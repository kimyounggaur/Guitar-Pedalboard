// S2.8 안전장치 시험(설계서 S2.8·E-12, 수용 기준 ①~③).
//
//   1. 순수 함수   src/persistence/presetUndo.ts — 지우기 전의 자리를 찾아 끼우는 계산과 겹치지 않는 이름 만들기.
//   2. 스토어      presetStore 의 savePreset(같은 이름 거부)·deletePreset·restoreDeletedPreset 이 저장소까지 정확히 바꾸는지.
//                 '묻지 않고 덮어쓰는 길이 없다'는 것을 저장소에 쓰기가 한 번도 없었다는 기록으로 확인한다.
//   3. 기본 설정   chainActions 의 isDefaultChain · 기억 → 처음 값으로 → 되돌리기가 켜짐·순서·음량 보정을 그대로 복원하는지.
//   4. IR 기억     AudioEngine 의 snapshotCabinetIrs/restoreCabinetIrs 가 같은 세션에서만 되돌리고 남의 IR 을 덮지 않는지.
//   5. 소스 검사   src/ 어디에도 window.confirm 이 없다(브라우저 기본 대화상자는 시험도 접근성도 약하다).
// 화면에서의 확인(토스트 8초·키보드로 '실행 취소'·대화상자 세 버튼·휴대폰 하단 시트)은 e2e E-12 가 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// ---------------------------------------------------------------------------------------------
// 가짜 브라우저 저장소: 쓰기 기록을 남긴다.
// ---------------------------------------------------------------------------------------------
const fakeValues = new Map();
const fakeWrites = [];
const dispatched = [];
globalThis.window = {
  dispatchEvent(event) {
    dispatched.push(event.type);
  },
  localStorage: {
    getItem: (key) => (fakeValues.has(key) ? fakeValues.get(key) : null),
    setItem(key, value) {
      fakeWrites.push({ key, value: String(value) });
      fakeValues.set(key, String(value));
    },
    removeItem: (key) => void fakeValues.delete(key),
    key: (index) => [...fakeValues.keys()][index] ?? null,
    get length() {
      return fakeValues.size;
    },
  },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

const bundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export * from './persistence/presetUndo.ts';",
      "export { STORAGE_KEYS } from './persistence/index.ts';",
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export { initialPedals, usePedalStore } from './store/pedalStore.ts';",
      "export { defaultPresets, usePresetStore } from './store/presetStore.ts';",
      "export { captureChainSnapshot, isDefaultChain, resetToDefaultChain, restoreChainSnapshot } from './store/chainActions.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'safeguards-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const app = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const {
  AudioEngine,
  STORAGE_KEYS,
  captureChainSnapshot,
  defaultPresets,
  idsAfter,
  initialPedals,
  isDefaultChain,
  keysAfter,
  reinsertByKey,
  reinsertId,
  resetToDefaultChain,
  restoreChainSnapshot,
  uniqueNumberedName,
  uniqueRestoredName,
  usePedalStore,
  usePresetStore,
} = app;

let checks = 0;
const ok = (condition, message) => {
  checks += 1;
  assert.ok(condition, message);
};
const equal = (actual, expected, message) => {
  checks += 1;
  assert.equal(actual, expected, message);
};
const deepEqual = (actual, expected, message) => {
  checks += 1;
  assert.deepEqual(actual, expected, message);
};
const clone = (value) => JSON.parse(JSON.stringify(value));

// ---------------------------------------------------------------------------------------------
// 1. 순수 함수
// ---------------------------------------------------------------------------------------------
{
  const items = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
  const keyOf = (item) => item.id;
  deepEqual(keysAfter(items, 'b', keyOf), ['c', 'd'], 'keysAfter: 뒤에 있던 것들(앞에서부터)');
  deepEqual(keysAfter(items, 'd', keyOf), [], 'keysAfter: 맨 끝이면 비어 있다');
  deepEqual(keysAfter(items, 'x', keyOf), [], 'keysAfter: 없는 key 면 비어 있다');
  deepEqual(keysAfter([], 'a', keyOf), [], 'keysAfter: 빈 목록');

  const without = (id) => items.filter((item) => item.id !== id);
  const ids = (list) => list.map(keyOf).join('');
  equal(ids(reinsertByKey(without('b'), { id: 'b' }, ['c', 'd'], keyOf)), 'abcd', 'reinsertByKey: 가운데 → 원래 자리');
  equal(ids(reinsertByKey(without('a'), { id: 'a' }, ['b', 'c', 'd'], keyOf)), 'abcd', 'reinsertByKey: 맨 앞');
  equal(ids(reinsertByKey(without('d'), { id: 'd' }, [], keyOf)), 'abcd', 'reinsertByKey: 맨 끝은 뒤에 붙인다');
  // 그 사이 바로 뒤 이웃(c)이 지워졌으면 그다음 이웃(d) 앞에
  equal(ids(reinsertByKey(['a', 'd'].map((id) => ({ id })), { id: 'b' }, ['c', 'd'], keyOf)), 'abd', 'reinsertByKey: 바로 뒤 이웃이 없으면 그다음 이웃 앞');
  // 뒤 이웃이 하나도 안 남았으면 맨 뒤
  equal(ids(reinsertByKey(['a'].map((id) => ({ id })), { id: 'b' }, ['c', 'd'], keyOf)), 'ab', 'reinsertByKey: 뒤 이웃이 모두 없으면 맨 뒤');
  equal(ids(reinsertByKey([], { id: 'b' }, ['c'], keyOf)), 'b', 'reinsertByKey: 빈 목록에도 끼운다');
  // 이미 있으면 바꾸지 않는다
  const same = reinsertByKey(items, { id: 'b' }, ['c'], keyOf);
  equal(ids(same), 'abcd', 'reinsertByKey: 같은 key 가 이미 있으면 그대로');
  ok(same !== items, 'reinsertByKey: 이미 있어도 새 배열을 돌려 준다(입력을 건드리지 않는다)');
  const input = without('b');
  reinsertByKey(input, { id: 'b' }, ['c'], keyOf);
  equal(ids(input), 'acd', 'reinsertByKey: 입력 배열을 바꾸지 않는다');

  deepEqual(idsAfter(['x', 'y', 'z'], 'x'), ['y', 'z'], 'idsAfter');
  deepEqual(reinsertId(['x', 'z'], 'y', ['z']), ['x', 'y', 'z'], 'reinsertId');
  deepEqual(reinsertId(['x', 'y'], 'y', ['z']), ['x', 'y'], 'reinsertId: 이미 있으면 그대로');

  equal(uniqueRestoredName('Lead', new Set()), 'Lead (복원)', 'uniqueRestoredName: 기본');
  equal(uniqueRestoredName('Lead', new Set(['Lead (복원)'])), 'Lead (복원 2)', 'uniqueRestoredName: 이미 쓰였으면 번호');
  equal(uniqueRestoredName('Lead', new Set(['Lead (복원)', 'Lead (복원 2)'])), 'Lead (복원 3)', 'uniqueRestoredName: 번호가 이어진다');
  equal(uniqueRestoredName('  Lead  ', new Set()), 'Lead (복원)', 'uniqueRestoredName: 앞뒤 공백은 뗀다');
  equal(uniqueRestoredName('   ', new Set()), 'Preset (복원)', 'uniqueRestoredName: 빈 이름도 이름이 된다');
  equal(uniqueNumberedName('Lead', new Set(['Lead'])), 'Lead (2)', 'uniqueNumberedName: 기본');
  equal(uniqueNumberedName('Lead', new Set(['Lead', 'Lead (2)', 'Lead (3)'])), 'Lead (4)', 'uniqueNumberedName: 쓰인 번호를 건너뛴다');
  equal(uniqueNumberedName('', new Set()), 'Preset (2)', 'uniqueNumberedName: 빈 이름');
}

// ---------------------------------------------------------------------------------------------
// 2. 스토어: 같은 이름 거부 · 삭제 기록 · 복원
// ---------------------------------------------------------------------------------------------
const presetStore = usePresetStore;
const presetsKey = STORAGE_KEYS.v2Presets;
const userPresets = () => presetStore.getState().presets.filter((preset) => !preset.isFactory);
const userNames = () => userPresets().map((preset) => preset.name);
const storedNames = () => JSON.parse(fakeValues.get(presetsKey)).presets.map((preset) => preset.name);
const board = () => clone(usePedalStore.getState().pedals);

{
  // 처음에는 사용자 프리셋이 없다. 저장은 맨 앞에 붙으므로 마지막에 저장한 것이 맨 앞이다.
  deepEqual(userNames(), [], '시작: 사용자 프리셋이 없다');
  for (const name of ['A', 'B', 'C', 'D']) equal(presetStore.getState().savePreset(name, board()), 'saved', `저장: ${name}`);
  deepEqual(userNames(), ['D', 'C', 'B', 'A'], '저장은 맨 앞에 붙는다');
  deepEqual(storedNames(), ['D', 'C', 'B', 'A'], '저장소에도 같은 순서');
  const factoryCount = presetStore.getState().presets.length - 4;
  equal(factoryCount, defaultPresets.length, '팩토리 프리셋은 그대로 따로 있다');

  // 같은 이름: 거부하고 아무것도 쓰지 않는다
  const before = clone(userPresets());
  const writesBefore = fakeWrites.length;
  usePedalStore.getState().setPresetTrimDb(-3);
  equal(presetStore.getState().savePreset('B', board()), 'exists', '같은 이름은 덮어쓰기 표시 없이는 거부');
  equal(presetStore.getState().savePreset('  B  ', board()), 'exists', '앞뒤 공백이 있어도 같은 이름');
  const writtenToPresets = fakeWrites.slice(writesBefore).filter((write) => write.key === presetsKey);
  equal(writtenToPresets.length, 0, '거부한 저장은 프리셋 저장소에 한 글자도 쓰지 않는다');
  deepEqual(userPresets(), before, '거부한 저장은 목록도 바꾸지 않는다');
  equal(presetStore.getState().savePreset('B', board(), undefined, { overwrite: false }), 'exists', 'overwrite:false 도 거부');
  equal(presetStore.getState().savePreset('B', board(), undefined, {}), 'exists', '빈 옵션도 거부');
  equal(presetStore.getState().savePreset('B', board(), undefined, { overwrite: undefined }), 'exists', 'overwrite 미지정도 거부');

  // 빈 이름
  equal(presetStore.getState().savePreset('   ', board()), 'invalid', '빈 이름은 invalid');
  deepEqual(userPresets(), before, 'invalid 도 아무것도 바꾸지 않는다');

  // 대소문자가 다르면 다른 이름이다(예전 동작 그대로)
  equal(presetStore.getState().savePreset('b', board()), 'saved', '대소문자가 다르면 다른 이름');
  deepEqual(userNames(), ['b', 'D', 'C', 'B', 'A'], '대소문자 다른 이름은 새 프리셋');
  presetStore.getState().deletePreset(userPresets()[0].id);

  // 팩토리와 같은 이름은 사용자 프리셋이 아니므로 새로 저장된다(예전 동작 그대로)
  const factoryName = defaultPresets[0].name;
  equal(presetStore.getState().savePreset(factoryName, board()), 'saved', '팩토리와 같은 이름도 사용자 프리셋으로 저장');
  equal(presetStore.getState().savePreset(factoryName, board()), 'exists', '그 사본과 같은 이름은 다시 묻는다');
  presetStore.getState().deletePreset(userPresets()[0].id);
  deepEqual(userNames(), ['D', 'C', 'B', 'A'], '시험용 저장분을 치웠다');

  // 덮어쓰기: 같은 id, 내용이 바뀌고 자리도 그대로
  const bBefore = userPresets().find((preset) => preset.name === 'B');
  usePedalStore.getState().setActive('delay', !usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').active);
  equal(presetStore.getState().savePreset('B', board(), undefined, { overwrite: true }), 'saved', 'overwrite:true 면 덮어쓴다');
  const bAfter = userPresets().find((preset) => preset.name === 'B');
  equal(bAfter.id, bBefore.id, '덮어써도 id 는 그대로');
  ok(JSON.stringify(bAfter.pedals) !== JSON.stringify(bBefore.pedals), '덮어쓰면 내용이 바뀐다');
  equal(bAfter.trimDb, -3, '덮어쓰면 음량 보정도 지금 값');
  deepEqual(userNames(), ['D', 'C', 'B', 'A'], '덮어써도 자리는 그대로');
  usePedalStore.getState().setPresetTrimDb(0);
  usePedalStore.getState().setPedals(clone(initialPedals), 0);
}

{
  // deletePreset: 기록을 돌려 준다
  const [d, c, b, a] = userPresets();
  const missing = presetStore.getState().deletePreset('없는-id');
  equal(missing, null, '없는 id 를 지우면 null');
  const factoryId = presetStore.getState().presets.find((preset) => preset.isFactory).id;
  const writesBefore = fakeWrites.length;
  equal(presetStore.getState().deletePreset(factoryId), null, '팩토리 프리셋은 지울 수 없다(null)');
  equal(fakeWrites.length, writesBefore, '팩토리를 지우려는 시도는 저장소를 건드리지 않는다');

  const record = presetStore.getState().deletePreset(c.id);
  ok(record !== null, '지우면 기록을 돌려 준다');
  equal(record.preset.id, c.id, '기록: 지운 프리셋');
  equal('isFactory' in record.preset, false, '기록: 목록용 isFactory 표시는 떼어 낸다');
  deepEqual(record.followingIds, [b.id, a.id], '기록: 뒤에 있던 내 프리셋들');
  deepEqual(userNames(), ['D', 'B', 'A'], '지운 뒤 목록');
  deepEqual(storedNames(), ['D', 'B', 'A'], '지운 뒤 저장소(바로 저장한다)');

  // 복원: 원래 자리
  const restored = presetStore.getState().restoreDeletedPreset(record);
  equal(restored.restored, true, '복원 성공');
  equal(restored.renamed, false, '이름은 그대로');
  deepEqual(userNames(), ['D', 'C', 'B', 'A'], '복원: 원래 자리');
  deepEqual(storedNames(), ['D', 'C', 'B', 'A'], '복원: 저장소에도 원래 자리');
  deepEqual(userPresets().find((preset) => preset.id === c.id), c, '복원: 내용이 지우기 전과 같다(시각·태그·음량 보정 포함)');

  // 두 번 복원하면 두 번째는 거절
  const twice = presetStore.getState().restoreDeletedPreset(record);
  equal(twice.restored, false, '이미 있으면 복원하지 않는다');
  equal(twice.reason, 'exists', '이유: exists');
  deepEqual(userNames(), ['D', 'C', 'B', 'A'], '두 번 복원해도 중복이 생기지 않는다');

  // 맨 앞·맨 끝
  const first = presetStore.getState().deletePreset(d.id);
  const last = presetStore.getState().deletePreset(a.id);
  deepEqual(userNames(), ['C', 'B'], '맨 앞과 맨 끝을 지웠다');
  presetStore.getState().restoreDeletedPreset(last);
  presetStore.getState().restoreDeletedPreset(first);
  deepEqual(userNames(), ['D', 'C', 'B', 'A'], '맨 앞·맨 끝 복원(순서와 무관)');

  // 여러 개를 지우고 지운 순서·반대 순서·뒤섞인 순서로 되돌려도 원래 순서
  const orders = [
    ['C', 'B'],
    ['B', 'C'],
  ];
  for (const order of orders) {
    const records = [];
    for (const name of ['C', 'B']) records.push(presetStore.getState().deletePreset(userPresets().find((preset) => preset.name === name).id));
    deepEqual(userNames(), ['D', 'A'], `둘을 지웠다(${order.join('→')} 로 되돌릴 준비)`);
    for (const name of order) presetStore.getState().restoreDeletedPreset(records.find((record_) => record_.preset.name === name));
    deepEqual(userNames(), ['D', 'C', 'B', 'A'], `${order.join('→')} 순서로 되돌려도 원래 순서`);
  }

  // 그 사이 이웃이 지워지거나 새로 저장됐을 때
  const middle = presetStore.getState().deletePreset(userPresets().find((preset) => preset.name === 'C').id);
  presetStore.getState().deletePreset(userPresets().find((preset) => preset.name === 'B').id);
  presetStore.getState().savePreset('N', board());
  deepEqual(userNames(), ['N', 'D', 'A'], '그 사이 이웃을 지우고 새 프리셋을 저장했다');
  presetStore.getState().restoreDeletedPreset(middle);
  deepEqual(userNames(), ['N', 'D', 'C', 'A'], '이웃이 사라졌으면 남은 다음 이웃 앞에 끼운다');
  presetStore.getState().deletePreset(userPresets().find((preset) => preset.name === 'N').id);
  presetStore.getState().savePreset('B', board());
  deepEqual(userNames(), ['B', 'D', 'C', 'A'], '시험 정리');

  // 그 사이 같은 이름이 쓰였을 때: '(복원)' 이름으로
  const target = presetStore.getState().deletePreset(userPresets().find((preset) => preset.name === 'D').id);
  equal(presetStore.getState().savePreset('D', board()), 'saved', '지운 이름으로 새로 저장했다');
  const renamed = presetStore.getState().restoreDeletedPreset(target);
  equal(renamed.restored, true, '이름이 겹쳐도 복원은 된다');
  equal(renamed.renamed, true, '이름이 바뀌었다고 알린다');
  equal(renamed.preset.name, 'D (복원)', "'(복원)' 이름");
  ok(userNames().includes('D') && userNames().includes('D (복원)'), '둘 다 남는다 — 어느 쪽도 덮어쓰지 않는다');
  equal(new Set(userNames()).size, userNames().length, '목록에 같은 이름이 둘 이상 없다');
  presetStore.getState().deletePreset(userPresets().find((preset) => preset.name === 'D (복원)').id);
  presetStore.getState().deletePreset(userPresets().find((preset) => preset.name === 'D').id);
  presetStore.getState().restoreDeletedPreset(target);
  deepEqual(userNames().filter((name) => name.startsWith('D')), ['D'], '정리 뒤 원래 이름으로 복원');

  // 팩토리는 이 과정에서 한 번도 흔들리지 않는다
  equal(presetStore.getState().presets.filter((preset) => preset.isFactory).length, defaultPresets.length, '팩토리 프리셋 수 그대로');
}

// ---------------------------------------------------------------------------------------------
// 3. 기본 페달 설정: 기억 · 처음 값으로 · 되돌리기
// ---------------------------------------------------------------------------------------------
{
  usePedalStore.getState().setPedals(clone(initialPedals), 0);
  const fresh = captureChainSnapshot();
  ok(isDefaultChain(fresh), '처음 상태는 기본 체인');
  deepEqual(fresh.cabinetIrs.entries, [], '기억: IR 이 없다');

  // 바뀐 곳 하나씩이 모두 '기본이 아님' 으로 잡힌다
  const toggled = clone(fresh);
  toggled.pedals[0].active = !toggled.pedals[0].active;
  ok(!isDefaultChain(toggled), '켜짐이 다르면 기본이 아니다');
  const reordered = clone(fresh);
  reordered.pedals.reverse();
  ok(!isDefaultChain(reordered), '순서가 다르면 기본이 아니다');
  const trimmed = clone(fresh);
  trimmed.presetTrimDb = 1;
  ok(!isDefaultChain(trimmed), '음량 보정이 0 이 아니면 기본이 아니다');
  const withIr = clone(fresh);
  withIr.cabinetIrs.entries.push({ pedalId: 'cab', name: 'x', buffer: null });
  ok(!isDefaultChain(withIr), '불러 둔 IR 이 있으면 기본이 아니다');
  const tweaked = clone(fresh);
  const firstParam = Object.keys(tweaked.pedals[0].params)[0];
  tweaked.pedals[0].params[firstParam] = typeof tweaked.pedals[0].params[firstParam] === 'number' ? tweaked.pedals[0].params[firstParam] + 1 : 'changed';
  ok(!isDefaultChain(tweaked), '노브 값이 다르면 기본이 아니다');

  // 실제 스토어로: 바꾼다 → 기억한다 → 기본으로 → 되돌린다
  const active = usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay');
  usePedalStore.getState().setActive('delay', !active.active);
  usePedalStore.getState().setPresetTrimDb(-2.5);
  usePedalStore.getState().reorderPedals(0, 3);
  const changed = captureChainSnapshot();
  ok(changed.pedals[0].id !== initialPedals[0].id, '순서를 바꿨다(시험 준비)');
  ok(!isDefaultChain(changed), '바꾼 뒤에는 기본이 아니다');
  equal(changed.presetTrimDb, -2.5, '기억: 음량 보정');
  const savedPedals = JSON.stringify(changed.pedals);

  // 기억한 값은 복사본이다 — 이후 변경이 닿지 않는다
  usePedalStore.getState().setActive('delay', active.active);
  usePedalStore.getState().reorderPedals(3, 0);
  equal(JSON.stringify(changed.pedals), savedPedals, '기억한 값은 이후의 변경에 영향을 받지 않는다');
  usePedalStore.getState().setActive('delay', !active.active);
  usePedalStore.getState().reorderPedals(0, 3);
  equal(JSON.stringify(usePedalStore.getState().pedals), savedPedals, '다시 같은 상태를 만들었다(시험 준비)');

  resetToDefaultChain();
  ok(isDefaultChain(captureChainSnapshot()), '처음 값으로 돌렸다');
  equal(usePedalStore.getState().presetTrimDb, 0, '음량 보정도 0');
  const storedAfterReset = JSON.parse(fakeValues.get(STORAGE_KEYS.v2State));
  equal(storedAfterReset.pedals.delay.active, active.active, '처음 값이 저장소에도 반영된다');
  equal(storedAfterReset.trimDb, 0, '처음 값의 음량 보정도 저장소에 반영된다');
  deepEqual(storedAfterReset.chain, initialPedals.map((pedal) => pedal.id), '처음 값의 순서도 저장소에 반영된다');

  const result = restoreChainSnapshot(changed);
  equal(result.cabinetIrsLost, 0, '되돌리기: 잃은 IR 없음');
  equal(JSON.stringify(usePedalStore.getState().pedals), savedPedals, '되돌리기: 모든 페달(켜짐·순서·노브)이 기억한 값과 같다');
  equal(usePedalStore.getState().presetTrimDb, -2.5, '되돌리기: 음량 보정');
  const storedAfterRestore = JSON.parse(fakeValues.get(STORAGE_KEYS.v2State));
  equal(storedAfterRestore.pedals.delay.active, !active.active, '되돌리기: 저장소에도 반영');
  equal(storedAfterRestore.trimDb, -2.5, '되돌리기: 음량 보정도 저장소에 반영');
  deepEqual(storedAfterRestore.chain, changed.pedals.map((pedal) => pedal.id), '되돌리기: 순서도 저장소에 반영');

  // 되돌리기가 기억한 값을 다시 바꾸지 않는다(두 번 되돌려도 같다)
  usePedalStore.getState().setPedals(clone(initialPedals), 0);
  restoreChainSnapshot(changed);
  restoreChainSnapshot(changed);
  equal(JSON.stringify(usePedalStore.getState().pedals), savedPedals, '두 번 되돌려도 같다');
  usePedalStore.getState().setPedals(clone(initialPedals), 0);
}

// ---------------------------------------------------------------------------------------------
// 4. IR 기억: 같은 세션에서만 · 남의 IR 을 덮지 않는다
// ---------------------------------------------------------------------------------------------
{
  const engine = AudioEngine.getInstance();
  const savedContext = engine.context;
  const savedGeneration = engine.sessionGeneration;
  engine.cabImpulses.clear();
  engine.context = { state: 'running' };
  engine.sessionGeneration = 7;
  const bufferA = { tag: 'A' };
  const bufferB = { tag: 'B' };
  engine.cabImpulses.set('cab-1', { name: 'room.wav', buffer: bufferA });
  engine.cabImpulses.set('cab-2', { name: 'hall.wav', buffer: bufferB });

  const snapshot = engine.snapshotCabinetIrs();
  equal(snapshot.generation, 7, 'IR 기억: 세션 번호');
  deepEqual(snapshot.entries.map((entry) => `${entry.pedalId}:${entry.name}`), ['cab-1:room.wav', 'cab-2:hall.wav'], 'IR 기억: 페달·이름');
  ok(snapshot.entries[0].buffer === bufferA, 'IR 기억: 버퍼는 복사하지 않고 그대로 잡는다(큰 데이터)');

  engine.clearAllCabinetIrs();
  equal(engine.cabImpulses.size, 0, '지우면 비어 있다');
  dispatched.length = 0;
  equal(engine.restoreCabinetIrs(snapshot), 2, '같은 세션이면 둘 다 되돌린다');
  equal(engine.getCabinetIrName('cab-1'), 'room.wav', '되돌린 IR 의 이름');
  ok(engine.cabImpulses.get('cab-2').buffer === bufferB, '되돌린 IR 의 버퍼');
  ok(dispatched.includes('cab-ir-change'), '되돌리면 화면에 알린다(cab-ir-change)');

  // 지금 같은 페달에 다른 IR 이 불려 있으면 그것을 지킨다
  engine.cabImpulses.clear();
  engine.cabImpulses.set('cab-1', { name: 'newer.wav', buffer: { tag: 'N' } });
  equal(engine.restoreCabinetIrs(snapshot), 1, '남의 IR 이 있는 페달은 건너뛴다');
  equal(engine.getCabinetIrName('cab-1'), 'newer.wav', '그 사이 불러 온 IR 을 덮어쓰지 않는다');
  equal(engine.getCabinetIrName('cab-2'), 'hall.wav', '나머지는 되돌린다');

  // 세션이 바뀌었으면(정지·다시 연결) 낡은 버퍼이므로 되돌리지 않는다
  engine.cabImpulses.clear();
  engine.sessionGeneration = 8;
  dispatched.length = 0;
  equal(engine.restoreCabinetIrs(snapshot), 0, '세션이 바뀌었으면 하나도 되돌리지 않는다');
  equal(engine.cabImpulses.size, 0, '낡은 IR 은 넣지 않는다');
  ok(!dispatched.includes('cab-ir-change'), '아무것도 안 바뀌었으면 알리지 않는다');

  // 오디오가 없거나 닫혔으면 되돌리지 않는다
  engine.sessionGeneration = 7;
  engine.context = null;
  equal(engine.restoreCabinetIrs(snapshot), 0, '오디오 컨텍스트가 없으면 0');
  engine.context = { state: 'closed' };
  equal(engine.restoreCabinetIrs(snapshot), 0, '닫힌 컨텍스트면 0');

  // 체인 되돌리기가 잃은 IR 수를 알려 준다
  engine.context = { state: 'running' };
  engine.sessionGeneration = 7;
  engine.cabImpulses.clear();
  engine.cabImpulses.set('cab-1', { name: 'room.wav', buffer: bufferA });
  const chainSnapshot = captureChainSnapshot();
  equal(chainSnapshot.cabinetIrs.entries.length, 1, '체인 기억에 IR 이 들어간다');
  ok(!isDefaultChain(chainSnapshot), 'IR 만 있어도 기본 체인이 아니다');
  resetToDefaultChain();
  equal(engine.cabImpulses.size, 0, '기본 설정은 IR 도 지운다');
  deepEqual(restoreChainSnapshot(chainSnapshot), { cabinetIrsLost: 0 }, '같은 세션이면 IR 을 잃지 않는다');
  equal(engine.getCabinetIrName('cab-1'), 'room.wav', '기본 설정을 되돌리면 IR 도 돌아온다');
  engine.sessionGeneration = 9;
  engine.cabImpulses.clear();
  deepEqual(restoreChainSnapshot(chainSnapshot), { cabinetIrsLost: 1 }, '세션이 바뀌었으면 잃은 IR 수를 알린다');

  engine.cabImpulses.clear();
  engine.context = savedContext;
  engine.sessionGeneration = savedGeneration;
  usePedalStore.getState().setPedals(clone(initialPedals), 0);
}

// ---------------------------------------------------------------------------------------------
// 5. 소스 검사: window.confirm 이 없다
// ---------------------------------------------------------------------------------------------
{
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
    }
  };
  await walk(root);
  ok(files.length > 50, `src 파일을 읽었다(${files.length}개)`);
  // 주석은 무시한다: 한 줄 주석과 블록 주석을 지운 뒤 찾는다.
  const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  const offenders = [];
  for (const file of files) {
    const text = stripComments(await readFile(file, 'utf8'));
    if (/(window|globalThis|self)\s*\.\s*(confirm|alert|prompt)\b/.test(text) || /(^|[^\w.$])(confirm|alert|prompt)\s*\(/.test(text)) offenders.push(file);
  }
  deepEqual(offenders, [], 'src 어디에도 브라우저 기본 confirm/alert/prompt 가 없다');
}

console.log(`safeguards regression passed (${checks} checks)`);
