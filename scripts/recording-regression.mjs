import assert from 'node:assert/strict';
import { Blob, Buffer, File } from 'node:buffer';
import console from 'node:console';
import { setImmediate } from 'node:timers';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const [engineSource, storeSource, meterSource, appShellSource, cssSource] = await Promise.all([
  readFile(new URL('../src/audio/AudioEngine.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/store/audioStore.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/Meter.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/panels.css', import.meta.url), 'utf8'),
]);

assert.match(engineSource, /createRecorderStream\(\): MediaStream/);
assert.match(engineSource, /this\.context\.createMediaStreamDestination\(\)/);
// 녹음은 스피커와 같은 리미터 출력(OutputStage.output)에서 갈라진다.
assert.match(engineSource, /this\.outputStage\?\.output\.connect\(this\.recorderDestination\)/);
assert.match(engineSource, /destination\.stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
assert.match(storeSource, /disposeRecordingRuntime[\s\S]*audioEngine\.disposeRecorderStream\(\)/);
assert.match(storeSource, /export type RecordingStatus = 'idle' \| 'recording' \| 'ready'/);
assert.match(storeSource, /let activeRecorder: MediaRecorder \| null/);
assert.match(storeSource, /let recordingChunks: Blob\[\]/);
assert.match(storeSource, /let recordingTimer: number \| null/);
assert.match(storeSource, /selectRecorderMimeType/);
assert.match(storeSource, /revokeRecordingUrl\(state\.recordedUrl\)/);
assert.match(storeSource, /setSelectedDevice:[\s\S]*finishActiveRecording\('finalize'\)/);
assert.match(storeSource, /startFile:[\s\S]*finishActiveRecording\('finalize'\)/);
// 정지 이유가 무엇이든 정리 절차는 하나다(S1.2): Panic 도 stopSession → AudioSession.stop 을 지나고,
// 그 ③ 단계(finalizeRecording 포트)가 녹음을 마감한다.
assert.match(storeSource, /panic:[\s\S]*stopSession\('panic'\)/);
assert.match(storeSource, /async function finalizeRecordingForStop\(\)[\s\S]*finishActiveRecording\('finalize'\)/);
assert.match(storeSource, /finalizeRecording: finalizeRecordingForStop/);
assert.doesNotMatch(storeSource, /audioEngine\.panic\(|AudioEngine\.getInstance\(\)\.stop\(/);
assert.match(storeSource, /audioEngine\.setHowlHandler/);
assert.match(appShellSource, /useEffect\(\(\) => \(\) => disposeRecording\(\)/);
for (const label of ['녹음', '정지', '다운로드']) {
  assert.match(meterSource, new RegExp(`>\\s*${label}\\s*<\\/button>`));
}
assert.match(meterSource, /disabled=\{!selectedRecordingSupported \|\| !isRunning/);
assert.match(meterSource, /disabled=\{recordingStatus !== 'recording'\}/);
assert.match(meterSource, /aria-live="polite"/);
assert.match(meterSource, /createRecordingFilename\(new Date\(\), recordedFormat\)/);
assert.match(cssSource, /\.recording-panel/);
assert.match(cssSource, /\.recording-actions/);

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
const { createRecordingFilename, selectRecorderMimeType, recordingFormatFromMime, encodePcmWav, WavRecorder } = await import(helperUrl);

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
assert.doesNotMatch(createRecordingFilename(new Date(2026, 8, 28), 'unknown'), /\.[a-z]+$/);
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
assert.match(createRecordingFilename(new Date(2026, 8, 28), 'wav'), /\.wav$/);
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
class ShortLimitContext extends MockWavContext { constructor() { super(); this.sampleRate = 1; } }
globalThis.AudioContext = ShortLimitContext;
const limitedRecorder = new WavRecorder({}, () => { limitCalls += 1; });
const samples = new Float32Array(130).fill(0.5);
MockWavContext.instances.at(-1).processor.onaudioprocess({ inputBuffer: { numberOfChannels: 1, getChannelData() { return samples; } } });
assert.equal(limitCalls, 1);
const limitedWav = new DataView(await (await limitedRecorder.stop()).arrayBuffer());
assert.equal(limitedWav.getUint32(40, true), 120 * 4);
delete globalThis.AudioContext;

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
const masterConnects = [];
const master = {
  gain: {
    cancelScheduledValues() {},
    setValueAtTime() {},
  },
  connect: (node) => masterConnects.push(node),
  disconnect() {},
};
engine.context = {
  state: 'running',
  currentTime: 0,
  createMediaStreamDestination: () => {
    destinationCreates += 1;
    return destination;
  },
};
engine.outputStage = { input: master, output: master, dispose() {} };
let inputStops = 0;
engine.stream = { getTracks: () => [{ stop: () => inputStops++ }] };
assert.equal(engine.createRecorderStream(), recorderStream);
assert.equal(engine.createRecorderStream(), recorderStream);
assert.equal(destinationCreates, 1, 'recorder destination을 재사용하지 않았습니다.');
assert.deepEqual(masterConnects, [destination]);
engine.stopInput();
assert.equal(inputStops, 1, '정지 절차는 마이크 입력 트랙을 바로 멈춰야 합니다');
assert.equal(recorderTrackStops, 0, '녹음 마감을 기다리는 동안 recorder 트랙은 살아 있어야 합니다');
engine.disposeRecorderStream();
assert.equal(recorderTrackStops, 1);
assert.equal(destinationDisconnects, 1);

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

useAudioStore.setState({ isRunning: true, inputMode: 'device', error: null });
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
assert.equal(toastMessages().length, 1);
assert.match(toastMessages()[0], /긴급 정지했습니다\. 마이크와 오디오를 모두 껐습니다\./);
assert.match(toastMessages()[0], /녹음은 저장했습니다\./);
assert.equal(useAudioStore.getState().error, null);

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
assert.match(toastMessages()[0], /하울링이 감지되어 정지했습니다\. 스피커 음량을 줄이거나 헤드폰을 쓰세요\./);
assert.match(toastMessages()[0], /녹음은 저장했습니다\./);
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
assert.match(createdBlobs.at(-1).type, /^audio\/mp4/);
assert.match(createRecordingFilename(new Date(2026, 8, 28), useAudioStore.getState().recordedFormat), /\.m4a$/);
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
assert.match(createdBlobs.at(-1).type, /^audio\/ogg/);

globalThis.AudioContext = ShortLimitContext;
useAudioStore.setState({ isRunning: true, inputMode: 'device', error: null });
useAudioStore.getState().setRecordingFormat('wav');
useAudioStore.getState().startRecording();
assert.equal(useAudioStore.getState().recordingStatus, 'recording');
MockWavContext.instances.at(-1).processor.onaudioprocess({ inputBuffer: { numberOfChannels: 1, getChannelData() { return samples; } } });
await new Promise((resolve) => setImmediate(resolve));
assert.equal(useAudioStore.getState().recordingStatus, 'ready');
assert.equal(useAudioStore.getState().recordedFormat, 'wav');
assert.ok(useAudioStore.getState().recordedUrl);
assert.match(useAudioStore.getState().error, /WAV 녹음 제한/);
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
assert.match(toastMessages()[0], /입력 장치 연결이 끊겼습니다\. 장치를 다시 연결한 뒤 연결하기를 누르세요\./);
assert.equal(useAudioStore.getState().error, null);
assert.equal(useAudioStore.getState().isRunning, false);
engine.sessionGeneration += 1;
endedCallback();
await new Promise((resolve) => setImmediate(resolve));
assert.equal(engineStops, stopsBeforeDisconnect + 1);
useAudioStore.getState().disposeRecording();

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

console.log(
  'Recording regression passed: reusable master destination, MIME selection, timer/data finalization, URL revoke, device/start/file/stop finalize, panic/howl finalize, unmount cleanup and UI contract.',
);
