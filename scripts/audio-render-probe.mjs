// 오디오 렌더 프로브 실행기(설계서 S0.3, 6.2절).
// `vite build --mode test` 로 probe.html 을 빌드하고, 헤드리스 Chrome 에서 실제 이펙트 클래스·워클릿을
// OfflineAudioContext 로 렌더해 소리를 숫자로 잰 뒤, docs/baseline/audio-probe.json 과 허용 오차(tolerances.json)로 견준다.
//
//   npm run probe                        전체 프로브를 44.1·48 kHz 에서 돌려 기준선과 비교
//   npm run probe -- --only P-01,P-04    일부 프로브만
//   npm run probe -- --rates 48000       샘플레이트 지정(쉼표로 여러 개)
//   npm run probe -- --update            기준선 갱신(커밋 메시지는 `baseline: {Step ID} {이유}`)
//   npm run probe -- --verbose           모든 측정값을 출력
//   npm run probe -- --skip-build        이미 있는 dist-probe 를 다시 빌드하지 않음
//   npm run probe -- --out result.json   이번 측정값 전체를 JSON 으로 저장
//
// 종료 코드: 0 통과(또는 로컬에서 Chrome 이 없어 건너뜀), 1 기준선과 다르거나 프로브 실패, 2 사용법 오류.
// CI(CI=true)에서 Chrome 이 없으면 건너뛰지 않고 실패한다(scripts/lib/chrome.mjs 의 requireChrome).
import { spawn } from 'node:child_process';
import console from 'node:console';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { delay, getOpenPort, requireChrome, startChrome } from './lib/chrome.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'dist-probe');
const baselinePath = join(root, 'docs', 'baseline', 'audio-probe.json');
const tolerancesPath = join(root, 'docs', 'baseline', 'tolerances.json');
const SAMPLE_RATES = [44100, 48000];
const PROBE_TIMEOUT_MS = Number(process.env.PROBE_TIMEOUT_MS ?? 420_000);

/** 실행 요약에 보여 줄 대표 측정값. 전체는 --verbose 나 기준선 JSON 에서 본다. */
const HEADLINES = {
  'P-01': ['noiseOutDb', 'playedOutDb', 'differenceDb'],
  'P-02': ['inputDropDb', 'outputDropDb'],
  'P-03': ['peakWithLimiterDb', 'peakWithoutLimiterDb', 'defaultCabOffPeakDb', 'defaultCabOffPeakWithoutLimiterDb'],
  'P-04': ['defaultDiffDb', 'maxAbsDiffDb', 'myIrRealMaxAbsDiffDb', 'myIrStressMaxAbsDiffDb'],
  'P-05': ['rawMinDb', 'rawMaxDb', 'minDb', 'maxDb', 'spreadDb', 'maxAbsDeviationDb', 'maxLimiterReductionDb', 'cleanDrive.maxDiffDb', 'quick.maxAbsErrorDb'],
  'P-06': ['auto.left.decision', 'auto.left.lrDiffDb', 'auto.left.lossDb', 'auto.left.decisionSeconds', 'auto.right.lrDiffDb', 'auto.both.lossDb'],
  'P-08': ['mix75.rippleDb', 'mix45.rippleDb'],
  'P-09': ['maxAbsLrDiffDb'],
  'P-10': ['minHz', 'maxHz', 'deviationPercent'],
  'P-11': ['static.comb.firstNotchHz', 'static.comb.impliedDelayMs', 'sweep.minHz', 'sweep.maxHz'],
  'P-12': ['highBandRippleDb', 'maxDb', 'minDb'],
  'P-13': ['distortion.30', 'overdrive.30', 'distortion.monotonic'],
  'P-14': ['gain.20', 'gain.30', 'smallestStepPercent'],
  'P-15': ['delay.dryChangeDb', 'reverb.dryChangeDb', 'delay.pcDryChangeDb'],
  'P-16': ['latencyMs.compressor', 'latencyMs.default', 'impulseOnsetMs.default'],
  'P-17': ['cpuShare.allOff', 'cpuShare.allOn', 'cpuShare.phaserOff', 'ratio.allOffOverAllOn'],
  'P-18': ['tested', 'unchangedCount', 'unchangedFlatEq', 'unchangedUnexpected', 'loadNullDb'],
  'P-19': ['nullDb.worst', 'activeMismatch', 'presetMissing', 'visit1.legacy', 'visit2.v2'],
  'P-20': ['maxStoredDecay'],
  'P-21': ['displayedSilenceDb', 'displayedToneDb'],
  'P-22': ['maxAbsCentsOpenStrings', 'cents.B1', 'cents.C2'],
  'P-23': ['maxClickRatioDb', 'totalNodesCreated'],
};

function usage(message) {
  if (message) console.error(`오류: ${message}`);
  console.error('사용법: npm run probe -- [--only P-01,P-04] [--rates 44100,48000] [--update] [--verbose] [--skip-build] [--no-compare] [--out 파일.json]');
  process.exit(2);
}

function parseArgs(argv) {
  const options = { update: false, only: null, rates: SAMPLE_RATES, skipBuild: false, verbose: false, out: null, noCompare: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const value = () => {
      index += 1;
      if (index >= argv.length) usage(`${argument} 뒤에 값이 필요합니다.`);
      return argv[index];
    };
    if (argument === '--update') options.update = true;
    else if (argument === '--verbose') options.verbose = true;
    else if (argument === '--skip-build') options.skipBuild = true;
    else if (argument === '--no-compare') options.noCompare = true;
    else if (argument === '--only') options.only = value().split(',').map((id) => id.trim().toUpperCase()).filter(Boolean);
    else if (argument === '--rates') options.rates = value().split(',').map((rate) => Number(rate.trim()));
    else if (argument === '--out') options.out = value();
    else usage(`알 수 없는 옵션: ${argument}`);
  }
  if (options.rates.some((rate) => !Number.isInteger(rate) || rate < 8000)) usage('--rates 는 정수 샘플레이트여야 합니다.');
  if (options.noCompare && options.update) usage('--no-compare 와 --update 는 함께 쓸 수 없습니다.');
  return options;
}

// ---------------------------------------------------------------------------------------------
// 빌드와 정적 서버
// ---------------------------------------------------------------------------------------------
function runProcess(command, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let output = '';
    child.stdout.on('data', (chunk) => { output += chunk; });
    child.stderr.on('data', (chunk) => { output += chunk; });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolvePromise(output);
      else reject(new Error(`${command} ${args.join(' ')} 가 코드 ${code} 로 끝났습니다.\n${output}`));
    });
  });
}

async function buildProbeBundle() {
  const viteBin = join(root, 'node_modules', 'vite', 'bin', 'vite.js');
  await runProcess(process.execPath, [viteBin, 'build', '--mode', 'test', '--outDir', 'dist-probe', '--logLevel', 'warn']);
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
};

function startStaticServer(directory, port) {
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const pathname = decodeURIComponent(url.pathname);
      const file = normalize(join(directory, pathname.endsWith('/') ? `${pathname}probe.html` : pathname));
      if (file !== directory && !file.startsWith(directory + sep)) {
        response.writeHead(403).end('forbidden');
        return;
      }
      const body = await readFile(file);
      response.writeHead(200, {
        'content-type': MIME_TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      response.end(body);
    } catch {
      response.writeHead(404).end('not found');
    }
  });
  return new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolvePromise(server));
  });
}

// ---------------------------------------------------------------------------------------------
// 브라우저 실행
// ---------------------------------------------------------------------------------------------
function describeException(details) {
  return details.exception?.description ?? details.exception?.value ?? details.text ?? '알 수 없는 페이지 오류';
}

async function evaluate(cdp, expression, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`시간 초과(${Math.round(timeoutMs / 1000)}초): ${expression.slice(0, 80)}`)), timeoutMs);
  });
  try {
    const result = await Promise.race([
      cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }),
      timeout,
    ]);
    if (result.exceptionDetails) throw new Error(describeException(result.exceptionDetails));
    return result.result.value;
  } finally {
    clearTimeout(timer);
  }
}

async function openProbePage(cdp, url, pageMessages, { listen = true } = {}) {
  // 같은 연결로 페이지를 다시 열 때는 듣는 쪽을 또 달지 않는다(메시지가 두 번 쌓인다).
  if (listen) {
    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    cdp.on('Runtime.exceptionThrown', (params) => pageMessages.push(`예외: ${describeException(params.exceptionDetails ?? {})}`));
    cdp.on('Runtime.consoleAPICalled', (params) => {
      if (params.type !== 'error' && params.type !== 'warning') return;
      const text = (params.args ?? []).map((argument) => argument.value ?? argument.description ?? '').join(' ');
      pageMessages.push(`${params.type}: ${text}`);
    });
  }
  const loaded = new Promise((resolvePromise) => cdp.on('Page.loadEventFired', resolvePromise));
  await cdp.send('Page.navigate', { url });
  await Promise.race([loaded, delay(30_000).then(() => { throw new Error('probe.html 로드 시간 초과'); })]);
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await evaluate(cdp, 'Boolean(window.__probe && window.__probe.ready)', 10_000)) return;
    await delay(100);
  }
  throw new Error(`probe.html 이 준비되지 않았습니다.\n${pageMessages.join('\n')}`);
}

// ---------------------------------------------------------------------------------------------
// 비교
// ---------------------------------------------------------------------------------------------
function globToRegExp(glob) {
  return new RegExp(`^${glob.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')}$`);
}

function toleranceFor(tolerances, probeId, key) {
  const path = `${probeId}.${key}`;
  for (const rule of tolerances.rules ?? []) {
    if (globToRegExp(rule.match).test(path)) return rule;
  }
  return tolerances.default ?? { abs: 0.05 };
}

function differsFrom(rule, expected, actual) {
  if (rule.ignore) return null;
  // atMost: 잔차·널 시험처럼 수치 잡음 바닥에 가까운 값은 기준값과의 차이 대신 상한만 본다.
  if (typeof rule.atMost === 'number' && typeof actual === 'number') {
    return actual <= rule.atMost ? null : `${actual} (상한 ${rule.atMost})`;
  }
  if (typeof expected === 'number' && typeof actual === 'number') {
    const allowed = Math.max(rule.abs ?? 0, (rule.rel ?? 0) * Math.abs(expected));
    if (Math.abs(actual - expected) <= allowed) return null;
    return `${actual} (기준 ${expected}, 허용 ±${Number(allowed.toFixed(4))})`;
  }
  return Object.is(expected, actual) ? null : `${JSON.stringify(actual)} (기준 ${JSON.stringify(expected)})`;
}

/**
 * 수용 기준(criteria): 기준선과 상관없이 지켜야 하는 절대 한계. 기준선을 갱신해도 이 값은 어길 수 없다.
 * `--only` 로 일부만 돌렸을 때는 돌리지 않은 프로브의 기준이 맞는 측정값이 없어도 경고하지 않는다.
 */
function checkCriteria(results, tolerances, { partial }) {
  const failures = [];
  const warnings = [];
  for (const criterion of tolerances.criteria ?? []) {
    const matcher = globToRegExp(criterion.match);
    let matched = 0;
    for (const [rate, probes] of Object.entries(results)) {
      for (const [id, current] of Object.entries(probes)) {
        if (current.error) continue;
        for (const [key, actual] of Object.entries(current.metrics)) {
          if (!matcher.test(`${id}.${key}`)) continue;
          matched += 1;
          const label = `${rate} Hz ${id}.${key}`;
          const step = criterion.step ? `${criterion.step} ` : '';
          if (typeof actual !== 'number' || !Number.isFinite(actual)) {
            failures.push(`${label}: ${JSON.stringify(actual)} (${step}수용 기준은 숫자여야 함)`);
            continue;
          }
          if (typeof criterion.atLeast === 'number' && !(actual >= criterion.atLeast)) {
            failures.push(`${label}: ${formatValue(actual)} (${step}수용 기준 하한 ${criterion.atLeast})`);
          }
          if (typeof criterion.atMost === 'number' && !(actual <= criterion.atMost)) {
            failures.push(`${label}: ${formatValue(actual)} (${step}수용 기준 상한 ${criterion.atMost})`);
          }
        }
      }
    }
    if (matched === 0 && !partial) warnings.push(`수용 기준 ${criterion.match} 에 맞는 측정값이 없습니다(이름이 바뀌었는지 확인).`);
  }
  return { failures, warnings };
}

function compareResults(results, baseline, tolerances, options) {
  const failures = [];
  const warnings = [];
  for (const [rate, probes] of Object.entries(results)) {
    for (const [id, current] of Object.entries(probes)) {
      if (current.error) continue;
      const recorded = baseline.results?.[rate]?.[id];
      if (!recorded) {
        failures.push(`${rate} Hz ${id}: 기준선에 없습니다(npm run probe -- --update).`);
        continue;
      }
      for (const [key, expected] of Object.entries(recorded.metrics)) {
        if (!(key in current.metrics)) {
          failures.push(`${rate} Hz ${id}.${key}: 이번 측정에 없습니다.`);
          continue;
        }
        const difference = differsFrom(toleranceFor(tolerances, id, key), expected, current.metrics[key]);
        if (difference) failures.push(`${rate} Hz ${id}.${key}: ${difference}`);
      }
      for (const key of Object.keys(current.metrics)) {
        if (!(key in recorded.metrics)) warnings.push(`${rate} Hz ${id}.${key}: 기준선에 없는 새 측정값입니다.`);
      }
    }
  }
  const criteria = checkCriteria(results, tolerances, { partial: Boolean(options?.only) });
  failures.push(...criteria.failures);
  warnings.push(...criteria.warnings);
  return { failures, warnings };
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT' && fallback !== undefined) return fallback;
    throw new Error(`${path} 를 읽지 못했습니다: ${error.message}`);
  }
}

function idOrder(a, b) {
  return a.localeCompare(b, 'en', { numeric: true });
}

function mergeBaseline(existing, results, options, environment) {
  const baseline = existing ?? { schema: 1, results: {} };
  baseline.schema = 1;
  baseline.description = '오디오 렌더 프로브 기준선. npm run probe -- --update 로만 갱신하고 커밋 메시지는 `baseline: {Step ID} {이유}` 로 적는다.';
  baseline.generatedWith = environment;
  baseline.results ??= {};
  for (const [rate, probes] of Object.entries(results)) {
    if (!options.only) baseline.results[rate] = {};
    baseline.results[rate] ??= {};
    for (const [id, current] of Object.entries(probes)) {
      if (current.error) continue;
      baseline.results[rate][id] = { title: current.title, metrics: current.metrics };
    }
    baseline.results[rate] = Object.fromEntries(Object.entries(baseline.results[rate]).sort(([a], [b]) => idOrder(a, b)));
  }
  baseline.results = Object.fromEntries(Object.entries(baseline.results).sort(([a], [b]) => Number(a) - Number(b)));
  return baseline;
}

// ---------------------------------------------------------------------------------------------
// 실행
// ---------------------------------------------------------------------------------------------
function formatValue(value) {
  return typeof value === 'number' ? String(Number(value.toFixed(3))) : JSON.stringify(value);
}

function printResult(rate, result, options) {
  const seconds = (result.milliseconds / 1000).toFixed(1);
  if (result.error) {
    console.log(`  [${rate} Hz] ${result.id} ${result.title ?? ''}: 실패 — ${result.error}`);
    return;
  }
  const keys = options.verbose ? Object.keys(result.metrics) : (HEADLINES[result.id] ?? []).filter((key) => key in result.metrics);
  console.log(`  [${rate} Hz] ${result.id} ${result.title} (${seconds}초)`);
  if (keys.length > 0) console.log(`      ${keys.map((key) => `${key}=${formatValue(result.metrics[key])}`).join('  ')}`);
  for (const note of result.notes ?? []) console.log(`      참고: ${note}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const startedAt = Date.now();

  const chromePath = await requireChrome('Audio render probe');
  if (!chromePath) {
    console.warn('Audio render probe skipped (건너뜀): Chrome 또는 WebSocket 을 쓸 수 없습니다. CHROME_PATH 를 설치된 Chrome 으로 지정하세요.');
    return 0;
  }

  if (!options.skipBuild || !existsSync(join(outDir, 'probe.html'))) await buildProbeBundle();

  const port = await getOpenPort();
  const server = await startStaticServer(outDir, port);
  const pageMessages = [];
  let browser;
  const results = {};
  let chromeVersion = 'unknown';
  try {
    browser = await startChrome({ chromePath, profilePrefix: 'guitar-pedalboard-probe-', quiet: true });
    const { cdp } = browser;
    chromeVersion = (await cdp.send('Browser.getVersion')).product;
    const probeUrl = `http://127.0.0.1:${port}/probe.html`;
    await openProbePage(cdp, probeUrl, pageMessages);

    const available = await evaluate(cdp, 'window.__probe.list()', 10_000);
    const ids = options.only ?? available.map((probe) => probe.id);
    const unknown = ids.filter((id) => !available.some((probe) => probe.id === id));
    if (unknown.length > 0) usage(`없는 프로브: ${unknown.join(', ')} (있는 것: ${available.map((probe) => probe.id).join(', ')})`);

    console.log(`오디오 렌더 프로브 — ${chromeVersion}, 샘플레이트 ${options.rates.join('·')} Hz, 프로브 ${ids.length}개`);
    for (const [rateIndex, rate] of options.rates.entries()) {
      // 샘플레이트마다 새 문서로 시작한다. 프로브가 늘어 렌더가 천 번을 넘으면(S4.2 의 P-30 이 백여 번을 더했다) 한 문서가 만든
      // 컨텍스트·워클릿 영역이 다 거두어지기 전에 다음 렌더가 끝나지 않고 멈췄다(L-268). 문서를 비우면 한꺼번에 정리된다.
      if (rateIndex > 0) {
        await cdp.send('Page.navigate', { url: 'about:blank' });
        await openProbePage(cdp, probeUrl, pageMessages, { listen: false });
      }
      results[rate] = {};
      for (const id of ids) {
        const title = available.find((probe) => probe.id === id)?.title;
        const started = Date.now();
        try {
          const result = await evaluate(cdp, `window.__probe.run(${JSON.stringify(id)}, ${rate})`, PROBE_TIMEOUT_MS);
          results[rate][id] = result;
        } catch (error) {
          results[rate][id] = { id, title, error: error.message, milliseconds: Date.now() - started, metrics: {}, notes: [] };
        }
        printResult(rate, results[rate][id], options);
      }
    }
  } finally {
    await browser?.close();
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }

  if (options.out) {
    await mkdir(dirname(resolve(options.out)), { recursive: true });
    await writeFile(options.out, `${JSON.stringify({ chrome: chromeVersion, results }, null, 2)}\n`);
  }

  const errors = Object.entries(results).flatMap(([rate, probes]) =>
    Object.values(probes).filter((probe) => probe.error).map((probe) => `${rate} Hz ${probe.id}: ${probe.error}`));
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  // 측정값만 필요할 때(scripts/compute-preset-trims.mjs). 기준선·수용 기준과 비교하지 않는다. 실행 오류만 실패로 본다.
  if (options.noCompare) {
    if (errors.length > 0) {
      console.error(`\n실행 오류 ${errors.length}건 (${seconds}초):\n- ${errors.join('\n- ')}`);
      return 1;
    }
    console.log(`\n측정만 했습니다(기준선과 비교하지 않음) (${seconds}초)`);
    return 0;
  }

  if (options.update) {
    if (errors.length > 0) {
      console.error(`\n실행 오류가 있어 기준선을 갱신하지 않습니다 (${seconds}초):\n- ${errors.join('\n- ')}`);
      return 1;
    }
    const tolerancesForUpdate = await readJson(tolerancesPath, { default: { abs: 0.05 }, rules: [] });
    const criteria = checkCriteria(results, tolerancesForUpdate, { partial: Boolean(options.only) });
    for (const warning of criteria.warnings) console.warn(`경고: ${warning}`);
    if (criteria.failures.length > 0) {
      console.error(`\n수용 기준을 어기는 값은 기준선으로 만들 수 없어 갱신하지 않습니다 (${seconds}초):\n- ${criteria.failures.join('\n- ')}`);
      return 1;
    }
    const existing = await readJson(baselinePath, null);
    const next = mergeBaseline(existing, results, options, { chrome: chromeVersion, node: process.version, script: 'scripts/audio-render-probe.mjs' });
    await mkdir(dirname(baselinePath), { recursive: true });
    await writeFile(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(`\n기준선을 갱신했습니다: ${baselinePath} (${seconds}초)\n커밋 메시지: baseline: {Step ID} {이유}`);
    return 0;
  }

  const baseline = await readJson(baselinePath, null);
  if (!baseline) {
    console.error(`\n기준선이 없습니다: ${baselinePath}\n처음이라면 npm run probe -- --update 로 만드세요.`);
    return 1;
  }
  const tolerances = await readJson(tolerancesPath, { default: { abs: 0.05 }, rules: [] });
  const { failures, warnings } = compareResults(results, baseline, tolerances, options);
  if (baseline.generatedWith?.chrome && baseline.generatedWith.chrome !== chromeVersion) {
    warnings.push(`Chrome 버전이 기준선(${baseline.generatedWith.chrome})과 다릅니다: ${chromeVersion}`);
  }
  for (const warning of warnings) console.warn(`경고: ${warning}`);
  const all = [...errors, ...failures];
  if (all.length > 0) {
    console.error(`\n오디오 렌더 프로브 실패 ${all.length}건 (${seconds}초):\n- ${all.join('\n- ')}`);
    if (pageMessages.length > 0) console.error(`\n페이지 메시지:\n${pageMessages.slice(0, 20).join('\n')}`);
    return 1;
  }
  console.log(`\n오디오 렌더 프로브 통과: 기준선과 일치 (${seconds}초)`);
  return 0;
}

main().then(
  (code) => { process.exit(code); },
  (error) => {
    console.error(error instanceof Error ? error.stack ?? error.message : error);
    process.exit(1);
  },
);
