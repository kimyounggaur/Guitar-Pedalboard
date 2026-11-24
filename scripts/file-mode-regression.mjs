// S2.6 음원 파일 모드(설계서 4.11 '파일 재생', 보고서 R2-5, E-10) 스토어 시험.
// 실제 AudioEngine·useAudioStore 를 묶고, 엔진의 파일 재생(`<audio>` 요소)만 가짜로 바꿔 '열어 둔 파일'의 생명 주기를 본다.
//   1. 파일 유지: 정지·Panic·끝남(반복 끔)으로 세션이 끝나도 File 은 남고 이름·전체 길이도 남는다. 위치·재생 상태만 처음으로 돌아간다.
//   2. 다시 재생: 세션이 끝나 있을 때의 재생은 같은 File 로 새 세션을 연다(엔진의 startFile 이 새 `<audio>` 요소·Object URL 을 만든다).
//   3. 파일을 놓는 때: 다른 파일을 열 때, '파일 닫기', 기타 연결(성공)만. 기타 연결이 실패하면 파일은 그대로, 파일 열기가 실패하면 열어 둔 파일이 없다.
//   4. 끝남: 반복을 끈 파일이 끝까지 재생돼도 세션은 끝나지 않고 파일도 그대로다(맨 끝에서 멈춘 상태).
//   5. 반복 재생 기본 켜짐, 켜고 끄는 값이 엔진에 전해진다. 탐색 막대의 절대 이동.
//   6. 소스 단언: 엔진이 세션마다 새 요소를 만들고 정리 때 이전 URL 을 해제하며, 파일 입력은 숨기고 한국어 버튼이 연다.
// 브라우저에서 실제로 되는지(새 요소·URL 해제·Space·화면)는 e2e E-10 이 본다.
import assert from 'node:assert/strict';
import { Buffer, File } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { setImmediate } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const deepEqual = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks += 1; };

const src = (relative) => fileURLToPath(new URL(`../src/${relative}`, import.meta.url));
const read = (relative) => readFile(new URL(`../${relative}`, import.meta.url), 'utf8');

const runtimeBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export { useAudioStore } from './store/audioStore.ts';",
      "export { useToastStore } from './store/toastStore.ts';",
    ].join('\n'),
    resolveDir: src(''),
    sourcefile: 'file-mode-runtime.ts',
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
const store = () => useAudioStore.getState();

// ---------------------------------------------------------------------------------------------
// 가짜 엔진: 세션마다 새 `<audio>` 요소(여기서는 객체 하나)를 만들고, 정리 때 놓는다.
// ---------------------------------------------------------------------------------------------
const DURATION = 60;
let element = null;
let elementsCreated = 0;
let loopSetting = true;
const log = { startFile: [], teardown: [], loop: [], seekTo: [] };
let failNextStartFile = false;
let failNextDeviceStart = false;

engine.invalidatePendingStart = () => {};
engine.silenceOutput = async () => { log.teardown.push('silence'); };
engine.stopInput = () => {};
engine.pausePlayback = () => { if (element) element.paused = true; };
engine.releaseGraph = () => { log.teardown.push('release'); element = null; };
engine.closeContext = async () => { log.teardown.push('close'); };
engine.advanceGeneration = () => {};
engine.listInputDevices = async () => [];
engine.getInputInfo = () => ({ deviceId: '', channelCount: 2, selectable: true });
engine.setInputChannelMode = () => {};
engine.setRememberedChannelDecision = () => {};
engine.start = async () => {
  if (failNextDeviceStart) {
    failNextDeviceStart = false;
    throw new Error('device failed');
  }
};
engine.startFile = async (file) => {
  log.startFile.push(file);
  if (failNextStartFile) {
    failNextStartFile = false;
    throw new Error('오디오 파일만 업로드할 수 있습니다.');
  }
  elementsCreated += 1;
  element = { file, currentTime: 0, duration: DURATION, paused: false, loop: loopSetting };
};
engine.readFilePlayback = () =>
  element
    ? { currentTime: element.currentTime, duration: element.duration, isPaused: element.paused }
    : { currentTime: 0, duration: 0, isPaused: true };
engine.playUploadedFile = async () => {
  if (!element) throw new Error('재생할 업로드 음원이 없습니다.');
  if (element.currentTime >= element.duration) element.currentTime = 0; // 끝에서 다시 재생하면 처음부터(브라우저의 동작)
  element.paused = false;
};
engine.pauseUploadedFile = () => { if (element) element.paused = true; };
engine.seekUploadedFile = (delta) => {
  if (element) element.currentTime = Math.min(Math.max(element.currentTime + delta, 0), element.duration);
};
engine.seekUploadedFileTo = (seconds) => {
  log.seekTo.push(seconds);
  if (element) element.currentTime = Math.min(Math.max(seconds, 0), element.duration);
};
engine.setFileLoop = (loop) => {
  log.loop.push(loop);
  loopSetting = loop;
  if (element) element.loop = loop;
};

const wav = (name) => new File(['audio'], name, { type: 'audio/wav' });

async function reset() {
  if (store().isRunning || store().inputMode !== 'idle') await store().stop();
  await new Promise((resolve) => setImmediate(resolve));
  await store().closeFile();
  store().setFileLoop(true);
  element = null;
  elementsCreated = 0;
  log.startFile.length = 0;
  log.teardown.length = 0;
  log.loop.length = 0;
  log.seekTo.length = 0;
  useToastStore.getState().clear();
  failNextStartFile = false;
  failNextDeviceStart = false;
  useAudioStore.setState({ error: null, isLoading: false });
}

// ---------------------------------------------------------------------------------------------
// 1. 처음 상태와 파일 열기
// ---------------------------------------------------------------------------------------------
// reset() 은 반복을 켜 놓고 시작하므로, 저장소·엔진이 처음부터 켜져 있는지는 그 전에 본다.
equal(store().fileLoop, true, "저장소 처음 값: '반복 재생' 기본 켜짐");
equal(Reflect.get(engine, 'fileLoop'), true, '엔진 처음 값: 반복 기본 켜짐');
await reset();
equal(store().uploadedFile, null, '처음에는 열어 둔 파일이 없다');
equal(store().uploadedFileName, null);
equal(store().fileLoop, true, "'반복 재생' 은 기본 켜짐");
equal(store().inputMode, 'idle');

const fileA = wav('a.wav');
await store().startFile(fileA);
equal(store().inputMode, 'file');
equal(store().isRunning, true);
equal(store().uploadedFile, fileA, '열어 둔 File 객체를 그대로 들고 있다');
equal(store().uploadedFileName, 'a.wav');
equal(store().fileDuration, DURATION);
equal(store().isFilePaused, false, '열자마자 재생');
equal(elementsCreated, 1);

// ---------------------------------------------------------------------------------------------
// 2. 정지해도 파일이 남는다. 다시 재생하면 같은 File 로 새 세션(새 요소)을 연다.
// ---------------------------------------------------------------------------------------------
element.currentTime = 33;
await store().stop();
equal(store().inputMode, 'idle', '정지하면 세션이 끝난다');
equal(store().isRunning, false);
equal(store().uploadedFile, fileA, '정지해도 파일은 남는다');
equal(store().uploadedFileName, 'a.wav', '이름도 남는다');
equal(store().fileDuration, DURATION, '전체 길이도 남아 화면이 0:00 / 1:00 으로 보인다');
equal(store().fileCurrentTime, 0, '위치는 처음으로 돌아간다');
equal(store().isFilePaused, true, '재생 버튼이 켜진다');
deepEqual(log.teardown, ['silence', 'release', 'close'], '정리 절차를 지나며 요소를 놓는다');
equal(element, null, '옛 요소는 놓였다');

await store().playFile();
equal(log.startFile.length, 2, '재생을 누르면 새 세션을 연다');
equal(log.startFile[1], fileA, '같은 File 로');
equal(elementsCreated, 2, '새 <audio> 요소');
equal(store().inputMode, 'file');
equal(store().isRunning, true);
equal(store().fileCurrentTime, 0, '처음부터');
equal(store().isFilePaused, false);
equal(store().uploadedFile, fileA);

// 같은 세션 안의 일시정지·재생은 새 세션이 아니다.
store().pauseFile();
equal(store().isFilePaused, true);
await store().playFile();
equal(log.startFile.length, 2, '일시정지 뒤 재생은 같은 세션이다');
equal(store().isFilePaused, false);

// Panic 도 파일은 남긴다.
store().panic();
await new Promise((resolve) => setImmediate(resolve));
equal(store().inputMode, 'idle');
equal(store().uploadedFile, fileA, 'Panic 뒤에도 파일은 남는다');
equal(store().uploadedFileName, 'a.wav');
await store().playFile();
equal(log.startFile.length, 3, 'Panic 뒤에도 재생으로 다시 시작한다');
equal(elementsCreated, 3);

// 열어 둔 파일이 없으면 재생은 아무 일도 하지 않는다(오류도 없다).
await reset();
await store().playFile();
equal(log.startFile.length, 0, '열린 파일이 없으면 세션을 열지 않는다');
equal(store().error, null);
equal(store().inputMode, 'idle');

// ---------------------------------------------------------------------------------------------
// 3. 끝남(반복 끔): 세션도 파일도 그대로, 맨 끝에서 멈춘 상태. 재생은 처음부터.
// ---------------------------------------------------------------------------------------------
await reset();
await store().startFile(fileA);
store().setFileLoop(false);
equal(store().fileLoop, false);
deepEqual(log.loop, [false], '반복 끔이 엔진에 전해진다');
equal(element.loop, false, '재생 중에도 바로 적용된다');
// 요소가 끝까지 재생돼 멈췄고 'ended' 가 왔다(브라우저가 하는 일).
element.currentTime = DURATION;
element.paused = true;
engine.playbackEndedHandler?.();
equal(store().inputMode, 'file', '끝나도 파일 세션은 그대로다');
equal(store().isRunning, true);
equal(store().uploadedFile, fileA, '끝나도 파일은 남는다');
equal(store().isFilePaused, true, '재생 버튼이 켜진다');
equal(store().fileCurrentTime, DURATION, '맨 끝에서 멈춘 위치가 화면에 간다');
deepEqual(log.teardown, [], '끝났다고 정리 절차를 돌리지 않는다');
equal(log.startFile.length, 1, '새 세션도 열지 않는다');
await store().playFile();
equal(log.startFile.length, 1, '끝에서 재생: 같은 세션(같은 요소)에서 처음부터');
equal(store().fileCurrentTime, 0, '처음부터 다시');
equal(store().isFilePaused, false);

// 새 파일은 반복 설정을 이어받는다(반복을 끄면 새 요소도 반복 없음).
store().setFileLoop(false);
await store().startFile(wav('b.wav'));
equal(element.loop, false, '반복을 끈 채 다른 파일을 열면 그 요소도 반복 없음');
store().setFileLoop(true);
equal(element.loop, true);

// 'ended' 가 파일 세션이 아닐 때 오면(늦게 온 이벤트) 아무것도 바꾸지 않는다.
await reset();
useAudioStore.setState({ fileCurrentTime: 7, isFilePaused: false });
engine.playbackEndedHandler?.();
equal(store().fileCurrentTime, 7, '파일 모드가 아니면 끝남 이벤트는 무시한다');

// ---------------------------------------------------------------------------------------------
// 4. 파일을 놓는 때
// ---------------------------------------------------------------------------------------------
// 4-1. 다른 파일을 열면 새 파일이 된다.
await reset();
await store().startFile(fileA);
const fileB = wav('b.wav');
await store().startFile(fileB);
equal(store().uploadedFile, fileB);
equal(store().uploadedFileName, 'b.wav');
equal(store().inputMode, 'file');

// 4-2. 열기가 실패하면 열어 둔 파일이 없다(이전 세션은 시작 실패의 정리 절차에서 이미 끝났다).
await reset();
await store().startFile(fileA);
failNextStartFile = true;
await store().startFile(wav('c.txt'));
equal(store().uploadedFile, null, '열지 못한 파일은 열어 둔 파일이 아니다');
equal(store().uploadedFileName, null);
equal(store().inputMode, 'idle');
equal(store().isRunning, false);
equal(store().error, '오디오 파일만 업로드할 수 있습니다.', '실패 안내는 그대로 보인다');

// 4-3. '파일 닫기': 재생 중이면 멈추고 파일을 놓는다.
await reset();
await store().startFile(fileA);
log.teardown.length = 0;
await store().closeFile();
equal(store().uploadedFile, null);
equal(store().uploadedFileName, null);
equal(store().inputMode, 'idle', '닫으면 재생도 멈춘다');
equal(store().isRunning, false);
deepEqual(log.teardown, ['silence', 'release', 'close'], '같은 정리 절차를 지난다');
equal(store().fileDuration, 0);
equal(store().fileCurrentTime, 0);
await store().playFile();
equal(log.startFile.length, 1, '닫은 파일은 다시 재생되지 않는다');

// 4-4. 세션이 끝난 뒤의 '파일 닫기'는 정리 절차를 다시 돌리지 않는다.
await reset();
await store().startFile(fileA);
await store().stop();
log.teardown.length = 0;
await store().closeFile();
equal(store().uploadedFile, null);
deepEqual(log.teardown, [], '이미 끝난 세션이라 할 일이 없다');

// 4-5. 기타를 연결하면(성공) 열어 둔 파일을 놓는다. 연결이 실패하면 그대로다.
await reset();
await store().startFile(fileA);
await store().stop();
failNextDeviceStart = true;
await store().start();
ok(store().error !== null, '연결 실패 안내');
equal(store().uploadedFile, fileA, '기타 연결에 실패하면 파일은 그대로다');
equal(store().uploadedFileName, 'a.wav');
useAudioStore.setState({ error: null });
await store().start();
equal(store().inputMode, 'device');
equal(store().isRunning, true);
equal(store().uploadedFile, null, '기타를 연결하면 파일을 놓는다');
equal(store().uploadedFileName, null);
// 기타가 연결돼 있는 동안 '파일 닫기'는 연결을 끊지 않는다.
log.teardown.length = 0;
await store().closeFile();
equal(store().inputMode, 'device', '파일 닫기는 기타 연결을 건드리지 않는다');
equal(store().isRunning, true);
deepEqual(log.teardown, [], '정리 절차도 돌지 않는다');
await store().stop();

// 4-6. 기타가 연결된 동안 파일을 열면 기타 연결은 파일 세션으로 바뀐다(기존 동작).
await reset();
await store().start();
await store().startFile(fileA);
equal(store().inputMode, 'file');
equal(store().uploadedFile, fileA);

// ---------------------------------------------------------------------------------------------
// 5. 탐색 막대
// ---------------------------------------------------------------------------------------------
await reset();
await store().startFile(fileA);
store().seekFileTo(25.5);
deepEqual(log.seekTo, [25.5], '막대 값이 그대로(절대 위치로) 엔진에 간다');
equal(store().fileCurrentTime, 25.5, '화면 위치가 곧바로 맞는다');
store().seekFile(10);
equal(store().fileCurrentTime, 35.5, '+10초');
store().seekFile(-10);
equal(store().fileCurrentTime, 25.5, '-10초');
store().seekFileTo(0);
equal(store().fileCurrentTime, 0);
store().seekFileTo(999);
equal(store().fileCurrentTime, DURATION, '끝을 넘으면 끝으로(엔진이 자른다)');

// 5-2. 진짜 엔진의 반복·절대 이동. 위에서 가짜로 바꾼 메서드를 원형에서 꺼내, 요소만 가짜인 객체에 호출한다.
{
  const fakeElement = { loop: true, currentTime: 10, duration: 60 };
  const self = { fileLoop: true, audioElement: fakeElement };
  AudioEngine.prototype.setFileLoop.call(self, false);
  equal(self.fileLoop, false, '엔진: 반복 설정을 기억한다(새 파일 세션에도 이어진다)');
  equal(fakeElement.loop, false, '엔진: 재생 중인 요소에도 바로 적용한다');
  AudioEngine.prototype.setFileLoop.call(self, true);
  equal(fakeElement.loop, true, '엔진: 다시 켜면 요소도 켜진다');
  const noElement = { fileLoop: true, audioElement: null };
  AudioEngine.prototype.setFileLoop.call(noElement, false);
  equal(noElement.fileLoop, false, '엔진: 요소가 없어도 설정은 남는다');

  const seek = (value, target = fakeElement) => {
    AudioEngine.prototype.seekUploadedFileTo.call({ audioElement: target }, value);
    return target.currentTime;
  };
  equal(seek(25.5), 25.5, '엔진: 절대 위치로 간다');
  equal(seek(999), 60, '엔진: 끝을 넘으면 길이로 자른다');
  equal(seek(-5), 0, '엔진: 0 아래는 0');
  equal(seek(Number.NaN, { currentTime: 7, duration: 60 }), 7, '엔진: 숫자가 아닌 값은 무시한다');
  equal(seek(Number.POSITIVE_INFINITY, { currentTime: 7, duration: 60 }), 7, '엔진: 무한대도 무시한다');
  equal(seek(1e6, { currentTime: 3, duration: Number.NaN }), 1e6, '엔진: 길이를 모르면 아래쪽만 자른다');
  equal(seek(-1, { currentTime: 3, duration: Number.NaN }), 0, '엔진: 길이를 몰라도 0 아래는 0');
  AudioEngine.prototype.seekUploadedFileTo.call({ audioElement: null }, 5);
  checks += 1; // 요소가 없어도 오류 없이 지나간다
}

// ---------------------------------------------------------------------------------------------
// 6. 소스 단언: 이 시험은 가짜 엔진이라 진짜 엔진·화면의 약속은 소스로도 붙들어 둔다.
// ---------------------------------------------------------------------------------------------
const [engineSource, storeSource, playerSource, panelSource, shortcutSource] = await Promise.all([
  read('src/audio/AudioEngine.ts'),
  read('src/store/audioStore.ts'),
  read('src/components/FilePlayer.tsx'),
  read('src/components/ConnectGuitarPanel.tsx'),
  read('src/components/GlobalKeyboardShortcuts.tsx'),
]);
const count = (text, needle) => text.split(needle).length - 1;
ok(engineSource.includes('private fileLoop = true;'), '엔진: 반복 재생 기본 켜짐');
ok(engineSource.includes('audioElement.loop = this.fileLoop;'), '엔진: 새 요소는 반복 설정을 이어받는다');
equal(count(engineSource, 'new Audio('), 1, '엔진: <audio> 요소는 파일 세션을 시작할 때만 만든다(세션마다 새 요소)');
ok(engineSource.includes("this.audioElement.removeAttribute('src');") && engineSource.includes('URL.revokeObjectURL(this.audioFileUrl);'), '엔진: 정리 때 옛 요소의 자원을 놓고 Object URL 을 해제한다');
ok(storeSource.includes('audioEngine.setFileLoop(loop);'), '스토어: 반복 설정을 엔진에 전한다');
ok(playerSource.includes('className="hidden-file-input"'), '화면: 파일 입력은 숨긴다(브라우저 기본 영문 버튼 노출 금지)');
ok(playerSource.includes('inputRef.current?.click()') && playerSource.includes('음원 파일 열기'), "화면: 한국어 버튼 '음원 파일 열기' 가 입력을 연다");
ok(playerSource.includes('파일 닫기') && playerSource.includes('반복 재생'), "화면: '파일 닫기'·'반복 재생'");
ok(panelSource.includes('<FilePlayer />'), '화면: 입력 패널이 플레이어를 그린다');
ok(!panelSource.includes('type="file"'), '화면: 패널에 기본 파일 입력이 남아 있지 않다');
ok(shortcutSource.includes('audioState.uploadedFile'), 'Space: 열어 둔 파일이 있으면 마이크 대신 파일을 튼다');

console.log(`통과 ${checks}건 — S2.6 음원 파일 모드(파일 유지·반복·끝남·탐색·열고 닫기) 스토어 시험`);
