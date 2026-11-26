// 사용자 캐비닛 IR 의 IndexedDB 저장소(S5.4). 진짜 브라우저의 저장소 동작은 e2e(s5-4)가 보고, 여기서는 가짜 IndexedDB 로 약속을 본다:
// 저장한 것이 그대로 돌아오는지, 복사본인지, 연결을 항상 닫는지, 오류가 어떻게 나오는지, 쓸 수 없는 값을 버리는지.
import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { createFakeIndexedDb } from './lib/fake-idb.mjs';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const bundle = await build({
  stdin: {
    contents: "export * from './audio/utils/cabinetIrStore.ts'; export { ko } from './i18n/ko.ts';",
    resolveDir: srcDir, sourcefile: 'cabinet-ir-store-entry.ts',
  },
  bundle: true, platform: 'node', format: 'esm', write: false, logLevel: 'silent',
});
const lib = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const { createIndexedDbIrStore, isStoredCabinetIr, CAB_IR_DB_NAME, CAB_IR_STORE_NAME, CAB_IR_RECORD_KEY, ko } = lib;

function sample(overrides = {}) {
  return {
    name: 'room.wav', sampleRate: 48000, cut: true, originalSeconds: 1.5, savedAt: 1700000000000,
    channels: [Float32Array.of(1, .5, -.25, 0), Float32Array.of(.5, .25, -.125, 0)],
    ...overrides,
  };
}

// 저장소가 localStorage 를 건드리면 안 된다(설정 저장소와 분리) — 건드리면 즉시 실패하는 덫을 놓는다.
const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('저장소가 localStorage 를 건드렸다'); } });

try {
  // ── 값 모양 검사 ──
  assert.equal(isStoredCabinetIr(sample()), true);
  for (const [label, bad] of [
    ['null', null], ['문자열', 'x'], ['이름 없음', sample({ name: undefined })], ['샘플레이트 낮음', sample({ sampleRate: 4000 })],
    ['샘플레이트 높음', sample({ sampleRate: 400000 })], ['채널 0개', sample({ channels: [] })], ['채널 3개', sample({ channels: [new Float32Array(2), new Float32Array(2), new Float32Array(2)] })],
    ['빈 채널', sample({ channels: [new Float32Array(0)] })], ['채널 길이 다름', sample({ channels: [new Float32Array(4), new Float32Array(3)] })],
    ['Float32Array 아님', sample({ channels: [[1, 2, 3]] })], ['1초 초과', sample({ channels: [new Float32Array(48100)] })],
    ['cut 없음', sample({ cut: undefined })], ['길이 숫자 아님', sample({ originalSeconds: NaN })], ['저장 시각 없음', sample({ savedAt: undefined })],
  ]) assert.equal(isStoredCabinetIr(bad), false, `쓸 수 없는 값: ${label}`);
  assert.equal(isStoredCabinetIr(sample({ channels: [new Float32Array(48001)] })), true, '1초 + 1샘플까지는 허용(반올림 여유)');

  // ── 저장·읽기·지우기 ──
  {
    const { factory, state } = createFakeIndexedDb();
    const store = createIndexedDbIrStore(factory);
    assert.equal(await store.load(), null, '처음에는 없다');
    assert.equal(state.openConnections, 0, '읽고 나서 연결을 닫는다');

    const original = sample();
    await store.save(original);
    assert.equal(state.openConnections, 0, '저장하고 나서 연결을 닫는다');
    original.channels[0][0] = 99; original.name = '바뀜';
    const loaded = await store.load();
    assert.equal(loaded.name, 'room.wav', '저장된 값은 복사본이다(나중에 바꿔도 영향 없음)');
    assert.deepEqual([...loaded.channels[0]], [1, .5, -.25, 0]);
    assert.deepEqual([...loaded.channels[1]], [.5, .25, -.125, 0]);
    assert.equal(loaded.cut, true); assert.equal(loaded.originalSeconds, 1.5); assert.equal(loaded.sampleRate, 48000);
    assert.ok(loaded.channels[0] instanceof Float32Array);
    assert.deepEqual([...state.databases.keys()], [CAB_IR_DB_NAME], '전용 DB 하나만 만든다');
    assert.deepEqual([...state.databases.get(CAB_IR_DB_NAME).stores.keys()], [CAB_IR_STORE_NAME]);
    assert.deepEqual([...state.databases.get(CAB_IR_DB_NAME).stores.get(CAB_IR_STORE_NAME).keys()], [CAB_IR_RECORD_KEY], 'IR 은 하나만 둔다');

    await store.save(sample({ name: 'second.wav', cut: false }));
    assert.equal((await store.load()).name, 'second.wav', '다시 저장하면 덮어쓴다');
    assert.equal(state.databases.get(CAB_IR_DB_NAME).stores.get(CAB_IR_STORE_NAME).size, 1);

    await store.clear();
    assert.equal(await store.load(), null, '지운 뒤에는 없다');
    assert.equal(state.openConnections, 0);
    await store.clear(); // 없는 것을 지워도 오류가 아니다
  }

  // ── 쓸 수 없는 값은 없는 것으로 ──
  {
    const { factory, state } = createFakeIndexedDb();
    const store = createIndexedDbIrStore(factory);
    await store.save(sample());
    state.databases.get(CAB_IR_DB_NAME).stores.get(CAB_IR_STORE_NAME).set(CAB_IR_RECORD_KEY, { name: 'x' });
    assert.equal(await store.load(), null, '손상된 값은 null');
  }

  // ── 쓰기는 트랜잭션이 끝나야 끝난다 ──
  {
    const { factory, state, release } = createFakeIndexedDb();
    const store = createIndexedDbIrStore(factory);
    await store.load(); // DB 만들기
    state.holdComplete = true;
    let settled = false;
    const pending = store.save(sample()).then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 30));
    assert.equal(settled, false, '요청이 성공해도 트랜잭션 완료 전에는 저장됐다고 하지 않는다');
    release();
    await pending;
    assert.equal(settled, true);
    state.holdComplete = false;
    assert.equal((await store.load()).name, 'room.wav');
  }

  // ── 실패 ──
  {
    const { factory, state } = createFakeIndexedDb();
    const store = createIndexedDbIrStore(factory);
    state.failOpen = '열 수 없음';
    await assert.rejects(store.load(), (error) => error.message === '열 수 없음');
    await assert.rejects(store.save(sample()), (error) => error.message === '열 수 없음');
    assert.equal(state.openConnections, 0);
    state.failOpen = null;

    await store.save(sample());
    state.failRequests = '요청 실패';
    await assert.rejects(store.load(), (error) => error.message === '요청 실패');
    assert.equal(state.openConnections, 0, '요청이 실패해도 연결을 닫는다');
    state.failRequests = null;

    state.abortWrites = true;
    await assert.rejects(store.save(sample({ name: 'aborted.wav' })));
    assert.equal(state.openConnections, 0, '쓰기가 중단돼도 연결을 닫는다');
    state.abortWrites = false;
    assert.equal((await store.load()).name, 'room.wav', '중단된 쓰기는 값을 바꾸지 않는다');
  }

  // ── IndexedDB 가 없는 환경 ──
  {
    const store = createIndexedDbIrStore(undefined);
    assert.equal(await store.load(), null, '없으면 읽기는 null');
    await assert.rejects(store.save(sample()), (error) => error.message === ko.cabinetIr.storeUnavailable);
    await store.clear();
  }
} finally {
  if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage); else delete globalThis.localStorage;
}
console.log('Cabinet IR IndexedDB store passed');
