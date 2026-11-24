// S2.4 저장 형식 v2 시험(설계서 4.7·4.8절, S2.4 수용 기준 '변환 단위 시험 6개 통과·멱등').
//
//   1. 변환 규칙  v1 픽스처 6개(e2e/fixtures/storage-v1)를 v2 로 옮긴 결과가, 규칙 M1~M3·M6 만으로 손으로 쓴 기대값과 같다.
//                기대값은 변환 코드를 거치지 않으므로 코드와 기대값이 같이 틀릴 수 없다. 몇 번을 옮겨도 같고(멱등),
//                되읽은 값이 v1 을 옛 방식으로 읽은 값과 같다. 규칙마다(M1 네 가지 조합, M2, M3, M5, M6, M7) 따로도 본다.
//   2. 열기 절차  처음 쓰는 사람 · v1 에서 올라오는 사람 · 이미 v2 인 사람 · 더 새로운 형식 · 깨진 값.
//                쓰기 순서는 v2:state → v2:presets → schema 이고, 하나라도 실패하면 schema 를 쓰지 않는다(다음 방문에 다시 옮긴다).
//                v1 키는 어떤 경우에도 쓰지도 지우지도 않는다(깨진 값을 보관하려고 옮기는 것만 예외).
//   3. 변환이 틀렸을 때  변환이 던지거나 되읽은 값이 다르면 v2 를 쓰지 않고 v1 데이터로 계속 동작한다(저장도 v1 키에 옛 모양으로).
//   4. 앱 데이터 층·스토어  appData·pedalStore·presetStore 가 v2 키에만 쓰고, 모르는 필드(M7)와 만든 시각을 지키고,
//                팩토리 사본 알림(M5)과 설정 초기화가 사용자 프리셋·schema 를 지킨다.
// 화면에서의 확인(E-08 LED 개수, 다른 탭 안내, 새 버전 알림)은 e2e 가, 소리가 같은지는 오디오 프로브 P-19 가 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// ---------------------------------------------------------------------------------------------
// 가짜 브라우저 저장소: 스토어·appData 가 쓰는 window.localStorage. 쓰기·지우기 기록을 남긴다.
// ---------------------------------------------------------------------------------------------
const fakeValues = new Map();
const fakeWrites = [];
const fakeRemoves = [];
globalThis.window = {
  dispatchEvent() {},
  localStorage: {
    getItem: (key) => (fakeValues.has(key) ? fakeValues.get(key) : null),
    setItem(key, value) {
      fakeWrites.push({ key, value: String(value) });
      fakeValues.set(key, String(value));
    },
    removeItem(key) {
      fakeRemoves.push(key);
      fakeValues.delete(key);
    },
    key: (index) => [...fakeValues.keys()][index] ?? null,
    get length() {
      return fakeValues.size;
    },
  },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};
/** 저장소를 비우고 `initial`(키 → 원문)로 채운다. 쓰기·지우기 기록도 비운다. */
function fillFakeStorage(initial = {}) {
  fakeValues.clear();
  fakeWrites.length = 0;
  fakeRemoves.length = 0;
  for (const [key, value] of Object.entries(initial)) fakeValues.set(key, value);
}

const harnessBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export * from './persistence/schema.ts';",
      "export { runBootstrap } from './persistence/bootstrap.ts';",
      "export { boardFromV1, convertV1ToV2, readBoardV1, readPresetsV1, verifyConversion } from './persistence/migrations/v1-to-v2.ts';",
      "export { KEPT_ON_RESET_KEYS, STORAGE_KEYS, createSafeStorage, safeStorage } from './persistence/index.ts';",
      "export * as appData from './persistence/appData.ts';",
      "export { clampTrimDb } from './audio/offline/loudnessSpec.ts';",
      "export { getParamDef } from './audio/params/index.ts';",
      "export { REVERB_DECAY_MAX } from './audio/params/definitions/reverb.ts';",
      "export { clonePedals, initialPedals, usePedalStore } from './store/pedalStore.ts';",
      "export { announceFactoryCopies, defaultPresets, serializePresetPayload, usePresetStore } from './store/presetStore.ts';",
      "export { useToastStore } from './store/toastStore.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'storage-v2-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const harnessCode = harnessBundle.outputFiles[0].text;
let harnessInstances = 0;
/**
 * 앱 코드를 새로 불러온다. 스토어는 불러올 때 저장 형식을 정하고(필요하면 v1 에서 v2 로 옮기고) 그 뒤로 바뀌지 않으므로,
 * 저장소를 채운 다음 이 함수로 다시 불러와야 '앱을 새로 여는 것'과 같다.
 */
const loadHarness = () => {
  harnessInstances += 1;
  return import(`data:text/javascript;base64,${Buffer.from(`${harnessCode}\n//# instance ${harnessInstances}`).toString('base64')}`);
};
const base = await loadHarness();
const {
  SCHEMA_V2,
  STORAGE_KEYS,
  KEPT_ON_RESET_KEYS,
  boardFromV1,
  boardToStateV2,
  buildPresetsStoreV2,
  carryOfPreset,
  clampTrimDb,
  collectExtra,
  convertV1ToV2,
  createSafeStorage,
  defaultPresets,
  extrasOfState,
  findFactoryCopies,
  getParamDef,
  initialPedals,
  isSameValue,
  parsePresetsStoreV2,
  parseStateV2,
  presetContentKey,
  presetFromV2,
  presetToV2,
  readBoardV1,
  readPresetsV1,
  runBootstrap,
  serializePresetPayload,
  stateV2ToBoard,
  verifyConversion,
  REVERB_DECAY_MAX,
} = base;
fillFakeStorage();

// 깨진 값·변환 실패는 console.warn 으로 원인을 남긴다. 시험 출력이 길어지지 않도록 모아 두고 필요한 곳에서 확인한다.
const originalConsoleWarn = console.warn;
const warnings = [];
console.warn = (...args) => {
  warnings.push(String(args[0]));
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
const throws = (fn, message) => {
  checks += 1;
  assert.throws(fn, undefined, message);
};
const clone = (value) => JSON.parse(JSON.stringify(value));
/** 목록에서 보이는 팩토리 표시(isFactory)를 뺀 사본. 사용자 프리셋은 이 표시가 없다. */
const withoutFactoryFlag = (preset) => {
  const copy = clone(preset);
  delete copy.isFactory;
  return copy;
};

const K = STORAGE_KEYS;
const NOW = 1_700_000_000_000;
const defaultById = new Map(initialPedals.map((pedal) => [pedal.id, pedal]));
const activeIdsOf = (pedals) => pedals.filter((pedal) => pedal.active).map((pedal) => pedal.id);

// ---------------------------------------------------------------------------------------------
// 가짜 저장소 + SafeStorage(열기 절차 시험용). 호출 기록을 남기고, 키마다 예외를 던지게 바꿀 수 있다.
// ---------------------------------------------------------------------------------------------
const { DOMException } = globalThis;
const quotaError = () => new DOMException("Failed to execute 'setItem' on 'Storage': exceeded the quota.", 'QuotaExceededError');
const securityError = () => new DOMException('The operation is insecure.', 'SecurityError');

function createBackend(initial = {}, hooks = {}) {
  const map = new Map(Object.entries(initial));
  const writes = [];
  const removes = [];
  return {
    map,
    writes,
    removes,
    getItem(key) {
      hooks.getItem?.(key);
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      hooks.setItem?.(key, value);
      writes.push({ key, value: String(value) });
      map.set(key, String(value));
    },
    removeItem(key) {
      hooks.removeItem?.(key);
      removes.push(key);
      map.delete(key);
    },
    key: (index) => [...map.keys()][index] ?? null,
    get length() {
      return map.size;
    },
  };
}

/** 앱을 한 번 연다: 가짜 저장소 위에서 runBootstrap 을 부른다. */
function boot(initial, { hooks, convert, getBackend } = {}) {
  const backend = createBackend(initial, hooks);
  const notices = [];
  const storage = createSafeStorage({
    getBackend: getBackend ?? (() => backend),
    notify: (kind) => notices.push(kind),
    now: () => NOW,
    subscribeToPageHide: () => {},
  });
  const result = runBootstrap(storage, convert ? { convert } : {});
  return { backend, storage, notices, result };
}

// ---------------------------------------------------------------------------------------------
// 픽스처: 실제 v1 저장소 내용 6개. 파일은 고치지 않는다(문서: e2e/fixtures/storage-v1/README.md).
// ---------------------------------------------------------------------------------------------
const fixtureDir = fileURLToPath(new URL('../e2e/fixtures/storage-v1/', import.meta.url));
const fixtureFiles = (await readdir(fixtureDir)).filter((name) => name.endsWith('.json')).sort();
equal(fixtureFiles.length, 6, 'v1 저장소 픽스처는 6개입니다');
const fixtures = new Map();
for (const file of fixtureFiles) {
  fixtures.set(file.slice(0, 2), { file, ...JSON.parse(await readFile(join(fixtureDir, file), 'utf8')) });
}
deepEqual([...fixtures.keys()], ['01', '02', '03', '04', '05', '06'], '픽스처 번호');
const fixtureRaw = (prefix) => ({ ...fixtures.get(prefix).storage });
/** 변환할 수 있는 픽스처(03 은 깨진 JSON 이다) 5개와, 그 켜진 페달 수(LED 개수, E-08) */
const CONVERTIBLE = ['01', '02', '04', '05', '06'];
const FIXTURE_ACTIVE_COUNT = { '01': 5, '02': 2, '04': 5, '05': 6, '06': 5 };

// ---------------------------------------------------------------------------------------------
// 기대값: 변환 코드를 쓰지 않고 규칙만으로 적는다.
//   M1 켜짐 = enabled && !bypassed
//   M2 꺼져 있고 Mix 가 0 이면 기본 Mix
//   M3 Reverb decay 는 6 초까지(D14, 4.9 스키마 범위)
//   M6 음량 보정이 없으면 0
// ---------------------------------------------------------------------------------------------
function expectedPedal(raw) {
  const defaults = defaultById.get(raw.id);
  const active = raw.enabled === true && raw.bypassed === false;
  const params = { ...defaults.params, ...raw.params };
  if (raw.id === 'reverb' && typeof params.decay === 'number') params.decay = Math.min(params.decay, REVERB_DECAY_MAX);
  if (!active && params.mix === 0) params.mix = defaults.params.mix;
  return { id: raw.id, type: defaults.type, active, params };
}
const pedalMap = (list) => Object.fromEntries(list.map((raw) => [raw.id, expectedPedal(raw)]));
const expectedState = (rawBoard) => ({
  schemaVersion: 2,
  chain: rawBoard.pedals.map((pedal) => pedal.id),
  pedals: pedalMap(rawBoard.pedals),
  trimDb: 0,
});
function expectedPreset(rawPreset) {
  const iso = new Date(rawPreset.updatedAt).toISOString();
  const preset = {
    schemaVersion: 2,
    id: rawPreset.id,
    name: rawPreset.name,
    origin: 'user',
    chain: rawPreset.pedals.map((pedal) => pedal.id),
    pedals: pedalMap(rawPreset.pedals),
    trimDb: 0,
    createdAt: iso,
    updatedAt: iso,
  };
  for (const key of ['libraryId', 'libraryName', 'description']) if (typeof rawPreset[key] === 'string') preset[key] = rawPreset[key];
  if (Array.isArray(rawPreset.tags)) preset.tags = rawPreset.tags;
  return preset;
}
const expectedPresetsStore = (rawPresets) => ({ schemaVersion: 2, presets: rawPresets.presets.map(expectedPreset) });

// ---------------------------------------------------------------------------------------------
// 1. 변환 단위 시험: 픽스처마다(수용 기준 '변환 단위 시험 6개'). 03(깨진 JSON)은 열기 절차에서 본다.
// ---------------------------------------------------------------------------------------------
for (const prefix of CONVERTIBLE) {
  const fixture = fixtures.get(prefix);
  const label = fixture.name;
  const boardRaw = fixture.storage[K.v1Pedals];
  const presetsRaw = fixture.storage[K.v1Presets];
  const rawBoard = JSON.parse(boardRaw);
  const rawPresets = presetsRaw ? JSON.parse(presetsRaw) : null;

  // 기대값을 쓸 때 가정한 것: 픽스처는 페달 15개를 모두 적고, 모든 값 이름이 기본 페달과 같다(그렇지 않으면 기본값이 채워져 기대값이 달라진다).
  equal(rawBoard.pedals.length, 15, `${label}: 페달 15개`);
  for (const pedal of rawBoard.pedals) {
    deepEqual(Object.keys(pedal.params).sort(), Object.keys(defaultById.get(pedal.id).params).sort(), `${label}: ${pedal.id} 값 이름이 기본 페달과 같다`);
  }

  const boardRead = readBoardV1(boardRaw);
  const presetsRead = presetsRaw ? readPresetsV1(presetsRaw) : null;
  const converted = convertV1ToV2(boardRead, presetsRead);

  // 작업 상태
  deepEqual(converted.state, expectedState(rawBoard), `${label}: v2 작업 상태가 규칙만으로 쓴 기대값과 같다`);
  for (const raw of rawBoard.pedals) {
    const record = converted.state.pedals[raw.id];
    equal(record.active, raw.enabled === true && raw.bypassed === false, `${label}: ${raw.id} 켜짐(M1)`);
    ok(!('enabled' in record) && !('bypassed' in record), `${label}: ${raw.id} 에 옛 두 필드가 남지 않는다`);
    ok(!('_extra' in record), `${label}: ${raw.id} 은 모르는 필드가 없으니 _extra 도 없다`);
  }
  equal(converted.state.trimDb, 0, `${label}: 음량 보정이 없으면 0(M6)`);
  equal(activeIdsOf(converted.board.pedals).length, FIXTURE_ACTIVE_COUNT[prefix], `${label}: 켜진 페달 수(= 화면의 LED 개수, E-08)`);
  deepEqual(activeIdsOf(converted.board.pedals), rawBoard.pedals.filter((pedal) => pedal.enabled && !pedal.bypassed).map((pedal) => pedal.id), `${label}: 켜진 페달의 id 와 순서`);
  equal(verifyConversion(converted), null, `${label}: 되읽은 값이 v1 을 옛 방식으로 읽은 값과 같다`);

  // 사용자 프리셋
  if (rawPresets) {
    deepEqual(converted.presetsStore, expectedPresetsStore(rawPresets), `${label}: v2 사용자 프리셋이 규칙만으로 쓴 기대값과 같다`);
    equal(converted.userPresets.length, rawPresets.presets.length, `${label}: 프리셋 개수`);
    converted.presetsStore.presets.forEach((preset, index) => {
      equal(preset.createdAt, preset.updatedAt, `${label}: ${preset.name} 만든 시각은 v1 에 없으니 수정 시각과 같다`);
      equal(Date.parse(preset.updatedAt), rawPresets.presets[index].updatedAt, `${label}: ${preset.name} 수정 시각 값이 그대로다`);
      equal(converted.userPresets[index].updatedAt, rawPresets.presets[index].updatedAt, `${label}: ${preset.name} 메모리의 수정 시각(밀리초)이 그대로다`);
    });
  } else {
    deepEqual(converted.presetsStore, { schemaVersion: 2, presets: [] }, `${label}: v1 프리셋이 없으면 빈 목록`);
  }

  // 멱등: 몇 번을 옮겨도 같다. 입력(읽은 값)도 바뀌지 않는다.
  const again = convertV1ToV2(readBoardV1(boardRaw), presetsRaw ? readPresetsV1(presetsRaw) : null);
  equal(JSON.stringify(again.state), JSON.stringify(converted.state), `${label}: 작업 상태를 두 번 옮겨도 같은 글자열`);
  equal(JSON.stringify(again.presetsStore), JSON.stringify(converted.presetsStore), `${label}: 사용자 프리셋을 두 번 옮겨도 같은 글자열`);
  const third = convertV1ToV2(boardRead, presetsRead);
  equal(JSON.stringify(third.state), JSON.stringify(converted.state), `${label}: 같은 읽은 값에서 다시 옮겨도 같다`);

  // 저장했다 읽어도 같다(JSON 왕복)
  deepEqual(parseStateV2(JSON.stringify(converted.state)), converted.state, `${label}: 작업 상태 JSON 왕복`);
  deepEqual(parsePresetsStoreV2(JSON.stringify(converted.presetsStore)), converted.presetsStore, `${label}: 사용자 프리셋 JSON 왕복`);

  // 쓰고 읽기: 읽은 값을 그대로 다시 쓰면 같은 저장본이 나온다(되쓰기가 값을 바꾸지 않는다)
  const board = stateV2ToBoard(converted.state);
  deepEqual(boardToStateV2(board.pedals, board.trimDb, extrasOfState(converted.state)), converted.state, `${label}: 읽었다 다시 쓴 작업 상태가 같다`);
  deepEqual(clone(board.pedals), clone(converted.board.pedals), `${label}: v2 를 읽은 보드 = v1 을 읽은 보드`);
  converted.presetsStore.presets.forEach((preset, index) => {
    const memory = presetFromV2(preset);
    deepEqual(memory, converted.userPresets[index], `${label}: ${preset.name} v2 를 읽은 프리셋 = v1 을 읽은 프리셋`);
    deepEqual(presetToV2(memory, carryOfPreset(preset)), preset, `${label}: ${preset.name} 읽었다 다시 쓴 프리셋이 같다`);
  });
}

// 픽스처 특성(기대값의 근거가 되는 입력이 정말 그런 값인지): 시험이 엉뚱한 곳을 보지 않게 한다.
{
  const raw02 = JSON.parse(fixtures.get('02').storage[K.v1Pedals]);
  equal(raw02.version, 10, '02 는 payload version 10(10→11 변환을 지난다)');
  const combos = Object.fromEntries(raw02.pedals.filter((p) => ['noise-gate', 'compressor', 'drive', 'eq'].includes(p.id)).map((p) => [p.id, [p.enabled, p.bypassed]]));
  deepEqual(combos, { 'noise-gate': [true, false], compressor: [true, true], drive: [false, false], eq: [false, true] }, '02 의 스위치 네 가지 조합');
  const converted02 = convertV1ToV2(readBoardV1(fixtures.get('02').storage[K.v1Pedals]), readPresetsV1(fixtures.get('02').storage[K.v1Presets]));
  deepEqual(
    ['noise-gate', 'compressor', 'drive', 'eq'].map((id) => converted02.state.pedals[id].active),
    [true, false, false, false],
    '02: 켜짐 / Bypass / On·Off 끔 / 둘 다 끔 → 켜짐만 켜진 채로',
  );
  const raw04 = JSON.parse(fixtures.get('04').storage[K.v1Pedals]);
  deepEqual(raw04.pedals.filter((p) => p.params.mix === 0).map((p) => p.id), ['chorus', 'delay', 'reverb'], '04: Mix 0 인 페달');
  const converted04 = convertV1ToV2(readBoardV1(fixtures.get('04').storage[K.v1Pedals]), readPresetsV1(fixtures.get('04').storage[K.v1Presets]));
  deepEqual(
    ['chorus', 'delay', 'reverb'].map((id) => converted04.state.pedals[id].params.mix),
    ['chorus', 'delay', 'reverb'].map((id) => defaultById.get(id).params.mix),
    '04: 꺼진 채 Mix 0 이던 페달은 기본 Mix 로 돌아온다(M2)',
  );
  const presetPedals04 = converted04.presetsStore.presets[0].pedals;
  deepEqual(
    ['chorus', 'delay', 'reverb'].map((id) => presetPedals04[id].params.mix),
    ['chorus', 'delay', 'reverb'].map((id) => defaultById.get(id).params.mix),
    '04: 사용자 프리셋 안의 같은 페달도 같은 규칙(M2)',
  );
  const raw05 = JSON.parse(fixtures.get('05').storage[K.v1Pedals]);
  equal(raw05.pedals.find((p) => p.id === 'reverb').params.decay, 7.5, '05: 저장된 Reverb decay');
  const converted05 = convertV1ToV2(readBoardV1(fixtures.get('05').storage[K.v1Pedals]), null);
  equal(converted05.state.pedals.reverb.params.decay, REVERB_DECAY_MAX, '05: 6 초까지로 맞춘다(M3, D14)');
  equal(REVERB_DECAY_MAX, 6, 'Reverb decay 상한은 6 초');
}

// ---------------------------------------------------------------------------------------------
// 2. 규칙마다: 입력을 직접 만들어 규칙 하나씩 본다.
// ---------------------------------------------------------------------------------------------
const v1BoardRaw = (version, edit = () => ({}), top = {}) =>
  JSON.stringify({
    version,
    pedals: initialPedals.map((pedal, index) => ({
      id: pedal.id,
      enabled: true,
      bypassed: !pedal.active,
      params: { ...pedal.params },
      ...edit(pedal, index),
    })),
    ...top,
  });
const convertBoardRaw = (raw) => convertV1ToV2(readBoardV1(raw), null);

// M1: 옛 두 스위치의 네 가지 조합 → 켜짐은 enabled && !bypassed. payload version 10 과 11 모두.
{
  const combos = [
    { enabled: true, bypassed: false, active: true },
    { enabled: true, bypassed: true, active: false },
    { enabled: false, bypassed: false, active: false },
    { enabled: false, bypassed: true, active: false },
  ];
  for (const version of [10, 11]) {
    const raw = v1BoardRaw(version, (_pedal, index) => {
      const combo = combos[index % combos.length];
      return { enabled: combo.enabled, bypassed: combo.bypassed };
    });
    const { state } = convertBoardRaw(raw);
    initialPedals.forEach((pedal, index) => {
      const combo = combos[index % combos.length];
      equal(state.pedals[pedal.id].active, combo.active, `M1 v${version}: ${pedal.id} enabled=${combo.enabled} bypassed=${combo.bypassed} → active=${combo.active}`);
    });
  }
}

// M2: 꺼져 있고 Mix 가 0 인 페달만 기본 Mix 로. 켜진 페달의 Mix 0·꺼진 페달의 다른 Mix 는 그대로.
{
  const raw = v1BoardRaw(11, (pedal) => {
    if (pedal.id === 'delay') return { bypassed: true, params: { ...pedal.params, mix: 0 } };
    if (pedal.id === 'reverb') return { bypassed: false, params: { ...pedal.params, mix: 0 } };
    if (pedal.id === 'chorus') return { bypassed: true, params: { ...pedal.params, mix: 40 } };
    return {};
  });
  const { state } = convertBoardRaw(raw);
  equal(state.pedals.delay.params.mix, defaultById.get('delay').params.mix, 'M2: 꺼짐 + Mix 0 → 기본 Mix');
  equal(state.pedals.delay.active, false, 'M2: 꺼진 채로 둔다');
  equal(state.pedals.reverb.params.mix, 0, 'M2: 켜진 페달의 Mix 0 은 사용자가 정한 값이다');
  equal(state.pedals.reverb.active, true, 'M2: 켜진 채로 둔다');
  equal(state.pedals.chorus.params.mix, 40, 'M2: 꺼진 페달의 Mix 40 은 그대로');
}

// M3: 스키마 범위 밖의 숫자는 범위 안으로
{
  const ratio = getParamDef('compressor', 'ratio');
  const raw = v1BoardRaw(11, (pedal) => {
    if (pedal.id === 'compressor') return { params: { ...pedal.params, ratio: ratio.max + 1000 } };
    if (pedal.id === 'reverb') return { params: { ...pedal.params, decay: 99 } };
    if (pedal.id === 'drive') return { params: { ...pedal.params, level: -50 } };
    return {};
  });
  const { state, board } = convertBoardRaw(raw);
  equal(state.pedals.compressor.params.ratio, ratio.max, 'M3: 상한 위 → 상한');
  equal(state.pedals.reverb.params.decay, REVERB_DECAY_MAX, 'M3: Reverb decay 99 → 6');
  const levelDef = getParamDef('drive', 'level');
  equal(state.pedals.drive.params.level, levelDef.min, 'M3: 하한 아래 → 하한');
  equal(board.pedals.find((pedal) => pedal.id === 'reverb').params.decay, REVERB_DECAY_MAX, 'M3: 메모리 보드도 같은 값');
  const inRange = convertBoardRaw(v1BoardRaw(11)).state;
  deepEqual(inRange.pedals.compressor.params, defaultById.get('compressor').params, 'M3: 범위 안의 값은 하나도 바뀌지 않는다');
}

// M4: 해당 없음 — v1 MIDI 매핑은 페달 id → 스위치(CC·노트)이고 …:enabled·…:bypass 이름의 키가 없다(기록 L-102). 매핑 키는 변환이 건드리지 않는다.
{
  const midi = JSON.parse(fixtures.get('06').storage[K.midi]);
  ok(Object.keys(midi).every((id) => defaultById.has(id)), 'M4: 매핑의 키는 페달 id 다');
  ok(Object.values(midi).every((entry) => Object.keys(entry).every((name) => ['channel', 'cc', 'note', 'value', 'mode'].includes(name))), 'M4: 매핑 항목에 enabled·bypass 이름이 없다');
  ok(!JSON.stringify(midi).includes('bypass') && !JSON.stringify(midi).includes('enabled'), 'M4: 매핑 어디에도 옛 스위치 이름이 없다');
  const opened = boot(fixtureRaw('06'));
  equal(opened.backend.map.get(K.midi), fixtures.get('06').storage[K.midi], 'M4: 열고 변환한 뒤에도 MIDI 매핑 원문이 같다');
  ok(!opened.backend.writes.some((write) => write.key === K.midi), 'M4: MIDI 매핑 키는 쓰지 않는다');
}

// M6: 음량 보정 — 없으면 0, 있으면 숫자로, 범위 밖은 맞추고, 숫자가 아니면 0
{
  equal(convertBoardRaw(v1BoardRaw(11)).state.trimDb, 0, 'M6: presetTrimDb 가 없으면 0');
  equal(convertBoardRaw(v1BoardRaw(11, () => ({}), { presetTrimDb: -3.5 })).state.trimDb, -3.5, 'M6: 있으면 그대로');
  equal(convertBoardRaw(v1BoardRaw(11, () => ({}), { presetTrimDb: 99 })).state.trimDb, clampTrimDb(99), 'M6: 범위 밖은 맞춘다');
  equal(convertBoardRaw(v1BoardRaw(11, () => ({}), { presetTrimDb: 'abc' })).state.trimDb, 0, 'M6: 숫자가 아니면 0');
  equal(typeof convertBoardRaw(v1BoardRaw(11)).state.trimDb, 'number', 'M6: v2 에는 늘 숫자로 적는다');
  const noTrim = parseStateV2(JSON.stringify({ schemaVersion: 2, chain: [], pedals: {} }));
  equal(noTrim.trimDb, 0, 'M6: v2 저장본에 trimDb 가 없어도 0');
  const presetRaw = JSON.stringify({
    version: 11,
    presets: [
      { id: 'a', name: 'A', updatedAt: 1000, pedals: [] },
      { id: 'b', name: 'B', updatedAt: 2000, trimDb: -4, pedals: [] },
    ],
  });
  const presets = convertV1ToV2(null, readPresetsV1(presetRaw)).presetsStore.presets;
  deepEqual(presets.map((preset) => preset.trimDb), [0, -4], 'M6: 프리셋의 음량 보정(없으면 0)');
}

// M7: 모르는 필드는 버리지 않고 _extra 에 둔다 — 작업 상태·페달·프리셋·프리셋 안의 페달 네 곳
const legacyRecord = (pedal, extra = {}) => ({
  id: pedal.id,
  type: pedal.type,
  name: pedal.name,
  enabled: true,
  bypassed: !pedal.active,
  color: pedal.color,
  params: { ...pedal.params },
  ...extra,
});
const extrasBoardRaw = v1BoardRaw(11, (pedal) => (pedal.id === 'drive' ? { note: '메모', nested: { list: [1, 2, 3] } } : {}), {
  presetTrimDb: -2.5,
  futureTop: { a: 1 },
});
const extrasPresetsRaw = JSON.stringify({
  version: 11,
  exportedAt: 1700000000000,
  presets: [
    { id: 'x1', name: 'Extra One', updatedAt: 1700000000000, pinned: true, pedals: initialPedals.map((pedal) => legacyRecord(pedal, pedal.id === 'delay' ? { custom: 7 } : {})) },
    { id: 'x2', name: 'Extra Two', updatedAt: 1700000001000, rating: 5, pedals: initialPedals.map((pedal) => legacyRecord(pedal)) },
  ],
});
{
  const converted = convertV1ToV2(readBoardV1(extrasBoardRaw), readPresetsV1(extrasPresetsRaw));
  deepEqual(converted.state._extra, { futureTop: { a: 1 } }, 'M7: 작업 상태의 모르는 필드');
  deepEqual(converted.state.pedals.drive._extra, { note: '메모', nested: { list: [1, 2, 3] } }, 'M7: 페달의 모르는 필드(중첩 값 포함)');
  ok(Object.entries(converted.state.pedals).every(([id, pedal]) => id === 'drive' || !('_extra' in pedal)), 'M7: 다른 페달에는 _extra 가 없다');
  equal(converted.state.trimDb, -2.5, 'M7: 아는 필드(presetTrimDb)는 _extra 로 가지 않는다');
  deepEqual(converted.presetsStore.presets[0]._extra, { pinned: true }, 'M7: 첫 프리셋의 모르는 필드가 첫 프리셋에 붙는다');
  deepEqual(converted.presetsStore.presets[1]._extra, { rating: 5 }, 'M7: 둘째 프리셋의 모르는 필드가 둘째 프리셋에 붙는다');
  deepEqual(converted.presetsStore.presets[0].pedals.delay._extra, { custom: 7 }, 'M7: 프리셋 안 페달의 모르는 필드');
  ok(!('_extra' in converted.presetsStore.presets[1].pedals.delay), 'M7: 둘째 프리셋의 같은 페달에는 없다');
  for (const field of ['name', 'color', 'type', 'enabled', 'bypassed']) {
    ok(!converted.presetsStore.presets[0].pedals.delay._extra || !(field in converted.presetsStore.presets[0].pedals.delay._extra), `M7: v1 이 아는 필드(${field})는 _extra 로 가지 않는다`);
  }
  equal(verifyConversion(converted), null, 'M7: 모르는 필드가 있어도 변환은 소리 값을 바꾸지 않는다');
  // v2 를 읽을 때도 모르는 필드를 모은다(다음 버전이 더한 필드)
  const stateRaw = JSON.stringify({ ...converted.state, futureV2: 'x', pedals: { ...converted.state.pedals, delay: { ...converted.state.pedals.delay, hint: 1 } } });
  const reread = parseStateV2(stateRaw);
  deepEqual(reread._extra, { futureTop: { a: 1 }, futureV2: 'x' }, 'M7: v2 의 _extra 와 새로 모르는 필드가 합쳐진다');
  deepEqual(reread.pedals.delay._extra, { hint: 1 }, 'M7: v2 페달의 모르는 필드');
  deepEqual(extrasOfState(reread).pedals, { drive: converted.state.pedals.drive._extra, delay: { hint: 1 } }, 'M7: 다시 쓸 때 돌려 쓸 모음');
  const written = boardToStateV2(stateV2ToBoard(reread).pedals, stateV2ToBoard(reread).trimDb, extrasOfState(reread));
  deepEqual(written._extra, reread._extra, 'M7: 다시 쓴 작업 상태에 모르는 필드가 남는다');
  deepEqual(written.pedals.delay._extra, { hint: 1 }, 'M7: 다시 쓴 페달에 모르는 필드가 남는다');
  // collectExtra 자체
  equal(collectExtra({ a: 1 }, ['a']), undefined, 'collectExtra: 모르는 필드가 없으면 undefined(빈 _extra 를 만들지 않는다)');
  deepEqual(collectExtra({ a: 1, b: 2, _extra: { c: 3 } }, ['a']), { b: 2, c: 3 }, 'collectExtra: 아는 키를 빼고 이미 있던 _extra 를 합친다');
}

// 아는 페달이 아닌 것: 옮기지 않는다(v1 키에는 그대로 남는다). 변환은 던지지 않는다.
{
  const raw = JSON.stringify({
    version: 11,
    pedals: [
      ...JSON.parse(v1BoardRaw(11)).pedals,
      { id: 'ghost', enabled: true, bypassed: false, params: { mix: 50 } },
    ],
  });
  const converted = convertBoardRaw(raw);
  ok(!('ghost' in converted.state.pedals) && !converted.state.chain.includes('ghost'), '모르는 페달 id 는 v2 에 옮기지 않는다');
  equal(converted.state.chain.length, 15, '아는 페달 15개');
  equal(verifyConversion(converted), null, '모르는 페달이 있어도 변환 검증은 통과한다');
}

// 페달이 일부만 있는 v1: 없는 페달은 기본값으로 채워 15개
{
  const raw = JSON.stringify({ version: 11, pedals: JSON.parse(v1BoardRaw(11)).pedals.slice(0, 3) });
  const { state } = convertBoardRaw(raw);
  equal(state.chain.length, 15, '일부만 적힌 v1 → 15개로 채운다');
  deepEqual(state.chain.slice(0, 3), initialPedals.slice(0, 3).map((pedal) => pedal.id), '적힌 순서가 앞에 온다');
}

// ---------------------------------------------------------------------------------------------
// 3. v2 읽기: 모양 검증과 읽을 때 적용하는 규칙
// ---------------------------------------------------------------------------------------------
{
  const goodState = convertBoardRaw(v1BoardRaw(11)).state;
  const text = JSON.stringify(goodState);
  deepEqual(parseStateV2(text), goodState, 'v2 읽기: 정상 저장본');
  for (const [name, raw] of [
    ['깨진 JSON', '{"schemaVersion":2,'],
    ['배열', '[]'],
    ['null', 'null'],
    ['schemaVersion 없음', JSON.stringify({ chain: [], pedals: {} })],
    ['schemaVersion 1', JSON.stringify({ ...goodState, schemaVersion: 1 })],
    ['schemaVersion 3(더 새로운 형식)', JSON.stringify({ ...goodState, schemaVersion: 3 })],
    ['schemaVersion 문자열', JSON.stringify({ ...goodState, schemaVersion: '2' })],
    ['pedals 가 배열', JSON.stringify({ ...goodState, pedals: [] })],
    ['chain 이 객체', JSON.stringify({ ...goodState, chain: {} })],
  ]) {
    throws(() => parseStateV2(raw), `v2 읽기: ${name} 은 던진다(SafeStorage 가 원문을 보관하고 기본값으로 시작한다)`);
  }

  // 모양이 맞지 않는 페달 한 개는 건너뛰고 나머지는 읽는다. 순서(chain)는 고쳐 읽는다.
  const messy = parseStateV2(
    JSON.stringify({
      schemaVersion: 2,
      chain: ['delay', 'delay', 'nope', 'drive'],
      pedals: {
        drive: { id: 'drive', type: 'drive', active: true, params: { mix: 88 } },
        delay: { id: 'delay', type: 'delay', active: 'yes', params: {} },
        reverb: { id: 'reverb', type: 'reverb', active: false, params: { mix: 25, weird: { a: 1 } } },
        chorus: { id: 'other', type: 'chorus', active: true, params: {} },
      },
    }),
  );
  deepEqual(Object.keys(messy.pedals).sort(), ['drive', 'reverb'], 'v2 읽기: active 가 불리언이 아닌 페달·id 가 키와 다른 페달은 건너뛴다');
  deepEqual(messy.chain, ['drive', 'reverb'], 'v2 읽기: 순서에서 없는 id·중복을 빼고 빠진 페달은 뒤에 붙인다');
  deepEqual(messy.pedals.reverb.params, { mix: 25 }, 'v2 읽기: 값이 객체인 파라미터는 버린다');

  // __proto__ 키가 객체의 원형을 바꾸지 않는다
  const proto = parseStateV2('{"schemaVersion":2,"chain":[],"pedals":{"__proto__":{"id":"__proto__","type":"drive","active":true,"params":{}},"drive":{"id":"drive","type":"drive","active":true,"params":{}}}}');
  deepEqual(Object.keys(proto.pedals), ['drive'], 'v2 읽기: __proto__ 페달은 건너뛴다');
  equal(Object.getPrototypeOf(proto.pedals), Object.prototype, 'v2 읽기: 원형이 바뀌지 않는다');
  equal({}.polluted, undefined, 'v2 읽기: 전역 오염이 없다');

  // 읽을 때 M1~M3 규칙이 다시 적용된다: 손으로 고친·다른 앱이 쓴 v2 도 안전한 보드가 된다
  const handEdited = stateV2ToBoard({
    schemaVersion: 2,
    chain: ['reverb', 'delay', 'compressor'],
    pedals: {
      reverb: { id: 'reverb', type: 'reverb', active: true, params: { decay: 99 } },
      delay: { id: 'delay', type: 'delay', active: false, params: { mix: 0 } },
      compressor: { id: 'compressor', type: 'compressor', active: true, params: { mix: 0 } },
    },
    trimDb: 99,
  });
  equal(handEdited.pedals.length, 15, 'v2 읽기: 모자란 페달은 기본값으로 채워 15개');
  deepEqual(handEdited.pedals.slice(0, 3).map((pedal) => pedal.id), ['reverb', 'delay', 'compressor'], 'v2 읽기: 적힌 순서가 앞');
  equal(handEdited.pedals[0].params.decay, REVERB_DECAY_MAX, 'v2 읽기: 범위 밖의 값을 맞춘다(M3)');
  equal(handEdited.pedals[1].params.mix, defaultById.get('delay').params.mix, 'v2 읽기: 꺼짐 + Mix 0 은 기본 Mix(M2)');
  equal(handEdited.pedals[2].params.mix, 0, 'v2 읽기: 켜진 페달의 Mix 0 은 그대로');
  equal(handEdited.trimDb, clampTrimDb(99), 'v2 읽기: 음량 보정을 맞춘다(M6)');

  // 프리셋 목록: 한 항목이라도 모양이 틀리면 목록 전체를 읽지 못한다(v1 과 같다 — 원문은 보관된다)
  const goodList = convertV1ToV2(null, readPresetsV1(fixtures.get('02').storage[K.v1Presets])).presetsStore;
  deepEqual(parsePresetsStoreV2(JSON.stringify(goodList)), goodList, 'v2 프리셋 읽기: 정상');
  for (const [name, value] of [
    ['presets 가 배열이 아님', { schemaVersion: 2, presets: {} }],
    ['schemaVersion 없음', { presets: [] }],
    ['schemaVersion 3', { schemaVersion: 3, presets: [] }],
    ['항목의 schemaVersion 이 다름', { schemaVersion: 2, presets: [{ ...goodList.presets[0], schemaVersion: 1 }] }],
    ['항목에 id 가 없음', { schemaVersion: 2, presets: [{ ...goodList.presets[0], id: undefined }] }],
    ['항목에 name 이 없음', { schemaVersion: 2, presets: [{ ...goodList.presets[0], name: 3 }] }],
  ]) {
    throws(() => parsePresetsStoreV2(JSON.stringify(value)), `v2 프리셋 읽기: ${name} → 던진다`);
  }
  const noOrigin = parsePresetsStoreV2(JSON.stringify({ schemaVersion: 2, presets: [{ schemaVersion: 2, id: 'p', name: 'P', updatedAt: '2026-01-02T03:04:05.000Z', chain: [], pedals: {} }] }));
  equal(noOrigin.presets[0].origin, 'user', 'v2 프리셋 읽기: origin 이 없으면 user');
  equal(noOrigin.presets[0].createdAt, '2026-01-02T03:04:05.000Z', 'v2 프리셋 읽기: createdAt 이 없으면 updatedAt');
  const badDate = parsePresetsStoreV2(JSON.stringify({ schemaVersion: 2, presets: [{ schemaVersion: 2, id: 'p', name: 'P', updatedAt: 'yesterday', chain: [], pedals: {} }] }));
  equal(badDate.presets[0].updatedAt, new Date(0).toISOString(), 'v2 프리셋 읽기: 시각이 이상하면 1970-01-01');
}

// 변환이 틀렸는지 알아보는 verifyConversion 자체가 정말 잡는지(변환 결과를 하나씩 망가뜨려 본다)
{
  const good = convertV1ToV2(readBoardV1(fixtures.get('02').storage[K.v1Pedals]), readPresetsV1(fixtures.get('02').storage[K.v1Presets]));
  equal(verifyConversion(good), null, 'verifyConversion: 맞는 변환은 통과');
  const mutate = (edit) => {
    const copy = clone(good);
    edit(copy);
    return verifyConversion(copy);
  };
  ok(typeof mutate((c) => { c.state.pedals.drive.active = !c.state.pedals.drive.active; }) === 'string', 'verifyConversion: 켜짐이 바뀌면 잡는다');
  ok(typeof mutate((c) => { c.state.pedals.drive.params.mix += 1; }) === 'string', 'verifyConversion: 노브 값이 바뀌면 잡는다');
  ok(typeof mutate((c) => { c.state.chain = [...c.state.chain].reverse(); }) === 'string', 'verifyConversion: 페달 순서가 바뀌면 잡는다');
  ok(typeof mutate((c) => { c.state.trimDb = 3; }) === 'string', 'verifyConversion: 음량 보정이 바뀌면 잡는다');
  ok(typeof mutate((c) => { c.presetsStore.presets.pop(); }) === 'string', 'verifyConversion: 프리셋이 빠지면 잡는다');
  ok(typeof mutate((c) => { c.presetsStore.presets[0].pedals.eq.active = true; }) === 'string', 'verifyConversion: 프리셋 안의 켜짐이 바뀌면 잡는다');
  ok(typeof mutate((c) => { c.presetsStore.presets[1].name = '다른 이름'; }) === 'string', 'verifyConversion: 프리셋 이름이 바뀌면 잡는다');
  ok(typeof mutate((c) => { c.presetsStore.presets[0].updatedAt = '2001-01-01T00:00:00.000Z'; }) === 'string', 'verifyConversion: 수정 시각이 바뀌면 잡는다');
  const hint = mutate((c) => { c.presetsStore.presets[1].trimDb = -6; });
  ok(typeof hint === 'string' && hint.includes('Switch Combos B'), 'verifyConversion: 어느 프리셋이 다른지 이름으로 알려 준다');
  const nullBoard = convertV1ToV2(null, null);
  equal(verifyConversion(nullBoard), null, 'verifyConversion: v1 이 없으면 기본 보드와 견준다');
  deepEqual(nullBoard.state.chain, initialPedals.map((pedal) => pedal.id), '옮길 v1 이 없으면 기본 보드');
}

// 시간 지난 사본 알림용 키(M5): 이름과 내용이 같아야 같은 프리셋이다
{
  equal(new Set(defaultPresets.map(presetContentKey)).size, defaultPresets.length, 'M5: 팩토리 프리셋 40개는 이름·내용 열쇠가 모두 다르다');
  equal(defaultPresets.length, 40, 'M5: 팩토리 프리셋은 40개');
  const factory = defaultPresets.find((preset) => preset.pedals.some((pedal) => pedal.id === 'drive')) ?? defaultPresets[0];
  const copy = { ...withoutFactoryFlag(factory), id: 'user-copy', libraryId: 'user', libraryName: 'My Presets', description: '사용자가 저장한 페달 체인', tags: ['user', 'custom'], updatedAt: 42 };
  deepEqual(findFactoryCopies([copy], defaultPresets), ['user-copy'], 'M5: 이름과 내용이 같으면 사본(id·시각·라이브러리 표시는 보지 않는다)');
  deepEqual(findFactoryCopies([], defaultPresets), [], 'M5: 사용자 프리셋이 없으면 없다');
  deepEqual(findFactoryCopies([{ ...copy, name: ` ${copy.name} ` }], defaultPresets), ['user-copy'], 'M5: 이름 앞뒤 공백은 보지 않는다');
  const reversedParams = { ...copy, pedals: copy.pedals.map((pedal) => ({ ...pedal, params: Object.fromEntries(Object.entries(pedal.params).reverse()) })) };
  deepEqual(findFactoryCopies([reversedParams], defaultPresets), ['user-copy'], 'M5: 값의 적힌 순서는 보지 않는다');
  const changedParam = clone(copy);
  changedParam.pedals[0].params.level = changedParam.pedals[0].params.level === 99 ? 98 : 99;
  deepEqual(findFactoryCopies([changedParam], defaultPresets), [], 'M5: 노브 값이 하나라도 다르면 사본이 아니다');
  const changedActive = clone(copy);
  changedActive.pedals[3].active = !changedActive.pedals[3].active;
  deepEqual(findFactoryCopies([changedActive], defaultPresets), [], 'M5: 켜짐이 다르면 사본이 아니다');
  const changedOrder = clone(copy);
  [changedOrder.pedals[0], changedOrder.pedals[1]] = [changedOrder.pedals[1], changedOrder.pedals[0]];
  deepEqual(findFactoryCopies([changedOrder], defaultPresets), [], 'M5: 페달 순서가 다르면 사본이 아니다');
  deepEqual(findFactoryCopies([{ ...copy, trimDb: (copy.trimDb ?? 0) + 1 }], defaultPresets), [], 'M5: 음량 보정이 다르면 사본이 아니다');
  deepEqual(findFactoryCopies([{ ...copy, name: `${copy.name} 2` }], defaultPresets), [], 'M5: 이름이 다르면 사본이 아니다(내용이 같아도)');
  // 팩토리 40개를 모두 사용자 프리셋으로 복사해 보면 40개 모두 사본이다
  const all = defaultPresets.map((preset, index) => ({ ...withoutFactoryFlag(preset), id: `copy-${index}`, libraryId: 'user' }));
  equal(findFactoryCopies(all, defaultPresets).length, 40, 'M5: 팩토리 40개의 사본은 모두 알아본다');
  // v1 저장본을 거쳐도(쓰고 읽으며 M1~M3 가 적용돼도) 알아본다 — 팩토리 프리셋은 이미 그 규칙을 지킨 값이다
  const viaV1 = readPresetsV1(serializePresetPayload(all)).presets;
  equal(findFactoryCopies(viaV1, defaultPresets).length, 40, 'M5: v1 저장본으로 썼다 읽어도 40개 모두 사본');
  const viaV2 = convertV1ToV2(null, readPresetsV1(serializePresetPayload(all))).presetsStore.presets.map(presetFromV2);
  equal(findFactoryCopies(viaV2, defaultPresets).length, 40, 'M5: v2 로 옮겼다 읽어도 40개 모두 사본');
}

// ---------------------------------------------------------------------------------------------
// 4. 열기 절차(runBootstrap): 가짜 저장소 위에서
// ---------------------------------------------------------------------------------------------
const writtenKeys = (opened) => opened.backend.writes.map((write) => write.key);
const V2_WRITE_ORDER = [K.v2State, K.v2Presets, K.schema];

// 4-1. 처음 쓰는 사람: 옮길 것이 없다. schema 만 쓰고(v2 로 시작했다는 표시), 나머지는 쓰지 않는다.
{
  const first = boot({});
  equal(first.result.outcome, 'fresh', '처음 쓰는 사람: fresh');
  equal(first.result.mode, 'v2', '처음 쓰는 사람: v2 모드');
  equal(first.result.board, null, '처음 쓰는 사람: 기본 보드');
  deepEqual(first.result.userPresets, [], '처음 쓰는 사람: 사용자 프리셋 없음');
  deepEqual(first.backend.writes, [{ key: K.schema, value: '2' }], '처음 쓰는 사람: schema 만 쓴다');
  deepEqual(first.notices, [], '처음 쓰는 사람: 안내 없음');
  // 두 번째 방문: 이미 v2. 읽기만 한다.
  const second = boot(Object.fromEntries(first.backend.map));
  equal(second.result.outcome, 'v2', '두 번째 방문: v2');
  equal(second.result.board, null, '두 번째 방문: v2:state 가 아직 없으면 기본 보드');
  deepEqual(second.backend.writes, [], '두 번째 방문: 아무것도 쓰지 않는다');
  deepEqual(second.backend.removes, [], '두 번째 방문: 아무것도 지우지 않는다');
}

// 4-2. v1 에서 올라오는 사람: 픽스처마다 — 쓰기 순서, v1 불변, 되읽기 같음, 멱등
for (const prefix of CONVERTIBLE) {
  const fixture = fixtures.get(prefix);
  const label = fixture.name;
  const initial = fixtureRaw(prefix);
  const rawBoard = JSON.parse(initial[K.v1Pedals]);
  const rawPresets = initial[K.v1Presets] ? JSON.parse(initial[K.v1Presets]) : null;

  const visit1 = boot(initial);
  equal(visit1.result.outcome, 'converted', `${label}: 첫 방문은 converted`);
  equal(visit1.result.mode, 'v2', `${label}: v2 모드`);
  deepEqual(writtenKeys(visit1), V2_WRITE_ORDER, `${label}: 쓰기 순서는 v2:state → v2:presets → schema, 그 밖에는 쓰지 않는다`);
  deepEqual(visit1.backend.removes, [], `${label}: 아무것도 지우지 않는다`);
  deepEqual(visit1.notices, [], `${label}: 안내 없음`);
  for (const key of Object.keys(initial)) equal(visit1.backend.map.get(key), initial[key], `${label}: ${key} 는 한 글자도 바뀌지 않는다(v1 키는 백업)`);
  equal(visit1.backend.map.get(K.schema), '2', `${label}: schema 는 2`);
  deepEqual(JSON.parse(visit1.backend.map.get(K.v2State)), expectedState(rawBoard), `${label}: 저장된 v2 작업 상태가 기대값과 같다`);
  deepEqual(
    JSON.parse(visit1.backend.map.get(K.v2Presets)),
    rawPresets ? expectedPresetsStore(rawPresets) : { schemaVersion: 2, presets: [] },
    `${label}: 저장된 v2 사용자 프리셋이 기대값과 같다`,
  );
  equal(activeIdsOf(visit1.result.board.pedals).length, FIXTURE_ACTIVE_COUNT[prefix], `${label}: 첫 방문의 켜진 페달 수`);

  // 두 번째 방문: v2 에서 읽는다. 아무것도 쓰지 않고, 첫 방문과 같은 값이다.
  const visit2 = boot(Object.fromEntries(visit1.backend.map));
  equal(visit2.result.outcome, 'v2', `${label}: 둘째 방문은 v2`);
  deepEqual(visit2.backend.writes, [], `${label}: 둘째 방문은 쓰지 않는다`);
  deepEqual(visit2.backend.removes, [], `${label}: 둘째 방문은 지우지 않는다`);
  deepEqual(visit2.result.board, visit1.result.board, `${label}: 둘째 방문의 보드 = 첫 방문의 보드`);
  deepEqual(visit2.result.userPresets, visit1.result.userPresets, `${label}: 둘째 방문의 프리셋 = 첫 방문의 프리셋`);
  equal(visit2.result.loadedState.schemaVersion, 2, `${label}: 읽은 v2 원본을 돌려 준다`);
  ok(visit2.result.loadedPresets !== null, `${label}: 읽은 프리셋 원본을 돌려 준다`);

  // 멱등: schema 를 지우고(= 변환이 끝나지 않은 것처럼) 다시 열어도 같은 v2 가 같은 순서로 다시 쓰인다.
  const retryInitial = Object.fromEntries(visit1.backend.map);
  delete retryInitial[K.schema];
  const retry = boot(retryInitial);
  equal(retry.result.outcome, 'converted', `${label}: schema 가 없으면 다시 옮긴다`);
  deepEqual(writtenKeys(retry), V2_WRITE_ORDER, `${label}: 다시 옮길 때도 같은 순서`);
  equal(retry.backend.map.get(K.v2State), visit1.backend.map.get(K.v2State), `${label}: 다시 옮겨도 v2:state 글자가 같다`);
  equal(retry.backend.map.get(K.v2Presets), visit1.backend.map.get(K.v2Presets), `${label}: 다시 옮겨도 v2:presets 글자가 같다`);
  deepEqual(retry.result.board, visit1.result.board, `${label}: 다시 옮긴 보드가 같다`);
}

// 4-3. 깨진 v1(픽스처 03): 흰 화면 없이 기본값으로, 원문은 보관한다. v2 로 시작했다는 표시만 한다.
{
  const initial = fixtureRaw('03');
  const opened = boot(initial);
  equal(opened.result.outcome, 'fresh', '03: 옮길 것이 없으니 fresh');
  equal(opened.result.board, null, '03: 기본 보드');
  deepEqual(opened.result.userPresets, [], '03: 사용자 프리셋 없음');
  deepEqual(opened.notices, ['corrupt'], '03: 깨진 값 안내는 한 번만');
  equal(opened.backend.map.get(`${K.v1Pedals}:corrupt-${NOW}`), initial[K.v1Pedals], '03: 깨진 작업 상태 원문을 보관한다');
  equal(opened.backend.map.get(`${K.v1Presets}:corrupt-${NOW}`), initial[K.v1Presets], '03: 깨진 프리셋 원문을 보관한다');
  ok(!opened.backend.map.has(K.v1Pedals) && !opened.backend.map.has(K.v1Presets), '03: 깨진 원본 키는 치운다(보관본이 남는다)');
  equal(opened.backend.map.get(K.io), initial[K.io], '03: 열 때 읽지 않는 키(io)는 건드리지 않는다');
  deepEqual([...writtenKeys(opened)].sort(), [`${K.v1Pedals}:corrupt-${NOW}`, `${K.v1Presets}:corrupt-${NOW}`, K.schema].sort(), '03: 쓴 것은 보관본 둘과 schema 뿐');
  ok(!opened.backend.map.has(K.v2State) && !opened.backend.map.has(K.v2Presets), '03: v2 키는 만들지 않는다');
  equal(opened.backend.map.get(K.schema), '2', '03: v2 로 시작했다는 표시');
  const next = boot(Object.fromEntries(opened.backend.map));
  equal(next.result.outcome, 'v2', '03: 다음 방문은 v2');
  deepEqual(next.notices, [], '03: 다음 방문에는 안내가 다시 나오지 않는다');
  equal(next.result.board, null, '03: 기본 보드');
}

// 4-4. 일부만 깨진 v1: 멀쩡한 쪽은 옮기고 깨진 쪽만 기본값
{
  const initial = fixtureRaw('02');
  initial[K.v1Presets] = '{"version":11,"presets":[';
  const opened = boot(initial);
  equal(opened.result.outcome, 'converted', '프리셋만 깨짐: 작업 상태는 옮긴다');
  deepEqual(opened.result.userPresets, [], '프리셋만 깨짐: 프리셋은 기본(없음)');
  deepEqual(opened.notices, ['corrupt'], '프리셋만 깨짐: 안내 한 번');
  equal(opened.backend.map.get(`${K.v1Presets}:corrupt-${NOW}`), initial[K.v1Presets], '프리셋만 깨짐: 원문 보관');
  deepEqual(JSON.parse(opened.backend.map.get(K.v2Presets)), { schemaVersion: 2, presets: [] }, '프리셋만 깨짐: 빈 목록을 쓴다');
  equal(activeIdsOf(opened.result.board.pedals).length, 2, '프리셋만 깨짐: 작업 상태는 그대로 옮겼다');
}

// 4-5. 쓰기 실패: 하나라도 실패하면 schema 를 쓰지 않는다. 다음 방문에 v1 에서 다시 옮긴다.
for (const [failing, label] of [[K.v2Presets, 'v2:presets'], [K.v2State, 'v2:state'], [K.schema, 'schema']]) {
  const initial = fixtureRaw('02');
  const visit1 = boot(initial, {
    hooks: {
      setItem: (key) => {
        if (key === failing) throw quotaError();
      },
    },
  });
  equal(visit1.result.outcome, 'converted', `${label} 쓰기 실패: 이번 방문은 메모리의 v2 로 계속 동작한다`);
  equal(activeIdsOf(visit1.result.board.pedals).length, 2, `${label} 쓰기 실패: 보드 값은 그대로`);
  deepEqual(visit1.notices, ['quota'], `${label} 쓰기 실패: 저장 공간 안내 한 번`);
  if (failing === K.schema) {
    ok(visit1.backend.map.has(K.v2State) && visit1.backend.map.has(K.v2Presets), 'schema 쓰기 실패: v2 키 둘은 써 두었다');
  } else {
    ok(!visit1.backend.map.has(K.schema), `${label} 쓰기 실패: schema 를 쓰지 않는다`);
  }
  ok(!visit1.backend.map.has(K.schema), `${label} 쓰기 실패: schema 는 저장소에 없다`);
  equal(visit1.backend.map.get(K.v1Pedals), initial[K.v1Pedals], `${label} 쓰기 실패: v1 작업 상태는 그대로`);
  // 다음 방문(쓰기가 되는 환경): 다시 옮기고 이번에는 schema 까지 쓴다.
  const visit2 = boot(Object.fromEntries(visit1.backend.map));
  equal(visit2.result.outcome, 'converted', `${label} 쓰기 실패 뒤 다음 방문: 다시 옮긴다`);
  equal(visit2.backend.map.get(K.schema), '2', `${label} 쓰기 실패 뒤 다음 방문: schema 까지 쓴다`);
  deepEqual(visit2.result.board, visit1.result.board, `${label} 쓰기 실패 뒤 다음 방문: 같은 보드`);
  deepEqual(visit2.result.userPresets, visit1.result.userPresets, `${label} 쓰기 실패 뒤 다음 방문: 같은 프리셋`);
  const visit3 = boot(Object.fromEntries(visit2.backend.map));
  equal(visit3.result.outcome, 'v2', `${label} 쓰기 실패 뒤 두 번째 다음 방문: v2`);
}

// 4-6. 사이트 데이터 차단: 던지지 않는다. 기본값으로 시작하고 한 번 알린다.
{
  const blocked = boot({}, {
    getBackend: () => {
      throw securityError();
    },
  });
  equal(blocked.result.outcome, 'fresh', '차단: 던지지 않고 기본값으로 시작한다');
  equal(blocked.result.board, null, '차단: 기본 보드');
  deepEqual(blocked.notices, ['blocked'], '차단: 안내는 한 번');
}

// 4-7. schema 값이 이상할 때: 보관하고 v1 에서 다시 옮긴다
for (const [bad, label] of [['abc', '글자'], ['1', '1(v2 보다 낮음)'], ['2.5', '정수가 아님'], ['0', '0'], ['-3', '음수']]) {
  const initial = { ...fixtureRaw('02'), [K.schema]: bad };
  const opened = boot(initial);
  equal(opened.result.outcome, 'converted', `schema=${label}: 깨진 값으로 보고 v1 에서 다시 옮긴다`);
  equal(opened.backend.map.get(`${K.schema}:corrupt-${NOW}`), bad, `schema=${label}: 원문을 보관한다`);
  equal(opened.backend.map.get(K.schema), '2', `schema=${label}: 옮긴 뒤 2 를 쓴다`);
  ok(opened.notices.includes('corrupt'), `schema=${label}: 깨진 값 안내`);
  equal(opened.backend.map.get(K.v1Pedals), initial[K.v1Pedals], `schema=${label}: v1 은 그대로`);
}

// 4-8. 더 새로운 저장 형식(schema 3 이상): 그 앱의 키를 건드리지 않고 v1 키로 연다(옛 방식)
{
  const newerState = JSON.stringify({ schemaVersion: 3, anything: 'from a newer app' });
  const newerPresets = JSON.stringify({ schemaVersion: 3, presets: [] });
  const initial = { ...fixtureRaw('02'), [K.schema]: '3', [K.v2State]: newerState, [K.v2Presets]: newerPresets };
  const opened = boot(initial);
  equal(opened.result.outcome, 'legacy', 'schema=3: 옛 방식으로 연다');
  equal(opened.result.mode, 'legacy', 'schema=3: legacy 모드');
  ok(opened.result.reason.includes('3'), 'schema=3: 이유에 형식 번호가 있다');
  deepEqual(opened.backend.writes, [], 'schema=3: 아무것도 쓰지 않는다');
  deepEqual(opened.backend.removes, [], 'schema=3: 아무것도 지우지 않는다');
  deepEqual(opened.notices, [], 'schema=3: 안내 없음');
  equal(opened.backend.map.get(K.v2State), newerState, 'schema=3: 더 새로운 앱의 v2:state 는 그대로');
  equal(opened.backend.map.get(K.v2Presets), newerPresets, 'schema=3: 더 새로운 앱의 v2:presets 는 그대로');
  equal(opened.backend.map.get(K.schema), '3', 'schema=3: schema 도 그대로');
  deepEqual(opened.result.board, boardFromV1(readBoardV1(initial[K.v1Pedals])), 'schema=3: v1 작업 상태로 보드를 만든다');
  deepEqual(opened.result.userPresets, readPresetsV1(initial[K.v1Presets]).presets, 'schema=3: v1 사용자 프리셋을 읽는다');
  equal(opened.result.loadedState, null, 'schema=3: v2 원본은 없다');
  // schema 가 더 큰 값이어도 같다
  const far = boot({ ...fixtureRaw('01'), [K.schema]: '17' });
  equal(far.result.mode, 'legacy', 'schema=17: legacy 모드');
}

// 4-9. v2 키가 깨졌을 때(schema=2): 보관하고 그 부분만 기본값. v1 백업을 되살리지 않는다.
{
  const converted = boot(fixtureRaw('02'));
  const v2 = Object.fromEntries(converted.backend.map);

  const brokenState = boot({ ...v2, [K.v2State]: '{"schemaVersion":2,"chain":' });
  equal(brokenState.result.outcome, 'v2', 'v2:state 깨짐: v2 모드');
  equal(brokenState.result.board, null, 'v2:state 깨짐: 기본 보드(v1 백업을 되살리지 않는다)');
  equal(brokenState.result.userPresets.length, 2, 'v2:state 깨짐: 프리셋은 그대로');
  deepEqual(brokenState.notices, ['corrupt'], 'v2:state 깨짐: 안내 한 번');
  equal(brokenState.backend.map.get(`${K.v2State}:corrupt-${NOW}`), '{"schemaVersion":2,"chain":', 'v2:state 깨짐: 원문 보관');
  ok(!brokenState.backend.map.has(K.v2State), 'v2:state 깨짐: 원본 키는 치운다');
  equal(brokenState.backend.map.get(K.schema), '2', 'v2:state 깨짐: schema 는 그대로');

  const brokenList = boot({ ...v2, [K.v2Presets]: JSON.stringify({ schemaVersion: 2, presets: [{ schemaVersion: 2, id: 'ok', name: 'ok' }, { oops: true }] }) });
  deepEqual(brokenList.result.userPresets, [], 'v2:presets 깨짐: 한 항목이라도 틀리면 목록 전체를 읽지 못한다(v1 과 같다)');
  equal(activeIdsOf(brokenList.result.board.pedals).length, 2, 'v2:presets 깨짐: 보드는 그대로');
  ok(brokenList.backend.map.has(`${K.v2Presets}:corrupt-${NOW}`), 'v2:presets 깨짐: 원문 보관');

  const wrongVersion = boot({ ...v2, [K.v2State]: JSON.stringify({ ...JSON.parse(v2[K.v2State]), schemaVersion: 3 }) });
  equal(wrongVersion.result.board, null, 'v2:state 의 schemaVersion 이 다름: 읽지 못한다');
  ok(wrongVersion.backend.map.has(`${K.v2State}:corrupt-${NOW}`), 'v2:state 의 schemaVersion 이 다름: 보관한다');
}

// ---------------------------------------------------------------------------------------------
// 5. 변환이 틀렸을 때: v1 데이터로 계속 동작한다(S2.4 '주의')
// ---------------------------------------------------------------------------------------------
{
  const initial = fixtureRaw('02');
  const expectedBoard = boardFromV1(readBoardV1(initial[K.v1Pedals]));
  const expectedPresets = readPresetsV1(initial[K.v1Presets]).presets;

  const expectLegacy = (opened, label, reasonIncludes) => {
    equal(opened.result.outcome, 'legacy', `${label}: legacy 로 연다`);
    equal(opened.result.mode, 'legacy', `${label}: legacy 모드`);
    deepEqual(opened.result.board, expectedBoard, `${label}: v1 을 옛 방식으로 읽은 보드로 계속 동작한다`);
    deepEqual(opened.result.userPresets, expectedPresets, `${label}: v1 사용자 프리셋으로 계속 동작한다`);
    deepEqual(opened.backend.writes, [], `${label}: v2 키도 schema 도 쓰지 않는다`);
    deepEqual(opened.backend.removes, [], `${label}: 지우지 않는다`);
    equal(opened.backend.map.get(K.v1Pedals), initial[K.v1Pedals], `${label}: v1 작업 상태는 그대로`);
    equal(opened.backend.map.get(K.v1Presets), initial[K.v1Presets], `${label}: v1 프리셋은 그대로`);
    ok(opened.result.reason.includes(reasonIncludes), `${label}: 이유가 남는다(${opened.result.reason})`);
    equal(opened.result.loadedState, null, `${label}: v2 원본은 없다`);
  };

  warnings.length = 0;
  const throwing = boot(initial, {
    convert: () => {
      throw new Error('변환기가 던졌다');
    },
  });
  expectLegacy(throwing, '변환이 던짐', '변환기가 던졌다');
  ok(warnings.some((line) => line.includes('v1 데이터로 계속합니다') && line.includes('변환기가 던졌다')), '변환이 던짐: 콘솔에 원인을 남긴다');

  const wrong = (edit) => (boardRead, presetsRead) => {
    const converted = convertV1ToV2(boardRead, presetsRead);
    edit(converted);
    return converted;
  };
  expectLegacy(boot(initial, { convert: wrong((c) => { c.state.pedals.drive.active = !c.state.pedals.drive.active; }) }), '켜짐이 틀린 변환', '페달');
  expectLegacy(boot(initial, { convert: wrong((c) => { c.state.pedals.delay.params.mix += 1; }) }), '노브 값이 틀린 변환', '페달');
  expectLegacy(boot(initial, { convert: wrong((c) => { c.state.chain.reverse(); }) }), '순서가 틀린 변환', '페달');
  expectLegacy(boot(initial, { convert: wrong((c) => { c.state.trimDb = 6; }) }), '음량 보정이 틀린 변환', '음량 보정');
  expectLegacy(boot(initial, { convert: wrong((c) => { c.presetsStore.presets.shift(); }) }), '프리셋이 빠진 변환', '프리셋 개수');
  expectLegacy(boot(initial, { convert: wrong((c) => { c.presetsStore.presets[1].pedals.eq.active = true; }) }), '프리셋 켜짐이 틀린 변환', 'Switch Combos B');

  // 변환이 맞으면 같은 입구로 정상 동작한다(위 시험이 '항상 legacy' 라서 통과하는 일을 막는다)
  const identity = boot(initial, { convert: (boardRead, presetsRead) => convertV1ToV2(boardRead, presetsRead) });
  equal(identity.result.outcome, 'converted', '맞는 변환을 끼워 넣으면 정상');

  // 어떤 이유로든 열기 전체가 던져도(예: schema 읽기 중 예외) 던지지 않고 v1 키로 연다
  warnings.length = 0;
  const explosive = boot(initial, {
    hooks: {
      getItem: (key) => {
        if (key === K.schema) throw new Error('schema 를 읽다가 예외');
      },
    },
  });
  ok(['legacy', 'converted', 'fresh'].includes(explosive.result.outcome), '열기 중 예외: 던지지 않는다');
}

// ---------------------------------------------------------------------------------------------
// 6. 앱 데이터 층·스토어(appData → pedalStore·presetStore): 실제 앱 코드를 새로 불러와서 본다
// ---------------------------------------------------------------------------------------------
const v1KeysUntouched = (initial, label) => {
  for (const key of [K.v1Pedals, K.v1Presets]) {
    if (initial[key] === undefined) continue;
    equal(fakeValues.get(key), initial[key], `${label}: ${key} 원문이 그대로다`);
    ok(!fakeWrites.some((write) => write.key === key), `${label}: ${key} 에 쓰지 않았다`);
  }
};
const stateWrites = () => fakeWrites.filter((write) => write.key === K.v2State);
const parseStored = (key) => JSON.parse(fakeValues.get(key));

// 6-1. 처음 쓰는 사람
{
  fillFakeStorage();
  const app = await loadHarness();
  equal(app.appData.getBoot().outcome, 'fresh', '앱 열기(처음): fresh');
  deepEqual(fakeWrites, [{ key: K.schema, value: '2' }], '앱 열기(처음): schema 만 쓴다');
  equal(activeIdsOf(app.usePedalStore.getState().pedals).length, 5, '앱 열기(처음): 기본 켜진 페달 5개(E-08)');
  deepEqual(app.usePedalStore.getState().pedals.map((pedal) => pedal.id), initialPedals.map((pedal) => pedal.id), '앱 열기(처음): 기본 순서');
  equal(app.usePresetStore.getState().presets.filter((preset) => !preset.isFactory).length, 0, '앱 열기(처음): 사용자 프리셋 없음');

  app.usePedalStore.getState().setActive('delay', true);
  equal(stateWrites().length, 1, '스위치를 켜면 v2:state 에 바로 쓴다');
  equal(parseStored(K.v2State).pedals.delay.active, true, '스위치: v2 저장본의 active');
  equal(Object.values(parseStored(K.v2State).pedals).filter((pedal) => pedal.active).length, 6, '스위치: 켜진 페달 6개(저장본)');
  ok(!('enabled' in parseStored(K.v2State).pedals.delay), '스위치: 저장본에 옛 필드가 없다');
  equal(app.usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').active, true, '스위치: 메모리');
  app.usePedalStore.getState().updatePedalParam('delay', 'mix', 61);
  equal(stateWrites().length, 1, '노브: 돌리는 동안에는 쓰지 않는다(지연 저장)');
  app.safeStorage.flush();
  equal(stateWrites().length, 2, '노브: flush 하면 한 번 쓴다');
  equal(parseStored(K.v2State).pedals.delay.params.mix, 61, '노브: 저장된 값');
  ok(!fakeWrites.some((write) => write.key === K.v1Pedals || write.key === K.v1Presets), '처음 쓰는 사람: v1 키에는 한 번도 쓰지 않는다');
  app.usePedalStore.getState().setPresetTrimDb(-1.5);
  equal(parseStored(K.v2State).trimDb, -1.5, '음량 맞추기: v2 저장본의 trimDb');
  app.usePedalStore.getState().reorderPedals(0, 3);
  deepEqual(parseStored(K.v2State).chain.slice(0, 4), ['compressor', 'auto-wah', 'drive', 'noise-gate'], '순서 바꾸기: v2 저장본의 chain');
  app.usePresetStore.getState().savePreset('내 첫 프리셋', app.usePedalStore.getState().pedals);
  const list = parseStored(K.v2Presets);
  equal(list.schemaVersion, 2, '프리셋 저장: v2 목록');
  equal(list.presets.length, 1, '프리셋 저장: 한 개');
  equal(list.presets[0].origin, 'user', '프리셋 저장: origin');
  equal(list.presets[0].createdAt, list.presets[0].updatedAt, '프리셋 저장: 새 프리셋의 만든 시각 = 수정 시각');
  ok(Number.isFinite(Date.parse(list.presets[0].updatedAt)), '프리셋 저장: ISO 시각');
  equal(list.presets[0].trimDb, -1.5, '프리셋 저장: 그 시점의 음량 보정');
  equal(list.presets[0].pedals.delay.active, true, '프리셋 저장: 켜짐');
  deepEqual(list.presets[0].tags, ['user', 'custom'], '프리셋 저장: 표시용 필드(v1 에서 이어받은 tags)');
}

// 6-2. v1 에서 올라오는 사람: 쓴 뒤에도 v1 키는 그대로, v2 키만 바뀐다
for (const prefix of CONVERTIBLE) {
  const label = `앱 열기(${fixtures.get(prefix).name})`;
  const initial = fixtureRaw(prefix);
  fillFakeStorage(initial);
  const app = await loadHarness();
  equal(app.appData.getBoot().outcome, 'converted', `${label}: converted`);
  deepEqual(fakeWrites.map((write) => write.key), V2_WRITE_ORDER, `${label}: 쓰기 순서`);
  const expected = JSON.parse(initial[K.v1Pedals]).pedals.filter((pedal) => pedal.enabled && !pedal.bypassed).map((pedal) => pedal.id);
  deepEqual(activeIdsOf(app.usePedalStore.getState().pedals), expected, `${label}: 스토어의 켜진 페달 = 옛 enabled && !bypassed`);
  equal(expected.length, FIXTURE_ACTIVE_COUNT[prefix], `${label}: 켜진 페달 수(E-08)`);
  const userBefore = app.usePresetStore.getState().presets.filter((preset) => !preset.isFactory);
  equal(userBefore.length, initial[K.v1Presets] ? JSON.parse(initial[K.v1Presets]).presets.length : 0, `${label}: 사용자 프리셋 수`);

  // 되쓰기는 값을 바꾸지 않는다(읽은 값을 그대로 다시 쓰면 같은 저장본)
  const stateBefore = parseStored(K.v2State);
  const presetsBefore = parseStored(K.v2Presets);
  app.appData.writeBoard(app.usePedalStore.getState().pedals, app.usePedalStore.getState().presetTrimDb);
  deepEqual(parseStored(K.v2State), stateBefore, `${label}: 읽은 보드를 다시 쓰면 같은 v2:state`);
  app.appData.writeUserPresets(app.appData.readUserPresets());
  deepEqual(parseStored(K.v2Presets), presetsBefore, `${label}: 읽은 프리셋을 다시 쓰면 같은 v2:presets(만든 시각 포함)`);

  // 여러 가지 조작
  app.usePedalStore.getState().setActive('noise-gate', false);
  app.usePedalStore.getState().setActive('reverb', true);
  app.usePedalStore.getState().updatePedalParam('drive', 'mix', 55);
  app.usePresetStore.getState().savePreset(`${prefix} 새 프리셋`, app.usePedalStore.getState().pedals);
  if (userBefore.length > 0) app.usePresetStore.getState().deletePreset(userBefore[0].id);
  app.safeStorage.flush();
  v1KeysUntouched(initial, label);
  equal(fakeValues.get(K.schema), '2', `${label}: schema 는 2 그대로`);
  const stateAfter = parseStored(K.v2State);
  equal(stateAfter.pedals['noise-gate'].active, false, `${label}: 조작이 v2:state 에 저장된다`);
  equal(stateAfter.pedals.reverb.active, true, `${label}: 조작(켜기)`);
  equal(stateAfter.pedals.drive.params.mix, 55, `${label}: 조작(노브)`);
  const presetsAfter = parseStored(K.v2Presets).presets;
  equal(presetsAfter.length, userBefore.length + 1 - (userBefore.length > 0 ? 1 : 0), `${label}: 프리셋 저장·삭제가 v2:presets 에 저장된다`);
  ok(presetsAfter.some((preset) => preset.name === `${prefix} 새 프리셋`), `${label}: 새 프리셋 이름`);

  // 그 다음 방문: 저장한 값 그대로
  const reopened = await loadHarness();
  equal(reopened.appData.getBoot().outcome, 'v2', `${label}: 다음 방문은 v2`);
  deepEqual(reopened.usePedalStore.getState().pedals, app.usePedalStore.getState().pedals, `${label}: 다음 방문의 보드 = 저장 직전의 보드`);
  deepEqual(
    reopened.usePresetStore.getState().presets.filter((preset) => !preset.isFactory).map((preset) => preset.name).sort(),
    app.usePresetStore.getState().presets.filter((preset) => !preset.isFactory).map((preset) => preset.name).sort(),
    `${label}: 다음 방문의 프리셋 이름`,
  );
}

// 6-3. M7: 모르는 필드와 만든 시각이 앱을 거쳐 저장돼도 남는다(v1 에서 올라온 경우)
{
  const initial = { [K.v1Pedals]: extrasBoardRaw, [K.v1Presets]: extrasPresetsRaw };
  fillFakeStorage(initial);
  const app = await loadHarness();
  equal(app.appData.getBoot().outcome, 'converted', 'M7 앱: converted');
  const firstState = parseStored(K.v2State);
  deepEqual(firstState._extra, { futureTop: { a: 1 } }, 'M7 앱: 처음 쓴 v2:state 의 _extra');
  equal(app.usePedalStore.getState().presetTrimDb, -2.5, 'M7 앱: 음량 보정을 읽었다');
  app.usePedalStore.getState().setActive('drive', false);
  const afterToggle = parseStored(K.v2State);
  deepEqual(afterToggle._extra, { futureTop: { a: 1 } }, 'M7 앱: 스위치를 눌러 저장해도 상태의 모르는 필드가 남는다');
  deepEqual(afterToggle.pedals.drive._extra, { note: '메모', nested: { list: [1, 2, 3] } }, 'M7 앱: 저장해도 페달의 모르는 필드가 남는다');
  equal(afterToggle.pedals.drive.active, false, 'M7 앱: 바꾼 값은 저장된다');
  app.usePedalStore.getState().reorderPedals(0, 5);
  deepEqual(parseStored(K.v2State).pedals.drive._extra, { note: '메모', nested: { list: [1, 2, 3] } }, 'M7 앱: 순서를 바꿔도 남는다');

  const createdBefore = Object.fromEntries(parseStored(K.v2Presets).presets.map((preset) => [preset.id, preset.createdAt]));
  app.usePresetStore.getState().savePreset('Extra One', app.usePedalStore.getState().pedals);
  const listAfter = parseStored(K.v2Presets).presets;
  const one = listAfter.find((preset) => preset.id === 'x1');
  ok(one, 'M7 앱: 같은 이름으로 다시 저장하면 같은 id 로 덮어쓴다');
  deepEqual(one._extra, { pinned: true }, 'M7 앱: 다시 저장한 프리셋의 모르는 필드가 남는다');
  equal(one.createdAt, createdBefore.x1, 'M7 앱: 다시 저장해도 만든 시각은 그대로');
  ok(Date.parse(one.updatedAt) > Date.parse(createdBefore.x1), 'M7 앱: 수정 시각은 새로 정한다');
  equal(one.pedals.delay._extra.custom, 7, 'M7 앱: 다시 저장한 프리셋 안 페달의 모르는 필드(delay 는 id 가 같아 이어받는다)');
  const two = listAfter.find((preset) => preset.id === 'x2');
  deepEqual(two._extra, { rating: 5 }, 'M7 앱: 건드리지 않은 프리셋도 그대로');
  equal(two.createdAt, createdBefore.x2, 'M7 앱: 건드리지 않은 프리셋의 만든 시각');
  app.usePresetStore.getState().savePreset('완전히 새 프리셋', app.usePedalStore.getState().pedals);
  const created = parseStored(K.v2Presets).presets.find((preset) => preset.name === '완전히 새 프리셋');
  equal(created.createdAt, created.updatedAt, 'M7 앱: 새 프리셋은 만든 시각 = 수정 시각');
  ok(!('_extra' in created), 'M7 앱: 새 프리셋에는 _extra 가 없다');
  app.usePresetStore.getState().deletePreset('x2');
  deepEqual(parseStored(K.v2Presets).presets.find((preset) => preset.id === 'x1')._extra, { pinned: true }, 'M7 앱: 다른 프리셋을 지워도 남는다');
  v1KeysUntouched(initial, 'M7 앱');
}

// 6-4. M7 + 만든 시각: v2 저장본(다음 버전이 모르는 필드를 더한 것)을 읽고 저장해도 남는다
{
  const stateRaw = JSON.stringify({
    schemaVersion: 2,
    chain: initialPedals.map((pedal) => pedal.id),
    pedals: Object.fromEntries(initialPedals.map((pedal) => [pedal.id, { id: pedal.id, type: pedal.type, active: pedal.active, params: { ...pedal.params }, ...(pedal.id === 'cab' ? { future: 'cab-field' } : {}) }])),
    trimDb: 0,
    topFuture: [1, 2],
  });
  const presetsRaw = JSON.stringify({
    schemaVersion: 2,
    listFuture: { k: 1 },
    presets: [
      {
        schemaVersion: 2,
        id: 'v2-a',
        name: 'V2 A',
        origin: 'user',
        chain: initialPedals.map((pedal) => pedal.id),
        pedals: Object.fromEntries(initialPedals.map((pedal) => [pedal.id, { id: pedal.id, type: pedal.type, active: pedal.active, params: { ...pedal.params }, ...(pedal.id === 'eq' ? { eqFuture: true } : {}) }])),
        trimDb: 1.5,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-06-01T00:00:00.000Z',
        libraryId: 'user',
        presetFuture: 'p',
      },
    ],
  });
  const initial = { [K.schema]: '2', [K.v2State]: stateRaw, [K.v2Presets]: presetsRaw };
  fillFakeStorage(initial);
  const app = await loadHarness();
  equal(app.appData.getBoot().outcome, 'v2', 'v2 저장본 읽기: v2');
  deepEqual(fakeWrites, [], 'v2 저장본 읽기: 열기만으로는 아무것도 쓰지 않는다');
  app.usePedalStore.getState().setActive('delay', true);
  const state = parseStored(K.v2State);
  deepEqual(state._extra, { topFuture: [1, 2] }, 'v2 저장본: 상태의 모르는 필드가 다시 저장돼도 남는다');
  deepEqual(state.pedals.cab._extra, { future: 'cab-field' }, 'v2 저장본: 페달의 모르는 필드가 남는다');
  app.usePresetStore.getState().savePreset('새로 저장', app.usePedalStore.getState().pedals);
  const list = parseStored(K.v2Presets);
  deepEqual(list._extra, { listFuture: { k: 1 } }, 'v2 저장본: 목록의 모르는 필드가 남는다');
  const a = list.presets.find((preset) => preset.id === 'v2-a');
  deepEqual(a._extra, { presetFuture: 'p' }, 'v2 저장본: 프리셋의 모르는 필드가 남는다');
  deepEqual(a.pedals.eq._extra, { eqFuture: true }, 'v2 저장본: 프리셋 안 페달의 모르는 필드가 남는다');
  equal(a.createdAt, '2026-01-01T00:00:00.000Z', 'v2 저장본: 만든 시각이 남는다');
  equal(a.updatedAt, '2026-06-01T00:00:00.000Z', 'v2 저장본: 건드리지 않은 프리셋의 수정 시각은 그대로');
  equal(a.trimDb, 1.5, 'v2 저장본: 프리셋 음량 보정');
  app.usePresetStore.getState().savePreset('V2 A', app.usePedalStore.getState().pedals);
  const resaved = parseStored(K.v2Presets).presets.find((preset) => preset.id === 'v2-a');
  equal(resaved.createdAt, '2026-01-01T00:00:00.000Z', 'v2 저장본: 다시 저장해도 만든 시각은 그대로');
  ok(Date.parse(resaved.updatedAt) > Date.parse('2026-06-01T00:00:00.000Z'), 'v2 저장본: 다시 저장하면 수정 시각이 새로워진다');
  deepEqual(resaved._extra, { presetFuture: 'p' }, 'v2 저장본: 다시 저장해도 프리셋의 모르는 필드가 남는다');
  deepEqual(parseStored(K.v2Presets)._extra, { listFuture: { k: 1 } }, 'v2 저장본: 다시 저장해도 목록의 모르는 필드가 남는다');
}

// 6-5. 옛 방식(legacy) 모드: schema 가 더 새로우면 v1 키에 옛 모양으로 읽고 쓴다. v2 키는 건드리지 않는다.
{
  const newerState = JSON.stringify({ schemaVersion: 3, from: 'newer app' });
  const initial = { ...fixtureRaw('02'), [K.schema]: '3', [K.v2State]: newerState };
  fillFakeStorage(initial);
  const app = await loadHarness();
  equal(app.appData.getBoot().mode, 'legacy', '옛 방식: legacy 모드');
  deepEqual(fakeWrites, [], '옛 방식: 열기만으로는 쓰지 않는다');
  deepEqual(activeIdsOf(app.usePedalStore.getState().pedals), ['noise-gate', 'cab'], '옛 방식: v1 작업 상태를 읽는다');
  equal(app.usePresetStore.getState().presets.filter((preset) => !preset.isFactory).length, 2, '옛 방식: v1 사용자 프리셋을 읽는다');

  app.usePedalStore.getState().setActive('delay', true);
  const v1State = parseStored(K.v1Pedals);
  equal(v1State.version, 11, '옛 방식: v1 키에 payload version 11 로 쓴다');
  ok(v1State.pedals.every((pedal) => pedal.enabled === true && typeof pedal.bypassed === 'boolean' && !('active' in pedal)), '옛 방식: 페달이 옛 두 필드(enabled·bypassed)로 적힌다');
  equal(v1State.pedals.find((pedal) => pedal.id === 'delay').bypassed, false, '옛 방식: 켠 페달은 bypassed:false');
  equal(v1State.pedals.find((pedal) => pedal.id === 'compressor').bypassed, true, '옛 방식: 꺼진 페달은 bypassed:true');
  const legacyAgain = readBoardV1(fakeValues.get(K.v1Pedals));
  equal(legacyAgain.stored.pedals.find((pedal) => pedal.id === 'delay').enabled, true, '옛 방식: 옛 코드로 읽을 수 있다');

  app.usePresetStore.getState().savePreset('옛 방식으로 저장', app.usePedalStore.getState().pedals);
  const v1Presets = parseStored(K.v1Presets);
  equal(v1Presets.version, 11, '옛 방식: 프리셋도 v1 payload(version 11)');
  equal(v1Presets.presets.length, 3, '옛 방식: 기존 둘 + 새 하나');
  ok(v1Presets.presets.every((preset) => preset.pedals.every((pedal) => pedal.enabled === true && typeof pedal.bypassed === 'boolean')), '옛 방식: 프리셋 안 페달도 옛 두 필드');
  equal(fakeValues.get(K.v2State), newerState, '옛 방식: 더 새로운 앱의 v2:state 는 건드리지 않는다');
  equal(fakeValues.get(K.schema), '3', '옛 방식: schema 도 그대로');
  ok(!fakeWrites.some((write) => write.key === K.v2State || write.key === K.v2Presets || write.key === K.schema), '옛 방식: v2 키·schema 에는 한 번도 쓰지 않는다');
  app.usePedalStore.getState().loadPedalsFromStorage();
  deepEqual(activeIdsOf(app.usePedalStore.getState().pedals), ['noise-gate', 'cab', 'delay'], '옛 방식: 다시 읽어도 같다(보드 순서: Delay 는 Cab 뒤)');
}

// 6-6. 팩토리 사본 알림(M5): v1 에서 옮긴 방문에만, 알려 주기만 하고 '정리'를 눌러야 지운다
{
  const copyOf = (preset, id, edit = (value) => value) => {
    const rest = withoutFactoryFlag(preset);
    return edit({ ...rest, id, libraryId: 'user', libraryName: 'My Presets', description: '사용자가 저장한 페달 체인', tags: ['user', 'custom'], updatedAt: 1700000000000 });
  };
  const factory = defaultPresets[4];
  const other = defaultPresets[9];
  const userPresets = [
    copyOf(factory, 'dup-exact'),
    copyOf(other, 'dup-edited', (preset) => ({ ...preset, pedals: preset.pedals.map((pedal, index) => (index === 1 ? { ...pedal, active: !pedal.active } : pedal)) })),
    copyOf(factory, 'dup-renamed', (preset) => ({ ...preset, name: `${preset.name} (내 것)` })),
    { id: 'mine', name: '내 프리셋', pedals: clone(initialPedals), updatedAt: 1700000001000 },
  ];
  const initial = { [K.v1Presets]: serializePresetPayload(userPresets) };
  fillFakeStorage(initial);
  const app = await loadHarness();
  equal(app.appData.getBoot().outcome, 'converted', 'M5: v1 에서 옮긴 방문');
  app.useToastStore.getState().clear();
  app.announceFactoryCopies();
  const toast = app.useToastStore.getState().toasts.find((candidate) => candidate.key === 'storage:factory-copies');
  ok(toast, 'M5: 알림이 뜬다');
  equal(toast.message, '팩토리 프리셋과 똑같은 사본 1개가 있습니다. 정리할까요?', 'M5: 이름과 내용이 똑같은 것만 센다(고친 것·이름이 다른 것은 아니다)');
  equal(toast.durationMs, 0, 'M5: 눌러서 닫을 때까지 남는다');
  equal(toast.kind, 'info', 'M5: 정보 알림');
  equal(toast.action.label, '정리', 'M5: 버튼 이름');
  equal(app.usePresetStore.getState().presets.filter((preset) => !preset.isFactory).length, 4, 'M5: 알리기만 하고 지우지 않는다');
  ok(parseStored(K.v2Presets).presets.some((preset) => preset.id === 'dup-exact'), 'M5: 저장본에서도 지우지 않았다');

  // 알림을 본 사이에 사본을 고쳤다면 '정리'가 그것을 지우지 않는다
  const edited = clone(factory.pedals);
  edited[0].params.level = edited[0].params.level === 77 ? 78 : 77;
  app.usePresetStore.getState().savePreset(factory.name, edited);
  const stillThere = app.usePresetStore.getState().presets.find((preset) => preset.id === 'dup-exact');
  ok(stillThere && findFactoryCopies([stillThere], defaultPresets).length === 0, 'M5: 같은 이름으로 다시 저장해 사본이 다른 내용이 됐다(기준)');
  toast.action.onAction();
  ok(app.usePresetStore.getState().presets.some((preset) => preset.id === 'dup-exact'), 'M5: 그사이 고친 사본은 정리해도 남는다');
  equal(app.usePresetStore.getState().presets.filter((preset) => !preset.isFactory).length, 4, 'M5: 아무것도 지우지 않았다');
}
{
  const factory = defaultPresets[4];
  const rest = withoutFactoryFlag(factory);
  const userPresets = [
    { ...rest, id: 'dup-exact', libraryId: 'user', updatedAt: 1700000000000 },
    { id: 'mine', name: '내 프리셋', pedals: clone(initialPedals), updatedAt: 1700000001000 },
  ];
  fillFakeStorage({ [K.v1Presets]: serializePresetPayload(userPresets) });
  const app = await loadHarness();
  app.useToastStore.getState().clear();
  app.announceFactoryCopies();
  const toast = app.useToastStore.getState().toasts.find((candidate) => candidate.key === 'storage:factory-copies');
  ok(toast, 'M5 정리: 알림');

  // 다음 방문(이미 v2): 사본이 저장소에 그대로 남아 있어도 다시 알리지 않는다 — 알림은 v1 에서 옮긴 그 방문에만 뜬다.
  const next = await loadHarness();
  equal(next.appData.getBoot().outcome, 'v2', 'M5: 다음 방문은 v2');
  ok(next.usePresetStore.getState().presets.some((preset) => preset.id === 'dup-exact'), 'M5: 사본은 아직 저장소에 있다(기준)');
  next.useToastStore.getState().clear();
  next.announceFactoryCopies();
  ok(!next.useToastStore.getState().toasts.some((candidate) => candidate.key === 'storage:factory-copies'), 'M5: v2 로 연 방문에는 사본이 남아 있어도 알리지 않는다');

  toast.action.onAction();
  deepEqual(app.usePresetStore.getState().presets.filter((preset) => !preset.isFactory).map((preset) => preset.id), ['mine'], 'M5 정리: 지금도 똑같은 사본만 지운다');
  deepEqual(parseStored(K.v2Presets).presets.map((preset) => preset.id), ['mine'], 'M5 정리: 저장본에서도 지워진다');
  ok(JSON.parse(fakeValues.get(K.v1Presets)).presets.some((preset) => preset.id === 'dup-exact'), 'M5 정리: v1 백업에는 그대로 남아 있다');
}

// 6-7. 설정 초기화(오류 화면의 '설정을 초기화하고 다시 시작'): 사용자 프리셋과 schema 는 남고 나머지는 지운다. v1 백업이 되살아나지 않는다.
{
  const initial = { ...fixtureRaw('02'), [K.io]: JSON.stringify({ masterVolume: 0.4 }), [K.midi]: fixtures.get('06').storage[K.midi] };
  fillFakeStorage(initial);
  const app = await loadHarness();
  app.usePedalStore.getState().setActive('delay', true);
  app.usePresetStore.getState().savePreset('초기화해도 남을 프리셋', app.usePedalStore.getState().pedals);
  const presetsBeforeReset = fakeValues.get(K.v2Presets);
  const removed = app.safeStorage.clearAppSettings();
  ok(removed >= 4, `초기화: 지운 개수(${removed})`);
  equal(fakeValues.get(K.v2Presets), presetsBeforeReset, '초기화: v2 사용자 프리셋은 남는다');
  equal(fakeValues.get(K.schema), '2', '초기화: schema 는 남는다');
  for (const key of [K.v2State, K.v1Pedals, K.io, K.midi]) ok(!fakeValues.has(key), `초기화: ${key} 는 지운다`);
  equal(fakeValues.get(K.v1Presets), initial[K.v1Presets], '초기화: 접두사가 다른 v1 프리셋 백업은 건드리지 않는다');
  // 다시 열기: 이미 v2 이므로 v1 백업에서 다시 옮기지 않는다. 보드는 기본, 사용자 프리셋은 그대로.
  const writesBeforeReopen = fakeWrites.length;
  const afterReset = await loadHarness();
  equal(afterReset.appData.getBoot().outcome, 'v2', '초기화 뒤: v2 로 열린다(v1 백업에서 다시 옮기지 않는다)');
  equal(activeIdsOf(afterReset.usePedalStore.getState().pedals).length, 5, '초기화 뒤: 기본 보드(켜진 페달 5개)');
  equal(afterReset.usePresetStore.getState().presets.filter((preset) => !preset.isFactory).length, 3, '초기화 뒤: 사용자 프리셋 3개(옛 2개 + 새로 저장한 1개)가 남아 있다');
  deepEqual(fakeWrites.slice(writesBeforeReopen), [], '초기화 뒤: 다시 열어도 아무것도 쓰지 않는다');
  ok(!fakeValues.has(K.v1Pedals), '초기화 뒤: v1 작업 상태가 되살아나지 않는다');
}

// 6-8. 저장소 값이 밖에서 바뀌었을 때 다시 읽기(오류 화면 뒤·다른 탭): loadPedalsFromStorage 는 v2:state 를 읽는다
{
  fillFakeStorage(fixtureRaw('01'));
  const app = await loadHarness();
  const changed = parseStored(K.v2State);
  changed.pedals.reverb.active = true;
  changed.trimDb = 2;
  fakeValues.set(K.v2State, JSON.stringify(changed));
  app.usePedalStore.getState().loadPedalsFromStorage();
  equal(app.usePedalStore.getState().pedals.find((pedal) => pedal.id === 'reverb').active, true, '다시 읽기: v2:state 의 바뀐 켜짐');
  equal(app.usePedalStore.getState().presetTrimDb, 2, '다시 읽기: 바뀐 음량 보정');
  fakeValues.delete(K.v2State);
  app.usePedalStore.getState().loadPedalsFromStorage();
  equal(activeIdsOf(app.usePedalStore.getState().pedals).length, 5, '다시 읽기: v2:state 가 없으면 기본 보드');
}

// 6-9. 사용자 프리셋이 많은 경우·큰 값도 같은 결과(프리셋 100개 왕복)
{
  const many = Array.from({ length: 100 }, (_, index) => ({
    id: `bulk-${index}`,
    name: `Bulk ${index}`,
    pedals: clone(initialPedals).map((pedal, position) => ({ ...pedal, active: (index + position) % 3 === 0 })),
    updatedAt: 1700000000000 + index,
    ...(index % 4 === 0 ? { trimDb: -(index % 7) } : {}),
  }));
  const raw = serializePresetPayload(many);
  const read = readPresetsV1(raw);
  const converted = convertV1ToV2(null, read);
  equal(verifyConversion(converted), null, '프리셋 100개: 변환 검증 통과');
  equal(converted.presetsStore.presets.length, 100, '프리셋 100개: 개수');
  deepEqual(converted.presetsStore.presets.map((preset) => preset.id), many.map((preset) => preset.id), '프리셋 100개: 순서');
  const via = parsePresetsStoreV2(JSON.stringify(converted.presetsStore)).presets.map(presetFromV2);
  // v1 을 읽은 프리셋에는 값 없는 표시용 필드가 `undefined` 로 들어 있고 v2 쪽에는 필드가 없다. 저장·화면에서는 같은 값이므로 JSON 모양으로 견준다.
  deepEqual(clone(via), clone(read.presets), '프리셋 100개: v2 로 썼다 읽으면 v1 을 읽은 값과 같다');
  equal(isSameValue(buildPresetsStoreV2(converted.presetsStore.presets), converted.presetsStore), true, '프리셋 100개: buildPresetsStoreV2 는 값을 바꾸지 않는다');
}

// ---------------------------------------------------------------------------------------------
// 끝
// ---------------------------------------------------------------------------------------------
console.warn = originalConsoleWarn;
equal(SCHEMA_V2, 2, '저장 형식 번호는 2');
deepEqual([...KEPT_ON_RESET_KEYS], [K.schema, K.v2Presets], '설정 초기화가 지키는 키');
console.log(`storage v2 regression passed (${checks} checks, ${fixtures.size} fixtures, ${harnessInstances} app loads)`);
