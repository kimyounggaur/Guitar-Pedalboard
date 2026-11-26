// 저장소 안전 장치 시험(S1.7, 설계서 4.8절, 보고서 R2-1).
//
// 사이트 데이터 차단, 저장 공간 가득 참, 깨진 값에서도 앱이 멈추지 않는지, 안내가 종류마다 한 번만 나오는지,
// 지연 저장이 마지막 변경 300 ms 뒤 한 번만 쓰고 페이지가 가려지면 바로 쓰는지를 가짜 저장소로 확인한다.
// 브라우저는 쓰지 않는다. 화면 동작(오류 화면, 흰 화면 없음)은 e2e E-05 가 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import vm from 'node:vm';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { ESLint } from 'eslint';
import { createFakeDocument, FakeNode } from './lib/fake-document.mjs';
import { byClass, byId, byRole, byTag, find, findAll, parseHtml, textContent } from './lib/html-tree.mjs';
import { createSsrHarness } from './lib/ssr-harness.mjs';

const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));

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
  KEPT_ON_RESET_KEYS,
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
// 0. 키 이름: S2.4 에서 v2 키 3개가 늘었고, 옛 두 키는 이름만 v1 로 바뀌었다(문자열은 그대로 — 백업으로 남는다)
// ---------------------------------------------------------------------------------------------
assert.deepEqual(
  { ...STORAGE_KEYS },
  {
    schema: 'guitar-pedalboard:schema',
    v2State: 'guitar-pedalboard:v2:state',
    v2Presets: 'guitar-pedalboard:v2:presets',
    v1Pedals: 'guitar-pedalboard:pedals',
    v1Presets: 'web-guitar-pedalboard-presets',
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
  '저장 키 문자열이 바뀌었습니다',
);
assert.deepEqual([...KEPT_ON_RESET_KEYS], [K.schema, K.v2Presets], '설정 초기화가 지키는 키');
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
  assert.equal(storage.getRaw(K.v1Presets), null, '없는 키는 null');

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
  assert.deepEqual(storage.get(K.v1Pedals, { version: 0 }), { version: 0 });
  assert.equal(storage.getRaw(K.outputDevice), null);

  // 쓰기: 실패로 알리되 던지지 않고, 이번 방문 동안은 메모리에 남는다.
  assert.deepEqual(storage.set(K.v1Pedals, { version: 11, bypass: true }), { ok: false, reason: 'blocked' });
  assert.deepEqual(storage.get(K.v1Pedals, null), { version: 11, bypass: true }, '메모리에 값이 남는다');
  storage.setRaw(K.outputDevice, 'device-1');
  assert.equal(storage.getRaw(K.outputDevice), 'device-1');
  storage.setDebounced(K.io, { gain: 1 }, 5);
  await delay(30);
  assert.deepEqual(storage.get(K.io, null), { gain: 1 }, '지연 저장도 메모리에 남는다');
  storage.remove(K.v1Pedals);
  assert.equal(storage.get(K.v1Pedals, 'empty'), 'empty', '지운 값은 이번 방문 동안 지워진 채다');

  for (let i = 0; i < 20; i += 1) {
    storage.set(K.v1Pedals, { i });
    storage.get(K.v1Pedals, null);
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

  assert.deepEqual(storage.set(K.v1Pedals, { version: 11, n: 1 }), { ok: false, reason: 'quota' });
  assert.deepEqual(storage.get(K.v1Pedals, null), { version: 11, n: 1 }, '실패한 값도 이번 방문 동안은 읽힌다');
  assert.equal(backend.map.has(K.v1Pedals), false);
  assert.deepEqual(storage.set(K.v1Pedals, { version: 11, n: 2 }), { ok: false, reason: 'quota' });
  storage.setRaw(K.v1Presets, '{"version":1,"presets":[]}');
  storage.setDebounced(K.io, { gain: 2 }, 5);
  await delay(30);

  assert.equal(notices.length, 1, '여러 번 실패해도 안내는 한 번');
  assert.equal(notices[0].kind, 'quota');
  assert.equal(notices[0].message, STORAGE_NOTICE_MESSAGES.quota);
  assert.ok(notices[0].message.includes('kimyounggaur.github.io'), '가득 참 안내는 어느 사이트의 데이터인지 알려 줍니다');
  assert.deepEqual(storage.get(K.v1Pedals, null), { version: 11, n: 2 });

  // 공간이 생기면 다음 저장이 성공하고 메모리 값은 저장소 값으로 돌아간다.
  full = false;
  assert.deepEqual(storage.set(K.v1Pedals, { version: 11, n: 3 }), { ok: true });
  assert.equal(backend.map.get(K.v1Pedals), '{"version":11,"n":3}');
  assert.deepEqual(storage.get(K.v1Pedals, null), { version: 11, n: 3 });
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
  const backend = createBackend({ [K.v1Pedals]: '{not json', [K.io]: '{"gain":"x"}', [K.presetFavorites]: '{"a":1}' });
  const { storage, notices } = createHarness({ backend, now: () => 111 });

  assert.deepEqual(storage.get(K.v1Pedals, { fresh: true }), { fresh: true }, 'JSON 해석 실패 → 기본값');
  assert.equal(backend.map.get(`${K.v1Pedals}:corrupt-111`), '{not json', '원문이 보관된다');
  assert.equal(backend.map.has(K.v1Pedals), false, '보관한 뒤 원래 키는 비운다');

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
  assert.deepEqual(storage.set(K.v1Pedals, { version: 11 }), { ok: true });
  assert.equal(backend.map.get(`${K.v1Pedals}:corrupt-111`), '{not json');
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
  for (const stamp of [1, 2, 3, 4, 5]) seed[`${K.v1Pedals}:corrupt-${stamp}`] = `old-${stamp}`;
  seed[K.v1Pedals] = '{bad';
  const backend = createBackend(seed);
  const { storage } = createHarness({ backend, now: () => 6 });
  storage.get(K.v1Pedals, null);
  const archives = [...backend.map.keys()].filter((name) => name.startsWith(`${K.v1Pedals}:corrupt-`)).sort();
  assert.deepEqual(archives, [`${K.v1Pedals}:corrupt-4`, `${K.v1Pedals}:corrupt-5`, `${K.v1Pedals}:corrupt-6`]);
}

// 보관하지 못하면(저장 공간 가득) 원래 값을 지우지 않는다 — 되돌릴 길을 없애지 않는다.
{
  const backend = createBackend({ [K.v1Pedals]: '{bad' }, { setItem: () => { throw quotaError(); } });
  const { storage, notices } = createHarness({ backend });
  assert.deepEqual(storage.get(K.v1Pedals, { fresh: true }), { fresh: true });
  assert.equal(backend.map.get(K.v1Pedals), '{bad', '보관에 실패하면 원본이 남는다');
  assert.deepEqual(notices.map((notice) => notice.kind), ['corrupt']);
}

// ---------------------------------------------------------------------------------------------
// 6. 지연 저장(setDebounced): 마지막 변경 뒤 한 번, 페이지가 가려지면 바로
// ---------------------------------------------------------------------------------------------
{
  const backend = createBackend();
  const { storage, hook } = createHarness({ backend });
  assert.equal(hook.subscriptions, 0, '지연 저장을 쓰기 전에는 훅을 걸지 않는다');

  storage.setDebounced(K.v1Pedals, { v: 1 }, 40);
  storage.setDebounced(K.v1Pedals, { v: 2 }, 40);
  storage.setDebounced(K.v1Pedals, { v: 3 }, 40);
  assert.equal(hook.subscriptions, 1, '페이지 가림 훅은 한 번만 건다');
  assert.equal(backend.calls.setItem, 0, '타이머가 돌기 전에는 쓰지 않는다');
  await delay(120);
  assert.equal(backend.calls.setItem, 1, '세 번 불러도 한 번만 쓴다');
  assert.equal(backend.map.get(K.v1Pedals), '{"v":3}', '마지막 값');

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
  storage.setDebounced(K.v1Pedals, { v: 4 }, 10_000);
  assert.equal(backend.map.get(K.v1Pedals), '{"v":3}');
  hook.flush();
  assert.equal(backend.map.get(K.v1Pedals), '{"v":4}', 'flush 훅이 바로 쓴다');
  hook.flush();
  assert.equal(backend.map.get(K.v1Pedals), '{"v":4}', '밀린 것이 없으면 아무 일도 없다');

  // flush() 직접 호출, 그 뒤 타이머는 다시 쓰지 않는다.
  storage.setDebounced(K.io, { latest: 'c' }, 60);
  storage.flush();
  assert.equal(backend.map.get(K.io), '{"latest":"c"}');
  const afterFlush = backend.calls.setItem;
  await delay(150);
  assert.equal(backend.calls.setItem, afterFlush, 'flush 한 저장은 타이머가 다시 쓰지 않는다');

  // set() 은 같은 키에 밀려 있던 지연 저장을 대신한다(오래된 값이 나중에 덮어쓰지 않는다).
  storage.setDebounced(K.v1Pedals, { v: 'old' }, 40);
  storage.set(K.v1Pedals, { v: 'new' });
  await delay(120);
  assert.equal(backend.map.get(K.v1Pedals), '{"v":"new"}');

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
    [K.v1Pedals]: 'abcd',
    [`${K.v1Pedals}:corrupt-1`]: 'xy',
    [K.v1Presets]: '12',
    'other-app:data': 'z'.repeat(1000),
    'guitar-pedalboard:future-key': 'q',
  });
  const { storage } = createHarness({ backend });
  const expected = (K.v1Pedals.length + 4 + `${K.v1Pedals}:corrupt-1`.length + 2 + K.v1Presets.length + 2 + 'guitar-pedalboard:future-key'.length + 1) * 2;
  assert.equal(storage.usageBytes(), expected);
}

// ---------------------------------------------------------------------------------------------
// 8. clearAppSettings: `guitar-pedalboard:` 키만 지운다
// ---------------------------------------------------------------------------------------------
{
  const backend = createBackend({
    [K.v1Pedals]: '1',
    [K.io]: '2',
    [`${K.v1Pedals}:corrupt-9`]: '3',
    'guitar-pedalboard:future-key': '4',
    [K.v1Presets]: '{"version":1,"presets":[]}',
    'other-app:data': 'keep',
    'guitar-pedalboardX': 'keep-too',
  });
  const { storage } = createHarness({ backend });
  storage.setDebounced(K.midi, { a: 1 }, 40);
  const removed = storage.clearAppSettings();
  assert.equal(removed, 4);
  assert.deepEqual(
    [...backend.map.keys()].sort(),
    ['guitar-pedalboardX', K.v1Presets, 'other-app:data'].sort(),
    '이 앱의 설정 키 외에는 건드리지 않는다(사용자 프리셋·다른 앱 데이터 포함)',
  );
  await delay(120);
  assert.equal(backend.map.has(K.midi), false, '밀려 있던 저장이 지운 뒤에 되살아나지 않는다');
  assert.equal(storage.getRaw(K.v1Pedals), null);
}

// S2.4: 사용자 프리셋은 v2 에서 `guitar-pedalboard:` 접두사 아래로 옮겨 왔다. 초기화는 그것과 schema 키(와 보관본)를 지우지 않는다.
{
  const backend = createBackend({
    [K.schema]: '2',
    [`${K.schema}:corrupt-1`]: 'x',
    [K.v2State]: '{}',
    [`${K.v2State}:corrupt-2`]: 'old state',
    [K.v2Presets]: '{"schemaVersion":2,"presets":[]}',
    [`${K.v2Presets}:corrupt-3`]: 'old presets',
    [K.v1Pedals]: '1',
    [K.v1Presets]: '{"version":11,"presets":[]}',
    [`${K.v1Presets}:corrupt-4`]: 'old v1 presets',
    [K.io]: '2',
  });
  const { storage } = createHarness({ backend });
  const removed = storage.clearAppSettings();
  assert.equal(removed, 4, '지운 것: v2State, 그 보관본, v1Pedals, io');
  assert.deepEqual(
    [...backend.map.keys()].sort(),
    [K.schema, `${K.schema}:corrupt-1`, K.v2Presets, `${K.v2Presets}:corrupt-3`, K.v1Presets, `${K.v1Presets}:corrupt-4`].sort(),
    'schema·v2 프리셋(보관본 포함)·v1 프리셋 백업은 남기고, 나머지 앱 설정은 지운다',
  );
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
  map.set(K.v1Pedals, '{bad');
  assert.deepEqual(storage.get(K.v1Pedals, 'fb'), 'fb');
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
  assert.ok(lines[3].startsWith('브라우저: '), '네 번째 줄은 브라우저 정보');
  assert.equal(lines[4], '시각: 2026-01-02T03:04:05.000Z');
}

// ---------------------------------------------------------------------------------------------
// 14. 구조의 약속을 실행으로 확인한다: localStorage 는 SafeStorage.ts 에만, 오류 경계, 앱의 감싸는 구조, 시작 실패 안내
//     (예전에는 소스를 글자로 읽어 정규식으로 확인했다 — S4.7)
// ---------------------------------------------------------------------------------------------
// ① localStorage 직접 사용 금지: 소스를 훑는 대신 이 저장소의 ESLint 설정을 실제로 돌려, 같은 코드가 SafeStorage.ts 밖에서는 오류이고 안에서는 통과하는지 본다.
{
  const eslint = new ESLint({ cwd: projectRoot });
  const lintRules = async (code, filePath) => {
    const [result] = await eslint.lintText(code, { filePath: join(projectRoot, filePath) });
    return result.messages.map((message) => message.ruleId).filter((ruleId) => ruleId?.startsWith('no-restricted-'));
  };
  const directUses = [
    ['localStorage.getItem("a");', 'no-restricted-globals'],
    ['window.localStorage.getItem("a");', 'no-restricted-properties'],
    ['globalThis.localStorage.getItem("a");', 'no-restricted-properties'],
    ['self.localStorage.getItem("a");', 'no-restricted-properties'],
  ];
  for (const [code, ruleId] of directUses) {
    assert.deepEqual(await lintRules(code, 'src/store/example.ts'), [ruleId], `src/store 의 '${code}' 는 막혀야 합니다`);
    assert.deepEqual(await lintRules(code, 'src/components/Example.tsx'), [ruleId], `src/components 의 '${code}' 는 막혀야 합니다`);
    assert.deepEqual(await lintRules(code, 'src/persistence/SafeStorage.ts'), [], 'SafeStorage.ts 는 localStorage 에 닿을 수 있는 유일한 파일입니다');
  }
  assert.deepEqual(await lintRules('safeStorage.get("a", null);', 'src/store/example.ts'), [], 'SafeStorage 를 거치는 사용은 막지 않습니다');
}

// ② 오류 경계·앱 구조·시작 실패 안내: 컴포넌트와 main.tsx 를 실제로 실행한다.
const sources = await Promise.all([readFile(new URL('../index.html', import.meta.url), 'utf8')]);
const [indexHtml] = sources;
{
  const reloads = [];
  const ssr = await createSsrHarness({
    extraExports: [
      "{ AppErrorBoundary } from './app/AppErrorBoundary.tsx'",
      "{ default as App } from './App.tsx'",
      "{ ToastRegion } from './components/Toast.tsx'",
      "{ SessionProtection } from './components/SessionProtection.tsx'",
      "{ AppShell } from './components/AppShell.tsx'",
      "{ AudioSession } from './audio/engine/AudioSession.ts'",
      "{ stopSessionForError } from './store/audioStore.ts'",
      "{ safeStorage, STORAGE_KEYS, APP_STORAGE_PREFIX } from './persistence/index.ts'",
      "{ showStaticFallback, STATIC_FALLBACK_TITLE } from './app/staticFallback.ts'",
    ],
  });
  const { AppErrorBoundary, App, ToastRegion, SessionProtection, AppShell, AudioSession, stopSessionForError } = ssr.exports;
  globalThis.window.location = { reload: () => reloads.push('reload') };
  const textOf = (node) => textContent(node).replace(/\s+/g, ' ').trim();
  const buttonLabels = (tree) => findAll(tree, byTag('button')).map(textOf);

  // 오류 경계: 오류가 없으면 아이를 그대로 그리고, 오류가 나면 상태에 담아 안내 화면을 그린다.
  const child = { marker: 'child' };
  assert.equal(new AppErrorBoundary({ children: child }).render(), child, '오류가 없으면 앱을 그대로 보여 줍니다');
  const failure = new Error('boom');
  assert.deepEqual(AppErrorBoundary.getDerivedStateFromError(failure), { error: failure, confirmingReset: false, copyStatus: 'idle' });
  const thrownText = AppErrorBoundary.getDerivedStateFromError('문자열로 던져진 값');
  assert.ok(thrownText.error instanceof Error && thrownText.error.message === '문자열로 던져진 값', 'Error 가 아닌 값도 Error 로 바꿔 담습니다');

  const boundary = new AppErrorBoundary({ children: child });
  boundary.state = AppErrorBoundary.getDerivedStateFromError(failure);
  boundary.setState = (patch) => {
    boundary.state = { ...boundary.state, ...patch };
  };
  let screen = ssr.renderElement(boundary.render());
  const alert = find(screen, byRole('alert'));
  assert.equal(alert.tag, 'main');
  assert.equal(alert.attrs['data-app-error'], 'true');
  assert.equal(alert.attrs.tabindex, '-1', '오류 화면은 포커스를 받을 수 있어야 합니다');
  assert.equal(textOf(find(screen, byTag('h1'))), '문제가 생겨 화면을 표시하지 못했습니다');
  assert.deepEqual(buttonLabels(screen), ['다시 시도', '설정을 초기화하고 다시 시작', '오류 정보 복사']);
  assert.equal(findAll(screen, byClass('app-error-confirm')).length, 0, '초기화 확인은 누르기 전에는 보이지 않습니다');

  // 소리부터 끈다: 오류를 잡으면 'error' 이유로 세션을 멈추고 오류를 기록한다.
  const stopReasons = [];
  const originalStop = AudioSession.prototype.stop;
  AudioSession.prototype.stop = async function stop(reason) {
    stopReasons.push(reason);
    return { ok: true };
  };
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (...args) => logged.push(args);
  try {
    boundary.componentDidCatch(failure, { componentStack: '\n  at Broken' });
    assert.deepEqual(stopReasons, ['error'], '오류가 나면 먼저 소리를 끈다');
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1], failure);
    await stopSessionForError();
    assert.deepEqual(stopReasons, ['error', 'error'], 'stopSessionForError 는 error 이유로 정지한다');
    AudioSession.prototype.stop = async () => {
      throw new Error('정리 실패');
    };
    await stopSessionForError(); // 정리가 실패해도 던지지 않는다
  } finally {
    AudioSession.prototype.stop = originalStop;
    console.error = originalConsoleError;
  }

  // 초기화는 두 번 눌러야 한다: 확인 화면이 뜨기 전에는 아무것도 지우지 않고, 확인한 뒤에만 이 앱의 설정을 지우고 새로고침한다.
  const appKey = STORAGE_KEYS.v1Pedals;
  ssr.storage.set(appKey, '{"version":11}');
  ssr.storage.set('other-app:setting', 'keep');
  boundary.askReset();
  screen = ssr.renderElement(boundary.render());
  assert.equal(ssr.storage.has(appKey), true, '확인 전에는 지우지 않습니다');
  assert.deepEqual(reloads, []);
  const confirm = find(screen, byClass('app-error-confirm'));
  assert.ok(confirm, '확인 화면이 보입니다');
  assert.equal(confirm.attrs['aria-labelledby'], find(confirm, byTag('h2')).attrs.id, '확인 화면은 자기 제목으로 이름이 붙습니다');
  assert.deepEqual(buttonLabels(confirm), ['초기화하고 다시 시작', '취소']);
  assert.equal(find(screen, (node) => node.tag === 'button' && textOf(node) === '설정을 초기화하고 다시 시작').attrs['aria-expanded'], 'true');
  boundary.cancelReset();
  assert.equal(boundary.state.confirmingReset, false);
  assert.equal(ssr.storage.has(appKey), true, '취소해도 지우지 않습니다');
  boundary.askReset();
  boundary.confirmReset();
  assert.equal(ssr.storage.has(appKey), false, '확인하면 이 앱의 설정을 지웁니다');
  assert.equal(ssr.storage.get('other-app:setting'), 'keep', '같은 주소의 다른 앱 데이터는 건드리지 않습니다');
  assert.deepEqual(reloads, ['reload'], '지운 뒤 새로고침합니다');
  boundary.retry();
  assert.deepEqual(boundary.state, { error: null, confirmingReset: false, copyStatus: 'idle' }, '다시 시도는 처음 상태로 돌아갑니다');

  // 앱 전체를 오류 경계가 감싼다: App 이 돌려주는 요소의 구조.
  const appElement = App();
  assert.equal(appElement.type, AppErrorBoundary, '오류 경계가 앱 전체의 바깥입니다');
  assert.deepEqual(appElement.props.children.map((element) => element.type), [ToastRegion, SessionProtection, AppShell], '토스트·세션 보호·앱 본체가 경계 안에 있습니다');

  // React 가 뜨기 전에 실패하면 정적 안내: showStaticFallback 이 #root 에 알림 영역을 넣는다.
  const fakeDocument = createFakeDocument();
  globalThis.document = fakeDocument;
  try {
    ssr.exports.showStaticFallback(fakeDocument.root);
    const [fallback] = fakeDocument.root.children;
    assert.equal(fallback.tagName, 'MAIN');
    assert.equal(fallback.getAttribute('role'), 'alert');
    assert.equal(fallback.getAttribute('data-static-fallback'), 'true');
    assert.equal(fallback.find((node) => node.tagName === 'H1').textContent, ssr.exports.STATIC_FALLBACK_TITLE);
    assert.equal(ssr.exports.STATIC_FALLBACK_TITLE, '앱을 시작하지 못했습니다');
    assert.equal(fallback.find((node) => node.tagName === 'BUTTON').textContent, '페이지 다시 불러오기');
  } finally {
    delete globalThis.document;
  }
  ssr.restore();
}

// ③ index.html: 앱 스크립트보다 먼저 오는 안내 스크립트를 가짜 window·document 에서 실행해, 스크립트 로딩 실패 때 #root 를 안내로 바꾸는지 본다.
{
  const page = parseHtml(indexHtml);
  const body = find(page, byTag('body'));
  const scripts = body.children.filter((node) => node.tag === 'script');
  const moduleScript = scripts.find((node) => node.attrs.type === 'module');
  const inlineScript = scripts.find((node) => node.attrs.type === undefined);
  assert.equal(moduleScript.attrs.src, '/src/main.tsx', '앱은 /src/main.tsx 모듈로 시작합니다');
  assert.ok(body.children.indexOf(inlineScript) < body.children.indexOf(moduleScript), '안내 스크립트가 앱 스크립트보다 먼저 옵니다');
  assert.ok(find(body, byId('root')), '#root 가 있습니다');

  const runInlineScript = (rootChildren, event) => {
    const fakeDocument = createFakeDocument();
    for (let index = 0; index < rootChildren; index += 1) fakeDocument.root.appendChild(new FakeNode('div'));
    const listeners = [];
    const sandbox = {
      document: fakeDocument,
      location: { origin: 'https://example.test', reload() {} },
      window: { addEventListener: (type, listener, capture) => listeners.push({ type, listener, capture }) },
    };
    vm.runInNewContext(textContent(inlineScript), sandbox);
    assert.deepEqual(listeners.map(({ type, capture }) => [type, capture]), [['error', true]], '캡처 단계에서 error 하나만 듣습니다(스크립트 로딩 실패는 버블링하지 않는다)');
    listeners[0].listener(event);
    return fakeDocument.root;
  };
  const scriptFailure = { target: { tagName: 'SCRIPT' } };
  const emptyRoot = runInlineScript(0, scriptFailure);
  const [shown] = emptyRoot.children;
  assert.equal(shown.getAttribute('role'), 'alert');
  assert.equal(shown.getAttribute('data-static-fallback'), 'true');
  assert.equal(shown.find((node) => node.tagName === 'H1').textContent, '앱을 시작하지 못했습니다');
  assert.deepEqual(runInlineScript(1, scriptFailure).children.map((node) => node.tagName), ['DIV'], 'React 가 이미 그렸으면(#root 에 내용이 있으면) 그 내용을 안내로 바꾸지 않습니다');
  assert.equal(runInlineScript(0, { target: { tagName: 'IMG' } }).children.length, 0, '이미지 로딩 실패 같은 무관한 오류는 무시합니다');
  assert.equal(runInlineScript(0, { target: null, filename: 'https://example.test/assets/index.js' }).children.length, 1, '우리 스크립트의 실행 오류는 안내를 보여 줍니다');
  assert.equal(runInlineScript(0, { target: null, filename: 'https://other.test/ads.js' }).children.length, 0, '다른 출처 스크립트의 오류는 무시합니다');
}

// ④ main.tsx: 시작 순서와 실패 처리를 실제로 실행한다. createRoot 를 가짜로 바꿔 성공·실패 두 경우를 본다.
async function runMain({ failRender }) {
  const hooks = { roots: [], rendered: [], listeners: [] };
  const fakeDocument = createFakeDocument();
  globalThis.__mainHooks = {
    createRoot(root) {
      hooks.roots.push(root);
      if (failRender) throw new Error('React 시작 실패');
      return { render: (element) => hooks.rendered.push(element) };
    },
  };
  const originalWarn = console.warn;
  const originalError = console.error;
  console.warn = () => {};
  console.error = () => {};
  let ssr;
  try {
    ssr = await createSsrHarness({
      extraExports: ["{ default as App } from './App.tsx'", "* as main from './main.tsx'"],
      stubs: {
        'react-dom/client': "export function createRoot(root: unknown) { return (globalThis as any).__mainHooks.createRoot(root); }",
        'styles/globals.css': 'export {};',
      },
      define: { 'import.meta.env.DEV': 'false' },
      documentOverrides: fakeDocument,
      windowOverrides: { addEventListener: (type) => hooks.listeners.push(type) },
    });
    return { hooks, fakeDocument, App: ssr.exports.App, ssr };
  } finally {
    console.warn = originalWarn;
    console.error = originalError;
  }
}
{
  const ok = await runMain({ failRender: false });
  assert.deepEqual(ok.hooks.listeners.filter((type) => type === 'error' || type === 'unhandledrejection').sort(), ['error', 'unhandledrejection'], '시작할 때 전역 오류 처리기를 건다');
  assert.equal(ok.hooks.roots[0], ok.fakeDocument.root, '#root 에 그린다');
  assert.equal(ok.hooks.rendered.length, 1);
  assert.equal(ok.hooks.rendered[0].props.children.type, ok.App, 'StrictMode 안에서 App 을 그린다');
  assert.equal(ok.fakeDocument.root.children.length, 0, '정상 시작에서는 정적 안내를 넣지 않는다');
  ok.ssr.restore();

  const failed = await runMain({ failRender: true });
  const [fallback] = failed.fakeDocument.root.children;
  assert.ok(fallback, 'React 가 뜨지 못하면 #root 에 정적 안내를 넣는다');
  assert.equal(fallback.getAttribute('data-static-fallback'), 'true');
  assert.equal(fallback.find((node) => node.tagName === 'H1').textContent, '앱을 시작하지 못했습니다');
  failed.ssr.restore();
}

console.warn = originalConsoleWarn;
assert.ok(warnings.length > 0 && warnings.every((text) => text.includes('읽지 못해 기본값을 사용합니다')), '깨진 값은 원인을 경고로 남긴다');

console.log(
  'SafeStorage regression passed: key names pinned, blocked/quota/unknown/corrupt handling with once-only notices, memory retention, 300 ms debounce with pagehide flush, scoped reset, never-throws, toast action slot, global error toasts, ESLint-enforced SafeStorage-only localStorage, rendered error boundary, App structure and main.tsx start-up failure handling.',
);
