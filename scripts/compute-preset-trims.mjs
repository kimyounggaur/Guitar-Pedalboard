// 팩토리 프리셋의 음량 보정(trim)을 계산해 src/presets/factoryTrims.json 에 쓴다(설계서 GS-2, 결정 D6, S1.4c).
//
// 사용법
//   npm run trims                  프로브 P-05 를 돌려 40개 프리셋의 trim 을 다시 계산하고 JSON 을 갱신한다.
//   npm run trims -- --skip-build  이미 만든 dist-probe 를 그대로 쓴다(앱 코드가 그대로일 때만).
//   npm run trims -- --check       JSON 을 고치지 않고, 지금 JSON 이 계산값과 같은지만 본다(다르면 종료 코드 1).
//
// 하는 일
//   1. scripts/audio-render-probe.mjs --only P-05 --no-compare 로 프리셋마다 rawDb·rawPeakDb(보정·리미터 없는 REF-PC 출력의 RMS·피크)를 받는다.
//   2. 샘플레이트(44.1·48 kHz)별 RMS 는 평균하고, 피크는 큰 쪽을 쓴다. 실제 기기는 둘 중 하나로 도니 한쪽에 치우치지 않게 한다.
//   3. trimDb = 목표 − 평균 (0.1 dB 단위, ±24 dB). 단 보정한 피크가 0 dBFS(리미터 천장 −1 + 허용 감소량 1 dB)를 넘지 않게 거기서 멈춘다(GS-7).
//      목표는 src/audio/offline/loudnessSpec.ts 의 상수 하나(PRESET_TARGET_RMS_DBFS)와 프리셋별 예외(PRESET_TARGET_OFFSETS_DB)가 정한다.
//      기준을 바꾸고 싶으면 그 상수만 고치고 이 스크립트를 다시 돈다.
//
// 앞 단계가 바뀌면(S1.4b 처럼 Cab 음량이 바뀌거나 프리셋 정의를 고치면) raw 값이 달라지므로 다시 돌려 JSON 을 새로 커밋한다.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const trimsPath = join(root, 'src', 'presets', 'factoryTrims.json');
const probePath = join(root, 'scripts', 'audio-render-probe.mjs');
const RATES = [44100, 48000];

const args = process.argv.slice(2);
const check = args.includes('--check');
const skipBuild = args.includes('--skip-build');
for (const argument of args) {
  if (!['--check', '--skip-build'].includes(argument)) {
    console.error(`알 수 없는 옵션: ${argument}\n사용법: npm run trims -- [--skip-build] [--check]`);
    process.exit(2);
  }
}

// 기준 상수와 공식은 앱이 쓰는 파일 그대로 가져온다(복사본을 두지 않는다).
const specBundle = await build({
  entryPoints: [join(root, 'src/audio/offline/loudnessSpec.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const spec = await import(`data:text/javascript;base64,${Buffer.from(specBundle.outputFiles[0].text).toString('base64')}`);

function runProbe(outFile) {
  const probeArgs = [probePath, '--only', 'P-05', '--no-compare', '--rates', RATES.join(','), '--out', outFile];
  if (skipBuild) probeArgs.push('--skip-build');
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, probeArgs, { cwd: root, stdio: 'inherit', windowsHide: true });
    child.once('error', reject);
    child.once('exit', (code) => (code === 0 ? resolvePromise() : reject(new Error(`오디오 프로브가 코드 ${code} 로 끝났습니다.`))));
  });
}

const workDir = await mkdtemp(join(tmpdir(), 'guitar-pedalboard-trims-'));
let measured;
try {
  const outFile = join(workDir, 'p05.json');
  await runProbe(outFile);
  const text = await readFile(outFile, 'utf8').catch(() => null);
  if (text === null) {
    throw new Error('프로브 결과 파일이 없습니다. Chrome 을 찾지 못해 프로브가 건너뛰어졌을 수 있습니다(CHROME_PATH 를 지정하세요).');
  }
  measured = JSON.parse(text);
} finally {
  await rm(workDir, { recursive: true, force: true });
}

const perRate = RATES.map((rate) => {
  const probe = measured.results?.[rate]?.['P-05'];
  assert.ok(probe && !probe.error, `${rate} Hz P-05 측정이 없습니다.${probe?.error ? ` (${probe.error})` : ''}`);
  const raws = {};
  const peaks = {};
  for (const [key, value] of Object.entries(probe.metrics)) {
    if (key.startsWith('rawDb.')) raws[key.slice('rawDb.'.length)] = value;
    if (key.startsWith('rawPeakDb.')) peaks[key.slice('rawPeakDb.'.length)] = value;
  }
  assert.deepEqual(Object.keys(peaks), Object.keys(raws), `${rate} Hz: rawDb 와 rawPeakDb 의 프리셋 목록이 다릅니다.`);
  return { raws, peaks };
});

const ids = Object.keys(perRate[0].raws);
assert.ok(ids.length > 0, 'P-05 에 rawDb 측정이 없습니다.');
for (const { raws } of perRate) assert.deepEqual(Object.keys(raws), ids, '샘플레이트마다 프리셋 목록이 같아야 합니다.');

const trims = {};
const rows = [];
const peakLimited = [];
let clamped = 0;
let silent = 0;
for (const id of ids) {
  const mean = perRate.reduce((sum, { raws }) => sum + raws[id], 0) / perRate.length;
  const peak = Math.max(...perRate.map(({ peaks }) => peaks[id]));
  const target = spec.targetRmsDbfsFor(id);
  const trim = spec.trimDbFor(mean, target, peak);
  const limited = spec.isHeadroomLimited(mean, peak, target);
  if (mean < spec.MIN_MEASURABLE_RMS_DBFS) silent += 1;
  if (Math.abs(target - mean) > spec.PRESET_TRIM_LIMIT_DB) clamped += 1;
  if (limited) peakLimited.push(id);
  trims[id] = trim;
  rows.push({ id, rates: perRate.map(({ raws }) => raws[id]), mean, peak, target, trim, limited, expected: mean + trim, expectedPeak: peak + trim });
}

console.log('\n프리셋 | raw(44.1k) raw(48k) 평균 | 피크(큰 쪽) | 목표 | trim | 보정 뒤 예상 평균 | 보정 뒤 예상 피크 | 피크 제한');
for (const row of rows) {
  const cells = [
    row.id.replace(/^factory-/, ''),
    ...row.rates.map((value) => value.toFixed(2)),
    row.mean.toFixed(2),
    row.peak.toFixed(2),
    row.target.toFixed(1),
    spec.formatTrimDb(row.trim),
    row.expected.toFixed(2),
    row.expectedPeak.toFixed(2),
    row.limited ? '피크 제한' : '',
  ];
  console.log(cells.join(' | '));
}
const largestRateGap = Math.max(...rows.map((row) => Math.abs(row.rates[0] - row.rates[1])));
console.log(`\n프리셋 ${rows.length}개, 두 샘플레이트의 raw 차이 최대 ${largestRateGap.toFixed(3)} dB, ±${spec.PRESET_TRIM_LIMIT_DB} dB 한도에 걸린 프리셋 ${clamped}개, 소리가 없는 프리셋 ${silent}개`);
console.log(`피크 여유 때문에 평균 목표에 못 미치는 프리셋 ${peakLimited.length}개: ${peakLimited.map((id) => id.replace(/^factory-/, '')).join(', ') || '없음'}`);

const next = {
  generatedBy: 'scripts/compute-preset-trims.mjs (npm run trims)',
  note: '팩토리 프리셋의 음량 보정(dB). 직접 고치지 말고 npm run trims 로 다시 만든다. 기준값은 src/audio/offline/loudnessSpec.ts.',
  targetRmsDbfs: spec.PRESET_TARGET_RMS_DBFS,
  toleranceDb: spec.PRESET_TARGET_TOLERANCE_DB,
  offsetsDb: { ...spec.PRESET_TARGET_OFFSETS_DB },
  maxLimiterReductionDb: spec.PRESET_MAX_LIMITER_REDUCTION_DB,
  sampleRates: RATES,
  /** 순간 피크가 커서 평균 목표(−20 dBFS)까지 못 올린 프리셋(GS-7). 참고용이며 trims 에서 이미 반영됐다. */
  peakLimited,
  trims,
};
const nextText = `${JSON.stringify(next, null, 2)}\n`;

if (check) {
  const current = await readFile(trimsPath, 'utf8').catch(() => '');
  if (current === nextText) {
    console.log('factoryTrims.json 이 계산값과 같습니다.');
  } else {
    console.error('factoryTrims.json 이 계산값과 다릅니다. npm run trims 로 다시 만들어 커밋하세요.');
    process.exit(1);
  }
} else {
  await writeFile(trimsPath, nextText);
  console.log(`${trimsPath} 를 갱신했습니다.`);
}
