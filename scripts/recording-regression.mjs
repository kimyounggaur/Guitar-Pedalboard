import assert from 'node:assert/strict';
import { Blob, Buffer, File } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const [engineSource, storeSource, meterSource, appShellSource, cssSource] = await Promise.all([
  readFile(new URL('../src/audio/AudioEngine.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/store/audioStore.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/Meter.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/AppShell.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/styles/panels.css', import.meta.url), 'utf8'),
]);

assert.match(engineSource, /createRecorderStream\(\): MediaStream/);
assert.match(engineSource, /this\.context\.createMediaStreamDestination\(\)/);
assert.match(engineSource, /this\.masterGain\.connect\(this\.recorderDestination\)/);
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
assert.match(storeSource, /panic:[\s\S]*finishActiveRecording\('abort'\)[\s\S]*audioEngine\.panic\(\)/);
assert.match(storeSource, /HOWL_DURATION_MS[\s\S]*finishActiveRecording\('abort'\)[\s\S]*engine\.panic\(\)/);
assert.match(appShellSource, /useEffect\(\(\) => \(\) => disposeRecording\(\)/);
for (const label of ['녹음', '정지', '다운로드']) {
  assert.match(meterSource, new RegExp(`>\\s*${label}\\s*<\\/button>`));
}
assert.match(meterSource, /disabled=\{!recordingSupported \|\| !isRunning/);
assert.match(meterSource, /disabled=\{recordingStatus !== 'recording'\}/);
assert.match(meterSource, /aria-live="polite"/);
assert.match(meterSource, /createRecordingFilename\(\)/);
assert.match(cssSource, /\.recording-panel/);
assert.match(cssSource, /\.recording-actions/);

const helperBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/recording.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperBundle.outputFiles[0].text).toString('base64')}`;
const { createRecordingFilename, selectRecorderMimeType } = await import(helperUrl);

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
assert.equal(
  createRecordingFilename(new Date(2026, 8, 28, 7, 5, 9)),
  'pedalboard-20260928-070509.webm',
);

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
  stdin: {
    contents: `
      export { AudioEngine } from './src/audio/AudioEngine.ts';
      export { useAudioStore } from './src/store/audioStore.ts';
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
const { AudioEngine, useAudioStore } = await import(runtimeUrl);
const engine = AudioEngine.getInstance();

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
engine.masterGain = master;
assert.equal(engine.createRecorderStream(), recorderStream);
assert.equal(engine.createRecorderStream(), recorderStream);
assert.equal(destinationCreates, 1, 'recorder destination을 재사용하지 않았습니다.');
assert.deepEqual(masterConnects, [destination]);
engine.panic();
assert.equal(recorderTrackStops, 1);
assert.equal(destinationDisconnects, 1);

let streamRequests = 0;
let enginePanics = 0;
let engineStops = 0;
let engineStarts = 0;
let engineFileStarts = 0;
let switchedDevice = null;
let playbackEndedHandler = null;
let recorderStreamDisposals = 0;
engine.createRecorderStream = () => {
  streamRequests += 1;
  return recorderStream;
};
engine.panic = () => {
  enginePanics += 1;
};
engine.stop = async () => {
  engineStops += 1;
};
engine.start = async () => {
  engineStarts += 1;
};
engine.startFile = async () => {
  engineFileStarts += 1;
};
engine.setInputDevice = async (deviceId) => {
  switchedDevice = deviceId;
};
engine.listInputDevices = async () => [];
engine.setPlaybackEndedHandler = (handler) => {
  playbackEndedHandler = handler;
};
engine.readFilePlayback = () => ({ currentTime: 0, duration: 60, isPaused: false });
engine.readLatency = () => ({ base: 1, output: 2, sampleRate: 48_000 });
engine.readPitch = () => ({ frequency: null, note: null, cents: 0 });
engine.readAudioGlitchCount = () => 0;
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
assert.equal(switchedDevice, 'input-2');
assert.equal(useAudioStore.getState().recordingStatus, 'ready');

useAudioStore.getState().startRecording();
await useAudioStore.getState().start();
assert.equal(engineStarts, 1);
assert.equal(useAudioStore.getState().recordingStatus, 'ready');

useAudioStore.getState().startRecording();
await useAudioStore.getState().startFile(new File(['audio'], 'test.wav', { type: 'audio/wav' }));
assert.equal(engineFileStarts, 1);
assert.equal(typeof playbackEndedHandler, 'function');
assert.equal(useAudioStore.getState().recordingStatus, 'ready');

useAudioStore.getState().startRecording();
await useAudioStore.getState().stop();
assert.equal(engineStops, 1);
assert.equal(useAudioStore.getState().recordingStatus, 'ready');

useAudioStore.setState({ isRunning: true, inputMode: 'device' });
useAudioStore.getState().startRecording();
recorder = MockMediaRecorder.instances.at(-1);
const urlsBeforePanic = createdUrls.length;
useAudioStore.getState().panic();
await Promise.resolve();
assert.equal(enginePanics, 1);
assert.equal(recorder.stopCalls, 1);
assert.equal(useAudioStore.getState().recordingStatus, 'idle');
assert.equal(useAudioStore.getState().recordedUrl, null);
assert.equal(createdUrls.length, urlsBeforePanic, 'Panic abort가 Blob URL을 만들었습니다.');

useAudioStore.setState({
  isRunning: true,
  inputMode: 'device',
  howlProtectionEnabled: true,
  error: null,
});
useAudioStore.getState().startRecording();
const loudLevel = {
  db: 0,
  linear: 1,
  peakDb: 0,
  peakLinear: 1,
  isClipping: true,
  clipHoldUntil: 0,
};
useAudioStore.getState().refreshMeters(loudLevel, loudLevel);
now += 1_300;
useAudioStore.getState().refreshMeters(loudLevel, loudLevel);
await Promise.resolve();
assert.equal(enginePanics, 2);
assert.equal(useAudioStore.getState().recordingStatus, 'idle');
assert.match(useAudioStore.getState().error, /하울링/);

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

console.log(
  'Recording regression passed: reusable master destination, MIME selection, timer/data finalization, URL revoke, device/start/file/stop finalize, panic/howl/unmount abort and UI contract.',
);
