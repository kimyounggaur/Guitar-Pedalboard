// package.json 의 test:* 스크립트를 이름순으로 모두 실행하고, 결과를 시험마다 한 줄씩 보여 준다.
//
//   npm test                    전부 실행
//   npm test -- chorus tuner    이름에 chorus 또는 tuner 가 들어간 것만 실행
//   npm test -- --list          실행하지 않고 목록만 보여 줌
//   npm test -- --verbose       통과한 시험의 출력도 보여 줌
//
// 종료 코드: 0 = 모두 통과, 1 = 하나라도 실패, 2 = 사용법 오류(없는 옵션·맞는 시험 없음).
// 시험은 서로 독립된 프로세스로 차례로 돌린다(하나가 실패해도 나머지는 계속 돌린다).
import { spawn } from 'node:child_process';
import console from 'node:console';
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import process from 'node:process';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
/** 시험 하나가 이 시간을 넘기면 멈춘 것으로 보고 실패로 처리한다. */
const TIMEOUT_MS = 180_000;
/** `node 파일.mjs 인자…` 꼴이면 셸 없이 바로 실행한다(Windows 에서도 같은 방식으로 돈다). */
const SIMPLE_NODE_COMMAND = /^node\s+([^\s&|;<>"'`$]+)((?:\s+[^\s&|;<>"'`$]+)*)\s*$/;
/** 이 시험들은 빌드 결과(dist/)를 검사한다. dist/ 가 없으면 시험 전에 한 번 빌드한다. */
const TESTS_NEEDING_BUILD = new Set(['test:pwa']);
/** 통과한 시험이 남긴 '건너뜀' 경고는 놓치지 않도록 요약에 다시 보여 준다. */
const SKIP_WARNING = /skipp?ed|건너뜀|건너뛰/i;

const knownFlags = new Set(['--list', '--verbose']);
const args = process.argv.slice(2);
const flags = new Set(args.filter((arg) => arg.startsWith('--')));
const filters = args.filter((arg) => !arg.startsWith('--'));
for (const flag of flags) {
  if (!knownFlags.has(flag)) {
    console.error(`알 수 없는 옵션: ${flag} (쓸 수 있는 옵션: ${[...knownFlags].join(', ')})`);
    process.exit(2);
  }
}

const packageJson = JSON.parse(await readFile(join(projectRoot, 'package.json'), 'utf8'));
const allTests = Object.entries(packageJson.scripts ?? {})
  .filter(([name]) => name.startsWith('test:'))
  .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
const selectedTests = filters.length
  ? allTests.filter(([name]) => filters.some((filter) => name.slice('test:'.length).includes(filter)))
  : allTests;

if (selectedTests.length === 0) {
  console.error(
    filters.length
      ? `이름에 ${filters.join(', ')} 이(가) 들어간 test:* 스크립트가 없습니다. (전체 ${allTests.length}개)`
      : 'package.json 에 test:* 스크립트가 없습니다.',
  );
  process.exit(2);
}

if (flags.has('--list')) {
  for (const [name, command] of selectedTests) console.log(`${name}  →  ${command}`);
  console.log(`\n${selectedTests.length}개`);
  process.exit(0);
}

if (selectedTests.some(([name]) => TESTS_NEEDING_BUILD.has(name)) && !(await exists('dist/index.html'))) {
  console.log('dist/ 가 없어 먼저 빌드합니다(test:pwa 는 빌드 결과를 검사합니다).');
  const build = await runOne('build', 'npm run build');
  if (!build.ok) {
    console.log(`실패  build  ${formatSeconds(build.seconds)}  (${build.reason})`);
    printIndented(build.output || '(출력 없음)');
    process.exit(1);
  }
  console.log(`완료  build  ${formatSeconds(build.seconds)}\n`);
}

const nameWidth = Math.max(...selectedTests.map(([name]) => name.length));
const startedAll = process.hrtime.bigint();
const results = [];

for (const [name, command] of selectedTests) {
  const result = await runOne(name, command);
  results.push(result);
  const status = result.ok ? '통과' : '실패';
  const reason = result.ok ? '' : `  (${result.reason})`;
  console.log(`${status}  ${name.padEnd(nameWidth)}  ${formatSeconds(result.seconds)}${reason}`);

  if (!result.ok) {
    printIndented(result.output || '(출력 없음)');
  } else if (flags.has('--verbose')) {
    printIndented(result.output);
  } else {
    const warnings = result.output.split(/\r?\n/).filter((line) => SKIP_WARNING.test(line));
    for (const warning of warnings) console.log(`      경고: ${warning.trim()}`);
  }
}

const failed = results.filter((result) => !result.ok);
const totalSeconds = Number(process.hrtime.bigint() - startedAll) / 1e9;
console.log(
  `\n전체 ${results.length}개 중 ${results.length - failed.length}개 통과, ${failed.length}개 실패 (${formatSeconds(totalSeconds)})`,
);
if (failed.length > 0) {
  console.log(`실패: ${failed.map((result) => result.name).join(', ')}`);
  process.exitCode = 1;
}

function runOne(name, command) {
  return new Promise((resolve) => {
    const started = process.hrtime.bigint();
    const simple = SIMPLE_NODE_COMMAND.exec(command);
    const options = { cwd: projectRoot, env: process.env };
    const child = simple
      ? spawn(process.execPath, [simple[1], ...simple[2].split(/\s+/).filter(Boolean)], options)
      : spawn(command, { ...options, shell: true });

    const output = [];
    let timedOut = false;
    let finished = false;
    const finish = (ok, reason) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      resolve({
        name,
        ok,
        reason,
        output: output.join(''),
        seconds: Number(process.hrtime.bigint() - started) / 1e9,
      });
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => output.push(chunk));
    child.stderr.on('data', (chunk) => output.push(chunk));
    child.on('error', (error) => {
      output.push(`${error.message}\n`);
      finish(false, '실행하지 못함');
    });
    child.on('close', (code, signal) => {
      if (timedOut) finish(false, `${TIMEOUT_MS / 1000}초 안에 끝나지 않아 멈춤`);
      else if (code === 0) finish(true, '');
      else finish(false, signal ? `신호 ${signal}로 종료` : `종료 코드 ${code}`);
    });
  });
}

async function exists(relativePath) {
  try {
    await access(join(projectRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

function formatSeconds(seconds) {
  return `${seconds.toFixed(1)}초`;
}

function printIndented(text) {
  const lines = text.replace(/\s+$/, '').split(/\r?\n/);
  for (const line of lines) console.log(`      ${line}`);
}
