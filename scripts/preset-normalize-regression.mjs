// S2.1 꺼진 페달의 Mix 0% 바로잡기 — 소리 밖의 약속을 지킨다.
//   · restoreMixOfOffPedals(M2): '꺼짐 + Mix 0' 만 기본 Mix 로 바꾼다. 켜진 페달·Mix > 0·모르는 id 는 그대로, 입력은 바꾸지 않고, 몇 번을 적용해도 같다
//   · 팩토리 프리셋 40개: '꺼짐 + Mix 0' 조합이 0개(설계서 S2.1 데이터 검사), 꺼진 페달 368개의 Mix 는 모두 0 보다 크다
//   · 불러오기: 프리셋 파일 가져오기(저장 형식 1·10·11), 저장소의 사용자 프리셋과 작업 상태(실제 픽스처 04 원본)가 같은 규칙을 지난다
//   · 사용자가 이 세션에서 정한 값은 건드리지 않는다(저장할 때는 그대로, 바로잡기는 불러올 때만)
// 소리 자체(꺼진 페달을 켜면 출력이 바뀐다, 불러온 직후 소리가 같다)는 오디오 프로브 P-18 이 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// ---------------------------------------------------------------------------------------------
// 가짜 브라우저 저장소. 쓰기 기록을 남겨 '불러오기만으로는 저장본을 덮어쓰지 않는다' 를 본다.
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
      "export { isPedalOff, restoreMixOfOffPedals } from './presets/normalize.ts';",
      "export { STORAGE_KEYS } from './persistence/index.ts';",
      "export { clonePedals, initialPedals, usePedalStore } from './store/pedalStore.ts';",
      "export { defaultPresets, parsePresetJson, usePresetStore } from './store/presetStore.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'preset-normalize-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const { isPedalOff, restoreMixOfOffPedals, STORAGE_KEYS, clonePedals, initialPedals, usePedalStore, defaultPresets, parsePresetJson, usePresetStore } =
  await import(`data:text/javascript;base64,${Buffer.from(harnessBundle.outputFiles[0].text).toString('base64')}`);

const defaultMix = new Map(initialPedals.map((pedal) => [pedal.id, pedal.params.mix]));
const defaultMixOf = (id) => defaultMix.get(id);
const byId = (pedals, id) => {
  const found = pedals.find((pedal) => pedal.id === id);
  assert.ok(found, `페달 ${id} 가 없습니다.`);
  return found;
};
const withState = (id, state, params = {}) => {
  const base = byId(initialPedals, id);
  return { ...clonePedals([base])[0], ...state, params: { ...base.params, ...params } };
};
const withoutMix = (params) => Object.fromEntries(Object.entries(params).filter(([name]) => name !== 'mix'));
/** 동결한 입력(바꾸면 TypeError). */
const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
};

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

// ---------------------------------------------------------------------------------------------
// 1. restoreMixOfOffPedals — M2 한 줄 규칙
// ---------------------------------------------------------------------------------------------
equal(initialPedals.length, 15, '페달은 15개');
for (const pedal of initialPedals) {
  ok(Number.isFinite(pedal.params.mix) && pedal.params.mix > 0, `${pedal.id} 의 기본 Mix 는 0 보다 커야 한다(되돌릴 값)`);
}

for (const base of initialPedals) {
  const off = withState(base.id, { bypassed: true }, { mix: 0 });
  const [restored] = restoreMixOfOffPedals([off], defaultMixOf);
  equal(restored.params.mix, base.params.mix, `${base.id}: 꺼짐 + Mix 0 → 기본 Mix ${base.params.mix}`);
  equal(restored.bypassed, true, `${base.id}: 꺼진 채로 둔다`);
  equal(restored.enabled, off.enabled, `${base.id}: enabled 는 그대로`);
  deepEqual(withoutMix(restored.params), withoutMix(off.params), `${base.id}: Mix 밖의 값은 하나도 바뀌지 않는다`);
  equal(off.params.mix, 0, `${base.id}: 입력 객체는 바뀌지 않는다`);
}

// 꺼짐의 두 가지 표현: 저장 형식 11 은 bypassed, 이전 형식은 enabled:false. 둘 다(그리고 둘이 겹쳐도) 꺼짐이다.
equal(isPedalOff({ enabled: true, bypassed: true }), true);
equal(isPedalOff({ enabled: false, bypassed: false }), true);
equal(isPedalOff({ enabled: false, bypassed: true }), true);
equal(isPedalOff({ enabled: true, bypassed: false }), false);
for (const [enabled, bypassed] of [[true, true], [false, false], [false, true]]) {
  const [restored] = restoreMixOfOffPedals([withState('delay', { enabled, bypassed }, { mix: 0 })], defaultMixOf);
  equal(restored.params.mix, 30, `Delay enabled=${enabled} bypassed=${bypassed} + Mix 0 → 기본 30`);
}

// 바꾸지 말아야 할 것: 같은 객체가 그대로 돌아온다.
const keep = [
  ['켜진 페달의 Mix 0(사용자가 정한 값)', withState('delay', { enabled: true, bypassed: false }, { mix: 0 })],
  ['꺼진 페달의 Mix 1', withState('delay', { bypassed: true }, { mix: 1 })],
  ['꺼진 페달의 Mix 0.4', withState('reverb', { bypassed: true }, { mix: 0.4 })],
  ['꺼진 페달의 Mix 50', withState('reverb', { bypassed: true }, { mix: 50 })],
  ['꺼진 페달의 Mix 100', withState('chorus', { bypassed: true }, { mix: 100 })],
  ['꺼진 페달의 Mix 가 문자열 "0"', withState('chorus', { bypassed: true }, { mix: '0' })],
  ['꺼진 페달의 Mix 가 false', withState('chorus', { bypassed: true }, { mix: false })],
  ['꺼진 페달의 Mix 가 없음', (() => { const pedal = withState('chorus', { bypassed: true }); delete pedal.params.mix; return pedal; })()],
  ['꺼진 페달의 Mix 가 음수', withState('flanger', { bypassed: true }, { mix: -5 })],
];
for (const [label, pedal] of keep) {
  const [result] = restoreMixOfOffPedals([pedal], defaultMixOf);
  ok(result === pedal, `${label}: 건드리지 않는다(같은 객체)`);
}
const unknown = { ...withState('delay', { bypassed: true }, { mix: 0 }), id: 'user-made-pedal' };
ok(restoreMixOfOffPedals([unknown], defaultMixOf)[0] === unknown, '기본 Mix 를 모르는 id 는 그대로');
for (const lookup of [() => undefined, () => 0, () => -3, () => Number.NaN, () => Number.POSITIVE_INFINITY, () => '30']) {
  const pedal = withState('delay', { bypassed: true }, { mix: 0 });
  ok(restoreMixOfOffPedals([pedal], lookup)[0] === pedal, `쓸 수 없는 기본값(${String(lookup())})이면 그대로`);
}
deepEqual(restoreMixOfOffPedals([], defaultMixOf), [], '빈 목록');

// 입력을 동결해도 던지지 않고(바꾸지 않음), 결과는 새 배열이며, 두 번 적용해도 같다.
const mixed = deepFreeze(clonePedals(initialPedals).map((pedal, index) =>
  index % 3 === 0 ? { ...pedal, bypassed: true, params: { ...pedal.params, mix: 0 } }
    : index % 3 === 1 ? { ...pedal, bypassed: false, params: { ...pedal.params, mix: 0 } }
      : pedal));
const once = restoreMixOfOffPedals(mixed, defaultMixOf);
ok(once !== mixed, '새 배열을 돌려 준다');
deepEqual(restoreMixOfOffPedals(once, defaultMixOf), once, '멱등: 두 번 적용해도 같다');
mixed.forEach((pedal, index) => {
  const result = once[index];
  const wasOffWithZeroMix = pedal.bypassed && pedal.params.mix === 0;
  equal(result.params.mix, wasOffWithZeroMix ? defaultMix.get(pedal.id) : pedal.params.mix, `${pedal.id}: 꺼짐+0 만 바뀐다`);
  equal(result.bypassed, pedal.bypassed, `${pedal.id}: 스위치 상태는 그대로`);
  equal(result.id, pedal.id);
});
deepEqual(once.map((pedal) => pedal.id), mixed.map((pedal) => pedal.id), '순서는 그대로');

// ---------------------------------------------------------------------------------------------
// 2. 팩토리 프리셋 40개 — 데이터 검사
// ---------------------------------------------------------------------------------------------
equal(defaultPresets.length, 40, '팩토리 프리셋 40개');
let offPedalCount = 0;
for (const preset of defaultPresets) {
  equal(preset.pedals.length, 15, `${preset.id}: 페달 15개`);
  for (const pedal of preset.pedals) {
    if (!isPedalOff(pedal)) continue;
    offPedalCount += 1;
    const mix = pedal.params.mix;
    ok(typeof mix === 'number' && Number.isFinite(mix), `${preset.id}:${pedal.id} 꺼진 페달의 Mix 는 숫자`);
    ok(mix > 0, `${preset.id}:${pedal.id} '꺼짐 + Mix 0' 조합이 있다(R2-2) — 켜도 소리가 바뀌지 않는다`);
  }
  deepEqual(
    restoreMixOfOffPedals(preset.pedals, defaultMixOf).map((pedal, index) => pedal === preset.pedals[index]),
    preset.pedals.map(() => true),
    `${preset.id}: 팩토리 데이터는 정규화가 건드릴 것이 없다`,
  );
}
equal(offPedalCount, 368, '꺼진 페달 368개(P-18 기준선과 같은 수)');

// ---------------------------------------------------------------------------------------------
// 3. 프리셋 파일 가져오기 — 저장 형식 1 · 10 · 11
// ---------------------------------------------------------------------------------------------
const presetJson = (version, pedals, extra = {}) =>
  JSON.stringify({ version, presets: [{ id: 'imported', name: 'Imported', updatedAt: 1, pedals, ...extra }] });
const storedPedal = (id, state, params) => ({ id, ...state, params: { ...byId(initialPedals, id).params, ...params } });

{
  // 11: 꺼짐은 bypassed.
  const [preset] = parsePresetJson(presetJson(11, [
    storedPedal('delay', { enabled: true, bypassed: true }, { mix: 0, timeMs: 410 }),
    storedPedal('reverb', { enabled: true, bypassed: true }, { mix: 0, decay: 2.5 }),
    storedPedal('chorus', { enabled: true, bypassed: false }, { mix: 0, rate: 0.9 }),
    storedPedal('crunch', { enabled: true, bypassed: true }, { mix: 60 }),
  ]));
  const delay = byId(preset.pedals, 'delay');
  const reverb = byId(preset.pedals, 'reverb');
  const chorus = byId(preset.pedals, 'chorus');
  equal(delay.params.mix, 30, '가져온 꺼진 Delay 의 Mix 0 → 기본 30');
  equal(delay.params.timeMs, 410, 'Delay 의 다른 값은 그대로');
  equal(delay.bypassed, true, 'Delay 는 꺼진 채');
  equal(reverb.params.mix, 25, '가져온 꺼진 Reverb 의 Mix 0 → 기본 25');
  equal(reverb.params.decay, 2.5, 'Reverb 의 다른 값은 그대로');
  equal(chorus.params.mix, 0, '가져온 켜진 Chorus 의 Mix 0 은 사용자가 정한 값이라 그대로');
  equal(chorus.bypassed, false, 'Chorus 는 켜진 채');
  equal(byId(preset.pedals, 'crunch').params.mix, 60, '꺼졌어도 Mix > 0 이면 그대로');
  equal(preset.pedals.length, 15, '없는 페달은 기본값으로 채워 15개');
}
{
  // 10: 꺼짐이 enabled:false 와 bypassed 의 조합. 네 조합 모두 같은 소리여야 한다(10→11).
  const combos = [
    ['enabled:true  bypassed:false', { enabled: true, bypassed: false }, 0, '켜짐: 그대로 0'],
    ['enabled:true  bypassed:true', { enabled: true, bypassed: true }, 30, '꺼짐: 기본'],
    ['enabled:false bypassed:false', { enabled: false, bypassed: false }, 30, '꺼짐: 기본'],
    ['enabled:false bypassed:true', { enabled: false, bypassed: true }, 30, '꺼짐: 기본'],
  ];
  for (const [label, state, expected, note] of combos) {
    const [preset] = parsePresetJson(presetJson(10, [storedPedal('delay', state, { mix: 0 })]));
    const delay = byId(preset.pedals, 'delay');
    equal(delay.params.mix, expected, `v10 ${label} + Mix 0 → ${note}`);
    equal(delay.bypassed, !(state.enabled && !state.bypassed), `v10 ${label}: 켜짐·꺼짐은 10→11 이 정한 대로`);
  }
}
{
  // 1: 맨 앞 배열 형식(버전 없음). 옛 형식은 Bypass 를 params 안에 적었다(`bypass`). 적지 않은 항목은 그 페달의 기본 상태를 따른다.
  const legacy = JSON.stringify([
    { id: 'legacy', name: 'Legacy', updatedAt: 1, pedals: [
      { id: 'delay', enabled: false, params: { mix: 0, time: 0.4 } },
      { id: 'reverb', enabled: true, params: { mix: 0, bypass: false } },
    ] },
  ]);
  const [preset] = parsePresetJson(legacy);
  const delay = byId(preset.pedals, 'delay');
  const reverb = byId(preset.pedals, 'reverb');
  equal(delay.bypassed, true, 'v1 enabled:false → 꺼짐');
  equal(delay.params.mix, 30, 'v1 꺼진 Delay 의 Mix 0 → 기본 30');
  equal(reverb.bypassed, false, 'v1 enabled:true → 켜짐');
  equal(reverb.params.mix, 0, 'v1 켜진 Reverb 의 Mix 0 은 그대로');
}
{
  // 내보냈다 다시 가져와도 같다(멱등). 소리를 정하는 값은 하나도 달라지지 않는다.
  const [first] = parsePresetJson(presetJson(11, [storedPedal('delay', { enabled: true, bypassed: true }, { mix: 0 })]));
  const reexported = presetJson(11, first.pedals, { id: first.id, name: first.name, updatedAt: first.updatedAt });
  const [second] = parsePresetJson(reexported);
  deepEqual(second.pedals, first.pedals, '두 번 가져와도 같다');
}

// ---------------------------------------------------------------------------------------------
// 4. 실제 픽스처 04 원본 — 저장소의 작업 상태와 사용자 프리셋
// ---------------------------------------------------------------------------------------------
const fixturePath = new URL('../e2e/fixtures/storage-v1/04-disabled-pedal-mix0.json', import.meta.url);
const fixtureText = await readFile(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureText);
const storedWorking = JSON.parse(fixture.storage[STORAGE_KEYS.pedals]);
const storedPresets = JSON.parse(fixture.storage[STORAGE_KEYS.presets]);
const offWithZeroMix = (pedals) => pedals.filter((pedal) => (!pedal.enabled || pedal.bypassed) && pedal.params.mix === 0).map((pedal) => pedal.id).sort();
deepEqual(offWithZeroMix(storedWorking.pedals), ['chorus', 'delay', 'reverb'], '픽스처 04 의 작업 상태: Chorus·Delay·Reverb 가 꺼짐 + Mix 0');
deepEqual(offWithZeroMix(storedPresets.presets[0].pedals), ['chorus', 'delay', 'reverb'], '픽스처 04 의 사용자 프리셋도 같다');

for (const [key, value] of Object.entries(fixture.storage)) storageValues.set(key, value);
storageWrites.length = 0;

usePedalStore.getState().loadPedalsFromStorage();
usePresetStore.getState().reloadPresets();

const workingPedals = usePedalStore.getState().pedals;
const userPreset = usePresetStore.getState().presets.find((preset) => preset.id === storedPresets.presets[0].id);
ok(userPreset, '사용자 프리셋을 저장소에서 읽었다');
for (const [label, pedals, source] of [
  ['작업 상태', workingPedals, storedWorking.pedals],
  ['사용자 프리셋', userPreset.pedals, storedPresets.presets[0].pedals],
]) {
  for (const id of ['chorus', 'delay', 'reverb']) {
    const loaded = byId(pedals, id);
    equal(loaded.params.mix, defaultMix.get(id), `${label}: ${id} 의 Mix 0 → 기본 ${defaultMix.get(id)}`);
    equal(loaded.bypassed, true, `${label}: ${id} 는 꺼진 채`);
  }
  // Mix 밖의 값과 다른 페달은 저장된 그대로.
  for (const stored of source) {
    const loaded = byId(pedals, stored.id);
    const changedMix = ['chorus', 'delay', 'reverb'].includes(stored.id);
    for (const [name, value] of Object.entries(stored.params)) {
      if (changedMix && name === 'mix') continue;
      equal(loaded.params[name], value, `${label}: ${stored.id}.${name} 은 저장된 그대로`);
    }
    equal(loaded.bypassed, stored.bypassed, `${label}: ${stored.id} 의 켜짐·꺼짐은 저장된 그대로`);
  }
  deepEqual(pedals.map((pedal) => pedal.id), source.map((pedal) => pedal.id), `${label}: 순서는 저장된 그대로`);
}
equal(
  storageWrites.filter(({ key }) => key === STORAGE_KEYS.pedals || key === STORAGE_KEYS.presets).length,
  0,
  '불러오기만으로는 저장본을 다시 쓰지 않는다(원본이 그대로 남는다)',
);
equal(storageValues.get(STORAGE_KEYS.pedals), fixture.storage[STORAGE_KEYS.pedals], '작업 상태 저장본 원문 그대로');
equal(storageValues.get(STORAGE_KEYS.presets), fixture.storage[STORAGE_KEYS.presets], '프리셋 저장본 원문 그대로');
equal(await readFile(fixturePath, 'utf8'), fixtureText, '픽스처 파일은 읽기만 했다');

// ---------------------------------------------------------------------------------------------
// 5. 이 세션에서 사용자가 정한 값은 건드리지 않는다
// ---------------------------------------------------------------------------------------------
{
  const board = clonePedals(workingPedals).map((pedal) =>
    pedal.id === 'delay' ? { ...pedal, bypassed: true, params: { ...pedal.params, mix: 0 } } : pedal);
  usePedalStore.getState().setPedals(board);
  equal(byId(usePedalStore.getState().pedals, 'delay').params.mix, 0, '직접 Mix 를 0 으로 하고 끈 값은 이 세션에서 그대로');
  usePresetStore.getState().savePreset('Mine', usePedalStore.getState().pedals);
  const saved = usePresetStore.getState().presets.find((preset) => preset.name === 'Mine');
  equal(byId(saved.pedals, 'delay').params.mix, 0, '저장할 때도 사용자가 정한 값 그대로');
  usePresetStore.getState().reloadPresets();
  const reloaded = usePresetStore.getState().presets.find((preset) => preset.name === 'Mine');
  equal(byId(reloaded.pedals, 'delay').params.mix, 30, '다시 불러올 때 바로잡는다');
}

console.log(`통과 ${checks}건 — S2.1 꺼진 페달 Mix 정규화(M2) 회귀 시험`);
