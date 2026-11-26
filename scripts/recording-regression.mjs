import assert from 'node:assert/strict';
import { Blob, Buffer, File } from 'node:buffer';
import console from 'node:console';
import { setImmediate } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { openApp } from './lib/app-browser.mjs';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';
import { byClass, byRole, byTag, find, findAll, hasClass, textContent } from './lib/html-tree.mjs';
import { createSsrHarness, hostText } from './lib/ssr-harness.mjs';

// 아래에서 performance 를 시계 가짜로 바꾸므로 진짜는 따로 둔다(브라우저 검사의 fetch 는 진짜 performance 가 필요하다).
const realPerformance = globalThis.performance;

const helperBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [fileURLToPath(new URL('../src/audio/recording.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperBundle.outputFiles[0].text).toString('base64')}`;
const {
  createRecordingFilename, selectRecorderMimeType, recordingFormatFromMime, encodePcmWav, WavRecorder,
  DEFAULT_WAV_MAX_SECONDS, MAX_WAV_FRAMES, WAV_MAX_SECONDS_OPTIONS, normalizeWavBitDepth, normalizeWavMaxSeconds, wavFrameLimit,
} = await import(helperUrl);

assert.equal(
  selectRecorderMimeType((mimeType) => mimeType === 'audio/webm;codecs=opus'),
  'audio/webm;codecs=opus',
);
assert.equal(
  selectRecorderMimeType((mimeType) => mimeType === 'audio/webm'),
  'audio/webm',
);
assert.equal(selectRecorderMimeType(() => false), undefined);
assert.equal(selectRecorderMimeType(), undefined);
assert.equal(recordingFormatFromMime('audio/mp4;codecs=mp4a.40.2'), 'm4a');
assert.equal(recordingFormatFromMime('video/mp4'), 'mp4');
assert.equal(recordingFormatFromMime('audio/ogg;codecs=opus'), 'ogg');
assert.equal(recordingFormatFromMime('audio/webm;codecs=opus'), 'webm');
assert.equal(recordingFormatFromMime(''), 'unknown');
assert.equal(createRecordingFilename(new Date(2026, 8, 28), 'unknown'), 'pedalboard-20260928-000000', '형식을 모르면 확장자를 붙이지 않는다');
assert.equal(
  createRecordingFilename(new Date(2026, 8, 28, 7, 5, 9)),
  'pedalboard-20260928-070509.webm',
);

const wav = encodePcmWav([new Float32Array([-1, 1, 0, 0.5])], 48000);
const wavData = new DataView(await wav.arrayBuffer());
const ascii = (start, count) => Array.from({ length: count }, (_, i) => String.fromCharCode(wavData.getUint8(start + i))).join('');
assert.equal(wav.type, 'audio/wav');
assert.equal(ascii(0, 4), 'RIFF');
assert.equal(ascii(8, 4), 'WAVE');
assert.equal(wavData.getUint32(4, true), 44);
assert.equal(wavData.getUint16(20, true), 1);
assert.equal(wavData.getUint16(22, true), 2);
assert.equal(wavData.getUint32(24, true), 48000);
assert.equal(wavData.getUint32(28, true), 192000);
assert.equal(wavData.getUint32(40, true), 8);
assert.equal(wavData.getInt16(44, true), -32768);
assert.equal(wavData.getInt16(46, true), 32767);
assert.equal(wavData.getInt16(50, true), 16384);
assert.equal(wavData.getUint32(40, true) / wavData.getUint32(28, true), 2 / 48000);
assert.equal(createRecordingFilename(new Date(2026, 8, 28), 'wav'), 'pedalboard-20260928-000000.wav');
assert.throws(() => encodePcmWav([new Float32Array(1)], 48000));

class MockWavContext {
  static instances = [];
  constructor() { this.sampleRate = 48000; this.destination = {}; MockWavContext.instances.push(this); }
  createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  createScriptProcessor() { this.processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return this.processor; }
  createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
  async resume() {}
  async close() { this.closed = true; }
}
globalThis.AudioContext = MockWavContext;
let limitCalls = 0;
const wavRecorder = new WavRecorder({}, () => { limitCalls += 1; });
MockWavContext.instances.at(-1).processor.onaudioprocess({ inputBuffer: { numberOfChannels: 2, getChannelData(channel) { return channel ? new Float32Array([1, 0.5]) : new Float32Array([-1, 0]); } } });
const captured = new DataView(await (await wavRecorder.stop()).arrayBuffer());
assert.equal(captured.getUint32(40, true), 8);
assert.deepEqual([44, 46, 48, 50].map((offset) => captured.getInt16(offset, true)), [-32768, 32767, 0, 16384]);
assert.equal(MockWavContext.instances.at(-1).processor.onaudioprocess, null);
assert.equal(MockWavContext.instances.at(-1).closed, true);
assert.equal(limitCalls, 0);
class OneHertzContext extends MockWavContext { constructor() { super(); this.sampleRate = 1; } }
globalThis.AudioContext = OneHertzContext;
const block = (count, channels = 1) => ({ inputBuffer: { numberOfChannels: channels, getChannelData() { return new Float32Array(count).fill(0.5); } } });
// 최대 길이를 안 주면 기본 5분(300초 = 샘플레이트 1 에서 300 프레임)이다: 130 프레임은 한도에 닿지 않는다.
const defaultRecorder = new WavRecorder({}, () => { limitCalls += 1; });
assert.equal(defaultRecorder.limitSeconds, 300, '기본 최대 길이는 5분');
MockWavContext.instances.at(-1).processor.onaudioprocess(block(130));
assert.equal(limitCalls, 0, '기본 한도(300프레임) 안이면 한도 콜백이 없다');
assert.equal(new DataView(await (await defaultRecorder.stop()).arrayBuffer()).getUint32(40, true), 130 * 4);
// 1분을 고르면 60 프레임에서 멈추고 한도 콜백이 한 번 불리며, 한도를 넘은 프레임은 담지 않는다.
const limitedRecorder = new WavRecorder({}, () => { limitCalls += 1; }, { maxSeconds: 60 });
assert.equal(limitedRecorder.limitSeconds, 60);
MockWavContext.instances.at(-1).processor.onaudioprocess(block(130));
assert.equal(limitCalls, 1);
const limitedWav = new DataView(await (await limitedRecorder.stop()).arrayBuffer());
assert.equal(limitedWav.getUint32(40, true), 60 * 4);
// 선택지에 없는 값(45초)은 기본 5분으로 본다.
assert.equal(new WavRecorder({}, () => {}, { maxSeconds: 45 }).limitSeconds, 300);
// 24비트: 샘플 3바이트, 헤더가 24비트로 맞고, 값이 두 보수로 들어간다.
const recorder24 = new WavRecorder({}, () => {}, { maxSeconds: 60, bitDepth: 24 });
MockWavContext.instances.at(-1).processor.onaudioprocess({ inputBuffer: { numberOfChannels: 2, getChannelData(channel) { return channel ? new Float32Array([1, 0.5]) : new Float32Array([-1, 0]); } } });
const wav24 = new DataView(await (await recorder24.stop()).arrayBuffer());
assert.equal(wav24.getUint16(34, true), 24, '비트 깊이');
assert.equal(wav24.getUint32(40, true), 4 * 3, '자료 바이트');
assert.equal(wav24.getUint32(4, true), 36 + 4 * 3, 'RIFF 크기');
assert.equal(wav24.getUint32(28, true), 1 * 2 * 3, '초당 바이트');
assert.equal(wav24.getUint16(32, true), 6, '블록 정렬');
const int24 = (offset) => { const v = wav24.getUint8(offset) | (wav24.getUint8(offset + 1) << 8) | (wav24.getUint8(offset + 2) << 16); return v >= 0x800000 ? v - 0x1000000 : v; };
assert.deepEqual([44, 47, 50, 53].map(int24), [-8388608, 8388607, 0, 4194304]);
delete globalThis.AudioContext;
// 선택지·정규화·메모리 상한.
assert.deepEqual([...WAV_MAX_SECONDS_OPTIONS], [60, 120, 300]);
assert.equal(DEFAULT_WAV_MAX_SECONDS, 300);
assert.equal(normalizeWavMaxSeconds(120), 120);
assert.equal(normalizeWavMaxSeconds(121), 300);
assert.equal(normalizeWavMaxSeconds('300'), 300);
assert.equal(normalizeWavBitDepth(24), 24);
assert.equal(normalizeWavBitDepth(32), 16);
assert.equal(normalizeWavBitDepth(undefined), 16);
assert.equal(wavFrameLimit(48000, 300), 14_400_000);
assert.equal(wavFrameLimit(96000, 300), MAX_WAV_FRAMES, '샘플레이트가 높으면 메모리 상한이 먼저 닿는다');
assert.equal(wavFrameLimit(44100, 60), 2_646_000);
// 24비트로 인코딩해도 길이(초) = 자료 바이트 / 초당 바이트가 샘플레이트와 맞는다.
const wavLong24 = encodePcmWav([new Float32Array(48000 * 2)], 48000, 24);
const wavLong24View = new DataView(await wavLong24.arrayBuffer());
assert.equal(wavLong24View.getUint32(40, true) / wavLong24View.getUint32(28, true), 1, '24비트 1초 길이');

let now = 1_000;
Object.defineProperty(globalThis, 'performance', {
  configurable: true,
  value: { now: () => now },
});

let nextTimerId = 1;
const intervals = new Map();
const timeouts = new Map();
const storage = new Map();
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: {
    localStorage: {
      getItem: (key) => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, String(value)),
      removeItem: (key) => storage.delete(key),
    },
    setInterval(callback) {
      const id = nextTimerId++;
      intervals.set(id, callback);
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    setTimeout(callback) {
      const id = nextTimerId++;
      timeouts.set(id, callback);
      return id;
    },
    clearTimeout(id) {
      timeouts.delete(id);
    },
  },
});

const createdUrls = [];
const revokedUrls = [];
const createdBlobs = [];
Object.defineProperty(URL, 'createObjectURL', {
  configurable: true,
  value(blob) {
    createdBlobs.push(blob);
    const url = `blob:recording-${createdUrls.length + 1}`;
    createdUrls.push(url);
    return url;
  },
});
Object.defineProperty(URL, 'revokeObjectURL', {
  configurable: true,
  value(url) {
    revokedUrls.push(url);
  },
});

const mimeChecks = [];
class MockMediaRecorder {
  static instances = [];

  static isTypeSupported(mimeType) {
    mimeChecks.push(mimeType);
    return mimeType === 'audio/webm;codecs=opus';
  }

  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType ?? '';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    this.stopCalls = 0;
    MockMediaRecorder.instances.push(this);
  }

  start(timeslice) {
    this.timeslice = timeslice;
    this.state = 'recording';
  }

  stop() {
    if (this.state === 'inactive') throw new Error('already inactive');
    this.stopCalls += 1;
    this.state = 'inactive';
    void Promise.resolve().then(() => {
      this.ondataavailable?.({ data: new Blob(['recorded-audio']) });
      this.onstop?.();
    });
  }
}
Object.defineProperty(globalThis, 'MediaRecorder', {
  configurable: true,
  value: MockMediaRecorder,
});

const runtimeBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: `
      export { AudioEngine } from './src/audio/AudioEngine.ts';
      export { useAudioStore } from './src/store/audioStore.ts';
      export { useToastStore } from './src/store/toastStore.ts';
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    sourcefile: 'recording-runtime-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeBundle.outputFiles[0].text).toString('base64')}`;
const { AudioEngine, useAudioStore, useToastStore } = await import(runtimeUrl);
const engine = AudioEngine.getInstance();

// A fresh module instance represents a page reload using the same browser storage.
assert.equal(useAudioStore.getState().tuningReferenceHz, 440);
useAudioStore.getState().setTuningReferenceHz(442);
useAudioStore.getState().setInputGainDb(3);
useAudioStore.getState().setMasterVolume(0.5);
useAudioStore.getState().setHowlProtectionEnabled(false);
const savedIo = JSON.parse(storage.get('guitar-pedalboard:io'));
assert.equal(savedIo.tuningReferenceHz, 442);
assert.equal(savedIo.inputGainDb, 3);
assert.equal(savedIo.masterVolume, 0.5);
assert.equal(savedIo.howlProtectionEnabled, false);
const reloaded = await import(`${runtimeUrl}#reference-reload`);
assert.equal(reloaded.useAudioStore.getState().tuningReferenceHz, 442);
assert.equal(reloaded.AudioEngine.getInstance().tuningReferenceHz, 442);
storage.set('guitar-pedalboard:io', JSON.stringify({ tuningReferenceHz: 'invalid' }));
const invalidSettings = await import(`${runtimeUrl}#invalid-reference`);
assert.equal(invalidSettings.useAudioStore.getState().tuningReferenceHz, 440);
storage.set('guitar-pedalboard:io', JSON.stringify({ tuningReferenceHz: 500 }));
const outOfRange = await import(`${runtimeUrl}#out-of-range-reference`);
assert.equal(outOfRange.useAudioStore.getState().tuningReferenceHz, 480);
storage.delete('guitar-pedalboard:io');

let destinationCreates = 0;
let recorderTrackStops = 0;
let destinationDisconnects = 0;
const recorderStream = {
  getTracks: () => [{ stop: () => (recorderTrackStops += 1) }],
};
const destination = {
  stream: recorderStream,
  disconnect: () => (destinationDisconnects += 1),
};
// 녹음은 스피커와 같은 리미터 출력(OutputStage.output)에서 갈라진다 — 입력 쪽(input)에서 갈라지면 리미터 앞 소리가 녹음된다.
const outputConnects = [];
const inputConnects = [];
const outputDisconnects = [];
const gainParam = { cancelScheduledValues() {}, setValueAtTime() {} };
const masterInput = { gain: gainParam, connect: (node) => inputConnects.push(node), disconnect() {} };
const masterOutput = {
  gain: gainParam,
  connect: (node) => outputConnects.push(node),
  disconnect: (node) => outputDisconnects.push(node),
};
engine.context = {
  state: 'running',
  currentTime: 0,
  createMediaStreamDestination: () => {
    destinationCreates += 1;
    return destination;
  },
};
engine.outputStage = { input: masterInput, output: masterOutput, dispose() {} };
let inputStops = 0;
engine.stream = { getTracks: () => [{ stop: () => inputStops++ }] };
assert.equal(engine.createRecorderStream(), recorderStream);
assert.equal(engine.createRecorderStream(), recorderStream);
assert.equal(destinationCreates, 1, 'recorder destination을 재사용하지 않았습니다.');
assert.deepEqual(outputConnects, [destination], '녹음 입구는 리미터 출력에서 갈라진다');
assert.deepEqual(inputConnects, [], '리미터 앞(입력 쪽)에서는 갈라지지 않는다');
engine.stopInput();
assert.equal(inputStops, 1, '정지 절차는 마이크 입력 트랙을 바로 멈춰야 합니다');
assert.equal(recorderTrackStops, 0, '녹음 마감을 기다리는 동안 recorder 트랙은 살아 있어야 합니다');
engine.disposeRecorderStream();
assert.equal(recorderTrackStops, 1);
assert.equal(destinationDisconnects, 1);
assert.deepEqual(outputDisconnects, [destination], '녹음 입구를 출력에서 떼어 낸다');
engine.disposeRecorderStream();
assert.equal(recorderTrackStops, 1, '두 번째 해제는 아무 일도 하지 않는다');
// 컨텍스트가 닫혔거나 없으면 녹음 스트림을 만들 수 없다.
engine.context = { ...engine.context, state: 'closed' };
assert.throws(() => engine.createRecorderStream());
assert.equal(destinationCreates, 1);
engine.context = { ...engine.context, state: 'running' };

let streamRequests = 0;
let engineStops = 0; // 정리 절차가 AudioContext 를 닫은 횟수
let engineStarts = 0;
let engineFileStarts = 0;
let startedDevice = null;
let recorderStreamDisposals = 0;
const teardownOrder = [];
const toastMessages = () => useToastStore.getState().toasts.map((toast) => toast.message);
/** 화면은 정지 즉시 바뀌므로, 정리 절차가 AudioContext 를 닫을 때까지 기다린다. */
async function settleStop(expectedStops) {
  for (let attempt = 0; attempt < 200 && engineStops < expectedStops; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
  }
  await new Promise((resolve) => setImmediate(resolve)); // 닫은 뒤 ⑦·⑧ 단계
}
engine.createRecorderStream = () => {
  streamRequests += 1;
  return recorderStream;
};
// 정리 절차(설계서 4.2절 ①~⑦)의 엔진 쪽 단계를 호출 기록으로 대신한다. ③ 녹음 마감은 스토어가 한다.
engine.invalidatePendingStart = () => {
  teardownOrder.push('invalidate-pending-start');
};
engine.silenceOutput = async () => {
  teardownOrder.push('silence-output');
};
engine.stopInput = () => {
  teardownOrder.push('stop-input');
};
engine.pausePlayback = () => {
  teardownOrder.push('pause-playback');
};
engine.releaseGraph = () => {
  teardownOrder.push('release-graph');
};
engine.closeContext = async () => {
  teardownOrder.push('close-context');
  engineStops += 1;
};
engine.advanceGeneration = () => {
  teardownOrder.push('advance-generation');
};
engine.start = async (deviceId) => {
  engineStarts += 1;
  startedDevice = deviceId ?? null;
};
engine.startFile = async () => {
  engineFileStarts += 1;
};
engine.listInputDevices = async () => [];
engine.readFilePlayback = () => ({ currentTime: 0, duration: 60, isPaused: false });
engine.readLatency = () => ({ sampleRate: 48_000, inputKind: 'device', input: null, inputSource: null, pedals: 0, limiter: 1, outputBase: 1, outputDevice: 2 });
engine.readPitch = () => ({ frequency: null, note: null, cents: 0 });
engine.readUnderrunCount = () => 0;
engine.disposeRecorderStream = () => {
  recorderStreamDisposals += 1;
};

// 정지 절차는 엔진을 직접 멈추지 않고 정리 절차(AudioSession.stop)를 지나야 한다 — 직접 부르면 아래 호출 기록이 늘어난다.
let directEngineStopCalls = 0;
engine.panic = () => { directEngineStopCalls += 1; };
engine.stop = async () => { directEngineStopCalls += 1; };

assert.equal(useAudioStore.getState().recordingStatus, 'idle', '처음 녹음 상태는 idle');
assert.equal(useAudioStore.getState().recordedUrl, null);
// S5.1: 처음 열면 WAV·16비트·최대 5분이다. 이 아래의 압축 녹음(MediaRecorder) 시험은 형식을 직접 고르고 시작한다.
assert.equal(useAudioStore.getState().recordingFormat, 'wav', '기본 녹음 형식은 WAV');
assert.equal(useAudioStore.getState().wavBitDepth, 16, '기본 비트 깊이');
assert.equal(useAudioStore.getState().wavMaxSeconds, 300, '기본 최대 길이는 5분');
useAudioStore.setState({ isRunning: true, inputMode: 'device', error: null, recordingFormat: 'webm' });
assert.equal(useAudioStore.getState().recordingSupported, true);
useAudioStore.getState().startRecording();
let recorder = MockMediaRecorder.instances.at(-1);
assert.equal(useAudioStore.getState().recordingStatus, 'recording');
assert.equal(recorder.mimeType, 'audio/webm;codecs=opus');
assert.equal(recorder.timeslice, 250);
assert.deepEqual(mimeChecks.slice(0, 1), ['audio/webm;codecs=opus']);
assert.equal(streamRequests, 1);

now = 3_550;
for (const callback of intervals.values()) callback();
assert.equal(useAudioStore.getState().recordingElapsed, 2);
await useAudioStore.getState().stopRecording();
const firstUrl = useAudioStore.getState().recordedUrl;
assert.equal(useAudioStore.getState().recordingStatus, 'ready');
assert.equal(firstUrl, 'blob:recording-1');
assert.equal(createdBlobs.at(-1).type, 'audio/webm;codecs=opus');
assert.equal(createdBlobs.at(-1).size, 'recorded-audio'.length, '녹음 조각이 파일이 된다');
assert.equal(intervals.size, 0);
assert.equal(timeouts.size, 0);
assert.equal(recorder.stopCalls, 1);

useAudioStore.getState().startRecording();
assert.ok(revokedUrls.includes(firstUrl), '새 녹음에서 이전 Blob URL을 해제하지 않았습니다.');
assert.equal(useAudioStore.getState().recordedUrl, null);
assert.equal(useAudioStore.getState().recordingStatus, 'recording');

await useAudioStore.getState().setSelectedDevice('input-2');
assert.equal(startedDevice, 'input-2');
assert.equal(engineStarts, 1);
assert.equal(useAudioStore.getState().recordingStatus, 'ready');
assert.equal(useAudioStore.getState().isRunning, true);

useAudioStore.getState().startRecording();
await useAudioStore.getState().start();
assert.equal(engineStarts, 2);
assert.equal(useAudioStore.getState().recordingStatus, 'ready');

useAudioStore.getState().startRecording();
await useAudioStore.getState().startFile(new File(['audio'], 'test.wav', { type: 'audio/wav' }));
assert.equal(engineFileStarts, 1);
assert.equal(useAudioStore.getState().recordingStatus, 'ready');
assert.equal(useAudioStore.getState().inputMode, 'file');

// 연결 해제: 정리 절차를 순서대로 지나고, 녹음을 저장하고, 저장했다는 안내만 띄운다.
useAudioStore.getState().startRecording();
useToastStore.getState().clear();
teardownOrder.length = 0;
await useAudioStore.getState().stop();
assert.equal(engineStops, 1);
assert.deepEqual(teardownOrder, [
  'invalidate-pending-start',
  'silence-output',
  'stop-input',
  'pause-playback',
  'release-graph',
  'close-context',
  'advance-generation',
]);
assert.equal(useAudioStore.getState().recordingStatus, 'ready');
assert.deepEqual(toastMessages(), ['녹음을 저장했습니다.']);
assert.equal(useAudioStore.getState().isRunning, false);
assert.equal(useAudioStore.getState().isLoading, false);

// 정지 절차는 '실제로 시작된 세션'을 정지할 때만 안내를 띄우므로 start() 로 세션을 연다.
await useAudioStore.getState().start();
useAudioStore.getState().startRecording();
recorder = MockMediaRecorder.instances.at(-1);
const urlsBeforePanic = createdUrls.length;
const stopsBeforePanic = engineStops;
useToastStore.getState().clear();
teardownOrder.length = 0;
useAudioStore.getState().panic();
assert.equal(useAudioStore.getState().isRunning, false, 'Panic 은 화면을 곧바로 연결 안 됨으로 돌려야 합니다');
await settleStop(stopsBeforePanic + 1);
assert.equal(engineStops, stopsBeforePanic + 1, 'Panic 도 AudioContext 를 닫는 정리 절차를 지나야 합니다');
assert.deepEqual(teardownOrder, [
  'invalidate-pending-start',
  'silence-output',
  'stop-input',
  'pause-playback',
  'release-graph',
  'close-context',
  'advance-generation',
]);
assert.equal(recorder.stopCalls, 1);
assert.equal(useAudioStore.getState().recordingStatus, 'ready');
assert.ok(useAudioStore.getState().recordedUrl);
assert.equal(createdUrls.length, urlsBeforePanic + 1, 'Panic should save recorded audio');
assert.equal(createdBlobs.at(-1).size, 'recorded-audio'.length, '이전 녹음의 조각이 남아 섞이지 않는다');
assert.equal(toastMessages().length, 1);
assert.equal(toastMessages()[0], '긴급 정지했습니다. 마이크와 오디오를 모두 껐습니다. 녹음은 저장했습니다.');
assert.equal(useAudioStore.getState().error, null);

assert.equal(typeof engine.howlHandler, 'function', '스토어가 하울링 처리기를 엔진에 연결한다');
await useAudioStore.getState().start();
useAudioStore.setState({ howlProtectionEnabled: true });
useAudioStore.getState().startRecording();
const stopsBeforeHowl = engineStops;
useToastStore.getState().clear();
engine.howlHandler();
await settleStop(stopsBeforeHowl + 1);
assert.equal(engineStops, stopsBeforeHowl + 1);
assert.equal(useAudioStore.getState().recordingStatus, 'ready');
assert.ok(useAudioStore.getState().recordedUrl);
assert.equal(toastMessages().length, 1);
assert.equal(toastMessages()[0], '하울링이 감지되어 정지했습니다. 스피커 음량을 줄이거나 헤드폰을 쓰세요. 녹음은 저장했습니다.');
assert.equal(useAudioStore.getState().error, null);

useAudioStore.setState({ isRunning: true, inputMode: 'device', error: null });
useAudioStore.getState().startRecording();
await useAudioStore.getState().stopRecording();
const finalUrl = useAudioStore.getState().recordedUrl;
assert.ok(finalUrl);
useAudioStore.getState().disposeRecording();
assert.equal(useAudioStore.getState().recordingStatus, 'idle');
assert.equal(useAudioStore.getState().recordedUrl, null);
assert.ok(revokedUrls.includes(finalUrl), 'unmount cleanup이 마지막 Blob URL을 해제하지 않았습니다.');
assert.equal(recorderStreamDisposals, 1, 'unmount cleanup이 recorder track을 해제하지 않았습니다.');
assert.equal(intervals.size, 0);
assert.equal(timeouts.size, 0);

MockMediaRecorder.isTypeSupported = () => false;
useAudioStore.setState({ isRunning: true, inputMode: 'device', error: null });
useAudioStore.getState().startRecording();
recorder = MockMediaRecorder.instances.at(-1);
recorder.mimeType = 'audio/mp4;codecs=mp4a.40.2';
await useAudioStore.getState().stopRecording();
assert.equal(useAudioStore.getState().recordedFormat, 'm4a');
assert.equal(createdBlobs.at(-1).type, 'audio/mp4;codecs=mp4a.40.2');
assert.equal(createRecordingFilename(new Date(2026, 8, 28), useAudioStore.getState().recordedFormat), 'pedalboard-20260928-000000.m4a');
useAudioStore.getState().startRecording();
await useAudioStore.getState().stopRecording();
assert.equal(useAudioStore.getState().recordedFormat, 'unknown');
assert.equal(createdBlobs.at(-1).type, '');
useAudioStore.getState().startRecording();
recorder = MockMediaRecorder.instances.at(-1);
recorder.stop = function () {
  this.state = 'inactive';
  void Promise.resolve().then(() => {
    this.ondataavailable?.({ data: new Blob(['audio'], { type: 'audio/ogg;codecs=opus' }) });
    this.onstop?.();
  });
};
await useAudioStore.getState().stopRecording();
assert.equal(useAudioStore.getState().recordedFormat, 'ogg');
assert.equal(createdBlobs.at(-1).type, 'audio/ogg;codecs=opus');

// S5.1: WAV 녹음 — 1분·24비트를 고르면 저장되고, 샘플레이트 1 에서 60 프레임에 닿으면 자동 저장되며, 파일이 24비트다.
globalThis.AudioContext = OneHertzContext;
useAudioStore.setState({ isRunning: true, inputMode: 'device', error: null });
useAudioStore.getState().setRecordingFormat('wav');
useAudioStore.getState().setWavMaxSeconds(60);
useAudioStore.getState().setWavBitDepth(24);
const savedWavIo = JSON.parse(storage.get('guitar-pedalboard:io'));
assert.equal(savedWavIo.recordingFormat, 'wav', '고른 녹음 형식이 저장된다');
assert.equal(savedWavIo.wavMaxSeconds, 60, '고른 최대 길이가 저장된다');
assert.equal(savedWavIo.wavBitDepth, 24, '고른 비트 깊이가 저장된다');
assert.equal(savedWavIo.tuningReferenceHz, 442, '다른 설정은 그대로 남는다');
useAudioStore.getState().setWavMaxSeconds(45); // 선택지에 없는 값은 5분으로 본다
assert.equal(useAudioStore.getState().wavMaxSeconds, 300);
useAudioStore.getState().setWavMaxSeconds(60);
useAudioStore.getState().startRecording();
assert.equal(useAudioStore.getState().recordingStatus, 'recording');
assert.equal(useAudioStore.getState().recordingLimitSeconds, 60, '이번 녹음이 담을 수 있는 길이');
// 녹음 중에는 설정을 바꿀 수 없다.
useAudioStore.getState().setWavBitDepth(16);
useAudioStore.getState().setWavMaxSeconds(120);
assert.equal(useAudioStore.getState().wavBitDepth, 24);
assert.equal(useAudioStore.getState().wavMaxSeconds, 60);
const wavSamples = new Float32Array(130).fill(0.5);
MockWavContext.instances.at(-1).processor.onaudioprocess({ inputBuffer: { numberOfChannels: 1, getChannelData() { return wavSamples; } } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(useAudioStore.getState().recordingStatus, 'ready');
assert.equal(useAudioStore.getState().recordedFormat, 'wav');
assert.ok(useAudioStore.getState().recordedUrl);
assert.equal(useAudioStore.getState().error, 'WAV 녹음 제한에 도달했거나 오디오를 시작할 수 없어 녹음을 종료했습니다.');
const storedWav = new DataView(await createdBlobs.at(-1).arrayBuffer());
assert.equal(storedWav.getUint16(34, true), 24, '저장된 파일은 24비트');
assert.equal(storedWav.getUint32(40, true), 60 * 2 * 3, '저장된 파일은 60 프레임');
useAudioStore.getState().disposeRecording();
delete globalThis.AudioContext;

// Default input unplug: the current track ends, the recording finalizes, and stale events are ignored.
useAudioStore.setState({ selectedDeviceId: '', error: null });
await useAudioStore.getState().start();
useAudioStore.getState().setRecordingFormat('webm');
useAudioStore.getState().startRecording();
let endedCallback;
const lostTrack = { addEventListener: (_type, cb) => { endedCallback = cb; }, removeEventListener() {} };
const liveStream = { getAudioTracks: () => [lostTrack] };
engine.stream = liveStream;
const generation = engine.sessionGeneration;
engine.watchInputEnd(liveStream, generation);
const stopsBeforeDisconnect = engineStops;
useToastStore.getState().clear();
endedCallback();
endedCallback();
await settleStop(stopsBeforeDisconnect + 1);
assert.equal(engineStops, stopsBeforeDisconnect + 1);
assert.equal(useAudioStore.getState().recordingStatus, 'ready');
assert.equal(toastMessages().length, 1);
assert.equal(toastMessages()[0], '입력 장치 연결이 끊겼습니다. 장치를 다시 연결한 뒤 연결하기를 누르세요. 녹음은 저장했습니다.');
assert.equal(useAudioStore.getState().error, null);
assert.equal(useAudioStore.getState().isRunning, false);
engine.sessionGeneration += 1;
endedCallback();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(engineStops, stopsBeforeDisconnect + 1);
useAudioStore.getState().disposeRecording();
assert.equal(directEngineStopCalls, 0, '연결 해제·Panic·하울링·장치 분실 모두 정리 절차를 지난다(엔진을 직접 멈추지 않는다)');

// S2.10(설계서 4.12): 입력·출력 지연과 끊김 수는 브라우저가 1초마다 갱신하므로 1초마다만 다시 읽고, 처리 지연(켜진 페달 + 리미터)은 매번 읽는다.
{
  let clock = 1_000_000;
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
  const calls = { full: 0, processing: 0, underrun: 0 };
  let pedals = 2.5;
  let underruns = 4;
  let rate = 48_000;
  engine.readProcessingLatency = () => {
    calls.processing += 1;
    return { sampleRate: rate, pedals, limiter: 1 };
  };
  engine.readLatency = () => {
    calls.full += 1;
    return { sampleRate: rate, inputKind: 'device', input: 5, inputSource: 'track-stats', pedals, limiter: 1, outputBase: 10, outputDevice: 2 };
  };
  engine.readUnderrunCount = () => {
    calls.underrun += 1;
    return underruns;
  };
  const silent = { db: -120, linear: 0, peakDb: -120, peakLinear: 0, isClipping: false, clipHoldUntil: 0 };
  const emptyLatency = { sampleRate: 0, inputKind: 'device', input: null, inputSource: null, pedals: 0, limiter: 0, outputBase: null, outputDevice: null };
  const refresh = () => useAudioStore.getState().refreshMeters(silent, silent);
  const shown = () => useAudioStore.getState();
  useAudioStore.setState({ latency: emptyLatency, underrunCount: null });

  refresh();
  assert.equal(calls.full, 1, '세션이 막 시작돼 아직 못 읽었으면 바로 읽는다');
  assert.equal(calls.underrun, 1);
  assert.equal(shown().underrunCount, 4);
  assert.equal(shown().latency.input, 5);
  assert.equal(shown().latency.pedals, 2.5);

  clock += 100;
  pedals = 3.5;
  underruns = 9;
  refresh();
  assert.equal(calls.full, 1, '100 ms 뒤에는 입력·출력 지연을 다시 읽지 않는다');
  assert.equal(calls.underrun, 1, '100 ms 뒤에는 끊김 수를 다시 읽지 않는다');
  assert.equal(shown().underrunCount, 4, '브라우저가 1초마다 갱신하므로 화면도 1초 동안 그대로');
  assert.equal(shown().latency.pedals, 3.5, '처리 지연(페달)은 매번 읽어서 페달을 켜고 끄면 바로 바뀐다');
  assert.equal(shown().latency.input, 5, '1초 전에 읽은 입력 지연은 그대로 둔다');
  assert.equal(shown().latency.limiter, 1);
  assert.ok(calls.processing >= 2, '처리 지연은 틱마다 읽는다');

  clock += 899;
  refresh();
  assert.equal(calls.underrun, 1, '999 ms 지났어도 아직 다시 읽지 않는다');
  assert.equal(shown().underrunCount, 4);
  clock += 1;
  refresh();
  assert.equal(calls.underrun, 2, '정확히 1초가 되면 다시 읽는다');
  assert.equal(calls.full, 2);
  assert.equal(shown().underrunCount, 9);

  clock += 50;
  rate = 44_100;
  underruns = 11;
  refresh();
  assert.equal(calls.full, 3, '샘플레이트가 바뀌면(새 세션) 1초를 기다리지 않고 바로 읽는다');
  assert.equal(shown().underrunCount, 11);
  assert.equal(shown().latency.sampleRate, 44_100);

  // 세션이 끝나면 읽음이 비워지고, 다음 세션의 첫 틱에는 바로 읽는다.
  useAudioStore.setState({ latency: emptyLatency, underrunCount: null });
  clock += 10;
  refresh();
  assert.equal(calls.full, 4, '비워진 뒤 첫 틱은 바로 읽는다');

  // 읽음의 어느 한 필드만 바뀌어도 화면 값이 바뀐다(필드 비교가 하나라도 빠지면 그 값은 화면에 영영 반영되지 않는다).
  const full = { sampleRate: 48_000, inputKind: 'device', input: 5, inputSource: 'track-stats', pedals: 2.5, limiter: 1, outputBase: 10, outputDevice: 2 };
  let current = { ...full };
  engine.readProcessingLatency = () => ({ sampleRate: current.sampleRate, pedals: current.pedals, limiter: current.limiter });
  engine.readLatency = () => ({ ...current });
  useAudioStore.setState({ latency: { ...full }, underrunCount: 0 });
  clock += 1000;
  refresh();
  const slowFields = [
    ['input', 6],
    ['inputSource', 'track-settings'],
    ['inputKind', 'file'],
    ['outputBase', 11],
    ['outputDevice', 3],
  ];
  for (const [field, value] of slowFields) {
    current = { ...full, [field]: value };
    clock += 1000;
    refresh();
    assert.equal(shown().latency[field], value, `${field} 만 바뀌어도 1초 뒤 화면 값이 바뀐다`);
    current = { ...full };
    clock += 1000;
    refresh();
    assert.equal(shown().latency[field], full[field], `${field} 가 되돌아오면 화면도 되돌아온다`);
  }
  for (const [field, value] of [['pedals', 3.5], ['limiter', 2]]) {
    current = { ...full, [field]: value };
    clock += 100;
    refresh();
    assert.equal(shown().latency[field], value, `${field} 는 100 ms 틱에도 바로 반영된다`);
    current = { ...full };
    clock += 100;
    refresh();
    assert.equal(shown().latency[field], full[field]);
  }

  // 정지하면 지연·끊김 읽음이 비워진다('--').
  await useAudioStore.getState().start();
  useAudioStore.setState({ underrunCount: 3, latency: { ...full } });
  const stopsBeforeReset = engineStops;
  await useAudioStore.getState().stop();
  await settleStop(stopsBeforeReset + 1);
  assert.equal(useAudioStore.getState().underrunCount, null, '정지하면 끊김 수가 비워진다');
  assert.equal(useAudioStore.getState().latency.sampleRate, 0, '정지하면 지연 읽음이 비워진다');
}

// ── 화면 계약: 녹음 패널(Meter)·정리(AppShell)·스타일 ─────────────────────────────────────────────────────────────
// 소스를 글자로 읽지 않고, 화면을 실제로 그려(서버 렌더) 버튼·접근성 속성을 묻고, 처리기를 직접 불러 스토어가 바뀌는지 본다.
const matchMediaStub = () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
const meterHarness = await createSsrHarness({
  extraExports: [
    "{ useAudioStore } from './store/audioStore.ts'",
    "{ Meter } from './components/Meter.tsx'",
    "{ ko } from './i18n/ko.ts'",
  ],
  windowOverrides: { matchMedia: matchMediaStub },
});
{
  const { useAudioStore: uiStore, Meter, ko: uiKo } = meterHarness.exports;
  const BASE = {
    recordingSupported: true,
    recordingFormat: 'webm',
    recordingStatus: 'idle',
    recordedUrl: null,
    recordedFormat: 'webm',
    recordingElapsed: 0,
    isRunning: false,
  };
  /** 주어진 상태에서 녹음 패널을 그려 버튼·문구를 요약한다. */
  function panelFor(patch) {
    const restore = meterHarness.serverState(uiStore, { ...BASE, ...patch });
    try {
      const tree = meterHarness.render(Meter, {});
      const panel = find(tree, byClass('recording-panel'));
      assert.ok(panel, '녹음 패널이 그려진다');
      const group = find(panel, byRole('group'));
      const buttons = findAll(group, byTag('button'));
      const status = find(panel, (node) => node.tag === 'p' && hasClass(node, 'recording-status'));
      const select = find(panel, byTag('select'));
      return {
        groupLabel: group.attrs['aria-label'],
        labels: buttons.map((button) => textContent(button).trim()),
        disabled: buttons.map((button) => 'disabled' in button.attrs),
        status: textContent(status),
        statusLive: status.attrs['aria-live'],
        selectDisabled: 'disabled' in select.attrs,
        panelText: textContent(panel),
        selects: findAll(panel, byTag('select')).map((node) => ({
          disabled: 'disabled' in node.attrs,
          options: findAll(node, byTag('option')).map((option) => ({ text: textContent(option).trim(), selected: 'selected' in option.attrs })),
        })),
      };
    } finally {
      restore();
    }
  }

  const idleOff = panelFor({});
  assert.equal(idleOff.groupLabel, '마스터 출력 녹음');
  assert.deepEqual(idleOff.labels, ['녹음', '정지', '다운로드']);
  assert.deepEqual(idleOff.disabled, [true, true, true], '연결 전에는 세 버튼 모두 눌러지지 않는다');
  assert.equal(idleOff.status, '녹음 대기');
  assert.equal(idleOff.statusLive, 'polite', '상태 문구는 스크린 리더에 정중하게 알린다');
  assert.equal(idleOff.selectDisabled, false);

  const idleOn = panelFor({ isRunning: true });
  assert.deepEqual(idleOn.disabled, [false, true, true], '연결되면 녹음만 눌러진다');

  const recordingNow = panelFor({ isRunning: true, recordingStatus: 'recording', recordingElapsed: 75 });
  assert.deepEqual(recordingNow.disabled, [true, false, true], '녹음 중에는 정지만 눌러진다');
  assert.equal(recordingNow.status, '녹음 중 01:15');
  assert.equal(recordingNow.selectDisabled, true, '녹음 중에는 형식을 바꿀 수 없다');

  const ready = panelFor({ isRunning: true, recordingStatus: 'ready', recordingElapsed: 5, recordedUrl: 'blob:take-1' });
  assert.deepEqual(ready.disabled, [false, true, false], '녹음이 끝나면 다운로드가 눌러진다');
  assert.equal(ready.status, '녹음 완료 00:05 · WEBM');
  assert.equal(panelFor({ recordingStatus: 'ready', recordedUrl: 'blob:take-1' }).disabled[2], false, '연결이 끊겨도 받아 둔 녹음은 내려받을 수 있다');
  assert.equal(
    panelFor({ recordingStatus: 'ready', recordedUrl: 'blob:take-1', recordedFormat: 'unknown' }).status,
    '녹음 완료 00:00 · 파일 형식 확인 불가 (확장자 없음)',
  );
  assert.equal(
    panelFor({ recordingStatus: 'ready', recordedUrl: 'blob:take-1', recordedFormat: 'm4a', recordingElapsed: 61 }).status,
    '녹음 완료 01:01 · M4A',
  );

  // S5.1: 녹음 형식 메뉴의 선택지·기본값, WAV 일 때만 보이는 비트 깊이·최대 길이 메뉴, 녹음 중 남은 시간.
  const optionTexts = (panel, index) => panel.selects[index].options.map((option) => option.text);
  const selectedText = (panel, index) => panel.selects[index].options.find((option) => option.selected)?.text;
  const compressedPanel = panelFor({ isRunning: true });
  assert.equal(compressedPanel.selects.length, 1, '압축 녹음에는 형식 메뉴만 있다');
  assert.deepEqual(optionTexts(compressedPanel, 0), ['WAV (원본 음질, 길이 정확)', '작은 파일 (브라우저 지원 압축 형식)'], 'WAV 가 첫 선택지');
  assert.equal(selectedText(compressedPanel, 0), '작은 파일 (브라우저 지원 압축 형식)');
  const wavIdle = panelFor({ isRunning: true, recordingFormat: 'wav', wavBitDepth: 16, wavMaxSeconds: 300 });
  assert.equal(wavIdle.selects.length, 3, 'WAV 에는 형식·비트 깊이·최대 길이 메뉴가 있다');
  assert.deepEqual(optionTexts(wavIdle, 1), ['16비트', '24비트']);
  assert.deepEqual(optionTexts(wavIdle, 2), ['1분', '2분', '5분']);
  assert.equal(selectedText(wavIdle, 0), 'WAV (원본 음질, 길이 정확)');
  assert.equal(selectedText(wavIdle, 1), '16비트');
  assert.equal(selectedText(wavIdle, 2), '5분');
  assert.equal(selectedText(panelFor({ isRunning: true, recordingFormat: 'wav', wavBitDepth: 24, wavMaxSeconds: 60 }), 1), '24비트');
  assert.equal(selectedText(panelFor({ isRunning: true, recordingFormat: 'wav', wavBitDepth: 24, wavMaxSeconds: 60 }), 2), '1분');
  assert.deepEqual(wavIdle.selects.map((menu) => menu.disabled), [false, false, false]);
  assert.equal(recordingNow.status, '녹음 중 01:15', '압축 녹음 중에는 남은 시간을 보이지 않는다(길이 제한이 없다)');

  // 지원 여부는 '고른 형식' 기준이다: 압축 녹음은 MediaRecorder, WAV 는 ScriptProcessor 가 있어야 한다.
  const unsupported = panelFor({ isRunning: true, recordingSupported: false });
  assert.equal(unsupported.status, uiKo.meter.recordingUnsupported);
  assert.equal(unsupported.status, '이 브라우저에서는 녹음을 지원하지 않습니다.');
  assert.equal(unsupported.disabled[0], true, '지원하지 않으면 연결돼 있어도 녹음 버튼이 꺼진다');
  assert.ok(unsupported.panelText.includes('압축 녹음 형식은 브라우저에 따라'), '압축 녹음 안내가 보인다');
  assert.equal(unsupported.panelText.includes('WAV 녹음은 고른 최대 길이'), false);

  assert.equal(typeof globalThis.AudioContext, 'undefined');
  const wavWithoutProcessor = panelFor({ isRunning: true, recordingFormat: 'wav', recordingSupported: true });
  assert.equal(wavWithoutProcessor.disabled[0], true, 'ScriptProcessor 가 없으면 WAV 녹음은 꺼진다(압축 지원 여부와 무관)');
  assert.equal(wavWithoutProcessor.status, uiKo.meter.recordingUnsupported);
  assert.ok(wavWithoutProcessor.panelText.includes('WAV 녹음은 고른 최대 길이'), 'WAV 안내가 보인다');
  assert.equal(wavWithoutProcessor.panelText.includes('압축 녹음 형식은 브라우저에 따라'), false);

  globalThis.AudioContext = class { createScriptProcessor() {} };
  try {
    const wavSupportedPanel = panelFor({ isRunning: true, recordingFormat: 'wav', recordingSupported: false });
    assert.equal(wavSupportedPanel.disabled[0], false, 'WAV 는 압축 녹음 지원 여부와 무관하게 ScriptProcessor 만 있으면 된다');
    assert.equal(wavSupportedPanel.status, '녹음 대기');
    const wavRecording = panelFor({ isRunning: true, recordingFormat: 'wav', recordingStatus: 'recording', recordingElapsed: 75, recordingLimitSeconds: 300 });
    assert.equal(wavRecording.status, '녹음 중 01:15 · 남은 시간 03:45', 'WAV 녹음 중에는 남은 시간이 보인다');
    assert.deepEqual(wavRecording.selects.map((menu) => menu.disabled), [true, true, true], '녹음 중에는 세 메뉴 모두 바꿀 수 없다');
    assert.equal(panelFor({ isRunning: true, recordingFormat: 'wav', recordingStatus: 'recording', recordingElapsed: 400, recordingLimitSeconds: 300 }).status, '녹음 중 06:40 · 남은 시간 00:00', '남은 시간은 0 밑으로 내려가지 않는다');
  } finally {
    delete globalThis.AudioContext;
  }

  // 처리기: 버튼이 스토어의 녹음 시작·정지를 부르고, 다운로드는 만든 링크로 파일 이름을 정해 내려받는다.
  const uiCalls = [];
  const handlerPatch = {
    ...BASE,
    isRunning: true,
    recordingStatus: 'recording',
    recordedUrl: 'blob:take-1',
    recordedFormat: 'webm',
    startRecording: () => uiCalls.push('start'),
    stopRecording: async () => { uiCalls.push('stop'); },
  };
  const restoreHandlers = meterHarness.serverState(uiStore, handlerPatch);
  const RealDate = globalThis.Date;
  const links = [];
  const originalDocument = globalThis.document;
  try {
    meterHarness.render(Meter, {});
    const buttonByLabel = (label) => meterHarness.findHost('button', (props) => hostText(props.children).trim() === label);
    buttonByLabel('녹음').props.onClick();
    await buttonByLabel('정지').props.onClick();
    assert.deepEqual(uiCalls, ['start', 'stop'], '녹음 버튼은 시작, 정지 버튼은 정지를 부른다');

    globalThis.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [2026, 8, 28, 7, 5, 9])); }
    };
    globalThis.document = {
      createElement(tag) {
        const link = { tag, href: '', download: '', clicks: 0, click() { this.clicks += 1; } };
        links.push(link);
        return link;
      },
    };
    buttonByLabel('다운로드').props.onClick();
    assert.equal(links.length, 1);
    assert.deepEqual([links[0].tag, links[0].href, links[0].download, links[0].clicks], ['a', 'blob:take-1', 'pedalboard-20260928-070509.webm', 1]);

    // 형식은 지금 고른 형식이 아니라 '녹음된 파일의 형식'을 따른다.
    restoreHandlers();
    const restoreUnknown = meterHarness.serverState(uiStore, { ...handlerPatch, recordingFormat: 'wav', recordedFormat: 'unknown' });
    try {
      meterHarness.render(Meter, {});
      buttonByLabel('다운로드').props.onClick();
      assert.equal(links[1].download, 'pedalboard-20260928-070509', '형식을 모르면 확장자 없는 이름');
    } finally {
      restoreUnknown();
    }
    const restoreEmpty = meterHarness.serverState(uiStore, { ...handlerPatch, recordedUrl: null });
    try {
      meterHarness.render(Meter, {});
      buttonByLabel('다운로드').props.onClick();
      assert.equal(links.length, 2, '받을 녹음이 없으면 링크를 만들지 않는다');
    } finally {
      restoreEmpty();
    }
  } finally {
    globalThis.Date = RealDate;
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
    restoreHandlers();
  }
}
meterHarness.restore();

// AppShell 이 닫히면(unmount) 녹음 정리를 한 번 부른다 — 열린 Blob URL 과 녹음 스트림을 남기지 않는다.
const shellHarness = await createSsrHarness({
  extraExports: [
    "{ useAudioStore } from './store/audioStore.ts'",
    "{ AppShell } from './components/AppShell.tsx'",
  ],
  stubs: {
    'components/HistoryControls': 'export function HistoryControls() { return null; }',
    'components/ChainText': 'export function ChainText() { return null; }',
    'components/ConnectGuitarPanel': 'export function ConnectGuitarPanel() { return null; }',
    'components/GlobalKeyboardShortcuts': 'export function GlobalKeyboardShortcuts() { return null; }',
    'components/Meter': 'export function Meter() { return null; }',
    'components/MidiReconnectBanner': 'export function MidiReconnectBanner() { return null; }',
    'components/PedalBoard': 'export function PedalBoard() { return null; }',
    'components/PresetPanel': 'export function PresetPanel() { return null; }',
  },
  windowOverrides: {
    matchMedia: matchMediaStub,
    addEventListener() {},
    removeEventListener() {},
  },
});
{
  const { useAudioStore: shellStore, AppShell } = shellHarness.exports;
  const shellCalls = [];
  const original = shellStore.getState();
  const patch = {
    connectSavedMidi: async () => {},
    disposeMidi: () => {},
    disposeRecording: () => { shellCalls.push('disposeRecording'); },
  };
  shellStore.setState(patch);
  const restoreShell = shellHarness.serverState(shellStore, patch);
  globalThis.document = { documentElement: { style: { setProperty() {}, removeProperty() {} } } };
  try {
    shellHarness.render(AppShell);
    const mounted = shellHarness.runEffects();
    assert.deepEqual(shellCalls, [], '화면이 떠 있는 동안에는 녹음을 정리하지 않는다');
    mounted.cleanup();
    assert.deepEqual(shellCalls, ['disposeRecording'], '화면이 닫히면 녹음 정리를 정확히 한 번 부른다');
  } finally {
    delete globalThis.document;
    restoreShell();
    shellStore.setState({ connectSavedMidi: original.connectSavedMidi, disposeMidi: original.disposeMidi, disposeRecording: original.disposeRecording });
    shellHarness.restore();
  }
}

// 스타일은 브라우저가 계산한 값으로 본다(소스 글자가 아니라 실제로 그렇게 보이는지).
Object.defineProperty(globalThis, 'performance', { configurable: true, value: realPerformance });
await verifyRecordingPanelInBrowser();

async function verifyRecordingPanelInBrowser() {
  const app = await openApp({ purpose: '녹음 패널 스타일', waitFor: '.recording-panel' });
  if (!app) return;
  try {
    const layout = await app.evaluate(`(() => {
      const panel = document.querySelector('.recording-panel');
      const actions = panel.querySelector('.recording-actions');
      const buttons = [...actions.querySelectorAll('button')];
      const panelStyle = getComputedStyle(panel);
      const actionStyle = getComputedStyle(actions);
      return {
        panelDisplay: panelStyle.display,
        panelRadius: panelStyle.borderTopLeftRadius,
        actionsDisplay: actionStyle.display,
        columns: actionStyle.gridTemplateColumns.split(' ').length,
        labels: buttons.map((button) => button.textContent.trim()),
        heights: buttons.map((button) => Math.round(button.getBoundingClientRect().height)),
        widths: buttons.map((button) => Math.round(button.getBoundingClientRect().width)),
        panelWidth: Math.round(panel.getBoundingClientRect().width),
        disabled: buttons.map((button) => button.disabled),
      };
    })()`);
    assert.equal(layout.panelDisplay, 'grid');
    assert.equal(layout.panelRadius, '8px');
    assert.equal(layout.actionsDisplay, 'grid');
    assert.equal(layout.columns, 3, '녹음·정지·다운로드가 한 줄 세 칸');
    assert.deepEqual(layout.labels, ['녹음', '정지', '다운로드']);
    assert.ok(layout.heights.every((height) => height >= 36), `버튼 높이 36px 이상: ${layout.heights}`);
    assert.ok(Math.max(...layout.widths) - Math.min(...layout.widths) <= 1, `세 칸의 너비가 같다: ${layout.widths}`);
    assert.ok(layout.widths.reduce((sum, width) => sum + width, 0) <= layout.panelWidth, '버튼이 패널 밖으로 나가지 않는다');
    assert.deepEqual(layout.disabled, [true, true, true], '연결 전에는 세 버튼이 모두 꺼져 있다');
  } finally {
    await app.close();
  }
}

console.log(
  'Recording regression passed: reusable master destination, MIME selection, timer/data finalization, URL revoke, device/start/file/stop finalize, panic/howl finalize, unmount cleanup and UI contract.',
);
