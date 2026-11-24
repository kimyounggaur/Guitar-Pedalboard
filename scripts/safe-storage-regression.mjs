// 저장소 안전 장치 시험(S1.7, 설계서 4.8절, 보고서 R2-1).
//
// 사이트 데이터 차단, 저장 공간 가득 참, 깨진 값에서도 앱이 멈추지 않는지, 안내가 종류마다 한 번만 나오는지,
// 지연 저장이 마지막 변경 300 ms 뒤 한 번만 쓰고 페이지가 가려지면 바로 쓰는지를 가짜 저장소로 확인한다.
// 브라우저는 쓰지 않는다. 화면 동작(오류 화면, 흰 화면 없음)은 e2e E-05 가 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));

const bundle = await build({
  stdin: {
    contents: [
      "export * from './persistence/index.ts';",
      "export { classifyStorageError } from './persistence/SafeStorage.ts';",
      "export { useToastStore, showToast } from './store/toastStore.ts';",
      "export { installGlobalErrorHandlers, UNEXPECTED_ERROR_MESSAGE, UNEXPECTED_ERROR_TOAST_KEY } from './app/globalErrors.ts';",
      "export { buildErrorReport, describeError, appVersion } from './app/errorReport.ts';",
    ].join('\n'),
    resolveDir: sourceRoot,
    sourcefile: 'safe-storage-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const {
  STORAGE_KEYS,
  APP_STORAGE_PREFIX,
  STORAGE_NOTICE_MESSAGES,
  createSafeStorage,
  safeStorage,
  classifyStorageError,
  useToastStore,
  showToast,
  installGlobalErrorHandlers,
  UNEXPECTED_ERROR_MESSAGE,
  UNEXPECTED_ERROR_TOAST_KEY,
  buildErrorReport,
  describeError,
  appVersion,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);

// ---------------------------------------------------------------------------------------------
// 도구
// ---------------------------------------------------------------------------------------------
// 브라우저가 던지는 것과 같은 이름·코드를 가진 예외(Node 에도 DOMException 이 있다)
const { DOMException } = globalThis;
const quotaError = () => new DOMException("Failed to execute 'setItem' on 'Storage': exceeded the quota.", 'QuotaExceededError');
const securityError = () => new DOMException('The operation is insecure.', 'SecurityError');

/** Map 으로 만든 가짜 저장소. hooks 로 호출마다 예외를 던지게 바꾼다. */
function createBackend(initial = {}, hooks = {}) {
  const map = new Map(Object.entries(initial));
  const calls = { getItem: 0, setItem: 0, removeItem: 0 };
  return {
    map,
    calls,
    getItem(key) {
      calls.getItem += 1;
      hooks.getItem?.(key);
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      calls.setItem += 1;
      hooks.setItem?.(key, value);
      map.set(key, String(value));
    },
    removeItem(key) {
      calls.removeItem += 1;
      hooks.removeItem?.(key);
      map.delete(key);
    },
    key(index) {
      return [...map.keys()][index] ?? null;
    },
    get length() {
      return map.size;
    },
  };
}

/** 안내를 기록하는 SafeStorage. 페이지 가림 훅도 가로채 flush 를 직접 부를 수 있게 한다. */
function createHarness({ backend, getBackend, now = () => 1_700_000_000_000 } = {}) {
  const notices = [];
  const hook = { flush: null, subscriptions: 0 };
  const storage = createSafeStorage({
    getBackend: getBackend ?? (() => backend),
    notify: (kind, message) => notices.push({ kind, message }),
    now,
    subscribeToPageHide: (flush) => {
      hook.subscriptions += 1;
      hook.flush = flush;
    },
  });
  return { storage, notices, hook };
}

const K = STORAGE_KEYS;

// 깨진 값을 만나면 SafeStorage 가 console.warn 으로 원인을 남긴다. 시험 출력이 길어지지 않도록 모아 두고 끝에서 개수만 확인한다.
const originalConsoleWarn = console.warn;
const warnings = [];
console.warn = (...args) => {
  warnings.push(String(args[0]));
};

// ---------------------------------------------------------------------------------------------
// 0. 키 이름은 그대로다(키 이름·값 형식 변경은 S2.4 범위)
// ---------------------------------------------------------------------------------------------
assert.deepEqual(
  { ...STORAGE_KEYS },
  {
    pedals: 'guitar-pedalboard:pedals',
    presets: 'web-guitar-pedalboard-presets',
    io: 'guitar-pedalboard:io',
    outputDevice: 'guitar-pedalboard:output-device',
    midi: 'guitar-pedalboard:midi',
    midiAdvanced: 'guitar-pedalboard:midi-advanced',
    presetFavorites: 'guitar-pedalboard:preset-favorites',
    presetRecents: 'guitar-pedalboard:preset-recents',
    mobileAudioNotice: 'guitar-pedalboard:mobile-audio-notice-dismissed',
    // S1.8 에서 더한 키: 넓은 화면의 오른쪽 오디오 패널 열림 상태(`{ sidebarOpen: boolean }`).
    ui: 'guitar-pedalboard:ui',
  },
  '저장 키 문자열이 바뀌었습니다(S2.4 범위)',
);
assert.equal(APP_STORAGE_PREFIX, 'guitar-pedalboard:');

// 안내 문구는 설계서 4.8절 표 그대로다.
assert.equal(STORAGE_NOTICE_MESSAGES.blocked, '브라우저 설정 때문에 설정을 저장할 수 없습니다. 이번 방문 동안만 유지됩니다.');
assert.equal(
  STORAGE_NOTICE_MESSAGES.quota,
  '저장 공간이 가득 차 설정이 저장되지 않았습니다. 같은 주소(kimyounggaur.github.io)에 올린 다른 앱의 데이터가 공간을 쓰고 있을 수 있습니다.',
);
assert.equal(STORAGE_NOTICE_MESSAGES.corrupt, '저장된 설정 일부를 읽지 못해 기본값으로 시작합니다.');

// ---------------------------------------------------------------------------------------------
// 1. 오류 분류
// ---------------------------------------------------------------------------------------------
assert.equal(classifyStorageError(quotaError()), 'quota');
assert.equal(classifyStorageError(securityError()), 'blocked');
assert.equal(classifyStorageError(Object.assign(new Error('x'), { name: 'NS_ERROR_DOM_QUOTA_REACHED' })), 'quota');
assert.equal(classifyStorageError(Object.assign(new Error('x'), { code: 22 })), 'quota');
assert.equal(classifyStorageError(new Error('quota exceeded')), 'quota');
assert.equal(classifyStorageError(new Error('Access is denied for this document.')), 'blocked');
assert.equal(classifyStorageError(new Error('boom')), 'unknown');
assert.equal(classifyStorageError(undefined), 'unknown');
assert.equal(classifyStorageError('QuotaExceededError'), 'unknown', '문자열은 오류 객체가 아니다');

// ---------------------------------------------------------------------------------------------
// 2. 정상 저장소: 읽고 쓰고 지운다. 값 형식은 그대로 보존된다.
// ---------------------------------------------------------------------------------------------
{
  const backend = createBackend();
  const { storage, notices } = createHarness({ backend });
  assert.equal(storage.mode, 'persistent');

  assert.deepEqual(storage.get(K.io, { gain: 0 }), { gain: 0 }, '없으면 기본값');
  assert.deepEqual(storage.set(K.io, { gain: 3 }), { ok: true });
  assert.equal(backend.map.get(K.io), '{"gain":3}', 'JSON 으로 저장한다');
  assert.deepEqual(storage.get(K.io, { gain: 0 }), { gain: 3 });

  // JSON 이 아닌 값(출력 장치 id, 모바일 안내 'true')은 문자열 그대로 저장되고 그대로 읽힌다.
  assert.deepEqual(storage.setRaw(K.outputDevice, 'device-abc'), { ok: true });
  assert.equal(backend.map.get(K.outputDevice), 'device-abc');
  assert.equal(storage.getRaw(K.outputDevice), 'device-abc');
  storage.setRaw(K.mobileAudioNotice, 'true');
  assert.equal(backend.map.get(K.mobileAudioNotice), 'true');
  assert.equal(storage.getRaw(K.mobileAudioNotice), 'true');
  assert.equal(storage.getRaw(K.presets), null, '없는 키는 null');

  // read: 직접 만든 해석 함수
  backend.map.set(K.presetFavorites, '["a","b"]');
  assert.deepEqual(storage.read(K.presetFavorites, (raw) => JSON.parse(raw), []), ['a', 'b']);

  storage.remove(K.io);
  assert.equal(backend.map.has(K.io), false);
  assert.deepEqual(storage.get(K.io, { gain: 0 }), { gain: 0 });
  assert.deepEqual(notices, [], '정상일 때는 안내가 없다');
}

// ---------------------------------------------------------------------------------------------
// 3. 사이트 데이터 차단(SecurityError): memory 모드, 앱은 계속, 안내는 한 번
// ---------------------------------------------------------------------------------------------
{
  let backendReads = 0;
  const { storage, notices } = createHarness({
    getBackend: () => {
      backendReads += 1;
      throw securityError();
    },
  });

  assert.equal(storage.mode, 'memory');
  assert.deepEqual(notices.map((notice) => notice.kind), ['blocked'], '접근 검사에서 한 번');

  // 읽기: 기본값
  assert.deepEqual(storage.get(K.pedals, { version: 0 }), { version: 0 });
  assert.equal(storage.getRaw(K.outputDevice), null);

  // 쓰기: 실패로 알리되 던지지 않고, 이번 방문 동안은 메모리에 남는다.
  assert.deepEqual(storage.set(K.pedals, { version: 11, bypass: true }), { ok: false, reason: 'blocked' });
  assert.deepEqual(storage.get(K.pedals, null), { version: 11, bypass: true }, '메모리에 값이 남는다');
  storage.setRaw(K.outputDevice, 'device-1');
  assert.equal(storage.getRaw(K.outputDevice), 'device-1');
  storage.setDebounced(K.io, { gain: 1 }, 5);
  await delay(30);
  assert.deepEqual(storage.get(K.io, null), { gain: 1 }, '지연 저장도 메모리에 남는다');
  storage.remove(K.pedals);
  assert.equal(storage.get(K.pedals, 'empty'), 'empty', '지운 값은 이번 방문 동안 지워진 채다');

  for (let i = 0; i < 20; i += 1) {
    storage.set(K.pedals, { i });
    storage.get(K.pedals, null);
  }
  assert.equal(notices.length, 1, '안내는 여러 번 쓰고 읽어도 한 번만');
  assert.equal(notices[0].message, STORAGE_NOTICE_MESSAGES.blocked);
  assert.equal(backendReads, 1, '막힌 것을 알고 나면 다시 접근하지 않는다');
  assert.equal(storage.usageBytes(), 0);
}

// 읽기에서 먼저 막히는 경우(getItem 이 SecurityError)
{
  const backend = createBackend({}, { getItem: () => { throw securityError(); } });
  const { storage, notices } = createHarness({ backend });
  assert.equal(storage.get(K.io, 'fallback'), 'fallback');
  assert.equal(storage.mode, 'memory', '읽다가 막힌 것을 알면 memory 모드');
  assert.deepEqual(notices.map((notice) => notice.kind), ['blocked']);
}

// 저장소가 아예 없는 환경(Node, 서버): 안내 없이 메모리로만 동작
{
  const { storage, notices } = createHarness({ getBackend: () => undefined });
  assert.equal(storage.mode, 'memory');
  assert.deepEqual(storage.set(K.io, { a: 1 }), { ok: false, reason: 'blocked' });
  assert.deepEqual(storage.get(K.io, null), { a: 1 });
  assert.deepEqual(notices, [], '저장소가 없는 환경에서는 사용자에게 알릴 화면이 없다');
}

// ---------------------------------------------------------------------------------------------
// 4. 저장 공간 가득 참(QuotaExceededError): 값은 메모리에, 조작 계속, 안내는 한 번
// ---------------------------------------------------------------------------------------------
{
  let full = true;
  const backend = createBackend({}, { setItem: () => { if (full) throw quotaError(); } });
  const { storage, notices } = createHarness({ backend });
  assert.equal(storage.mode, 'persistent', '읽기는 된다');

  assert.deepEqual(storage.set(K.pedals, { version: 11, n: 1 }), { ok: false, reason: 'quota' });
  assert.deepEqual(storage.get(K.pedals, null), { version: 11, n: 1 }, '실패한 값도 이번 방문 동안은 읽힌다');
  assert.equal(backend.map.has(K.pedals), false);
  assert.deepEqual(storage.set(K.pedals, { version: 11, n: 2 }), { ok: false, reason: 'quota' });
  storage.setRaw(K.presets, '{"version":1,"presets":[]}');
  storage.setDebounced(K.io, { gain: 2 }, 5);
  await delay(30);

  assert.equal(notices.length, 1, '여러 번 실패해도 안내는 한 번');
  assert.equal(notices[0].kind, 'quota');
  assert.match(notices[0].message, /kimyounggaur\.github\.io/);
  assert.deepEqual(storage.get(K.pedals, null), { version: 11, n: 2 });

  // 공간이 생기면 다음 저장이 성공하고 메모리 값은 저장소 값으로 돌아간다.
  full = false;
  assert.deepEqual(storage.set(K.pedals, { version: 11, n: 3 }), { ok: true });
  assert.equal(backend.map.get(K.pedals), '{"version":11,"n":3}');
  assert.deepEqual(storage.get(K.pedals, null), { version: 11, n: 3 });
  assert.equal(notices.length, 1, '복구되어도 안내를 되풀이하지 않는다');
}

// 사전에 만든 모의(e2e 의 quota 모의와 같은 모양): 일반 Error('quota exceeded')
{
  const backend = createBackend({}, { setItem: () => { throw new Error('quota exceeded'); } });
  const { storage, notices } = createHarness({ backend });
  assert.deepEqual(storage.set(K.io, {}), { ok: false, reason: 'quota' });
  assert.deepEqual(notices.map((notice) => notice.kind), ['quota']);
}

// 알 수 없는 오류: 일반 안내 한 번
{
  const backend = createBackend({}, { setItem: () => { throw new Error('boom'); } });
  const { storage, notices } = createHarness({ backend });
  assert.deepEqual(storage.set(K.io, { a: 1 }), { ok: false, reason: 'unknown' });
  storage.set(K.io, { a: 2 });
  assert.deepEqual(notices.map((notice) => notice.kind), ['unknown']);
  assert.equal(notices[0].message, STORAGE_NOTICE_MESSAGES.unknown);
  assert.deepEqual(storage.get(K.io, null), { a: 2 });
}

// ---------------------------------------------------------------------------------------------
// 5. 깨진 값: 원문을 `…:corrupt-{시각}` 에 보관, 기본값, 안내 한 번
// ---------------------------------------------------------------------------------------------
{
  const backend = createBackend({ [K.pedals]: '{not json', [K.io]: '{"gain":"x"}', [K.presetFavorites]: '{"a":1}' });
  const { storage, notices } = createHarness({ backend, now: () => 111 });

  assert.deepEqual(storage.get(K.pedals, { fresh: true }), { fresh: true }, 'JSON 해석 실패 → 기본값');
  assert.equal(backend.map.get(`${K.pedals}:corrupt-111`), '{not json', '원문이 보관된다');
  assert.equal(backend.map.has(K.pedals), false, '보관한 뒤 원래 키는 비운다');

  // 검증 실패도 깨진 값
  const isGoodIo = (value) => typeof value === 'object' && value !== null && typeof value.gain === 'number';
  assert.deepEqual(storage.get(K.io, { gain: 0 }, isGoodIo), { gain: 0 });
  assert.equal(backend.map.get(`${K.io}:corrupt-111`), '{"gain":"x"}');

  // read 의 해석 함수가 던져도 깨진 값
  const list = storage.read(
    K.presetFavorites,
    (raw) => {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) throw new Error('배열이 아님');
      return parsed;
    },
    [],
  );
  assert.deepEqual(list, []);
  assert.equal(backend.map.get(`${K.presetFavorites}:corrupt-111`), '{"a":1}');

  assert.deepEqual(notices.map((notice) => notice.kind), ['corrupt'], '깨진 값이 셋이어도 안내는 한 번');
  assert.equal(notices[0].message, STORAGE_NOTICE_MESSAGES.corrupt);

  // 기본값으로 시작한 뒤의 첫 저장은 정상 키에 쓰고, 보관본은 그대로다.
  assert.deepEqual(storage.set(K.pedals, { version: 11 }), { ok: true });
  assert.equal(backend.map.get(`${K.pedals}:corrupt-111`), '{not json');
}

// 빈 문자열은 깨진 값이 아니라 '값 없음'
{
  const backend = createBackend({ [K.io]: '' });
  const { storage, notices } = createHarness({ backend });
  assert.deepEqual(storage.get(K.io, 'fallback'), 'fallback');
  assert.deepEqual(notices, []);
}

// 보관본은 키마다 최신 3개만 남긴다.
{
  const seed = {};
  for (const stamp of [1, 2, 3, 4, 5]) seed[`${K.pedals}:corrupt-${stamp}`] = `old-${stamp}`;
  seed[K.pedals] = '{bad';
  const backend = createBackend(seed);
  const { storage } = createHarness({ backend, now: () => 6 });
  storage.get(K.pedals, null);
  const archives = [...backend.map.keys()].filter((name) => name.startsWith(`${K.pedals}:corrupt-`)).sort();
  assert.deepEqual(archives, [`${K.pedals}:corrupt-4`, `${K.pedals}:corrupt-5`, `${K.pedals}:corrupt-6`]);
}

// 보관하지 못하면(저장 공간 가득) 원래 값을 지우지 않는다 — 되돌릴 길을 없애지 않는다.
{
  const backend = createBackend({ [K.pedals]: '{bad' }, { setItem: () => { throw quotaError(); } });
  const { storage, notices } = createHarness({ backend });
  assert.deepEqual(storage.get(K.pedals, { fresh: true }), { fresh: true });
  assert.equal(backend.map.get(K.pedals), '{bad', '보관에 실패하면 원본이 남는다');
  assert.deepEqual(notices.map((notice) => notice.kind), ['corrupt']);
}

// ---------------------------------------------------------------------------------------------
// 6. 지연 저장(setDebounced): 마지막 변경 뒤 한 번, 페이지가 가려지면 바로
// ---------------------------------------------------------------------------------------------
{
  const backend = createBackend();
  const { storage, hook } = createHarness({ backend });
  assert.equal(hook.subscriptions, 0, '지연 저장을 쓰기 전에는 훅을 걸지 않는다');

  storage.setDebounced(K.pedals, { v: 1 }, 40);
  storage.setDebounced(K.pedals, { v: 2 }, 40);
  storage.setDebounced(K.pedals, { v: 3 }, 40);
  assert.equal(hook.subscriptions, 1, '페이지 가림 훅은 한 번만 건다');
  assert.equal(backend.calls.setItem, 0, '타이머가 돌기 전에는 쓰지 않는다');
  await delay(120);
  assert.equal(backend.calls.setItem, 1, '세 번 불러도 한 번만 쓴다');
  assert.equal(backend.map.get(K.pedals), '{"v":3}', '마지막 값');

  // 값이 함수면 쓰는 순간에 부른다(그 사이 바뀐 최신 값을 읽는다).
  let latest = 'a';
  storage.setDebounced(K.io, () => ({ latest }), 40);
  latest = 'b';
  await delay(120);
  assert.equal(backend.map.get(K.io), '{"latest":"b"}');

  // 기본 지연은 300 ms
  const before = backend.calls.setItem;
  storage.setDebounced(K.presetRecents, ['x']);
  await delay(150);
  assert.equal(backend.calls.setItem, before, '기본 300 ms 안에는 쓰지 않는다');
  await delay(300);
  assert.equal(backend.calls.setItem, before + 1);
  assert.equal(backend.map.get(K.presetRecents), '["x"]');

  // 페이지가 가려지거나 닫히면(pagehide·visibilitychange hidden) 밀린 저장을 바로 쓴다.
  storage.setDebounced(K.pedals, { v: 4 }, 10_000);
  assert.equal(backend.map.get(K.pedals), '{"v":3}');
  hook.flush();
  assert.equal(backend.map.get(K.pedals), '{"v":4}', 'flush 훅이 바로 쓴다');
  hook.flush();
  assert.equal(backend.map.get(K.pedals), '{"v":4}', '밀린 것이 없으면 아무 일도 없다');

  // flush() 직접 호출, 그 뒤 타이머는 다시 쓰지 않는다.
  storage.setDebounced(K.io, { latest: 'c' }, 60);
  storage.flush();
  assert.equal(backend.map.get(K.io), '{"latest":"c"}');
  const afterFlush = backend.calls.setItem;
  await delay(150);
  assert.equal(backend.calls.setItem, afterFlush, 'flush 한 저장은 타이머가 다시 쓰지 않는다');

  // set() 은 같은 키에 밀려 있던 지연 저장을 대신한다(오래된 값이 나중에 덮어쓰지 않는다).
  storage.setDebounced(K.pedals, { v: 'old' }, 40);
  storage.set(K.pedals, { v: 'new' });
  await delay(120);
  assert.equal(backend.map.get(K.pedals), '{"v":"new"}');

  // remove() 도 밀린 저장을 취소한다.
  storage.setDebounced(K.presetFavorites, ['z'], 40);
  storage.remove(K.presetFavorites);
  await delay(120);
  assert.equal(backend.map.has(K.presetFavorites), false);
}

// ---------------------------------------------------------------------------------------------
// 7. usageBytes: 이 앱의 키만 센다
// ---------------------------------------------------------------------------------------------
{
  const backend = createBackend({
    [K.pedals]: 'abcd',
    [`${K.pedals}:corrupt-1`]: 'xy',
    [K.presets]: '12',
    'other-app:data': 'z'.repeat(1000),
    'guitar-pedalboard:future-key': 'q',
  });
  const { storage } = createHarness({ backend });
  const expected = (K.pedals.length + 4 + `${K.pedals}:corrupt-1`.length + 2 + K.presets.length + 2 + 'guitar-pedalboard:future-key'.length + 1) * 2;
  assert.equal(storage.usageBytes(), expected);
}

// ---------------------------------------------------------------------------------------------
// 8. clearAppSettings: `guitar-pedalboard:` 키만 지운다
// ---------------------------------------------------------------------------------------------
{
  const backend = createBackend({
    [K.pedals]: '1',
    [K.io]: '2',
    [`${K.pedals}:corrupt-9`]: '3',
    'guitar-pedalboard:future-key': '4',
    [K.presets]: '{"version":1,"presets":[]}',
    'other-app:data': 'keep',
    'guitar-pedalboardX': 'keep-too',
  });
  const { storage } = createHarness({ backend });
  storage.setDebounced(K.midi, { a: 1 }, 40);
  const removed = storage.clearAppSettings();
  assert.equal(removed, 4);
  assert.deepEqual(
    [...backend.map.keys()].sort(),
    ['guitar-pedalboardX', K.presets, 'other-app:data'].sort(),
    '이 앱의 설정 키 외에는 건드리지 않는다(사용자 프리셋·다른 앱 데이터 포함)',
  );
  await delay(120);
  assert.equal(backend.map.has(K.midi), false, '밀려 있던 저장이 지운 뒤에 되살아나지 않는다');
  assert.equal(storage.getRaw(K.pedals), null);
}

// 차단된 환경에서도 던지지 않는다.
{
  const { storage } = createHarness({ getBackend: () => { throw securityError(); } });
  assert.equal(storage.clearAppSettings(), 0);
}

// ---------------------------------------------------------------------------------------------
// 9. 어떤 경우에도 던지지 않는다
// ---------------------------------------------------------------------------------------------
{
  const hostile = createBackend({}, {
    getItem: () => { throw new TypeError('getItem exploded'); },
    setItem: () => { throw new RangeError('setItem exploded'); },
    removeItem: () => { throw new Error('removeItem exploded'); },
  });
  hostile.key = () => { throw new Error('key exploded'); };
  const { storage } = createHarness({ backend: hostile });
  const circular = {};
  circular.self = circular;

  assert.doesNotThrow(() => {
    storage.get(K.io, 1);
    storage.getRaw(K.io);
    storage.read(K.io, () => { throw new Error('parse'); }, 2);
    storage.set(K.io, { a: 1 });
    storage.setRaw(K.io, 'x');
    storage.setDebounced(K.io, () => { throw new Error('produce'); }, 5);
    storage.flush();
    storage.remove(K.io);
    storage.usageBytes();
    storage.clearAppSettings();
    void storage.mode;
  });
  assert.deepEqual(storage.set(K.io, circular), { ok: false, reason: 'unknown' }, '직렬화할 수 없는 값도 던지지 않는다');
  await delay(30);
}

// 안내를 띄우는 쪽이 던져도 저장 흐름은 계속된다.
{
  const backend = createBackend({}, { setItem: () => { throw quotaError(); } });
  const storage = createSafeStorage({
    getBackend: () => backend,
    notify: () => {
      throw new Error('notify exploded');
    },
  });
  assert.doesNotThrow(() => storage.set(K.io, {}));
  assert.deepEqual(storage.get(K.io, null), {}, '안내가 실패해도 값은 메모리에 남는다');
}

// 매번 새로 저장소를 얻는다: 시험이 `window.localStorage` 를 바꿔 끼워도 따라간다.
{
  const first = createBackend({ [K.io]: '{"from":"first"}' });
  const second = createBackend({ [K.io]: '{"from":"second"}' });
  let current = first;
  const { storage } = createHarness({ getBackend: () => current });
  assert.deepEqual(storage.get(K.io, null), { from: 'first' });
  current = second;
  assert.deepEqual(storage.get(K.io, null), { from: 'second' });
}

// removeItem·key·length 가 없는 간단한 가짜 저장소도 쓴다(다른 회귀 시험들이 이런 모양을 쓴다).
{
  const map = new Map();
  const minimal = { getItem: (key) => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)) };
  const { storage, notices } = createHarness({ backend: minimal });
  assert.deepEqual(storage.set(K.io, { a: 1 }), { ok: true });
  assert.deepEqual(storage.get(K.io, null), { a: 1 });
  storage.remove(K.io);
  assert.equal(storage.getRaw(K.io), null, 'removeItem 이 없어도 이번 방문 동안은 지워진 것으로 본다');
  map.set(K.pedals, '{bad');
  assert.deepEqual(storage.get(K.pedals, 'fb'), 'fb');
  assert.deepEqual(notices.map((notice) => notice.kind), ['corrupt']);
}

// ---------------------------------------------------------------------------------------------
// 10. 기본 인스턴스와 토스트: 안내는 종류마다 토스트 하나(key 중복 제거)
// ---------------------------------------------------------------------------------------------
{
  useToastStore.getState().clear();
  const previousWindow = globalThis.window;
  const quotaBackend = createBackend({}, { setItem: () => { throw quotaError(); } });
  globalThis.window = { localStorage: quotaBackend };
  try {
    // 기본 인스턴스는 window.localStorage 를 부를 때마다 새로 얻는다.
    safeStorage.set(K.io, { a: 1 });
    safeStorage.set(K.io, { a: 2 });
    safeStorage.setRaw(K.outputDevice, 'x');
    const toasts = useToastStore.getState().toasts.filter((toast) => toast.key.startsWith('storage:'));
    assert.equal(toasts.length, 1, '저장이 여러 번 실패해도 토스트는 하나');
    assert.equal(toasts[0].key, 'storage:quota');
    assert.equal(toasts[0].kind, 'warning');
    assert.equal(toasts[0].message, STORAGE_NOTICE_MESSAGES.quota);
  } finally {
    globalThis.window = previousWindow;
    useToastStore.getState().clear();
  }
}

// ---------------------------------------------------------------------------------------------
// 11. 토스트 확장: 동작 버튼 자리, 같은 key 는 하나만
// ---------------------------------------------------------------------------------------------
{
  const store = useToastStore.getState();
  store.clear();
  let actions = 0;
  showToast({ message: '첫 번째', kind: 'info', key: 'k', action: { label: '되돌리기', onAction: () => { actions += 1; } } });
  assert.equal(useToastStore.getState().toasts.length, 1);
  const [first] = useToastStore.getState().toasts;
  assert.equal(first.action.label, '되돌리기');
  first.action.onAction();
  assert.equal(actions, 1);

  showToast({ message: '두 번째', kind: 'info', key: 'k' });
  assert.equal(useToastStore.getState().toasts.length, 1, '같은 key 는 하나만 남는다');
  assert.equal(useToastStore.getState().toasts[0].message, '두 번째');
  assert.equal(useToastStore.getState().toasts[0].action, undefined, '새 토스트가 이전 동작 버튼을 대신한다');

  showToast({ message: '일반' });
  assert.equal(useToastStore.getState().toasts.at(-1).action, undefined, '동작 버튼은 선택 사항');
  store.clear();
}

// ---------------------------------------------------------------------------------------------
// 12. 전역 오류 토스트(error·unhandledrejection)
// ---------------------------------------------------------------------------------------------
{
  const handlers = new Map();
  const fakeWindow = {
    addEventListener: (type, handler) => handlers.set(type, handler),
    removeEventListener: (type, handler) => {
      if (handlers.get(type) === handler) handlers.delete(type);
    },
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    useToastStore.getState().clear();
    const uninstall = installGlobalErrorHandlers(fakeWindow);
    assert.deepEqual([...handlers.keys()].sort(), ['error', 'unhandledrejection']);
    const unexpected = () => useToastStore.getState().toasts.filter((toast) => toast.key === UNEXPECTED_ERROR_TOAST_KEY);

    // 브라우저가 레이아웃 중에 내는 무해한 알림은 무시한다.
    handlers.get('error')({ message: 'ResizeObserver loop completed with undelivered notifications.' });
    handlers.get('error')({ message: 'ResizeObserver loop limit exceeded' });
    handlers.get('unhandledrejection')({ reason: Object.assign(new Error('The play() request was interrupted'), { name: 'AbortError' }) });
    assert.equal(unexpected().length, 0);

    // 진짜 오류: 토스트 하나, 같은 key 는 되풀이돼도 하나
    handlers.get('error')({ message: 'boom', error: new TypeError('boom') });
    handlers.get('error')({ message: 'boom2', error: new TypeError('boom2') });
    handlers.get('unhandledrejection')({ reason: new Error('rejected') });
    handlers.get('unhandledrejection')({ reason: 'string reason' });
    assert.equal(unexpected().length, 1);
    const [toast] = unexpected();
    assert.equal(toast.message, UNEXPECTED_ERROR_MESSAGE);
    assert.equal(UNEXPECTED_ERROR_MESSAGE, '예기치 못한 오류가 생겼습니다');
    assert.equal(toast.kind, 'error');
    assert.equal(toast.action.label, '오류 정보 복사');

    uninstall();
    assert.equal(handlers.size, 0, '듣기를 멈춘다');
  } finally {
    console.error = originalConsoleError;
    useToastStore.getState().clear();
  }
}

// ---------------------------------------------------------------------------------------------
// 13. 오류 정보 문자열
// ---------------------------------------------------------------------------------------------
{
  assert.deepEqual(describeError(new RangeError('범위')), { name: 'RangeError', message: '범위' });
  assert.deepEqual(describeError('그냥 문자열'), { name: 'Error', message: '그냥 문자열' });
  assert.deepEqual(describeError({ name: 'Custom', message: 'm' }), { name: 'Custom', message: 'm' });
  assert.deepEqual(describeError(undefined), { name: 'Error', message: '(메시지 없음)' });
  assert.deepEqual(describeError(null), { name: 'Error', message: '(메시지 없음)' });

  const packageJson = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(appVersion, packageJson.version, '앱 버전은 package.json 에서 온다');
  const report = buildErrorReport(new TypeError('x is not a function'), new Date('2026-01-02T03:04:05.000Z'));
  const lines = report.split('\n');
  assert.equal(lines[0], '오류 이름: TypeError');
  assert.equal(lines[1], '메시지: x is not a function');
  assert.equal(lines[2], `앱 버전: ${packageJson.version}`);
  assert.match(lines[3], /^브라우저: /);
  assert.equal(lines[4], '시각: 2026-01-02T03:04:05.000Z');
}

// ---------------------------------------------------------------------------------------------
// 14. 소스 계약: localStorage 는 SafeStorage.ts 에만, 오류 경계와 main.tsx 의 약속
// ---------------------------------------------------------------------------------------------
async function listSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await listSources(path)));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(path);
  }
  return files;
}
const stripComments = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');

const offenders = [];
for (const file of await listSources(sourceRoot)) {
  if (file.endsWith('/persistence/SafeStorage.ts')) continue;
  if (/\blocalStorage\b/.test(stripComments(await readFile(file, 'utf8')))) offenders.push(file.replace(`${sourceRoot}/`, 'src/'));
}
assert.deepEqual(offenders, [], 'SafeStorage.ts 밖에서 localStorage 를 직접 참조합니다');

const safeStorageSource = await readFile(new URL('../src/persistence/SafeStorage.ts', import.meta.url), 'utf8');
assert.equal([...stripComments(safeStorageSource).matchAll(/window\.localStorage/g)].length, 1, 'localStorage 에 닿는 곳은 browserBackend 하나');

const boundarySource = await readFile(new URL('../src/app/AppErrorBoundary.tsx', import.meta.url), 'utf8');
assert.match(boundarySource, /getDerivedStateFromError/);
assert.match(boundarySource, /componentDidCatch[\s\S]*void stopSessionForError\(\)/, '오류가 나면 먼저 소리를 끈다');
for (const text of ['문제가 생겨 화면을 표시하지 못했습니다', '다시 시도', '설정을 초기화하고 다시 시작', '오류 정보 복사', '초기화하고 다시 시작', '취소']) {
  assert.ok(boundarySource.includes(text), `오류 화면에 '${text}' 가 없습니다`);
}
assert.match(boundarySource, /role="alert"/);
assert.match(boundarySource, /safeStorage\.clearAppSettings\(\);\s*window\.location\.reload\(\)/, '확인한 뒤에만 지우고 새로고침한다');
assert.doesNotMatch(boundarySource, /confirmReset[\s\S]*\blocalStorage\b/);

const appSource = await readFile(new URL('../src/App.tsx', import.meta.url), 'utf8');
assert.match(appSource, /<AppErrorBoundary>[\s\S]*<AppShell \/>[\s\S]*<\/AppErrorBoundary>/, '오류 경계가 앱 전체를 감싼다');
assert.match(appSource, /<ToastRegion \/>/);

const mainSource = await readFile(new URL('../src/main.tsx', import.meta.url), 'utf8');
assert.match(mainSource, /installGlobalErrorHandlers\(\)/);
assert.match(mainSource, /try \{[\s\S]*createRoot\(rootElement\)\.render\([\s\S]*\} catch \(error\) \{[\s\S]*showStaticFallback\(rootElement\)/, 'React 가 뜨지 못하면 정적 안내');

const auditSource = await readFile(new URL('../src/store/audioStore.ts', import.meta.url), 'utf8');
assert.match(auditSource, /export function stopSessionForError\(\)[\s\S]*stopSession\('error'\)/);

const indexSource = await readFile(new URL('../index.html', import.meta.url), 'utf8');
assert.match(indexSource, /앱을 시작하지 못했습니다/, 'React 가 뜨기 전 실패에 대한 정적 안내');
assert.match(indexSource, /<script type="module" src="\/src\/main\.tsx"><\/script>/);
assert.ok(indexSource.indexOf('data-static-fallback') < indexSource.indexOf('src="/src/main.tsx"'), '안내 스크립트가 앱 스크립트보다 먼저 온다');

console.warn = originalConsoleWarn;
assert.ok(warnings.length > 0 && warnings.every((text) => text.includes('읽지 못해 기본값을 사용합니다')), '깨진 값은 원인을 경고로 남긴다');

console.log(
  'SafeStorage regression passed: key names pinned, blocked/quota/unknown/corrupt handling with once-only notices, memory retention, 300 ms debounce with pagehide flush, scoped reset, never-throws, toast action slot, global error toasts and error-boundary source contract.',
);
