// S2.7 내보내기·가져오기 v2 — 파일을 만들고 읽고 가르는 규칙(설계서 4.7절 '내보내기 파일 형식 v2', E-11 수용 기준의 앞쪽 절반).
//   · 내보내기: 내 프리셋만(origin 'user'), 한 개도 없으면 파일을 만들지 않는다(null), 파일 모양은 v2
//   · 가져오기가 받는 파일: v2, 그리고 예전 형식 — 배열·`{version, presets}`, 팩토리 40개가 함께 든 파일
//   · 가르기: 팩토리 제외(origin·`factory-` id·이름+내용 일치) → 똑같은 것은 조용히 건너뜀 → id/이름이 같고 내용이 다르면 충돌 → 나머지는 추가
//   · 충돌 처리(덮어쓰기 / 사본으로 추가 / 건너뛰기), 선택이 없으면 건너뛰기, 입력은 바꾸지 않는다
//   · 저장: 바뀐 것이 없으면(같은 파일을 다시 가져오면) 저장소를 건드리지 않는다. 가져온 뒤 저장본에는 팩토리 id 가 없다
//   · 틀린 파일은 한국어 메시지로 거절하고 아무것도 바꾸지 않는다
// 화면(파일 선택 창·대화상자·버튼)은 e2e E-11 이 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// ---------------------------------------------------------------------------------------------
// 가짜 브라우저 저장소. 쓰기 기록을 남겨 '바뀐 것이 없으면 저장하지 않는다'를 본다.
// ---------------------------------------------------------------------------------------------
const storageWrites = [];
const storageValues = new Map();
globalThis.window = {
  dispatchEvent() {},
  localStorage: {
    getItem: (key) => storageValues.get(key) ?? null,
    setItem(key, value) {
      storageWrites.push({ key, value });
      storageValues.set(key, value);
    },
    removeItem: (key) => storageValues.delete(key),
  },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

const harnessBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { appVersion } from './app/errorReport.ts';",
      "export { STORAGE_KEYS } from './persistence/index.ts';",
      "export { EXPORT_FORMAT, applyImport, buildExportFile, formatImportSummary, parseImportFile, planImport, serializeExportFile, uniqueCopyName } from './persistence/exportFormat.ts';",
      "export { presetContentKey } from './persistence/schema.ts';",
      "export { clonePedals, usePedalStore } from './store/pedalStore.ts';",
      "export { defaultPresets, parsePresetJson, serializePresetPayload, usePresetStore } from './store/presetStore.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'export-format-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const {
  appVersion, STORAGE_KEYS, EXPORT_FORMAT, applyImport, buildExportFile, formatImportSummary, parseImportFile, planImport,
  serializeExportFile, uniqueCopyName, presetContentKey, clonePedals, usePedalStore, defaultPresets, parsePresetJson, serializePresetPayload,
  usePresetStore,
} = await import(`data:text/javascript;base64,${Buffer.from(harnessBundle.outputFiles[0].text).toString('base64')}`);

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
const throwsKorean = (fn, pattern, message) => {
  checks += 1;
  assert.throws(fn, (error) => error instanceof Error && pattern.test(error.message), message);
};
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

const store = () => usePresetStore.getState();
const userPresets = () => store().presets.filter((preset) => !preset.isFactory);
const pedalsNow = () => clonePedals(usePedalStore.getState().pedals);
const withDrive = (drive) => pedalsNow().map((pedal) => (pedal.id === 'drive' ? { ...pedal, params: { ...pedal.params, drive } } : pedal));
const presetWrites = () => storageWrites.filter((write) => write.key === STORAGE_KEYS.v2Presets);
const storedPresets = () => JSON.parse(storageValues.get(STORAGE_KEYS.v2Presets)).presets;

let idCounter = 0;
const createId = () => `new-id-${(idCounter += 1)}`;
const NOW = 1_800_000_000_000;
const fileOf = (text) => parseImportFile(text);
const planOf = (text, existing = [], factory = defaultPresets) => planImport(fileOf(text), existing, factory);
const preset = (id, name, extra = {}) => ({ id, name, pedals: pedalsNow(), updatedAt: 1000, ...extra });
/** 팩토리 표시(isFactory)를 뗀 복사본. 예전 앱이 파일로 내보낼 때의 모양이다. `drop` 으로 다른 필드도 뗀다. */
const plain = (item, ...drop) => {
  const copy = { ...item };
  for (const key of ['isFactory', ...drop]) delete copy[key];
  return copy;
};

// ---------------------------------------------------------------------------------------------
// 1. 팩토리 프리셋은 코드에 있고 40개다(예전 파일에 든 수와 같다)
// ---------------------------------------------------------------------------------------------
equal(defaultPresets.length, 40, '팩토리 프리셋은 40개');
ok(defaultPresets.every((item) => item.id.startsWith('factory-') && item.isFactory === true), '팩토리 id 는 모두 factory- 로 시작');

// ---------------------------------------------------------------------------------------------
// 2. 내보내기: 내 프리셋이 없으면 파일을 만들지 않는다
// ---------------------------------------------------------------------------------------------
equal(userPresets().length, 0, '시작할 때 내 프리셋은 0개');
const writesBeforeExport = storageWrites.length;
equal(store().exportPresets(), null, '내 프리셋이 0개면 내보내기는 null(빈 파일을 만들지 않는다)');
equal(storageWrites.length, writesBeforeExport, '내보내기는 저장소에 쓰지 않는다');

// ---------------------------------------------------------------------------------------------
// 3. 내보내기: 내 프리셋만, v2 모양
// ---------------------------------------------------------------------------------------------
store().savePreset('내 A', withDrive(3), 0);
store().savePreset('내 B', withDrive(7), 3.5);
equal(userPresets().length, 2);
const exportedText = store().exportPresets();
ok(typeof exportedText === 'string', '내 프리셋이 있으면 문자열');
const exported = JSON.parse(exportedText);
deepEqual(Object.keys(exported).sort(), ['appVersion', 'exportedAt', 'format', 'presets', 'schemaVersion'], '최상위 키는 설계서 4.7절의 다섯 개');
equal(exported.format, 'guitar-pedalboard-presets');
equal(EXPORT_FORMAT, 'guitar-pedalboard-presets');
equal(exported.schemaVersion, 2);
equal(exported.appVersion, appVersion, 'appVersion 은 앱 버전(package.json)');
ok(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(exported.exportedAt) && Number.isFinite(Date.parse(exported.exportedAt)), 'exportedAt 은 ISO 8601');
equal(exported.presets.length, 2, '내 프리셋 2개만');
ok(exported.presets.every((item) => item.origin === 'user' && item.schemaVersion === 2), '모두 origin user, 프리셋도 schemaVersion 2');
ok(exported.presets.every((item) => !item.id.startsWith('factory-')), '팩토리 id 가 없다');
const factoryNames = new Set(defaultPresets.map((item) => item.name));
ok(exported.presets.every((item) => !factoryNames.has(item.name)), '팩토리 이름이 없다');
deepEqual(exported.presets.map((item) => item.name), ['내 B', '내 A'], '목록 순서 그대로(방금 저장한 것이 앞)');
equal(exported.presets.find((item) => item.name === '내 B').trimDb, 3.5, '음량 보정이 실려 간다');
ok(exportedText.includes('\n  '), '사람이 읽을 수 있게 들여쓴다');
ok(!/"enabled"|"bypassed"/.test(exportedText), '옛 enabled/bypassed 필드는 없다(active 하나)');
ok(!/slotA|slotB|activeSlot/.test(exportedText), 'A/B 슬롯(세션 값)은 내보내지 않는다');
ok(exportedText.length < 40_000, `내 프리셋 2개 파일이 작다(${exportedText.length} 글자). 팩토리 40개(264 KB)가 들어가지 않았다`);

// buildExportFile 은 팩토리를 한 번 더 거른다
const guarded = buildExportFile([...defaultPresets, ...userPresets()], { appVersion: '9.9.9', exportedAt: NOW });
deepEqual(guarded.presets.map((item) => item.name), ['내 B', '내 A'], '팩토리 id 는 만드는 쪽에서도 거른다');
equal(guarded.appVersion, '9.9.9');
equal(guarded.exportedAt, new Date(NOW).toISOString());
equal(serializeExportFile(guarded), JSON.stringify(guarded, null, 2));

// ---------------------------------------------------------------------------------------------
// 4. 내보낸 파일을 읽으면 같은 프리셋이 나온다(왕복)
// ---------------------------------------------------------------------------------------------
const reread = fileOf(exportedText);
equal(reread.source, 'v2');
equal(reread.candidates.length, 2);
ok(reread.candidates.every((item) => item.origin === 'user'));
deepEqual(
  reread.candidates.map((item) => presetContentKey(item.preset)),
  userPresets().map((item) => presetContentKey(item)),
  '내보냈다 읽은 프리셋은 이름·페달·값·음량 보정이 같다',
);
deepEqual(reread.candidates.map((item) => item.preset.id), userPresets().map((item) => item.id), 'id 도 그대로');

// ---------------------------------------------------------------------------------------------
// 5. 같은 파일을 다시 가져오면: 0개 가져옴 · N개 건너뜀, 전체 개수 변화 0, 저장소는 건드리지 않는다
// ---------------------------------------------------------------------------------------------
{
  const before = store().presets;
  const writesBefore = storageWrites.length;
  const storedBefore = storageValues.get(STORAGE_KEYS.v2Presets);
  const plan = store().planImport(exportedText);
  deepEqual([plan.add.length, plan.conflicts.length, plan.identical, plan.factory], [0, 0, 2, 0], '계획: 추가 0 · 충돌 0 · 똑같음 2 · 팩토리 0');
  const result = store().commitImport(plan, []);
  equal(formatImportSummary(result), '0개 가져옴 · 2개 건너뜀');
  equal(store().presets, before, '목록 객체가 그대로(전체 개수 변화 0, 다시 그리지도 않는다)');
  equal(storageWrites.length, writesBefore, '저장소에 쓰지 않았다');
  equal(storageValues.get(STORAGE_KEYS.v2Presets), storedBefore, '저장본의 한 글자도 바뀌지 않았다(updatedAt 도)');
  equal(store().presets.length, 42, '전체 42개(팩토리 40 + 내 2)');
}

// ---------------------------------------------------------------------------------------------
// 6. 예전 형식 파일(팩토리 40개 포함): 팩토리는 추가되지 않고 내 프리셋만 추가된다
// ---------------------------------------------------------------------------------------------
const oldUser = [preset('old-user-1', '예전 내 프리셋 1'), preset('old-user-2', '예전 내 프리셋 2', { trimDb: -2 })];
const oldFileText = serializePresetPayload([...defaultPresets.map((item) => plain(item)), ...oldUser], { exportedAt: NOW, pretty: true });
ok(oldFileText.length > 200_000, `예전 파일은 팩토리 40개를 포함해 크다(${oldFileText.length} 글자)`);
{
  const file = fileOf(oldFileText);
  equal(file.source, 'v1');
  equal(file.candidates.length, 42);
  const plan = planImport(file, userPresets(), defaultPresets);
  equal(plan.factory, 40, '팩토리 40개 제외');
  equal(plan.add.length, 2, '내 프리셋 2개만 추가');
  equal(plan.conflicts.length, 0);
  deepEqual(plan.add.map((item) => item.name), ['예전 내 프리셋 1', '예전 내 프리셋 2']);

  const result = store().commitImport(store().planImport(oldFileText), []);
  equal(formatImportSummary(result), '2개 가져옴 · 40개 건너뜀');
  equal(userPresets().length, 4, '내 프리셋 2 → 4');
  equal(store().presets.length, 44, '전체 42 → 44(팩토리가 80개로 늘지 않는다)');
  equal(store().presets.filter((item) => item.isFactory).length, 40, '팩토리는 그대로 40개');
  ok(storedPresets().every((item) => item.origin === 'user' && !item.id.startsWith('factory-')), '저장본에 팩토리 id 가 없다');
  equal(storedPresets().length, 4);
  equal(storedPresets().find((item) => item.id === 'old-user-2').trimDb, -2, '예전 파일의 음량 보정도 옮겨 온다');
  equal(presetWrites().length >= 1, true, '바뀐 것이 있으니 저장했다');
}

// 같은 예전 파일을 한 번 더: 모두 건너뜀
{
  const writesBefore = storageWrites.length;
  const result = store().commitImport(store().planImport(oldFileText), []);
  equal(formatImportSummary(result), '0개 가져옴 · 42개 건너뜀', '예전 파일을 다시 가져오면 42개 모두 건너뜀');
  equal(storageWrites.length, writesBefore, '저장소에 쓰지 않았다');
  equal(userPresets().length, 4);
}

// 예전 파일에서 팩토리 프리셋 내용이 지금과 달라도(옛 버전 내용) factory- id 면 제외한다
{
  const stale = defaultPresets.slice(0, 5).map((item) => ({
    ...plain(item, 'trimDb'),
    pedals: item.pedals.map((pedal) => ({ ...pedal, params: { ...pedal.params, level: 1 } })),
  }));
  const plan = planOf(serializePresetPayload(stale), [], defaultPresets);
  equal(plan.factory, 5, '내용이 달라진 옛 팩토리 항목도 factory- id 로 알아본다');
  equal(plan.add.length, 0);
}

// id 가 다른 사본이어도 이름·내용이 팩토리와 같으면 제외한다(M5 와 같은 기준)
{
  const copy = defaultPresets[3];
  const plan = planOf(serializePresetPayload([{ ...plain(copy), id: 'copied-by-user' }]), [], defaultPresets);
  equal(plan.factory, 1, '이름+내용이 팩토리와 같은 사본은 제외');
  equal(plan.add.length, 0);
}

// v2 파일의 origin 'factory' 항목은 id·내용이 달라도 제외한다
{
  const v2 = JSON.parse(exportedText);
  v2.presets.push({ ...v2.presets[0], id: 'sneaky', name: '이름이 완전히 다름', origin: 'factory' });
  const plan = planOf(JSON.stringify(v2), userPresets(), defaultPresets);
  equal(plan.factory, 1, 'origin factory 는 제외');
  equal(plan.identical, 2);
  equal(plan.add.length, 0);
}

// ---------------------------------------------------------------------------------------------
// 7. 충돌: 같은 id·다른 내용, 같은 이름·다른 내용
// ---------------------------------------------------------------------------------------------
const existing = deepFreeze([preset('p1', '기타 A'), preset('p2', '기타 B', { trimDb: 1 })]);
const makeFile = (items) => JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: 2, appVersion: '0.0.0', exportedAt: new Date(NOW).toISOString(), presets: items });
const v2Of = (item, overrides = {}) => ({
  schemaVersion: 2, id: item.id, name: item.name, origin: 'user', chain: item.pedals.map((pedal) => pedal.id),
  pedals: Object.fromEntries(item.pedals.map((pedal) => [pedal.id, { id: pedal.id, type: pedal.type, active: pedal.active, params: pedal.params }])),
  trimDb: item.trimDb ?? 0, createdAt: new Date(item.updatedAt).toISOString(), updatedAt: new Date(item.updatedAt).toISOString(), ...overrides,
});
const changedDrive = (item, drive) => v2Of({ ...item, pedals: item.pedals.map((pedal) => (pedal.id === 'drive' ? { ...pedal, params: { ...pedal.params, drive } } : pedal)) });

{
  // 같은 id, 내용이 다름 → 충돌(이유 id)
  const text = makeFile([changedDrive(existing[0], 9.5)]);
  const plan = planOf(text, existing);
  equal(plan.conflicts.length, 1);
  equal(plan.conflicts[0].reason, 'id');
  equal(plan.conflicts[0].existing.id, 'p1');
  equal(plan.add.length + plan.identical + plan.factory, 0);

  const overwritten = applyImport(plan, existing, ['overwrite'], { now: NOW, createId });
  equal(formatImportSummary(overwritten), '1개 가져옴 · 0개 건너뜀', '덮어쓰기는 가져온 것으로 센다');
  equal(overwritten.next.length, 2, '덮어쓰기는 개수를 늘리지 않는다');
  equal(overwritten.next[0].id, 'p1');
  equal(overwritten.next[0].pedals.find((pedal) => pedal.id === 'drive').params.drive, 9.5, '내용이 파일의 것으로 바뀐다');
  equal(overwritten.next[0].updatedAt, NOW);
  equal(overwritten.next[1], existing[1], '다른 프리셋은 그대로');

  const copied = applyImport(plan, existing, ['copy'], { now: NOW, createId });
  equal(copied.next.length, 3, '사본은 하나 늘린다');
  equal(copied.next[0], existing[0], '기존 프리셋은 그대로');
  equal(copied.next[2].name, '기타 A (가져옴)');
  ok(copied.next[2].id.startsWith('new-id-'), '사본은 새 id');
  equal(copied.next[2].pedals.find((pedal) => pedal.id === 'drive').params.drive, 9.5);
  equal(formatImportSummary(copied), '1개 가져옴 · 0개 건너뜀');

  const skipped = applyImport(plan, existing, ['skip'], { now: NOW, createId });
  equal(formatImportSummary(skipped), '0개 가져옴 · 1개 건너뜀');
  deepEqual(skipped.next, [...existing], '건너뛰기는 아무것도 바꾸지 않는다');

  const unanswered = applyImport(plan, existing, [], { now: NOW, createId });
  equal(formatImportSummary(unanswered), '0개 가져옴 · 1개 건너뜀', '선택이 없으면 건너뛰기(아무것도 지우지 않는 쪽)');

  // 사본 이름이 이미 있으면 번호를 붙인다
  const twice = applyImport(plan, copied.next, ['copy'], { now: NOW, createId });
  equal(twice.next[twice.next.length - 1].name, '기타 A (가져옴 2)');
  equal(uniqueCopyName('  이름  ', new Set()), '이름 (가져옴)', '앞뒤 공백은 뗀다');
}

{
  // 같은 이름, 다른 id, 내용이 다름 → 충돌(이유 name). 덮어쓰기는 기존 id 를 지킨다(즐겨찾기·최근이 id 로 가리킨다).
  const incoming = { ...existing[1], id: 'other-id' };
  const text = makeFile([changedDrive(incoming, 1.5)]);
  const plan = planOf(text, existing);
  equal(plan.conflicts.length, 1);
  equal(plan.conflicts[0].reason, 'name');
  equal(plan.conflicts[0].existing.id, 'p2');
  const overwritten = applyImport(plan, existing, ['overwrite'], { now: NOW, createId });
  equal(overwritten.next.length, 2);
  equal(overwritten.next[1].id, 'p2', '덮어써도 기존 id 를 지킨다');
  equal(overwritten.next[1].name, '기타 B');
}

{
  // 같은 이름·같은 내용인데 id 만 다르면 똑같은 것이다: 조용히 건너뜀
  const incoming = { ...existing[0], id: 'different-id' };
  const plan = planOf(makeFile([v2Of(incoming)]), existing);
  deepEqual([plan.add.length, plan.conflicts.length, plan.identical], [0, 0, 1], 'id 만 다른 같은 내용은 건너뜀');
}

{
  // 파일 안에서 id 가 겹치면 뒤의 것이 이긴다. 앞의 것은 건너뜀으로 센다.
  const first = v2Of(preset('dup', '겹침'));
  const second = changedDrive(preset('dup', '겹침'), 2.5);
  const plan = planOf(makeFile([first, second]), []);
  equal(plan.add.length, 1);
  equal(plan.identical, 1, '앞의 것은 건너뜀');
  equal(plan.add[0].pedals.find((pedal) => pedal.id === 'drive').params.drive, 2.5, '뒤의 것이 이긴다');
}

{
  // 충돌 둘 + 추가 하나: 선택은 충돌 순서대로 짝이 맞는다
  const c1 = changedDrive(existing[0], 4.5);
  const c2 = changedDrive(existing[1], 4.5);
  const added = v2Of(preset('fresh', '새 프리셋'));
  const plan = planOf(makeFile([c1, added, c2]), existing);
  equal(plan.conflicts.length, 2);
  equal(plan.add.length, 1);
  const result = applyImport(plan, existing, ['skip', 'overwrite'], { now: NOW, createId });
  equal(formatImportSummary(result), '2개 가져옴 · 1개 건너뜀', '추가 1 + 덮어쓰기 1 가져옴, 건너뛰기 1');
  equal(result.next[0], existing[0], '첫 충돌은 건너뜀');
  equal(result.next[1].pedals.find((pedal) => pedal.id === 'drive').params.drive, 4.5, '둘째 충돌은 덮어씀');
  equal(result.next[2].name, '새 프리셋');
}

{
  // 계획과 저장 사이에 기존 프리셋이 지워졌어도 덮어쓰기는 추가로 돌아선다(잃어버리지 않는다)
  const plan = planOf(makeFile([changedDrive(existing[0], 8.5)]), existing);
  const result = applyImport(plan, [existing[1]], ['overwrite'], { now: NOW, createId });
  equal(result.next.length, 2);
  equal(result.next[1].id, 'p1');
}

// ---------------------------------------------------------------------------------------------
// 8. 가져온 충돌을 스토어로: 덮어쓰기 / 사본 / 건너뛰기가 저장소까지 간다
// ---------------------------------------------------------------------------------------------
{
  const target = userPresets()[0];
  const changed = JSON.parse(store().exportPresets());
  changed.presets = changed.presets.filter((item) => item.id === target.id);
  changed.presets[0].trimDb = 6;
  const text = JSON.stringify(changed);

  const plan = store().planImport(text);
  equal(plan.conflicts.length, 1);
  const countBefore = userPresets().length;

  const skipResult = store().commitImport(plan, ['skip']);
  equal(formatImportSummary(skipResult), '0개 가져옴 · 1개 건너뜀');
  equal(userPresets().length, countBefore);
  equal(userPresets().find((item) => item.id === target.id).trimDb, target.trimDb, '건너뛰면 그대로');

  const copyResult = store().commitImport(plan, ['copy']);
  equal(formatImportSummary(copyResult), '1개 가져옴 · 0개 건너뜀');
  equal(userPresets().length, countBefore + 1);
  const copyName = `${target.name} (가져옴)`;
  const copy = userPresets().find((item) => item.name === copyName);
  ok(copy && copy.id !== target.id && copy.trimDb === 6, '사본은 새 id·가져온 내용');
  ok(storedPresets().some((item) => item.name === copyName), '저장본에도 있다');

  const overwriteResult = store().commitImport(store().planImport(text), ['overwrite']);
  equal(formatImportSummary(overwriteResult), '1개 가져옴 · 0개 건너뜀');
  equal(userPresets().find((item) => item.id === target.id).trimDb, 6, '덮어쓰기는 파일의 내용으로');
  equal(userPresets().length, countBefore + 1, '덮어쓰기는 개수를 늘리지 않는다');
  ok(storedPresets().every((item) => !item.id.startsWith('factory-')), '저장본에 팩토리 id 가 없다');

  store().reloadPresets();
  equal(userPresets().find((item) => item.id === target.id).trimDb, 6, '저장소에서 다시 읽어도 같다');
}

// ---------------------------------------------------------------------------------------------
// 9. 틀린 파일은 한국어 메시지로 거절하고 아무것도 바꾸지 않는다
// ---------------------------------------------------------------------------------------------
{
  const stateBefore = store().presets;
  const writesBefore = storageWrites.length;
  throwsKorean(() => store().planImport('{ not json'), /JSON 파일을 읽을 수 없습니다/, '깨진 JSON');
  throwsKorean(() => store().planImport('5'), /프리셋 JSON 형식이 올바르지 않습니다/, '숫자');
  throwsKorean(() => store().planImport('null'), /프리셋 JSON 형식이 올바르지 않습니다/, 'null');
  throwsKorean(() => store().planImport('{"presets": 3}'), /프리셋 JSON 형식이 올바르지 않습니다/, 'presets 가 배열이 아닌 v1');
  throwsKorean(() => store().planImport('[{"id": 1}]'), /프리셋 항목이 올바르지 않습니다/, '항목이 틀린 v1');
  throwsKorean(() => store().planImport(JSON.stringify({ format: 'something-else', schemaVersion: 2, presets: [] })), /이 앱이 내보낸 프리셋 파일이 아닙니다/, '다른 format');
  throwsKorean(() => store().planImport(JSON.stringify({ schemaVersion: 2, presets: [] })), /이 앱이 내보낸 프리셋 파일이 아닙니다/, 'format 이 없는 v2 모양');
  throwsKorean(() => store().planImport(JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: 3, presets: [] })), /지원하지 않는 프리셋 파일 버전입니다: 3/, '더 새로운 버전');
  throwsKorean(() => store().planImport(JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: 2, presets: 'x' })), /프리셋 JSON 형식이 올바르지 않습니다/, 'v2 presets 가 배열이 아님');
  throwsKorean(() => store().planImport(JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: 2, presets: [{ schemaVersion: 2, name: '이름만' }] })), /프리셋 항목이 올바르지 않습니다/, 'v2 항목에 id 가 없음');
  throwsKorean(() => store().planImport(JSON.stringify({ format: EXPORT_FORMAT, schemaVersion: 2, presets: [{ schemaVersion: 1, id: 'x', name: 'y' }] })), /프리셋 항목이 올바르지 않습니다/, 'v2 항목의 버전이 다름');
  equal(store().presets, stateBefore, '거절한 파일은 목록을 바꾸지 않는다');
  equal(storageWrites.length, writesBefore, '거절한 파일은 저장소에 쓰지 않는다');
}

// 빈 파일은 받는다(0개 가져옴 · 0개 건너뜀)
{
  const writesBefore = storageWrites.length;
  for (const text of ['[]', '{"version":11,"presets":[]}', makeFile([])]) {
    const result = store().commitImport(store().planImport(text), []);
    equal(formatImportSummary(result), '0개 가져옴 · 0개 건너뜀', `빈 목록: ${text.slice(0, 24)}`);
  }
  equal(storageWrites.length, writesBefore, '빈 목록은 저장하지 않는다');
}

// 예전 파일 형식(배열)도 받는다
{
  const arrayText = JSON.stringify([{ id: 'arr-1', name: '배열 형식', updatedAt: 5, pedals: [] }]);
  const file = fileOf(arrayText);
  equal(file.source, 'v1');
  const plan = planImport(file, userPresets(), defaultPresets);
  equal(plan.add.length, 1);
  equal(plan.add[0].pedals.length, 15, '비어 있던 페달 목록은 기본 15개로 채운다(예전 가져오기와 같다)');
}

// v2 파일 안의 `__proto__` 키는 객체 원형을 바꾸지 못한다
{
  const poisoned = `{"format":"${EXPORT_FORMAT}","schemaVersion":2,"presets":[{"schemaVersion":2,"id":"pz","name":"독","chain":[],"pedals":{"__proto__":{"id":"__proto__","type":"drive","active":true,"params":{}}},"trimDb":0}]}`;
  const file = fileOf(poisoned);
  equal(file.candidates.length, 1);
  equal({}.active, undefined, '전역 Object 원형이 오염되지 않았다');
}

// 예전 파서는 그대로다(옛 방식 모드의 저장본·이전 버전 파일 읽기)
{
  const legacyText = serializePresetPayload([{ id: 'lg', name: '옛 방식', pedals: pedalsNow(), updatedAt: 3 }]);
  const parsed = parsePresetJson(legacyText);
  equal(parsed.length, 1);
  equal(JSON.parse(legacyText).version, 11, '옛 방식 모드의 저장본은 여전히 v11');
}

console.log(`export-format regression passed (${checks} checks)`);
