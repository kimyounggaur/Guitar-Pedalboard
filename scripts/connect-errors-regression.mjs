// S2.3 연결 오류 안내(설계서 4.13, 보고서 R2-7) 시험.
//   1. 분류·문구: 오류 이름 → 4.13 표의 행. 표의 글자는 설계서 문서에서 직접 읽어 카탈로그(ko.ts)와 견준다.
//      영어 원문('Permission denied' 등)은 어떤 오류에서도 화면 문구에 새지 않는다.
//   2. 기본 장치 재시도 판정: 골라 둔 장치가 없을 때(OverconstrainedError·NotFoundError)만 다시 시도한다.
//   3. 스토어의 연결 흐름: 실제 AudioEngine·useAudioStore 를 묶고 엔진의 입력만 가짜로 바꿔 돌린다 —
//      오류 문구, 기본 장치로 다시 연결 + 안내 토스트 + 선택 초기화 + 기본 장치의 채널 설정, 한 번만 안내.
//   4. 소스 단언: 엔진이 워클릿 로드 실패와 비보안 출처를 구별해 던지고, 화면의 오류 문단이 role="alert" 이다.
// 브라우저에서 화면에 실제로 보이는지는 e2e E-07 이 본다.
import assert from 'node:assert/strict';
import { Buffer, File } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// Node 의 전역 DOMException(브라우저의 getUserMedia 오류와 같은 모양). scripts 에는 ESLint 전역 설정이 없어 이름을 직접 꺼내 쓴다.
const { DOMException } = globalThis;

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const deepEqual = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

const src = (relative) => fileURLToPath(new URL(`../src/${relative}`, import.meta.url));
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

// ---------------------------------------------------------------------------------------------
// 1. 분류·문구
// ---------------------------------------------------------------------------------------------
const pureBundle = await build({
  stdin: {
    contents: [
      "export { audioErrorMessage, classifyConnectError, connectErrorMessage, shouldRetryWithDefaultInput, WorkletLoadError } from './audio/engine/errors.ts';",
      "export { ko } from './i18n/ko.ts';",
    ].join('\n'),
    resolveDir: src(''),
    sourcefile: 'connect-errors-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const { audioErrorMessage, classifyConnectError, connectErrorMessage, shouldRetryWithDefaultInput, WorkletLoadError, ko } = await import(
  `data:text/javascript;base64,${Buffer.from(pureBundle.outputFiles[0].text).toString('base64')}`
);

// 설계서 4.13 의 표를 문서에서 직접 읽는다. 문서의 글자가 바뀌면 이 시험이 알려 준다.
const design = await read('docs/refactoring-design.md');
const tableStart = design.indexOf('연결 오류 안내(R2-7):');
const tableEnd = design.indexOf('### 4.14', tableStart);
ok(tableStart > 0 && tableEnd > tableStart, '설계서에서 4.13 연결 오류 안내 표를 찾지 못했습니다');
const designRows = design
  .slice(tableStart, tableEnd)
  .split('\n')
  .filter((line) => line.startsWith('| ') && !line.startsWith('| 오류 이름') && !line.startsWith('|---'))
  .map((line) => line.split('|').slice(1, -1).map((cell) => cell.trim()));
equal(designRows.length, 8, '4.13 표는 8행(오류 이름 6 + 워클릿 로드 실패 + 그 밖)이어야 합니다');
const designByName = new Map(designRows.map(([name, , text]) => [name, text]));
/** 표의 안내 칸에서 따옴표 안의 글을 꺼낸다. 따옴표가 겹친 행(OverconstrainedError)은 마지막 따옴표 글이다. */
const quoted = (cell) => {
  const matches = [...cell.matchAll(/'([^']+)'/g)].map((match) => match[1]);
  return matches.at(-1);
};

const catalogByDesignName = {
  NotAllowedError: ko.connect.notAllowed,
  NotFoundError: ko.connect.notFound,
  NotReadableError: ko.connect.notReadable,
  OverconstrainedError: ko.connect.fellBackToDefault,
  SecurityError: ko.connect.security,
  AbortError: ko.connect.abort,
  '워클릿 로드 실패': ko.connect.workletLoad,
};
for (const [name, catalogText] of Object.entries(catalogByDesignName)) {
  ok(designByName.has(name), `설계서 표에 ${name} 행이 있어야 합니다`);
  equal(catalogText, quoted(designByName.get(name)), `${name}: 카탈로그 문구가 설계서 4.13 과 같아야 합니다`);
}
const designOther = quoted(designRows.find(([name]) => name === '그 밖')[2]);
equal(ko.connect.other('{name}'), designOther, "'그 밖' 행: 오류 이름 자리({name})까지 설계서와 같아야 합니다");

// 이름 → 행. 옛 브라우저가 쓰던 이름도 같은 행이다.
const kinds = [
  ['NotAllowedError', 'notAllowed'],
  ['PermissionDeniedError', 'notAllowed'],
  ['NotFoundError', 'notFound'],
  ['DevicesNotFoundError', 'notFound'],
  ['NotReadableError', 'notReadable'],
  ['TrackStartError', 'notReadable'],
  ['OverconstrainedError', 'overconstrained'],
  ['ConstraintNotSatisfiedError', 'overconstrained'],
  ['SecurityError', 'security'],
  ['AbortError', 'abort'],
  ['WorkletLoadError', 'workletLoad'],
  ['TypeError', 'other'],
  ['NotSupportedError', 'other'],
  ['InvalidStateError', 'other'],
  ['Error', 'other'],
];
for (const [name, kind] of kinds) {
  equal(classifyConnectError(new DOMException('x', name)), kind, `${name} → ${kind}`);
  equal(classifyConnectError({ name }), kind, `${name}: 다른 창에서 온 오류처럼 이름만 있어도 같다`);
}
for (const value of [undefined, null, 42, 'NotAllowedError', {}, { name: 42 }, { name: '' }, []]) {
  equal(classifyConnectError(value), 'other', `이름이 없는 값(${JSON.stringify(value) ?? 'undefined'})은 그 밖`);
}

// 하네스(e2e/helpers/mocks.ts)의 getUserMedia 모의 7종과 같은 이름·영어 원문. 어느 것도 화면에 영어 원문이 나오면 안 된다.
const harnessErrors = [
  ['NotAllowedError', 'Permission denied', ko.connect.notAllowed],
  ['NotFoundError', 'Requested device not found', ko.connect.notFound],
  ['NotReadableError', 'Could not start audio source', ko.connect.notReadable],
  ['OverconstrainedError', 'The constraints could not be satisfied by the available devices.', ko.connect.notFound],
  ['SecurityError', 'getUserMedia is not allowed in this context', ko.connect.security],
  ['AbortError', 'Starting audio source failed', ko.connect.abort],
  ['TypeError', 'Failed to execute getUserMedia on MediaDevices', ko.connect.other('TypeError')],
];
const hasLatinLetters = (text) => /[A-Za-z]/.test(text.replaceAll('https', ''));
for (const [name, englishMessage, expected] of harnessErrors) {
  const error = name === 'TypeError' ? new TypeError(englishMessage) : new DOMException(englishMessage, name);
  const message = connectErrorMessage(error);
  equal(message, expected, `${name}: 4.13 의 문구`);
  ok(!message.includes(englishMessage), `${name}: 영어 원문이 문구에 없다`);
  ok(!audioErrorMessage(error).includes(englishMessage), `${name}: 연결이 아닌 안내에도 영어 원문이 없다`);
  // 영어 글자는 'https'(SecurityError 문구)와 '그 밖' 행의 오류 이름에만 있다.
  if (name !== 'TypeError') ok(!hasLatinLetters(message), `${name}: 문구에 영어 글자가 없다(https 제외): ${message}`);
}

// 표에 없는 오류(그 밖) — 이름을 괄호에 적는다. 이름을 모르면 '알 수 없음'. 영어 원문은 절대 쓰지 않는다.
equal(connectErrorMessage(new RangeError('boom')), '연결하지 못했습니다(오류: RangeError). 페이지를 새로 고친 뒤 다시 시도해 주세요.', '그 밖: 오류 이름');
equal(connectErrorMessage('boom'), '연결하지 못했습니다(오류: 알 수 없음). 페이지를 새로 고친 뒤 다시 시도해 주세요.', '문자열이 던져져도 영어 원문이 새지 않는다');
equal(connectErrorMessage(undefined), '연결하지 못했습니다(오류: 알 수 없음). 페이지를 새로 고친 뒤 다시 시도해 주세요.', 'undefined');
equal(connectErrorMessage(new Error('이 브라우저는 오디오 입력을 지원하지 않습니다.')), '이 브라우저는 오디오 입력을 지원하지 않습니다.', '엔진이 직접 만든 한국어 오류는 그대로 보인다');
equal(connectErrorMessage(new DOMException('오디오 시작 요청이 취소되었습니다.', 'AbortError')), ko.connect.abort, '이름이 표에 있으면 메시지가 한국어여도 표의 문구를 쓴다');

// 워클릿 로드 실패: 브라우저는 addModule 실패를 AbortError 로 알린다 → 엔진이 WorkletLoadError 로 감싸야 표의 다른 행으로 나온다.
const addModuleFailure = new DOMException("Unable to load a worklet's module.", 'AbortError');
equal(classifyConnectError(addModuleFailure), 'abort', '감싸지 않은 addModule 실패는 장치 시작 실패와 구별되지 않는다');
const wrapped = new WorkletLoadError({ cause: addModuleFailure });
ok(wrapped instanceof Error, 'WorkletLoadError 는 Error 다');
equal(wrapped.name, 'WorkletLoadError', '이름');
equal(wrapped.cause, addModuleFailure, '원인을 보존한다');
equal(classifyConnectError(wrapped), 'workletLoad', '분류');
equal(connectErrorMessage(wrapped), ko.connect.workletLoad, '워클릿 로드 실패의 문구');
equal(audioErrorMessage(wrapped), ko.connect.workletLoad, '음원 파일 시작 중의 워클릿 실패도 같은 문구');

// 연결이 아닌 작업: 마이크 문구를 쓰지 않는다(음원 파일 재생 거부도 NotAllowedError 다).
equal(audioErrorMessage(new DOMException("play() failed because the user didn't interact with the document first.", 'NotAllowedError')), ko.audio.startFailed, '파일 재생 거부에 마이크 권한 문구를 쓰지 않는다');
equal(audioErrorMessage(new Error('오디오 파일만 업로드할 수 있습니다.')), '오디오 파일만 업로드할 수 있습니다.', '한국어 오류는 그대로');
equal(audioErrorMessage(new Error('Failed to decode')), ko.audio.startFailed, '영어 원문은 기본 안내로');
equal(audioErrorMessage(undefined), ko.audio.startFailed, 'undefined');

// ---------------------------------------------------------------------------------------------
// 2. 기본 장치 재시도 판정
// ---------------------------------------------------------------------------------------------
const retryCases = [
  ['OverconstrainedError', 'ghost', true],
  ['ConstraintNotSatisfiedError', 'ghost', true],
  ['NotFoundError', 'ghost', true],
  ['DevicesNotFoundError', 'ghost', true],
  ['NotAllowedError', 'ghost', false],
  ['NotReadableError', 'ghost', false],
  ['SecurityError', 'ghost', false],
  ['AbortError', 'ghost', false],
  ['WorkletLoadError', 'ghost', false],
  ['TypeError', 'ghost', false],
  ['OverconstrainedError', '', false],
  ['OverconstrainedError', undefined, false],
  ['NotFoundError', '', false],
  ['NotFoundError', undefined, false],
];
for (const [name, deviceId, expected] of retryCases) {
  equal(shouldRetryWithDefaultInput({ name }, deviceId), expected, `${name} / 장치 ${JSON.stringify(deviceId)} → 다시 시도 ${expected}`);
}
equal(shouldRetryWithDefaultInput(undefined, 'ghost'), false, '오류 값이 이상해도 다시 시도하지 않는다');

// ---------------------------------------------------------------------------------------------
// 3. 스토어의 연결 흐름(실제 엔진·스토어, 입력만 가짜)
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

const runtimeBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export { useAudioStore } from './store/audioStore.ts';",
      "export { useToastStore } from './store/toastStore.ts';",
    ].join('\n'),
    resolveDir: src(''),
    sourcefile: 'connect-errors-runtime.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const { AudioEngine, useAudioStore, useToastStore } = await import(
  `data:text/javascript;base64,${Buffer.from(runtimeBundle.outputFiles[0].text).toString('base64')}`
);
const engine = AudioEngine.getInstance();

// 정리 절차(설계서 4.2절 ①~⑦)의 엔진 쪽 단계는 아무것도 하지 않는 가짜로 둔다.
engine.invalidatePendingStart = () => {};
engine.silenceOutput = async () => {};
engine.stopInput = () => {};
engine.pausePlayback = () => {};
engine.releaseGraph = () => {};
engine.closeContext = async () => {};
engine.advanceGeneration = () => {};
engine.listInputDevices = async () => [];
engine.getInputInfo = () => ({ deviceId: '', channelCount: 2, selectable: true });

/** engine.start(deviceId) 호출 기록. behaviors[deviceId ?? ''] 가 던질 오류(없으면 성공)다. */
const startCalls = [];
const channelModeCalls = [];
let behaviors = {};
engine.start = async (deviceId) => {
  startCalls.push(deviceId ?? null);
  const failure = behaviors[deviceId ?? ''];
  if (failure) throw failure();
};
engine.setInputChannelMode = (mode) => { channelModeCalls.push(mode); };
engine.setRememberedChannelDecision = () => {};
engine.startFile = async () => { throw new DOMException("play() failed because the user didn't interact with the document first.", 'NotAllowedError'); };

const toasts = () => useToastStore.getState().toasts;
const fail = (name, message) => () => new DOMException(message, name);
async function reset(selectedDeviceId = '') {
  if (useAudioStore.getState().isRunning) await useAudioStore.getState().stop();
  await new Promise((resolve) => setImmediate(resolve));
  useToastStore.getState().clear();
  startCalls.length = 0;
  channelModeCalls.length = 0;
  behaviors = {};
  useAudioStore.setState({
    selectedDeviceId,
    error: null,
    isRunning: false,
    isLoading: false,
    inputMode: 'idle',
    inputChannels: { ghost: { mode: 'ch2', decision: null }, default: { mode: 'stereo', decision: null } },
  });
}

// 3-1. 장치를 고르지 않았을 때: 오류 이름마다 표의 문구가 화면 상태(error)에 들어가고, 다시 시도하지 않는다.
for (const [name, englishMessage, expected] of harnessErrors) {
  await reset('');
  behaviors = { '': name === 'TypeError' ? () => new TypeError(englishMessage) : fail(name, englishMessage) };
  await useAudioStore.getState().start();
  const state = useAudioStore.getState();
  equal(state.error, expected, `start() ${name}: error 에 4.13 의 문구`);
  equal(state.isRunning, false, `start() ${name}: 연결되지 않은 상태로 돌아간다`);
  equal(state.isLoading, false, `start() ${name}: 로딩이 끝난다`);
  deepEqual(startCalls, [null], `start() ${name}: 장치를 고르지 않았으니 한 번만 시도한다`);
  equal(toasts().length, 0, `start() ${name}: 기본 장치 안내 토스트가 없다`);
}

// 3-2. 골라 둔 장치가 없을 때(OverconstrainedError): 기본 장치로 다시 연결하고 안내한다.
for (const name of ['OverconstrainedError', 'NotFoundError']) {
  await reset('ghost');
  behaviors = { ghost: fail(name, 'Requested device not found') };
  await useAudioStore.getState().start();
  const state = useAudioStore.getState();
  deepEqual(startCalls, ['ghost', null], `${name}: 골라 둔 장치로 먼저, 실패하면 기본 장치로 한 번 더`);
  equal(state.isRunning, true, `${name}: 기본 장치로 연결된다`);
  equal(state.error, null, `${name}: 오류 문구가 남지 않는다`);
  equal(state.selectedDeviceId, '', `${name}: 선택이 기본 장치로 돌아간다`);
  equal(state.inputChannelMode, 'stereo', `${name}: 기본 장치에 기억된 채널 설정이 올라간다`);
  deepEqual(channelModeCalls, ['ch2', 'stereo'], `${name}: 엔진에는 골라 둔 장치의 설정 → 기본 장치의 설정 순서`);
  equal(toasts().length, 1, `${name}: 안내는 하나`);
  equal(toasts()[0].message, ko.connect.fellBackToDefault, `${name}: 안내 문구`);
  equal(toasts()[0].kind, 'warning', `${name}: 경고로 띄운다(입력이 달라졌다)`);
  equal(toasts()[0].key, 'input-fallback', `${name}: 같은 키는 하나만 남는다`);

  // 다음 연결은 기본 장치 그대로 — 안내를 되풀이하지 않는다.
  await useAudioStore.getState().stop();
  await new Promise((resolve) => setImmediate(resolve));
  useToastStore.getState().clear();
  startCalls.length = 0;
  await useAudioStore.getState().start();
  deepEqual(startCalls, [null], `${name}: 다음 연결은 한 번에`);
  equal(toasts().length, 0, `${name}: 안내를 되풀이하지 않는다`);
  equal(useAudioStore.getState().isRunning, true, `${name}: 다음 연결도 된다`);
}

// 3-3. 기본 장치로도 실패하면 두 번째 오류의 문구를 보이고, 연결 안내는 없다.
await reset('ghost');
behaviors = { ghost: fail('OverconstrainedError', 'x'), '': fail('NotFoundError', 'Requested device not found') };
await useAudioStore.getState().start();
equal(useAudioStore.getState().error, ko.connect.notFound, '기본 장치도 없으면 입력 장치 없음 문구');
equal(useAudioStore.getState().isRunning, false, '연결되지 않는다');
deepEqual(startCalls, ['ghost', null], '두 번만 시도한다(무한 반복 없음)');
equal(toasts().length, 0, '연결하지 못했으니 기본 장치로 연결했다는 안내는 없다');
equal(useAudioStore.getState().selectedDeviceId, 'ghost', '선택은 고른 장치에 그대로 있다');
equal(useAudioStore.getState().inputChannelMode, 'ch2', '실패하면 채널 설정도 고른 장치의 것으로 되돌아온다(기본 장치의 설정이 남지 않는다)');
deepEqual(channelModeCalls, ['ch2', 'stereo', 'ch2'], '엔진에는 고른 장치 → 기본 장치 → 고른 장치 순서로 올린다');

await reset('ghost');
behaviors = { ghost: fail('OverconstrainedError', 'x'), '': fail('NotAllowedError', 'Permission denied') };
await useAudioStore.getState().start();
equal(useAudioStore.getState().error, ko.connect.notAllowed, '두 번째 시도의 오류가 보인다');
equal(useAudioStore.getState().inputChannelMode, 'ch2', '두 번째 시도가 다른 오류로 실패해도 채널 설정은 고른 장치의 것이다');

// 3-4. 장치가 있는데 못 여는 오류는 다시 시도하지 않는다(다른 장치로 몰래 바꾸지 않는다).
for (const name of ['NotAllowedError', 'NotReadableError', 'SecurityError', 'AbortError']) {
  await reset('ghost');
  behaviors = { ghost: fail(name, 'English raw message') };
  await useAudioStore.getState().start();
  deepEqual(startCalls, ['ghost'], `${name}: 골라 둔 장치가 있어도 다시 시도하지 않는다`);
  equal(useAudioStore.getState().selectedDeviceId, 'ghost', `${name}: 선택을 바꾸지 않는다`);
  equal(toasts().length, 0, `${name}: 기본 장치 안내가 없다`);
  ok(!useAudioStore.getState().error.includes('English raw message'), `${name}: 영어 원문이 없다`);
}

// 3-5. 연결 중에 장치를 바꾸는 경우(setSelectedDevice)도 같다.
await reset('');
await useAudioStore.getState().start();
equal(useAudioStore.getState().isRunning, true, '먼저 기본 장치로 연결');
startCalls.length = 0;
useToastStore.getState().clear();
behaviors = { ghost: fail('OverconstrainedError', 'x') };
await useAudioStore.getState().setSelectedDevice('ghost');
deepEqual(startCalls, ['ghost', null], '장치를 바꿀 때도 기본 장치로 다시 연결');
equal(useAudioStore.getState().isRunning, true, '연결이 이어진다');
equal(useAudioStore.getState().selectedDeviceId, '', '선택이 기본 장치로');
equal(toasts().length, 1, '안내 하나');
equal(toasts()[0].message, ko.connect.fellBackToDefault, '안내 문구');

await reset('');
await useAudioStore.getState().start();
behaviors = { ghost: fail('NotReadableError', 'x') };
await useAudioStore.getState().setSelectedDevice('ghost');
equal(useAudioStore.getState().error, ko.connect.notReadable, '장치를 바꾸다 실패하면 표의 문구');
equal(useAudioStore.getState().isRunning, false, '연결이 풀린다');

// 3-6. 음원 파일 시작 실패는 마이크 문구를 쓰지 않는다.
await reset('');
await useAudioStore.getState().startFile(new File(['x'], 'a.wav', { type: 'audio/wav' }));
equal(useAudioStore.getState().error, ko.audio.startFailed, '파일 재생 거부 → 기본 안내(마이크 문구 아님)');

// 3-7. 워클릿 로드 실패는 장치 시작 실패와 다른 문구다.
await reset('');
behaviors = { '': () => new WorkletLoadError({ cause: addModuleFailure }) };
await useAudioStore.getState().start();
equal(useAudioStore.getState().error, ko.connect.workletLoad, '워클릿 로드 실패 문구');

// ---------------------------------------------------------------------------------------------
// 4. 소스 단언
// ---------------------------------------------------------------------------------------------
const [engineSource, storeSource, panelSource, errorsSource] = await Promise.all([
  read('src/audio/AudioEngine.ts'),
  read('src/store/audioStore.ts'),
  read('src/components/ConnectGuitarPanel.tsx'),
  read('src/audio/engine/errors.ts'),
]);
const count = (text, needle) => text.split(needle).length - 1;
ok(engineSource.includes('throw new WorkletLoadError({ cause: error })'), '엔진: addModule 실패를 WorkletLoadError 로 감싼다');
ok(engineSource.includes("globalThis.isSecureContext === false") && engineSource.includes("'SecurityError'"), '엔진: 비보안 출처는 SecurityError 로 던진다');
ok(engineSource.includes('throw new Error(ko.engine.inputUnsupported)'), '엔진: 보안 출처인데 입력이 없으면 브라우저 탓으로 안내한다');
equal(ko.engine.inputUnsupported, '이 브라우저는 오디오 입력을 지원하지 않습니다.', '엔진: 그 안내 문구');
ok(!storeSource.includes('toErrorMessage'), '스토어: 옛 toErrorMessage 가 없다');
equal(count(storeSource, 'connectErrorMessage(error)'), 2, '스토어: 연결(start)·장치 바꾸기(setSelectedDevice)만 4.13 문구를 쓴다');
equal(count(storeSource, 'audioErrorMessage(error)'), 4, '스토어: 장치 목록·음원 파일 시작·재생·녹음은 연결이 아닌 안내를 쓴다');
equal(count(storeSource, 'startDeviceSession('), 3, '스토어: 연결 두 곳이 같은 함수를 쓴다(정의 1 + 호출 2)');
ok(storeSource.includes('shouldRetryWithDefaultInput(error, deviceId)'), '스토어: 다시 시도 판정은 errors.ts 의 함수');
ok(storeSource.includes('ko.connect.fellBackToDefault'), '스토어: 안내 문구는 카탈로그에서');
ok(panelSource.includes('<p ref={errorRef} className="error-message" role="alert">{error}</p>'), '화면: 오류 문단이 role="alert" 이다(스크린리더가 바로 읽는다)');
equal(count(panelSource, 'className="error-message"'), 1, '화면: 오류 문단은 한 군데에서만 만든다(연결된 상태와 아닌 상태가 같은 문단을 쓴다)');
equal(count(panelSource, '{inMenu ? null : errorNotice}'), 1, '화면: 휴대폰 도크의 입력 패널에서는 안내가 연결 버튼 줄 바로 아래에 있다');
ok(panelSource.indexOf('{inMenu ? null : errorNotice}') > panelSource.indexOf('className="connect-actions"'), '화면: 안내는 연결 버튼 줄 다음에 온다');
ok(panelSource.indexOf('{inMenu ? null : errorNotice}') < panelSource.indexOf('<FilePlayer />'), '화면: 안내는 음원 파일·안전 설정 묶음보다 위에 있다(휴대폰 도크에서 스크롤 아래로 밀리지 않는다)');
// 데스크톱 헤더 메뉴(AudioInputMenu)의 오류 문단은 소스 글자 읽기를 늘리지 않고 e2e(E-07)가 화면에서 확인한다.
ok(panelSource.includes("errorRef.current?.scrollIntoView({ block: 'nearest' })"), '화면: 새 오류가 생기면 보이는 곳까지 스크롤한다');
ok(!panelSource.includes('{error && <p className="error-message"'), '화면: 패널 맨 아래의 옛 오류 문단이 없다');
ok(!errorsSource.includes('error instanceof'), 'errors.ts: 오류를 instanceof 로 가르지 않는다(다른 창의 오류도 이름으로 가른다)');

console.log(`통과 ${checks}건 — S2.3 연결 오류 안내·기본 장치 재시도 회귀 시험`);
