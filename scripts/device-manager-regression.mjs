// S2.13 입출력 장치 자동 관리(설계서 4.4 DeviceManager, E-17, 보고서 R2-15) 시험.
//   1. DeviceManager 순수 함수: 장치 목록이 채워졌는지(권한 전 판정 보류), 기억한 장치 찾기(id → 이름 → 없음), 선택 맞추기(사라짐·돌아옴·id 바뀜),
//      '기본 장치로 연결했습니다' 안내 조건, 저장된 출력 장치 고르기(옛 키와의 호환), 저장값 해석, devicechange 묶기(디바운스·해제).
//   2. 실제 스토어(엔진의 입출력만 가짜): 저장·복원, 장치 목록 갱신, 연주 중 장치 분실(device-lost), 연결할 때 안내(한 번만), 출력 장치 폴백, 읽기 순서(늦은 응답 무시),
//      devicechange 감시(스토어가 한 번만 등록, 연달아 온 신호는 한 번만 읽음).
//   3. 엔진: 저장된 출력 장치를 쓰지 못하면 연결을 막지 않고 기본 출력으로 두고 한 번 알린다.
//   4. 소스 단언: 화면 컴포넌트가 devicechange 를 따로 듣지 않고, 미지원 안내·저장된 장치 메뉴가 카탈로그를 쓰며, 문구가 설계서와 같다.
// 브라우저에서 실제로 보이는 것(목록이 1초 안에 바뀌는지, setSinkId 호출, 안내 토스트)은 e2e E-17 이 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// Node 의 전역 DOMException(브라우저의 setSinkId 오류와 같은 모양). scripts 에는 ESLint 전역 설정이 없어 이름을 직접 꺼내 쓴다.
const { DOMException } = globalThis;

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const deepEqual = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

const src = (relative) => fileURLToPath(new URL(`../src/${relative}`, import.meta.url));
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');
const toModule = (text) => import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);

// ---------------------------------------------------------------------------------------------
// 1. DeviceManager 순수 함수
// ---------------------------------------------------------------------------------------------
const pure = await build({
  entryPoints: [src('audio/devices/DeviceManager.ts')],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const {
  chooseRememberedOutput,
  isDeviceListed,
  isListIdentified,
  labelOf,
  makeRemembered,
  parseRememberedDevice,
  reconcileInputSelection,
  rememberedPresence,
  resolveRememberedDevice,
  resolveRememberedOutput,
  shouldAnnounceMissing,
  watchDeviceChanges,
} = await toModule(pure.outputFiles[0].text);

const dev = (deviceId, label = '') => ({ deviceId, label });
const MIC1 = dev('id-1', 'USB Mic');
const MIC2 = dev('id-2', 'Audio Interface');
const REM2 = { id: 'id-2', label: 'Audio Interface' };

// 1-1. 목록이 장치를 구별할 만큼 채워졌는가
ok(isListIdentified([]), '빈 목록은 "장치 없음"으로 확실하다');
ok(isListIdentified([MIC1, MIC2]), 'id 가 모두 있으면 구별할 수 있다');
ok(isListIdentified([dev('id-1', '')]), '이름이 비어도 id 가 있으면 구별할 수 있다');
ok(!isListIdentified([dev('', '')]), 'id 가 빈 항목(권한 전)은 구별할 수 없다');
ok(!isListIdentified([MIC1, dev('', '')]), '하나라도 비어 있으면 구별할 수 없다');
ok(isDeviceListed([MIC1, MIC2], 'id-2') && !isDeviceListed([MIC1, MIC2], 'id-9'), 'isDeviceListed');
equal(labelOf([MIC1, MIC2], 'id-2'), 'Audio Interface', 'labelOf');
equal(labelOf([MIC1], 'id-9'), '', '없는 장치의 이름은 빈 문자열');
deepEqual(makeRemembered([MIC1, MIC2], 'id-2'), REM2, 'makeRemembered: 목록에서 이름을 가져온다');
equal(makeRemembered([MIC1], ''), null, 'makeRemembered: 기본 장치(빈 id)는 기억하지 않는다');
deepEqual(makeRemembered([], 'id-9', '저장 이름'), { id: 'id-9', label: '저장 이름' }, 'makeRemembered: 목록에 없으면 넘겨 준 이름');
deepEqual(makeRemembered([], 'id-9'), { id: 'id-9', label: '' }, 'makeRemembered: 이름도 모르면 빈 이름');

// 1-2. 기억한 장치 찾기
deepEqual(resolveRememberedDevice([MIC1], null), { kind: 'none' }, '기억한 장치가 없다');
deepEqual(resolveRememberedDevice([MIC1], { id: '', label: 'x' }), { kind: 'none' }, 'id 가 빈 기억은 없는 것과 같다');
deepEqual(resolveRememberedDevice([dev('', '')], REM2), { kind: 'unknown' }, '권한 전 목록에서는 판단을 보류한다');
deepEqual(resolveRememberedDevice([MIC1, MIC2], REM2), { kind: 'found', id: 'id-2', label: 'Audio Interface', by: 'id' }, 'id 로 찾는다');
deepEqual(
  resolveRememberedDevice([MIC1, dev('id-2', 'Renamed')], REM2),
  { kind: 'found', id: 'id-2', label: 'Renamed', by: 'id' },
  'id 가 같으면 이름이 바뀌어도 그 장치(최신 이름을 돌려준다)',
);
deepEqual(resolveRememberedDevice([MIC1, dev('id-2', '')], REM2), { kind: 'found', id: 'id-2', label: 'Audio Interface', by: 'id' }, '목록의 이름이 비면 기억한 이름을 유지한다');
deepEqual(resolveRememberedDevice([MIC1, dev('new-id', 'Audio Interface')], REM2), { kind: 'found', id: 'new-id', label: 'Audio Interface', by: 'label' }, 'id 가 없으면 이름으로 찾는다');
deepEqual(
  resolveRememberedDevice([dev('id-2', 'Elsewhere'), dev('new-id', 'Audio Interface')], { id: 'id-2', label: 'Audio Interface' }),
  { kind: 'found', id: 'id-2', label: 'Elsewhere', by: 'id' },
  'id 가 맞으면 이름이 같은 다른 장치보다 id 가 먼저다',
);
deepEqual(resolveRememberedDevice([MIC1, MIC2], { id: 'id-9', label: 'Gone Mic' }), { kind: 'missing' }, 'id 도 이름도 없으면 사라진 것');
deepEqual(resolveRememberedDevice([MIC1, dev('id-3', '')], { id: 'id-9', label: '' }), { kind: 'missing' }, '이름 없는 기억은 이름 없는 장치와 짝지어지지 않는다');
deepEqual(resolveRememberedDevice([], REM2), { kind: 'missing' }, '장치가 하나도 없으면(확실한 빈 목록) 사라진 것');

// 1-3. 선택 맞추기
const base = { list: [MIC1, MIC2], selectedDeviceId: 'id-2', remembered: REM2, running: false, reappeared: false };
const reconcile = (patch) => reconcileInputSelection({ ...base, ...patch });

deepEqual(reconcile({}), { selectedDeviceId: 'id-2', remembered: REM2, lost: false }, '목록에 있으면 그대로');
deepEqual(reconcile({ list: [dev('', '')], running: true }), { selectedDeviceId: 'id-2', remembered: REM2, lost: false }, '권한 전 목록에서는 연주 중이어도 분실로 보지 않는다');
deepEqual(reconcile({ list: [dev('', '')] }), { selectedDeviceId: 'id-2', remembered: REM2, lost: false }, '권한 전 목록에서는 선택을 지우지 않는다');
deepEqual(
  reconcile({ list: [MIC1, dev('id-2', 'Audio Interface (2)')] }),
  { selectedDeviceId: 'id-2', remembered: { id: 'id-2', label: 'Audio Interface (2)' }, lost: false },
  '고른 장치의 이름이 바뀌면 기억한 이름을 맞춘다',
);
deepEqual(
  reconcile({ list: [MIC1], running: true }),
  { selectedDeviceId: '', remembered: REM2, lost: true },
  '연주 중 고른 장치가 사라지면 분실 — 선택은 기본 장치로, 기억은 남긴다',
);
deepEqual(
  reconcile({ list: [], running: true }),
  { selectedDeviceId: '', remembered: REM2, lost: true },
  '연주 중 장치가 하나도 안 보여도(확실한 빈 목록) 분실',
);
deepEqual(
  reconcile({ list: [MIC1, dev('new-id', 'Audio Interface')] }),
  { selectedDeviceId: 'new-id', remembered: { id: 'new-id', label: 'Audio Interface' }, lost: false },
  '쉬는 중 id 만 바뀌었으면 이름으로 찾아 갈아탄다(기억의 id 도 갱신)',
);
deepEqual(
  reconcile({ list: [MIC1, dev('new-id', 'Audio Interface')], running: true }),
  { selectedDeviceId: '', remembered: REM2, lost: true },
  '연주 중에는 이름으로 갈아타지 않는다(이미 열린 입력은 그 장치가 아니다)',
);
deepEqual(reconcile({ list: [MIC1] }), { selectedDeviceId: '', remembered: REM2, lost: false }, '쉬는 중 사라졌고 이름도 없으면 기본 장치로 — 기억은 남긴다');
deepEqual(
  reconcile({ selectedDeviceId: '', reappeared: true }),
  { selectedDeviceId: 'id-2', remembered: REM2, lost: false },
  '기본 장치를 쓰던 중 기억한 장치가 다시 나타나면 다시 고른다',
);
deepEqual(
  reconcile({ selectedDeviceId: '', reappeared: false }),
  { selectedDeviceId: '', remembered: REM2, lost: false },
  '계속 목록에 있었는데 선택이 기본 장치라면(열지 못해 내려온 것) 뒤집지 않는다',
);
deepEqual(
  reconcile({ selectedDeviceId: '', reappeared: true, running: true }),
  { selectedDeviceId: '', remembered: REM2, lost: false },
  '연주 중에는 입력을 바꾸지 않는다',
);
deepEqual(
  reconcile({ selectedDeviceId: '', reappeared: true, remembered: null }),
  { selectedDeviceId: '', remembered: null, lost: false },
  '기억한 장치가 없으면 되돌릴 것도 없다',
);
deepEqual(
  reconcile({ selectedDeviceId: '', reappeared: true, list: [dev('', '')] }),
  { selectedDeviceId: '', remembered: REM2, lost: false },
  '권한 전에는 되돌리지 않는다',
);

// 1-4. 존재 여부와 안내 조건
equal(rememberedPresence([MIC1, MIC2], REM2), true, 'rememberedPresence: 있다');
equal(rememberedPresence([MIC1], REM2), false, 'rememberedPresence: 없다');
equal(rememberedPresence([dev('', '')], REM2), null, 'rememberedPresence: 권한 전이라 모른다');
equal(rememberedPresence([MIC1], null), null, 'rememberedPresence: 기억한 장치가 없다');
equal(rememberedPresence([dev('new-id', 'Audio Interface')], REM2), true, 'rememberedPresence: 이름으로 찾아도 있는 것');

equal(shouldAnnounceMissing([MIC1], REM2, '', null), true, '기본 장치로 가는데 기억한 장치가 없으면 안내한다');
equal(shouldAnnounceMissing([MIC1], REM2, '', 'id-2'), false, '같은 장치는 한 번만 안내한다');
equal(shouldAnnounceMissing([MIC1], REM2, '', 'id-1'), true, '다른 장치에 대해 알렸더라도 이 장치는 새로 안내한다');
equal(shouldAnnounceMissing([MIC1], REM2, 'id-1', null), false, '선택이 있으면(그 장치로 연결한다) 여기서 안내하지 않는다');
equal(shouldAnnounceMissing([MIC1, MIC2], REM2, '', null), false, '기억한 장치가 목록에 있으면 안내하지 않는다');
equal(shouldAnnounceMissing([dev('', '')], REM2, '', null), false, '권한 전에는 안내하지 않는다');
equal(shouldAnnounceMissing([MIC1], null, '', null), false, '기억한 장치가 없으면 안내하지 않는다');

// 1-5. 출력 장치
deepEqual(resolveRememberedOutput([MIC1], null), { kind: 'default' }, '출력: 기억 없음 → 시스템 기본');
deepEqual(resolveRememberedOutput([dev('', '')], REM2), { kind: 'unknown', id: 'id-2' }, '출력: 권한 전 → 보류(기억한 id 를 그대로 쓴다)');
deepEqual(resolveRememberedOutput([MIC2], REM2).kind, 'found', '출력: id 로 찾음');
deepEqual(resolveRememberedOutput([dev('x', 'Audio Interface')], REM2), { kind: 'found', id: 'x', label: 'Audio Interface', by: 'label' }, '출력: 이름으로 찾음');
deepEqual(resolveRememberedOutput([MIC1], REM2), { kind: 'missing' }, '출력: 없음');

// 1-6. 옛 키와의 호환
const LABELED = { id: 'out-2', label: 'Speakers' };
equal(chooseRememberedOutput(null, null), null, '저장된 것이 없다');
deepEqual(chooseRememberedOutput(LABELED, null), LABELED, '옛 키가 없으면 새 저장값');
deepEqual(chooseRememberedOutput(LABELED, 'out-2'), LABELED, '두 값이 같으면 새 저장값(이름이 있다)');
deepEqual(chooseRememberedOutput(LABELED, 'out-3'), { id: 'out-3', label: '' }, '두 값이 어긋나면 옛 키를 따른다(옛 빌드로 돌아가 다시 골랐다)');
equal(chooseRememberedOutput(LABELED, ''), null, '옛 키가 빈 문자열(시스템 기본 출력)이면 기본');
deepEqual(chooseRememberedOutput(null, 'out-1'), { id: 'out-1', label: '' }, '새 저장값이 없고 옛 키만 있으면 옛 키(이름은 모른다)');
equal(chooseRememberedOutput(null, ''), null, '옛 키가 빈 문자열이면 기본');

// 1-7. 저장값 해석
deepEqual(parseRememberedDevice({ id: 'a', label: 'B' }), { id: 'a', label: 'B' }, '정상');
deepEqual(parseRememberedDevice({ id: 'a' }), { id: 'a', label: '' }, '이름이 없으면 빈 이름');
deepEqual(parseRememberedDevice({ id: 'a', label: 3 }), { id: 'a', label: '' }, '이름이 문자열이 아니면 빈 이름');
equal(parseRememberedDevice({ id: 'a', label: 'x'.repeat(500) }).label.length, 200, '이름은 200자까지');
for (const bad of [null, undefined, 'a', 3, [], [{ id: 'a' }], {}, { id: '' }, { id: 3, label: 'x' }, { label: 'x' }]) {
  equal(parseRememberedDevice(bad), null, `저장값 ${JSON.stringify(bad)} 는 버린다`);
}

// 1-8. devicechange 묶기
function fakeTimers() {
  const pending = new Map();
  let next = 1;
  return {
    setTimer: (callback, ms) => { const id = next++; pending.set(id, { callback, ms }); return id; },
    clearTimer: (id) => { pending.delete(id); },
    pending,
    fireAll() { const tasks = [...pending.values()]; pending.clear(); for (const task of tasks) task.callback(); },
  };
}
function fakeTarget() {
  const listeners = new Set();
  return {
    addEventListener: (type, listener) => { if (type === 'devicechange') listeners.add(listener); },
    removeEventListener: (type, listener) => { if (type === 'devicechange') listeners.delete(listener); },
    fire: () => { for (const listener of [...listeners]) listener(); },
    listeners,
  };
}
{
  const target = fakeTarget();
  const timers = fakeTimers();
  let calls = 0;
  const stop = watchDeviceChanges(target, () => { calls += 1; }, { delayMs: 50, setTimer: timers.setTimer, clearTimer: timers.clearTimer });
  equal(target.listeners.size, 1, '감시를 시작하면 devicechange 를 하나 듣는다');
  for (let index = 0; index < 6; index += 1) target.fire();
  equal(timers.pending.size, 1, '연달아 온 신호는 기다리는 타이머 하나로 묶인다');
  equal([...timers.pending.values()][0].ms, 50, '기다리는 시간');
  equal(calls, 0, '기다리는 동안은 부르지 않는다');
  timers.fireAll();
  equal(calls, 1, '묶인 신호는 한 번만 전한다');
  target.fire();
  timers.fireAll();
  equal(calls, 2, '시간이 지난 뒤의 신호는 따로 전한다');
  target.fire();
  stop();
  equal(target.listeners.size, 0, '해제하면 듣기를 그만둔다');
  equal(timers.pending.size, 0, '해제하면 기다리던 타이머도 취소한다');
  timers.fireAll();
  equal(calls, 2, '해제한 뒤에는 부르지 않는다');
}
{
  let calls = 0;
  const stopNull = watchDeviceChanges(undefined, () => { calls += 1; });
  const stopMissing = watchDeviceChanges({}, () => { calls += 1; });
  stopNull();
  stopMissing();
  equal(calls, 0, 'mediaDevices 가 없는 환경(비보안 출처)에서도 던지지 않는다');
  const target = fakeTarget();
  const stop = watchDeviceChanges(target, () => { calls += 1; }, { delayMs: 10 });
  target.fire();
  await delay(60);
  equal(calls, 1, '실제 타이머로도 한 번 전한다');
  stop();
}

// ---------------------------------------------------------------------------------------------
// 2. 실제 스토어(엔진의 입출력만 가짜)
// ---------------------------------------------------------------------------------------------
const storage = new Map();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setInterval: () => 0,
    clearInterval() {},
    setTimeout: () => 0,
    clearTimeout() {},
  },
});

const runtime = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export { useAudioStore } from './store/audioStore.ts';",
      "export { useToastStore } from './store/toastStore.ts';",
      "export { safeStorage, STORAGE_KEYS } from './persistence/index.ts';",
      "export { ko } from './i18n/ko.ts';",
    ].join('\n'),
    resolveDir: src(''),
    sourcefile: 'device-manager-runtime.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});

let scenarioCount = 0;
/**
 * 저장소에 `io`·옛 출력 키를 심고 스토어를 새로 불러온다(모듈 시작 때 저장값을 읽으므로 시나리오마다 새 모듈이 필요하다).
 * 엔진의 입출력 목록·시작은 `world` 로 조종하는 가짜다.
 */
async function loadStore({ io, legacyOutput, inputs = [], outputs = [], sinkSupported = true } = {}) {
  storage.clear();
  if (io !== undefined) storage.set('guitar-pedalboard:io', JSON.stringify(io));
  if (legacyOutput !== undefined) storage.set('guitar-pedalboard:output-device', legacyOutput);

  const target = fakeTarget();
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { mediaDevices: target } });
  scenarioCount += 1;
  const modules = await toModule(`${runtime.outputFiles[0].text}\n// scenario ${scenarioCount}`);
  const { AudioEngine, useAudioStore, useToastStore, safeStorage, STORAGE_KEYS, ko } = modules;
  const engine = AudioEngine.getInstance();

  const world = {
    inputs,
    outputs,
    inputReads: 0,
    outputReads: 0,
    startCalls: [],
    outputSets: [],
    inputGate: null,
    outputFellBack: false,
  };
  engine.invalidatePendingStart = () => {};
  engine.silenceOutput = async () => {};
  engine.stopInput = () => {};
  engine.pausePlayback = () => {};
  engine.releaseGraph = () => {};
  engine.closeContext = async () => {};
  engine.advanceGeneration = () => {};
  engine.getInputInfo = () => ({ deviceId: '', channelCount: 2, selectable: true });
  engine.setInputChannelMode = () => {};
  engine.setRememberedChannelDecision = () => {};
  engine.start = async (deviceId) => { world.startCalls.push(deviceId ?? null); };
  engine.listInputDevices = async () => {
    world.inputReads += 1;
    const snapshot = world.inputs;
    if (world.inputGate) await world.inputGate;
    return snapshot;
  };
  engine.listOutputDevices = async () => { world.outputReads += 1; return world.outputs; };
  Object.defineProperty(engine, 'supportsOutputSelection', { configurable: true, get: () => sinkSupported });
  engine.setOutputDevice = async (id) => { world.outputSets.push(id); };
  engine.consumeOutputFallback = () => { const value = world.outputFellBack; world.outputFellBack = false; return value; };

  const state = () => useAudioStore.getState();
  const toasts = () => useToastStore.getState().toasts;
  const stored = () => { safeStorage.flush(); return JSON.parse(storage.get('guitar-pedalboard:io') ?? '{}'); };
  return { engine, world, state, toasts, stored, target, safeStorage, STORAGE_KEYS, ko, useToastStore, useAudioStore };
}

const settle = () => new Promise((resolve) => setImmediate(resolve));

// 2-1. 처음: 저장값이 없으면 기본 장치
{
  const app = await loadStore({ inputs: [MIC1, MIC2], outputs: [dev('out-1', 'Speakers')] });
  equal(app.state().selectedDeviceId, '', '저장값 없음: 기본 입력 장치');
  equal(app.state().rememberedInput, null, '저장값 없음: 기억한 입력 장치 없음');
  equal(app.state().selectedOutputDeviceId, '', '저장값 없음: 시스템 기본 출력');
  equal(app.state().rememberedOutput, null, '저장값 없음: 기억한 출력 장치 없음');

  await app.state().loadDevices();
  deepEqual(app.state().devices.map((device) => device.deviceId), ['id-1', 'id-2'], '목록을 읽는다');

  await app.state().setSelectedDevice('id-2');
  deepEqual(app.state().rememberedInput, REM2, '입력 장치를 고르면 id 와 이름을 기억한다');
  deepEqual(app.stored().devices, { input: REM2, output: null }, '기억한 입력 장치가 io 저장값에 들어간다');
  equal(app.stored().inputGainDb, 0, '다른 입출력 설정은 그대로 함께 저장된다');

  await app.state().setSelectedDevice('');
  equal(app.state().rememberedInput, null, '기본 입력 장치를 고르면 기억을 지운다');
  equal(app.stored().devices.input, null, '지운 기억이 저장된다');

  await app.state().setOutputDevice('out-9');
  deepEqual(app.state().rememberedOutput, { id: 'out-9', label: '' }, '목록에 없는 출력 장치는 이름 없이 기억한다');
  await app.state().setOutputDevice('out-1');
  deepEqual(app.state().rememberedOutput, { id: 'out-1', label: 'Speakers' }, '출력 장치를 고르면 id 와 이름을 기억한다');
  await app.state().loadDevices();
  equal(app.state().selectedOutputDeviceId, 'out-1', '목록에 있으면 그대로');
  deepEqual(app.stored().devices.output, { id: 'out-1', label: 'Speakers' }, '이름이 저장된다');
  equal(storage.get('guitar-pedalboard:output-device'), 'out-1', '옛 출력 키도 같은 값으로 계속 쓴다');
  await app.state().setOutputDevice('');
  equal(app.state().rememberedOutput, null, '시스템 기본 출력을 고르면 기억을 지운다');
  equal(storage.get('guitar-pedalboard:output-device'), '', '옛 키는 빈 문자열');
  equal(app.stored().devices.output, null, 'io 저장값도 비운다');

  // 새 필드를 넣은 뒤에도 다른 설정을 저장하면 장치 기억이 지워지지 않는다.
  await app.state().setSelectedDevice('id-2');
  app.state().setInputGainDb(6);
  deepEqual(app.stored().devices.input, REM2, '입력 이득을 바꿔도 기억한 장치는 유지된다');
  equal(app.stored().inputGainDb, 6, '입력 이득이 저장된다');
  app.useToastStore.getState().clear();
}

// 2-2. 저장된 입력 장치 복원
{
  const app = await loadStore({
    io: { inputGainDb: 3, devices: { input: REM2, output: null } },
    inputs: [MIC1, MIC2],
  });
  equal(app.state().selectedDeviceId, 'id-2', '다음 방문: 기억한 장치가 골라져 있다');
  deepEqual(app.state().rememberedInput, REM2, '다음 방문: 기억이 복원된다');
  equal(app.state().inputGainDb, 3, '다른 설정도 함께 복원된다');
  await app.state().loadDevices();
  equal(app.state().selectedDeviceId, 'id-2', '목록에 있으면 그대로');
}
{
  const app = await loadStore({ io: { inputGainDb: 0 }, inputs: [MIC1] });
  equal(app.state().selectedDeviceId, '', '장치 기억이 없던 옛 저장값: 기본 장치');
  equal(app.state().rememberedInput, null, '옛 저장값에 devices 가 없어도 읽힌다');
}
for (const broken of [{ devices: 3 }, { devices: [] }, { devices: { input: 'x', output: 7 } }, { devices: { input: { id: '' } } }]) {
  const app = await loadStore({ io: broken });
  equal(app.state().rememberedInput, null, `깨진 devices ${JSON.stringify(broken.devices)} 는 기본 장치로 읽는다`);
  equal(app.state().rememberedOutput, null, `깨진 devices ${JSON.stringify(broken.devices)}: 출력도 기본`);
}

// 2-3. 권한 전 목록(id 가 빈 항목)에서는 기억을 지우지 않는다
{
  const app = await loadStore({ io: { devices: { input: REM2, output: null } }, inputs: [dev('', '')] });
  await app.state().loadDevices();
  equal(app.state().selectedDeviceId, 'id-2', '권한 전 목록: 선택을 지우지 않는다');
  deepEqual(app.state().rememberedInput, REM2, '권한 전 목록: 기억을 지우지 않는다');
  app.world.inputs = [MIC1, MIC2];
  await app.state().loadDevices();
  equal(app.state().selectedDeviceId, 'id-2', '권한을 받아 목록이 채워지면 그대로 이어진다');
}

// 2-4. 장치가 사라지고 돌아오고 id 가 바뀐다
{
  const app = await loadStore({ io: { devices: { input: REM2, output: null } }, inputs: [MIC1] });
  await app.state().loadDevices();
  equal(app.state().selectedDeviceId, '', '저장된 장치가 없으면 기본 장치');
  deepEqual(app.state().rememberedInput, REM2, '기억은 남긴다');
  deepEqual(app.stored().devices.input ?? REM2, REM2, '저장값도 그대로');

  app.world.inputs = [MIC1, MIC2];
  await app.state().loadDevices();
  equal(app.state().selectedDeviceId, 'id-2', '장치가 다시 나타나면 다시 고른다');

  app.world.inputs = [MIC1, dev('new-id', 'Audio Interface')];
  await app.state().loadDevices();
  equal(app.state().selectedDeviceId, 'new-id', 'id 만 바뀌었으면 이름으로 찾아 갈아탄다');
  deepEqual(app.state().rememberedInput, { id: 'new-id', label: 'Audio Interface' }, '기억의 id 도 바뀐다');
  deepEqual(app.stored().devices.input, { id: 'new-id', label: 'Audio Interface' }, '바뀐 기억이 저장된다');
  app.useToastStore.getState().clear();
}

// 2-5. 연주 중 고른 입력 장치가 사라지면 세션을 끝낸다
{
  const app = await loadStore({ io: { devices: { input: REM2, output: null } }, inputs: [MIC1, MIC2] });
  await app.state().loadDevices();
  await app.state().start();
  equal(app.state().isRunning, true, '연결된다');
  deepEqual(app.world.startCalls, ['id-2'], '기억한 장치로 연결한다');
  equal(app.toasts().length, 0, '안내 없음');

  app.world.inputs = [MIC1];
  await app.state().loadDevices();
  equal(app.state().isRunning, false, '장치가 사라지면 세션이 끝난다');
  equal(app.state().inputMode, 'idle', '화면이 연결된 상태로 남지 않는다');
  equal(app.state().selectedDeviceId, '', '선택은 기본 장치로');
  deepEqual(app.state().rememberedInput, REM2, '기억은 남긴다');
  ok(app.toasts().some((toast) => toast.message.startsWith('입력 장치 연결이 끊겼습니다.')), 'device-lost 안내가 뜬다');

  app.world.inputs = [MIC1, MIC2];
  await app.state().loadDevices();
  equal(app.state().selectedDeviceId, 'id-2', '장치가 돌아오면 다시 고른다');
  equal(app.state().isRunning, false, '자동으로 다시 연결하지는 않는다');
  app.useToastStore.getState().clear();
}
{
  // 권한 전 목록에서는 연주 중이어도 분실로 보지 않는다
  const app = await loadStore({ inputs: [MIC1, MIC2] });
  await app.state().loadDevices();
  await app.state().setSelectedDevice('id-2');
  await app.state().start();
  equal(app.state().isRunning, true, '연결된다');
  app.world.inputs = [dev('', '')];
  await app.state().loadDevices();
  equal(app.state().isRunning, true, '목록이 id 를 못 주는 동안은 세션을 끊지 않는다');
  await app.state().stop();
  app.useToastStore.getState().clear();
}

// 2-6. 연결할 때: 저장된 장치가 없으면 기본 장치로 연결하고 한 번만 안내한다
{
  const app = await loadStore({ io: { devices: { input: REM2, output: null } }, inputs: [MIC1] });
  await app.state().loadDevices();
  await app.state().start();
  deepEqual(app.world.startCalls, [null], '목록에 없는 저장된 장치는 열어 보지 않고 기본 장치로 연결한다');
  equal(app.toasts().length, 1, '안내가 하나 뜬다');
  equal(app.toasts()[0].message, app.ko.connect.fellBackToDefault, '안내 문구');
  equal(app.toasts()[0].kind, 'warning', '경고로 띄운다');
  await app.state().stop();
  await settle();
  app.useToastStore.getState().clear();
  await app.state().start();
  equal(app.toasts().length, 0, '같은 장치에 대해서는 다시 안내하지 않는다');
  await app.state().stop();
  await settle();

  // 장치가 돌아왔다가 다시 사라지면 새로 안내한다
  app.world.inputs = [MIC1, MIC2];
  await app.state().loadDevices();
  equal(app.state().selectedDeviceId, 'id-2', '돌아온 장치를 다시 고른다');
  app.world.inputs = [MIC1];
  await app.state().loadDevices();
  await app.state().start();
  equal(app.toasts().length, 1, '다시 사라진 뒤의 연결에서는 다시 안내한다');
  await app.state().stop();
  app.useToastStore.getState().clear();
}
{
  // 기억한 장치가 목록에 있으면 안내가 없다. 권한 전(빈 id 목록)에도 안내하지 않는다.
  const present = await loadStore({ io: { devices: { input: REM2, output: null } }, inputs: [MIC1, MIC2] });
  await present.state().loadDevices();
  await present.state().start();
  equal(present.toasts().length, 0, '장치가 있으면 안내가 없다');
  await present.state().stop();

  const blank = await loadStore({ io: { devices: { input: REM2, output: null } }, inputs: [dev('', '')] });
  await blank.state().loadDevices();
  await blank.state().start();
  deepEqual(blank.world.startCalls, ['id-2'], '권한 전에는 기억한 id 로 먼저 연결해 본다');
  equal(blank.toasts().length, 0, '권한 전에는 안내가 없다');
  await blank.state().stop();
  present.useToastStore.getState().clear();
  blank.useToastStore.getState().clear();
}

// 2-7. 출력 장치: 옛 키와 새 저장값
{
  const legacyOnly = await loadStore({ legacyOutput: 'out-1' });
  equal(legacyOnly.state().selectedOutputDeviceId, 'out-1', '옛 키만 있어도 읽는다');
  deepEqual(legacyOnly.state().rememberedOutput, { id: 'out-1', label: '' }, '이름은 모른다');

  const both = await loadStore({ io: { devices: { input: null, output: LABELED } }, legacyOutput: 'out-2' });
  deepEqual(both.state().rememberedOutput, LABELED, '두 값이 같으면 이름이 있는 새 저장값');

  const conflict = await loadStore({ io: { devices: { input: null, output: LABELED } }, legacyOutput: 'out-3' });
  deepEqual(conflict.state().rememberedOutput, { id: 'out-3', label: '' }, '어긋나면 옛 키(옛 빌드로 돌아가 다시 고른 것)');
  equal(conflict.state().selectedOutputDeviceId, 'out-3', '선택도 옛 키를 따른다');

  const cleared = await loadStore({ io: { devices: { input: null, output: LABELED } }, legacyOutput: '' });
  equal(cleared.state().rememberedOutput, null, '옛 키가 빈 문자열이면 시스템 기본 출력');
}

// 2-8. 출력 장치 목록 맞추기(쉬는 중)
{
  const app = await loadStore({
    io: { devices: { input: null, output: { id: 'out-2', label: 'Speakers' } } },
    legacyOutput: 'out-2',
    outputs: [dev('out-1', 'Phones'), dev('new-out', 'Speakers')],
  });
  await app.state().loadDevices();
  equal(app.state().selectedOutputDeviceId, 'new-out', '출력: id 가 바뀐 장치를 이름으로 찾는다');
  deepEqual(app.state().rememberedOutput, { id: 'new-out', label: 'Speakers' }, '출력: 기억의 id 도 바뀐다');
  deepEqual(app.world.outputSets, ['new-out'], '출력: 엔진에도 새 id 를 알린다');
  equal(storage.get('guitar-pedalboard:output-device'), 'new-out', '출력: 옛 키도 맞춘다');

  app.world.outputs = [dev('out-1', 'Phones')];
  await app.state().loadDevices();
  equal(app.state().selectedOutputDeviceId, '', '출력: 사라졌으면 시스템 기본 출력');
  deepEqual(app.state().rememberedOutput, { id: 'new-out', label: 'Speakers' }, '출력: 기억은 남긴다');
  equal(app.world.outputSets.at(-1), '', '출력: 엔진도 기본 출력으로');

  app.world.outputs = [dev('out-1', 'Phones'), dev('new-out', 'Speakers')];
  await app.state().loadDevices();
  equal(app.state().selectedOutputDeviceId, 'new-out', '출력: 돌아오면 다시 고른다');
}
{
  // 연주 중에는 출력 선택을 건드리지 않는다
  const app = await loadStore({ io: { devices: { input: null, output: { id: 'out-2', label: 'Speakers' } } }, legacyOutput: 'out-2', inputs: [MIC1], outputs: [dev('out-2', 'Speakers')] });
  await app.state().loadDevices();
  await app.state().start();
  app.world.outputs = [];
  app.world.outputSets.length = 0;
  await app.state().loadDevices();
  equal(app.state().selectedOutputDeviceId, 'out-2', '연주 중에는 출력 선택을 바꾸지 않는다');
  deepEqual(app.world.outputSets, [], '연주 중에는 엔진의 출력도 바꾸지 않는다');
  await app.state().stop();
  app.useToastStore.getState().clear();
}

// 2-9. 출력 장치 폴백 안내
{
  const app = await loadStore({ io: { devices: { input: null, output: { id: 'out-2', label: 'Speakers' } } }, legacyOutput: 'out-2', inputs: [MIC1], outputs: [dev('out-2', 'Speakers')] });
  await app.state().loadDevices();
  app.world.outputFellBack = true; // 엔진이 setSinkId 실패로 기본 출력에 두었다
  await app.state().start();
  equal(app.state().isRunning, true, '출력 장치를 못 써도 연결은 된다');
  equal(app.state().error, null, '오류 문구가 없다');
  equal(app.state().selectedOutputDeviceId, '', '선택이 시스템 기본 출력으로 돌아온다');
  deepEqual(app.state().rememberedOutput, { id: 'out-2', label: 'Speakers' }, '기억은 남긴다');
  const notice = app.toasts().find((toast) => toast.key === 'output-fallback');
  ok(notice, '출력 폴백 안내가 뜬다');
  equal(notice.message, app.ko.devices.outputFellBack, '안내 문구');
  equal(notice.kind, 'warning', '경고');
  await app.state().stop();
  await settle();
  app.useToastStore.getState().clear();
  await app.state().start();
  equal(app.toasts().length, 0, '다음 연결에서는 되풀이하지 않는다');
  await app.state().stop();
  app.useToastStore.getState().clear();
}
{
  // 목록에서 이미 없다고 판단한 출력 장치도 한 번 안내한다
  const app = await loadStore({ io: { devices: { input: null, output: { id: 'out-9', label: 'Gone Speakers' } } }, legacyOutput: 'out-9', inputs: [MIC1], outputs: [dev('out-1', 'Phones')] });
  await app.state().loadDevices();
  equal(app.state().selectedOutputDeviceId, '', '없는 출력 장치는 기본 출력으로');
  await app.state().start();
  ok(app.toasts().some((toast) => toast.key === 'output-fallback'), '목록에 없어도 연결할 때 안내한다');
  await app.state().stop();
  app.useToastStore.getState().clear();
}

// 2-10. 읽기 순서: 늦게 끝난 옛 읽기는 새 읽기를 덮지 않는다
{
  const app = await loadStore({ inputs: [MIC1] });
  let release;
  app.world.inputGate = new Promise((resolve) => { release = resolve; });
  const slow = app.state().loadDevices(); // MIC1 만 보이는 옛 목록을 쥔 채 기다린다
  await settle();
  app.world.inputGate = null;
  app.world.inputs = [MIC1, MIC2];
  await app.state().loadDevices();
  deepEqual(app.state().devices.map((device) => device.deviceId), ['id-1', 'id-2'], '새 읽기의 결과가 올라간다');
  release();
  await slow;
  deepEqual(app.state().devices.map((device) => device.deviceId), ['id-1', 'id-2'], '늦게 끝난 옛 읽기는 결과를 버린다');
}

// 2-11. devicechange 감시: 스토어가 한 번만 등록하고 연달아 온 신호는 한 번만 읽는다
{
  const app = await loadStore({ inputs: [MIC1, MIC2] });
  equal(app.target.listeners.size, 1, '스토어가 devicechange 를 하나 듣는다');
  const before = app.world.inputReads;
  for (let index = 0; index < 6; index += 1) app.target.fire();
  await delay(400);
  equal(app.world.inputReads - before, 1, '연달아 온 6번의 신호가 입력 목록을 한 번만 읽게 한다');
  ok(app.world.outputReads >= 1, '출력 목록도 같이 읽는다');
  deepEqual(app.state().devices.map((device) => device.deviceId), ['id-1', 'id-2'], '읽은 목록이 올라간다');
  app.world.inputs = [MIC1];
  app.target.fire();
  await delay(400);
  deepEqual(app.state().devices.map((device) => device.deviceId), ['id-1'], '장치가 빠지면 새로고침을 누르지 않아도 목록이 바뀐다');
}

// ---------------------------------------------------------------------------------------------
// 3. 엔진: 저장된 출력 장치를 쓰지 못하면 연결을 막지 않는다
// ---------------------------------------------------------------------------------------------
{
  const app = await loadStore();
  const engine = app.engine;
  const apply = (context) => engine.applyOutputDevice(context);
  // loadStore 는 스토어 시험을 위해 consumeOutputFallback 을 가짜로 바꿔 두었다. 여기서는 실제 메서드를 쓴다.
  const consume = () => Object.getPrototypeOf(engine).consumeOutputFallback.call(engine);

  engine.outputDeviceId = '';
  await apply({ setSinkId: async () => { throw new Error('boom'); } });
  equal(consume(), false, '장치를 고르지 않았으면 setSinkId 를 부르지도 않는다');

  const calls = [];
  engine.outputDeviceId = 'out-2';
  await apply({ setSinkId: async (id) => { calls.push(id); } });
  deepEqual(calls, ['out-2'], '저장된 출력 장치로 보낸다');
  equal(consume(), false, '성공하면 폴백이 아니다');
  equal(engine.outputDeviceId, 'out-2', '성공하면 저장된 장치를 유지한다');

  engine.outputDeviceId = 'gone';
  await apply({ setSinkId: async () => { throw new DOMException('Device not found', 'NotFoundError'); } });
  equal(consume(), true, '장치를 열 수 없으면 폴백으로 알려 준다');
  equal(consume(), false, '폴백은 한 번만 알려 준다');
  equal(engine.outputDeviceId, '', '시스템 기본 출력으로 둔다');

  engine.outputDeviceId = 'out-2';
  await apply({});
  equal(consume(), true, 'setSinkId 가 없는 컨텍스트도 폴백(연결을 막지 않는다)');
}

// ---------------------------------------------------------------------------------------------
// 4. 소스 단언
// ---------------------------------------------------------------------------------------------
const storeSource = await read('src/store/audioStore.ts');
const selectorSource = await read('src/components/DeviceSelector.tsx');
const panelSource = await read('src/components/ConnectGuitarPanel.tsx');
const engineSource = await read('src/audio/AudioEngine.ts');
const koSource = await read('src/i18n/ko.ts');
const design = await read('docs/refactoring-design.md');

ok(storeSource.includes('watchDeviceChanges(navigator.mediaDevices'), '스토어가 devicechange 를 지켜본다');
ok(storeSource.includes('reconcileInputSelection('), '선택 맞추기는 DeviceManager 의 함수로 한다');
ok(storeSource.includes('const ticket = ++deviceLoadTicket') && storeSource.includes('ticket !== deviceLoadTicket'), '늦은 읽기를 버리는 차례 표가 있다');
ok(!storeSource.includes('persistIoSettings({'), '입출력 설정 저장은 ioSettingsOf 한 곳으로 모은다(필드를 빠뜨리지 않는다)');
ok(storeSource.includes('ioSettingsOf('), 'ioSettingsOf 를 쓴다');
ok(storeSource.includes('chooseRememberedOutput('), '출력 장치는 옛 키와 새 저장값을 함께 읽는다');
ok(storeSource.includes('consumeOutputFallback()'), '연결한 뒤 출력 폴백을 알린다');
ok(!panelSource.includes("addEventListener('devicechange'"), '패널 컴포넌트는 devicechange 를 따로 듣지 않는다');
ok(!selectorSource.includes('이 브라우저는 출력 장치 선택을 지원하지 않습니다'), '예전 미지원 문구가 남지 않았다');
ok(selectorSource.includes('ko.devices.outputUnsupported'), '미지원 안내는 카탈로그 문구를 쓴다');
ok(selectorSource.includes('rememberedInput?.label'), '목록에 없는 저장된 입력 장치도 이름으로 보인다');
ok(!engineSource.includes('선택한 출력 장치에 연결할 수 없습니다'), '저장된 출력 장치를 못 써도 연결을 막는 오류를 던지지 않는다');
equal(engineSource.split('await this.applyOutputDevice(context)').length - 1, 2, '장치·파일 시작 둘 다 같은 출력 적용 함수를 쓴다');

const outputGuide = '출력 장치는 시스템 설정에서 바꿔 주세요';
const inputFallback = '저장된 입력 장치를 찾지 못해 기본 장치로 연결했습니다';
ok(design.includes(outputGuide), '설계서에 출력 미지원 안내 문구가 있다');
ok(design.includes(inputFallback), '설계서에 입력 폴백 안내 문구가 있다');
ok(koSource.includes(`'${outputGuide}.'`), '카탈로그의 출력 미지원 안내가 설계서 문구다');
ok(koSource.includes(`'${inputFallback}.'`), '카탈로그의 입력 폴백 안내가 설계서 문구다');

console.log(`통과 ${checks}건 — S2.13 입출력 장치 자동 관리(DeviceManager·스토어·엔진 폴백) 시험`);
