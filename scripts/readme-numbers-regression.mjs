// S4.9 README 수치 자동 검사 — README.md 가 말하는 숫자와 이름이 코드에서 나온 실제 값과 같은지 본다(설계서 S4.9, R4-9).
// 코드가 바뀌었는데 README 가 옛 숫자를 말하는 일(예: 이펙터가 늘었는데 "12개" 로 남는 일)을 막는 것이 목적이다.
//   1. 이펙터 개수: README 의 "N개 이펙터" · "N개 페달" 표기는 모두 initialPedals 길이와 같다.
//   2. 이펙터 표: "이펙터와 파라미터" 표의 첫 칸 이름이 initialPedals 의 이름과 순서까지 같다.
//   3. 프리셋 개수: "N개 팩토리 프리셋" · "N개 프리셋" 표기는 모두 defaultPresets 길이와 같다.
//   4. 캐비닛: 표의 "N models" 는 실제 캐비닛 모델 수(+ Off) 와 같고, 사용자 IR 한도("최대 N MB·M초") 는 앱의 상수와 같다.
//   5. 단축키 범위: "1~N번째 페달" 의 N 은 이펙터 개수와 같다.
// 정규식 단언을 쓰지 않는다(test:test-system 규칙). README 는 문서이므로 읽는 것이 소스 읽기가 아니다 —
// 앱 소스 글자는 읽지 않고, esbuild 로 묶은 모듈이 내놓는 실제 값만 쓴다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

let checks = 0;
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const deepEqual = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

const rootUrl = new URL('../', import.meta.url);

// ── 코드에서 실제 값을 얻는다 ─────────────────────────────────────────────────────────────
const bundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { initialPedals } from './presets/initialPedals.ts';",
      "export { defaultPresets } from './store/presetStore.ts';",
      "export { CAB_LEVEL_TRIM_DB } from './audio/utils/cabinet.ts';",
      "export { MAX_CAB_IR_BYTES, MAX_CAB_IR_SECONDS } from './audio/utils/cabinetIr.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('src', rootUrl)),
    sourcefile: 'readme-numbers-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  jsx: 'automatic',
  target: 'node20',
  write: false,
});
const code = bundle.outputFiles[0].text;
const { initialPedals, defaultPresets, CAB_LEVEL_TRIM_DB, MAX_CAB_IR_BYTES, MAX_CAB_IR_SECONDS } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
);

const pedalNames = initialPedals.map((pedal) => pedal.name);
const cabModelCount = Object.keys(CAB_LEVEL_TRIM_DB).length;
const irMegabytes = MAX_CAB_IR_BYTES / (1024 * 1024);

const readme = await readFile(new URL('README.md', rootUrl), 'utf8');

// ── 글자 찾기 도구(정규식 없이) ─────────────────────────────────────────────────────────────
const isDigit = (ch) => ch >= '0' && ch <= '9';

/** `text` 안의 모든 `suffix` 바로 앞에 붙은 정수를 모은다. 예: numbersBefore('15개 이펙터', '개 이펙터') → [15]. */
function numbersBefore(text, suffix) {
  const found = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(suffix, from);
    if (at < 0) break;
    let start = at;
    while (start > 0 && isDigit(text[start - 1])) start -= 1;
    if (start < at) found.push(Number(text.slice(start, at)));
    from = at + suffix.length;
  }
  return found;
}

/** `text` 안의 모든 `prefix` 바로 뒤에 붙은 정수를 모은다. 예: numbersAfter('MB·2초', 'MB·') → [2]. */
function numbersAfter(text, prefix) {
  const found = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(prefix, from);
    if (at < 0) break;
    let end = at + prefix.length;
    const start = end;
    while (end < text.length && isDigit(text[end])) end += 1;
    if (end > start) found.push(Number(text.slice(start, end)));
    from = at + prefix.length;
  }
  return found;
}

/** 찾은 숫자가 모두 기대값과 같아야 한다. 하나도 못 찾으면 시험이 허공을 보는 것이므로 실패시킨다. */
function expectAll(label, values, expected) {
  ok(values.length > 0, `${label}: README 에서 숫자를 하나도 찾지 못했다(문구가 바뀌었다면 이 시험의 찾기 문구도 같이 고쳐야 한다)`);
  for (const value of values) equal(value, expected, `${label}: README 는 ${value} 라고 쓰는데 코드의 값은 ${expected}`);
}

// ── 0. 코드 쪽 값이 말이 되는지(시험 자체가 빈 값을 맞다고 하지 않게) ────────────────────────────
ok(pedalNames.length >= 10, `이펙터 이름을 읽지 못했다: ${pedalNames.length}`);
ok(new Set(pedalNames).size === pedalNames.length, '이펙터 이름이 겹친다');
ok(defaultPresets.length >= 10, `팩토리 프리셋을 읽지 못했다: ${defaultPresets.length}`);
ok(cabModelCount >= 3, `캐비닛 모델 수를 읽지 못했다: ${cabModelCount}`);
ok(Number.isInteger(irMegabytes) && irMegabytes > 0, `사용자 IR 한도가 MB 단위 정수가 아니다: ${MAX_CAB_IR_BYTES}`);

// ── 1. 이펙터 개수 ─────────────────────────────────────────────────────────────────────────
expectAll('이펙터 개수("N개 이펙터")', numbersBefore(readme, '개 이펙터'), pedalNames.length);
expectAll('페달 체인("N개 페달 체인")', numbersBefore(readme, '개 페달 체인'), pedalNames.length);

// ── 2. 이펙터 표: 이름과 순서 ───────────────────────────────────────────────────────────────
const lines = readme.split('\n');
const sectionStart = lines.findIndex((line) => line.trim() === '## 이펙터와 파라미터');
ok(sectionStart >= 0, 'README 에 "## 이펙터와 파라미터" 절이 없다');
const tableNames = [];
let seenHeader = false;
for (let i = sectionStart + 1; i < lines.length; i += 1) {
  const line = lines[i].trim();
  if (line.startsWith('## ')) break;
  if (!line.startsWith('|')) continue;
  const cells = line.split('|').map((cell) => cell.trim());
  const first = cells[1] ?? '';
  if (!seenHeader) { seenHeader = true; continue; } // 머리 줄
  if (first.startsWith('---')) continue; // 구분 줄
  tableNames.push(first);
}
deepEqual(tableNames, pedalNames, '이펙터 표의 이름·순서가 initialPedals 와 다르다');

// ── 3. 프리셋 개수 ─────────────────────────────────────────────────────────────────────────
expectAll('팩토리 프리셋("N개 팩토리 프리셋")', numbersBefore(readme, '개 팩토리 프리셋'), defaultPresets.length);
expectAll('프리셋("N개 프리셋")', numbersBefore(readme, '개 프리셋'), defaultPresets.length);

// ── 4. 캐비닛 ──────────────────────────────────────────────────────────────────────────────
// 표 문구는 "5 models+Off" 꼴이다. 앱의 Off 는 모델이 아니라 끔 상태이므로 모델 수만 센다.
expectAll('캐비닛 모델("N models")', numbersBefore(readme, ' models'), cabModelCount);
expectAll('사용자 IR 용량("최대 N MB")', numbersBefore(readme, ' MB·'), irMegabytes);
expectAll('사용자 IR 길이("MB·N초")', numbersAfter(readme, 'MB·'), MAX_CAB_IR_SECONDS);

// ── 5. 단축키 범위 ─────────────────────────────────────────────────────────────────────────
expectAll('단축키 범위("1~N번째 페달")', numbersBefore(readme, '번째 페달'), pedalNames.length);

// ── 6. 시험이 정말 잡는지(자기 점검): 숫자를 바꾼 가짜 README 에서 어긋남을 찾아낸다 ──────────────────
const wrong = readme.split(`${pedalNames.length}개 이펙터`).join(`${pedalNames.length + 1}개 이펙터`);
ok(wrong !== readme, '자기 점검용 가짜 README 를 만들지 못했다');
ok(numbersBefore(wrong, '개 이펙터').some((n) => n !== pedalNames.length), '자기 점검: 바뀐 숫자를 찾아내지 못했다');

console.log(`README 수치 검사 통과 — ${checks}개 확인 (이펙터 ${pedalNames.length}, 프리셋 ${defaultPresets.length}, 캐비닛 ${cabModelCount}, IR ${irMegabytes} MB·${MAX_CAB_IR_SECONDS}초)`);
