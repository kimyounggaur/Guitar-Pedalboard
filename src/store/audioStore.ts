import { notifyStorageFailure } from './storageNotice';
import { create } from 'zustand';
import { AudioEngine } from '../audio/AudioEngine';
import {
  AudioSession,
  type StopDetail,
  type StopReason,
  type StopResult,
} from '../audio/engine/AudioSession';
import type { ChannelDecision } from '../audio/engine/channelDecision';
import {
  isChannelDecision,
  isInputChannelMode,
  type InputChannelMode,
  type InputChannelState,
} from '../audio/engine/InputStage';
import type {
  CrunchParams,
  DelayParams,
  DriveParams,
  FuzzParams,
  LatencyReading,
  LevelReading,
  PedalState,
  PitchReading,
  TremoloParams,
  TuningPresetId,
} from '../audio/types';
import {
  addTapTempoTap,
  normalizeTapTempoBpm,
  TAP_TEMPO_DEFAULT_BPM,
} from '../audio/tapTempo';
import {
  createMidiMapping,
  MIDI_STORAGE_KEY,
  midiMappingMatches,
  parseMidiMappingsJson,
  parseMidiMessage,
  type MidiDeviceInfo,
  type MidiMappings,
} from '../audio/midi';
import { recordingFormatFromMime, selectRecorderMimeType, WavRecorder, type RecordingFileFormat } from '../audio/recording';
import { usePedalStore } from './pedalStore';
import { showToast } from './toastStore';

const IO_STORAGE_KEY = 'guitar-pedalboard:io';
const OUTPUT_STORAGE_KEY = 'guitar-pedalboard:output-device';
function readOutputDevice(): string {
  try { return typeof window === 'undefined' ? '' : window.localStorage.getItem(OUTPUT_STORAGE_KEY) ?? ''; } catch { return ''; }
}
const initialOutputDevice = readOutputDevice();
const RECORDING_TIMER_INTERVAL_MS = 250;
const RECORDING_STOP_FALLBACK_MS = 1000;

/** 장치별로 기억하는 입력 채널 설정(S1.3). 키는 `inputChannelKey` 가 만든다. */
interface StoredInputChannel {
  mode: InputChannelMode;
  /** 지난 세션에서 자동 판정이 낸 결과. 아직 없으면 null */
  decision: ChannelDecision | null;
}

interface IoSettings {
  inputGainDb: number;
  masterVolume: number;
  howlProtectionEnabled: boolean;
  tuningReferenceHz: number;
  /** S1.3 에서 추가한 필드. 기존 저장값에는 없고, 없으면 빈 객체로 읽는다. */
  inputChannels: Record<string, StoredInputChannel>;
}

const defaultIoSettings: IoSettings = {
  inputGainDb: 0,
  masterVolume: 0.9,
  howlProtectionEnabled: true,
  tuningReferenceHz: 440,
  inputChannels: {},
};

/** 기억해 두는 장치 수의 상한. 넘으면 가장 오래 전에 쓴 것부터 잊는다. */
const MAX_REMEMBERED_INPUT_DEVICES = 20;
const DEFAULT_INPUT_CHANNEL_KEY = 'default';

function inputChannelKey(deviceId: string): string {
  return deviceId || DEFAULT_INPUT_CHANNEL_KEY;
}

function readInputChannels(value: unknown): Record<string, StoredInputChannel> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  const result: Record<string, StoredInputChannel> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(-MAX_REMEMBERED_INPUT_DEVICES)) {
    if (!entry || typeof entry !== 'object') continue;
    const { mode, decision } = entry as Record<string, unknown>;
    if (!isInputChannelMode(mode)) continue;
    result[key] = { mode, decision: isChannelDecision(decision) ? decision : null };
  }
  return result;
}

const silentLevel: LevelReading = {
  db: -120,
  linear: 0,
  peakDb: -120,
  peakLinear: 0,
  isClipping: false,
  clipHoldUntil: 0,
};
const emptyPitch: PitchReading = { frequency: null, note: null, cents: 0 };
const emptyLatency: LatencyReading = { base: null, output: null, input: null, sampleRate: 0 };


function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readIoSettings(): IoSettings {
  if (typeof window === 'undefined') return { ...defaultIoSettings };

  try {
    const raw = window.localStorage.getItem(IO_STORAGE_KEY);
    if (!raw) return { ...defaultIoSettings };

    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return { ...defaultIoSettings };

    const stored = parsed as Record<string, unknown>;
    const inputGainDb =
      typeof stored.inputGainDb === 'number' && Number.isFinite(stored.inputGainDb)
        ? clamp(stored.inputGainDb, -24, 24)
        : defaultIoSettings.inputGainDb;
    const masterVolume =
      typeof stored.masterVolume === 'number' && Number.isFinite(stored.masterVolume)
        ? clamp(stored.masterVolume, 0, 1)
        : defaultIoSettings.masterVolume;

    return {
      inputGainDb,
      masterVolume,
      howlProtectionEnabled:
        typeof stored.howlProtectionEnabled === 'boolean'
          ? stored.howlProtectionEnabled
          : defaultIoSettings.howlProtectionEnabled,
      tuningReferenceHz:
        typeof stored.tuningReferenceHz === 'number' && Number.isFinite(stored.tuningReferenceHz)
          ? Math.round(clamp(stored.tuningReferenceHz, 400, 480))
          : defaultIoSettings.tuningReferenceHz,
      inputChannels: readInputChannels(stored.inputChannels),
    };
  } catch {
    return { ...defaultIoSettings };
  }
}

function persistIoSettings(settings: IoSettings): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage.setItem(IO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    notifyStorageFailure();
  }
}

function resetHowlWatch(): void {
  // Detection state is held in the audio worklet.
}

function isSamePitch(left: PitchReading, right: PitchReading): boolean {
  return (
    left.frequency === right.frequency &&
    left.note === right.note &&
    left.cents === right.cents &&
    left.targetNote === right.targetNote &&
    left.stringNumber === right.stringNumber &&
    left.octaveMismatch === right.octaveMismatch
  );
}

function isSameLatency(left: LatencyReading, right: LatencyReading): boolean {
  return (
    left.base === right.base &&
    left.output === right.output &&
    left.input === right.input &&
    left.sampleRate === right.sampleRate
  );
}

const initialIoSettings = readIoSettings();
const audioEngine = AudioEngine.getInstance();
audioEngine.setInputGain(initialIoSettings.inputGainDb);
audioEngine.setMasterVolume(initialIoSettings.masterVolume);
audioEngine.setTunerActive(false);
audioEngine.setTuningPreset('standard');
audioEngine.setTuningReferenceHz(initialIoSettings.tuningReferenceHz);

const MIDI_SUPPORTED =
  typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';

let midiAccess: MIDIAccess | null = null;
let midiAccessPromise: Promise<MIDIAccess> | null = null;
let midiSessionGeneration = 0;
const attachedMidiInputs = new Map<string, MIDIInput>();

function readMidiMappings(): MidiMappings {
  if (typeof window === 'undefined') return {};

  try {
    return parseMidiMappingsJson(window.localStorage?.getItem(MIDI_STORAGE_KEY) ?? null);
  } catch {
    return {};
  }
}

function persistMidiMappings(mappings: MidiMappings): void {
  if (typeof window === 'undefined') return;

  try {
    window.localStorage?.setItem(MIDI_STORAGE_KEY, JSON.stringify(mappings));
  } catch {
    notifyStorageFailure();
  }
}

let midiAdvancedHandler: ((data: Uint8Array) => boolean) | null = null;
let midiAdvancedMatches: ((data: Uint8Array) => boolean) | null = null;
export function registerMidiAdvancedHandler(handler: ((data: Uint8Array) => boolean) | null, matches: ((data: Uint8Array) => boolean) | null): void {
  midiAdvancedHandler = handler;
  midiAdvancedMatches = matches;
}
const midiPressed = new Map<string, boolean>();

function handleMidiMessage(event: MIDIMessageEvent): void {
  const audioState = useAudioStore.getState();
  if (audioState.midiLearningPedalId && event.data && midiAdvancedMatches?.(event.data)) {
    useAudioStore.setState({ midiError: '이 MIDI 신호는 익스프레션 또는 프리셋 전환에 이미 사용 중입니다.' });
    return;
  }
  if (!audioState.midiLearningPedalId && event.data && midiAdvancedHandler?.(event.data)) return;
  const message = parseMidiMessage(event.data);
  if (!message) return;
  const learningPedalId = audioState.midiLearningPedalId;
  if (learningPedalId) {
    const pedalExists = usePedalStore
      .getState()
      .pedals.some((pedal) => pedal.id === learningPedalId);
    if (!pedalExists) {
      useAudioStore.setState({ midiLearningPedalId: null });
      return;
    }

    const midiMappings: MidiMappings = {
      ...audioState.midiMappings,
      [learningPedalId]: createMidiMapping(message),
    };
    persistMidiMappings(midiMappings);
    useAudioStore.setState({
      midiMappings,
      midiLearningPedalId: null,
      midiError: null,
    });
    return;
  }

  Object.entries(audioState.midiMappings).forEach(([pedalId, mapping]) => {
    if (!midiMappingMatches(mapping, message)) return;

    const pedalStore = usePedalStore.getState();
    const pedal = pedalStore.pedals.find((candidate) => candidate.id === pedalId);
    if (!pedal) return;
    let bypassed = message.bypassed;
    if (mapping.mode === 'toggle') {
      const pressed = !message.bypassed;
      const wasPressed = midiPressed.get(pedalId) ?? false;
      midiPressed.set(pedalId, pressed);
      if (!pressed || wasPressed) return;
      bypassed = !pedal.bypassed;
    }
    if (pedal.bypassed === bypassed) return;
    pedalStore.setPedalBypass(pedalId, bypassed);
    audioEngine.setPedalBypass(pedalId, bypassed);
  });
}

function syncMidiInputs(): void {
  if (!midiAccess) return;

  const connectedInputs = new Map<string, MIDIInput>();
  midiAccess.inputs.forEach((input) => {
    if (input.state === 'connected') connectedInputs.set(input.id, input);
  });

  attachedMidiInputs.forEach((input, inputId) => {
    if (connectedInputs.get(inputId) === input) return;
    if (input.onmidimessage === handleMidiMessage) input.onmidimessage = null;
    attachedMidiInputs.delete(inputId);
  });

  connectedInputs.forEach((input, inputId) => {
    const previousInput = attachedMidiInputs.get(inputId);
    if (previousInput === input && input.onmidimessage === handleMidiMessage) return;
    if (previousInput?.onmidimessage === handleMidiMessage) previousInput.onmidimessage = null;
    input.onmidimessage = handleMidiMessage;
    attachedMidiInputs.set(inputId, input);
  });

  const midiDevices: MidiDeviceInfo[] = Array.from(connectedInputs.values())
    .map((input) => ({
      id: input.id,
      name: input.name ?? 'MIDI 입력',
      manufacturer: input.manufacturer ?? '',
      state: input.state,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
  useAudioStore.setState({ midiDevices });
}

function handleMidiStateChange(): void {
  syncMidiInputs();
}

function attachMidiAccess(access: MIDIAccess): void {
  if (midiAccess === access && midiAccess.onstatechange === handleMidiStateChange) {
    syncMidiInputs();
    return;
  }
  if (midiAccess && midiAccess !== access) {
    midiAccess.onstatechange = null;
  }
  midiAccess = access;
  midiAccess.onstatechange = handleMidiStateChange;
  syncMidiInputs();
}

async function requestMidiAccessForLearn(): Promise<MIDIAccess> {
  if (midiAccess) return midiAccess;
  if (!MIDI_SUPPORTED) throw new Error('Web MIDI를 지원하지 않는 브라우저입니다.');

  const pendingRequest =
    midiAccessPromise ?? navigator.requestMIDIAccess({ sysex: false });
  midiAccessPromise = pendingRequest;
  try {
    return await pendingRequest;
  } finally {
    if (midiAccessPromise === pendingRequest) midiAccessPromise = null;
  }
}

function disposeMidiRuntime(): void {
  midiSessionGeneration += 1;
  midiAccessPromise = null;
  attachedMidiInputs.forEach((input) => {
    if (input.onmidimessage === handleMidiMessage) input.onmidimessage = null;
  });
  attachedMidiInputs.clear();
  if (midiAccess) midiAccess.onstatechange = null;
  midiAccess = null;
}

export type RecordingStatus = 'idle' | 'recording' | 'ready';
type RecordingEndMode = 'finalize' | 'abort';

const MEDIA_RECORDER_SUPPORTED = typeof MediaRecorder !== 'undefined';
let activeRecorder: MediaRecorder | null = null;
let activeWavRecorder: WavRecorder | null = null;
let wavCompletion: Promise<void> | null = null;
let wavAbortRequested = false;
let recordingChunks: Blob[] = [];
let recordingTimer: number | null = null;
let recordingStopFallback: number | null = null;
let recordingStartedAt = 0;
let recordingGeneration = 0;
let recordingEndMode: RecordingEndMode = 'finalize';
let recordingStopRequested = false;
let recordingMimeType = '';
let recordingCompletion: Promise<void> | null = null;
let resolveRecordingCompletion: (() => void) | null = null;

function recordingNow(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function clearRecordingTimer(): void {
  if (recordingTimer === null || typeof window === 'undefined') return;
  window.clearInterval(recordingTimer);
  recordingTimer = null;
}

function clearRecordingStopFallback(): void {
  if (recordingStopFallback === null || typeof window === 'undefined') return;
  window.clearTimeout(recordingStopFallback);
  recordingStopFallback = null;
}

function revokeRecordingUrl(url: string | null): void {
  if (url && typeof URL !== 'undefined') URL.revokeObjectURL(url);
}

function settleRecording(
  candidate: MediaRecorder,
  generation: number,
  errorMessage?: string,
): void {
  if (candidate !== activeRecorder || generation !== recordingGeneration) return;

  clearRecordingTimer();
  clearRecordingStopFallback();
  candidate.ondataavailable = null;
  candidate.onstop = null;
  candidate.onerror = null;

  const chunks = recordingChunks;
  const mode = errorMessage ? 'abort' : recordingEndMode;
  const elapsed = Math.max(
    useAudioStore.getState().recordingElapsed,
    Math.floor((recordingNow() - recordingStartedAt) / 1000),
  );
  const resolveCompletion = resolveRecordingCompletion;

  activeRecorder = null;
  recordingChunks = [];
  recordingStopRequested = false;
  recordingCompletion = null;
  resolveRecordingCompletion = null;

  if (mode === 'finalize') {
    try {
      const mime = candidate.mimeType || recordingMimeType || chunks.find((chunk) => chunk.type)?.type || '';
      const blob = new Blob(chunks, { type: mime });
      const recordedUrl = URL.createObjectURL(blob);
      useAudioStore.setState({
        recordingStatus: 'ready',
        recordedUrl,
        recordedFormat: recordingFormatFromMime(mime),
        recordingElapsed: elapsed,
      });
    } catch {
      useAudioStore.setState({
        recordingStatus: 'idle',
        recordedUrl: null,
        recordingElapsed: 0,
        error: '녹음 파일을 만들지 못했습니다.',
      });
    }
  } else {
    useAudioStore.setState({
      recordingStatus: 'idle',
      recordedUrl: null,
      recordingElapsed: 0,
      ...(errorMessage ? { error: errorMessage } : {}),
    });
  }

  resolveCompletion?.();
}

function finishActiveRecording(mode: RecordingEndMode): Promise<void> {
  if (wavCompletion) {
    if (mode === 'abort') wavAbortRequested = true;
    return wavCompletion;
  }
  if (activeWavRecorder) {
    const recorder = activeWavRecorder;
    activeWavRecorder = null;
    wavAbortRequested = mode === 'abort';
    clearRecordingTimer();
    const elapsed = Math.floor((recordingNow() - recordingStartedAt) / 1000);
    wavCompletion = recorder.stop().then((blob) => {
      if (!wavAbortRequested) {
        useAudioStore.setState({ recordingStatus: 'ready', recordedUrl: URL.createObjectURL(blob), recordedFormat: 'wav', recordingElapsed: elapsed });
      } else {
        useAudioStore.setState({ recordingStatus: 'idle', recordedUrl: null, recordingElapsed: 0 });
      }
    }).catch(() => useAudioStore.setState({ recordingStatus: 'idle', error: 'WAV 녹음을 저장하지 못했습니다.' }))
      .finally(() => { wavCompletion = null; });
    return wavCompletion;
  }
  const candidate = activeRecorder;
  if (!candidate) {
    clearRecordingTimer();
    clearRecordingStopFallback();
    return Promise.resolve();
  }

  if (mode === 'abort') {
    recordingEndMode = 'abort';
    clearRecordingTimer();
    useAudioStore.setState({ recordingStatus: 'idle', recordingElapsed: 0 });
  }

  const completion = recordingCompletion ?? Promise.resolve();
  if (recordingStopRequested) return completion;

  recordingStopRequested = true;
  const generation = recordingGeneration;
  if (typeof window !== 'undefined') {
    recordingStopFallback = window.setTimeout(
      () => settleRecording(candidate, generation),
      RECORDING_STOP_FALLBACK_MS,
    );
  }

  try {
    candidate.stop();
  } catch {
    settleRecording(candidate, generation, '녹음을 안전하게 종료하지 못했습니다.');
  }

  return completion;
}

function disposeRecordingRuntime(recordedUrl: string | null): void {
  void finishActiveRecording('abort');
  audioEngine.disposeRecorderStream();
  revokeRecordingUrl(recordedUrl);
  useAudioStore.setState({
    recordingStatus: 'idle',
    recordedUrl: null,
    recordingElapsed: 0,
  });
}

/** 정리 절차 ③: 녹음 중이었으면 마감을 기다린다. 파일이 만들어졌으면 true, 녹음 중이 아니었으면 false. */
async function finalizeRecordingForStop(): Promise<boolean> {
  const wasRecording = activeRecorder !== null || activeWavRecorder !== null || wavCompletion !== null;
  if (!wasRecording) return false;
  await finishActiveRecording('finalize');
  return useAudioStore.getState().recordingStatus === 'ready';
}

/** 정리 절차 ⑧: 정지 이유별 안내(설계서 4.2절). 오류 경계 화면은 S1.7, 시작 실패 문구는 store.error 가 맡는다. */
function announceStop(result: StopResult, detail: StopDetail): void {
  const savedNote = result.recordingSaved ? ' 녹음은 저장했습니다.' : '';
  switch (result.reason) {
    case 'user-disconnect':
      if (result.recordingSaved) {
        showToast({ kind: 'success', key: 'recording-saved', message: '녹음을 저장했습니다.' });
      }
      break;
    case 'panic':
      showToast({
        kind: 'warning',
        key: 'session-stop',
        message: `긴급 정지했습니다. 마이크와 오디오를 모두 껐습니다.${savedNote}`,
      });
      break;
    case 'howl': {
      const frequency = detail.howlFrequencyHz;
      const where = typeof frequency === 'number' && Number.isFinite(frequency) ? `(약 ${Math.round(frequency)} Hz)` : '';
      showToast({
        kind: 'warning',
        key: 'session-stop',
        message: `하울링${where}이 감지되어 정지했습니다. 스피커 음량을 줄이거나 헤드폰을 쓰세요.${savedNote}`,
      });
      break;
    }
    case 'device-lost':
      showToast({
        kind: 'warning',
        key: 'session-stop',
        message: `입력 장치 연결이 끊겼습니다. 장치를 다시 연결한 뒤 연결하기를 누르세요.${savedNote}`,
      });
      break;
    case 'error':
      break;
  }
  if (result.failedSteps.length > 0) {
    showToast({
      kind: 'error',
      key: 'session-stop-failed',
      message: '정지하는 중 일부 정리가 끝나지 않았습니다. 소리가 계속 나면 페이지를 새로고침해 주세요.',
    });
  }
}

/**
 * 오디오 세션 하나. 시작과 모든 종류의 정지(연결 해제·Panic·Esc·하울링·장치 분리·파일 재생 끝·시작 실패)가
 * 이 객체를 지난다. 정지 코드를 이유별로 따로 두지 않는다(설계서 S1.2, REFACTOR_LOG L-15).
 */
const audioSession = new AudioSession({
  start: (source) =>
    source.kind === 'file' ? audioEngine.startFile(source.file) : audioEngine.start(source.deviceId || undefined),
  invalidatePendingStart: () => audioEngine.invalidatePendingStart(),
  silenceOutput: () => audioEngine.silenceOutput(),
  stopInput: () => audioEngine.stopInput(),
  finalizeRecording: finalizeRecordingForStop,
  pausePlayback: () => audioEngine.pausePlayback(),
  releaseGraph: () => audioEngine.releaseGraph(),
  closeContext: () => audioEngine.closeContext(),
  advanceGeneration: () => audioEngine.advanceGeneration(),
  notify: announceStop,
});

type InputMode = 'idle' | 'device' | 'file';

type TempoPedalState = PedalState & {
  type: 'delay' | 'tremolo';
  params: DelayParams | TremoloParams;
};

function isTempoPedal(pedal: PedalState): pedal is TempoPedalState {
  return pedal.type === 'delay' || pedal.type === 'tremolo';
}

function readInitialTempoBpm(): number {
  const syncedPedal = usePedalStore
    .getState()
    .pedals.find((pedal) => isTempoPedal(pedal) && pedal.params.sync);

  return syncedPedal && isTempoPedal(syncedPedal)
    ? normalizeTapTempoBpm(syncedPedal.params.bpm)
    : TAP_TEMPO_DEFAULT_BPM;
}

function applyGlobalBpmToSyncedPedals(bpm: number): void {
  const pedalStore = usePedalStore.getState();
  const changedIds: string[] = [];
  const pedals = pedalStore.pedals.map((pedal) => {
    if (!isTempoPedal(pedal) || !pedal.params.sync || pedal.params.bpm === bpm) return pedal;

    changedIds.push(pedal.id);
    return {
      ...pedal,
      params: {
        ...pedal.params,
        bpm,
      },
    } as PedalState;
  });

  if (changedIds.length === 0) return;

  pedalStore.setPedals(pedals);
  changedIds.forEach((pedalId) => audioEngine.setPedalParam(pedalId, 'bpm', bpm));
}

function applyTempoSyncToPedal(pedalId: string, sync: boolean, bpm: number): void {
  const pedalStore = usePedalStore.getState();
  const currentPedal = pedalStore.pedals.find((pedal) => pedal.id === pedalId);
  if (!currentPedal || !isTempoPedal(currentPedal)) return;

  if (currentPedal.params.sync === sync && (!sync || currentPedal.params.bpm === bpm)) return;

  const pedals = pedalStore.pedals.map((pedal) => {
    if (pedal.id !== pedalId || !isTempoPedal(pedal)) return pedal;
    return {
      ...pedal,
      params: {
        ...pedal.params,
        sync,
        bpm: sync ? bpm : pedal.params.bpm,
      },
    } as PedalState;
  });

  pedalStore.setPedals(pedals);
  audioEngine.setPedalParam(pedalId, 'sync', sync);
}

interface AudioStore {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  outputDevices: MediaDeviceInfo[];
  selectedOutputDeviceId: string;
  outputSelectionSupported: boolean;
  setOutputDevice: (deviceId: string) => Promise<void>;
  inputMode: InputMode;
  uploadedFileName: string | null;
  fileCurrentTime: number;
  fileDuration: number;
  isFilePaused: boolean;
  isRunning: boolean;
  isLoading: boolean;
  error: string | null;
  inputLevel: LevelReading;
  outputLevel: LevelReading;
  activeEffectCount: number;
  audioGlitchCount: number | null;
  pitch: PitchReading;
  isTunerActive: boolean;
  tuningPreset: TuningPresetId;
  tuningReferenceHz: number;
  latency: LatencyReading;
  inputGainDb: number;
  masterVolume: number;
  howlProtectionEnabled: boolean;
  /** 선택한 입력 장치의 채널 모드(자동·1번·2번·스테레오). 장치별로 기억한다. */
  inputChannelMode: InputChannelMode;
  /** 자동 모드가 정한 입력. 'pending' 은 기타 소리가 들어오기를 기다리는 중이다. */
  inputChannelDecision: InputChannelState;
  /** 연결된 입력이 채널을 고를 수 있는지: true/false, 아직 연결 전이면 null(메뉴를 보인다). 파일 재생은 false. */
  inputChannelSelectable: boolean | null;
  /** 장치별로 기억한 입력 채널 설정(키: 장치 id, 기본 장치는 'default') */
  inputChannels: Record<string, StoredInputChannel>;
  setInputChannelMode: (mode: InputChannelMode) => void;
  chainGainWarning: string | null;
  estimatedChainGainDb: number;
  tapTempo: { taps: number[]; bpm: number };
  midiDevices: MidiDeviceInfo[];
  midiSupported: boolean;
  midiLearningPedalId: string | null;
  midiMappings: MidiMappings;
  midiError: string | null;
  recordingSupported: boolean;
  recordingFormat: 'webm' | 'wav';
  recordedFormat: RecordingFileFormat;
  setRecordingFormat: (format: 'webm' | 'wav') => void;
  recordingStatus: RecordingStatus;
  recordedUrl: string | null;
  recordingElapsed: number;
  loadDevices: () => Promise<void>;
  setInputGainDb: (value: number) => void;
  setMasterVolume: (value: number) => void;
  setHowlProtectionEnabled: (enabled: boolean) => void;
  setTunerActive: (active: boolean) => void;
  setTuningPreset: (preset: TuningPresetId) => void;
  setTuningReferenceHz: (referenceHz: number) => void;
  refreshChainGainWarning: () => void;
  setSelectedDevice: (deviceId: string) => Promise<void>;
  start: () => Promise<void>;
  startFile: (file: File) => Promise<void>;
  playFile: () => Promise<void>;
  pauseFile: () => void;
  seekFile: (deltaSeconds: number) => void;
  stop: () => Promise<void>;
  panic: () => void;
  tapTempoTap: () => void;
  setGlobalBpm: (bpm: number) => void;
  setTempoSync: (pedalId: string, sync: boolean) => void;
  adoptTempoFromPedals: () => void;
  connectSavedMidi: (force?: boolean) => Promise<void>;
  setMidiMode: (pedalId: string, mode: 'momentary' | 'toggle') => void;
  startMidiLearn: (pedalId: string) => Promise<void>;
  cancelMidiLearn: () => void;
  removeMidiMapping: (pedalId: string) => void;
  disposeMidi: () => void;
  startRecording: () => void;
  stopRecording: () => Promise<void>;
  disposeRecording: () => void;
  refreshMeters: (inputLevel: LevelReading, outputLevel: LevelReading) => void;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'NotAllowedError' || error.name === 'PermissionDeniedError') return '마이크 권한이 차단되었습니다. 브라우저 주소창의 사이트 설정에서 마이크를 허용해 주세요.';
    if (error.name === 'NotFoundError' || error.name === 'DevicesNotFoundError' || error.name === 'OverconstrainedError') return '선택한 입력 장치를 찾을 수 없습니다. 연결 상태를 확인하고 장치 목록을 새로고침해 주세요.';
    if (error.name === 'NotReadableError' || error.name === 'TrackStartError') return '입력 장치를 사용할 수 없습니다. 다른 앱에서 장치를 사용 중인지 확인해 주세요.';
    if (error.name === 'AbortError') return '오디오 장치 연결이 중단되었습니다. 장치를 확인한 뒤 다시 시도해 주세요.';
    if (/[가-힣]/.test(error.message)) return error.message;
  }
  return '오디오 장치를 시작하지 못했습니다.';
}

function resetReadings() {
  return {
    inputLevel: silentLevel,
    outputLevel: silentLevel,
    activeEffectCount: 0,
    audioGlitchCount: null,
    pitch: emptyPitch,
    latency: emptyLatency,
    fileCurrentTime: 0,
    fileDuration: 0,
    isFilePaused: true,
  };
}

/** 이 장치에 기억된 채널 모드·판정을 엔진과 화면 상태에 올린다. 장치를 고를 때와 연결을 시작하기 직전에 부른다. */
function loadInputChannels(deviceId: string): void {
  const stored = useAudioStore.getState().inputChannels[inputChannelKey(deviceId)];
  const mode = stored?.mode ?? 'auto';
  const decision = stored?.decision ?? null;
  audioEngine.setInputChannelMode(mode);
  audioEngine.setRememberedChannelDecision(decision);
  useAudioStore.setState({
    inputChannelMode: mode,
    inputChannelDecision: decision ?? 'pending',
    inputChannelSelectable: null,
  });
}

/** 지금 선택한 장치의 채널 모드와 자동 판정을 `guitar-pedalboard:io` 의 `inputChannels` 에 남긴다. */
function rememberInputChannels(): void {
  const state = useAudioStore.getState();
  const key = inputChannelKey(state.selectedDeviceId);
  const entry: StoredInputChannel = {
    mode: state.inputChannelMode,
    decision: state.inputChannelDecision === 'pending' ? null : state.inputChannelDecision,
  };
  const previous = state.inputChannels[key];
  if (previous && previous.mode === entry.mode && previous.decision === entry.decision) return;

  // 최근에 쓴 장치가 뒤로 가게 다시 넣고, 상한을 넘으면 앞(가장 오래된 것)부터 잊는다.
  const next = { ...state.inputChannels };
  delete next[key];
  next[key] = entry;
  const keys = Object.keys(next);
  for (const stale of keys.slice(0, Math.max(0, keys.length - MAX_REMEMBERED_INPUT_DEVICES))) delete next[stale];

  useAudioStore.setState({ inputChannels: next });
  persistIoSettings({
    inputGainDb: state.inputGainDb,
    masterVolume: state.masterVolume,
    howlProtectionEnabled: state.howlProtectionEnabled,
    tuningReferenceHz: state.tuningReferenceHz,
    inputChannels: next,
  });
}

/**
 * 화면을 곧바로 '연결 안 됨'으로 돌린 뒤 하나뿐인 정리 절차를 지난다. 이미 아무것도 없으면 화면은 건드리지 않는다.
 * isLoading 은 '연결 중'일 때만 쓴다: 정지 중에 눌린 '기타 연결하기'는 AudioSession.start 가 정지가 끝나기를 기다린다.
 */
function stopSession(reason: StopReason, detail: StopDetail = {}): Promise<StopResult> {
  const active = audioSession.state !== 'idle' || useAudioStore.getState().isRunning;
  if (active) {
    resetHowlWatch();
    useAudioStore.setState({
      isRunning: false,
      inputMode: 'idle',
      uploadedFileName: null,
      isLoading: false,
      error: null,
      inputChannelSelectable: null,
      ...resetReadings(),
    });
  }
  return audioSession.stop(reason, detail);
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  devices: [],
  selectedDeviceId: '',
  outputDevices: [],
  selectedOutputDeviceId: initialOutputDevice,
  outputSelectionSupported: audioEngine.supportsOutputSelection,
  inputMode: 'idle',
  uploadedFileName: null,
  fileCurrentTime: 0,
  fileDuration: 0,
  isFilePaused: true,
  isRunning: false,
  isLoading: false,
  error: null,
  inputLevel: silentLevel,
  outputLevel: silentLevel,
  activeEffectCount: 0,
  audioGlitchCount: null,
  pitch: emptyPitch,
  isTunerActive: false,
  tuningPreset: 'standard',
  tuningReferenceHz: initialIoSettings.tuningReferenceHz,
  latency: emptyLatency,
  inputGainDb: initialIoSettings.inputGainDb,
  masterVolume: initialIoSettings.masterVolume,
  howlProtectionEnabled: initialIoSettings.howlProtectionEnabled,
  inputChannelMode: initialIoSettings.inputChannels[DEFAULT_INPUT_CHANNEL_KEY]?.mode ?? 'auto',
  inputChannelDecision: initialIoSettings.inputChannels[DEFAULT_INPUT_CHANNEL_KEY]?.decision ?? 'pending',
  inputChannelSelectable: null,
  inputChannels: initialIoSettings.inputChannels,
  setInputChannelMode: (mode) => {
    audioEngine.setInputChannelMode(mode);
    set({ inputChannelMode: mode });
    rememberInputChannels();
  },
  chainGainWarning: null,
  estimatedChainGainDb: 0,
  tapTempo: { taps: [], bpm: readInitialTempoBpm() },
  midiDevices: [],
  midiSupported: MIDI_SUPPORTED,
  midiLearningPedalId: null,
  midiMappings: readMidiMappings(),
  midiError: null,
  recordingSupported: MEDIA_RECORDER_SUPPORTED,
  recordingFormat: 'webm',
  recordedFormat: 'webm',
  setRecordingFormat: (format) => { if (get().recordingStatus !== 'recording') set({ recordingFormat: format }); },
  recordingStatus: 'idle',
  recordedUrl: null,
  recordingElapsed: 0,

  setInputGainDb: (value) => {
    const inputGainDb = clamp(value, -24, 24);
    audioEngine.setInputGain(inputGainDb);
    set({ inputGainDb });
    persistIoSettings({
      inputGainDb,
      masterVolume: get().masterVolume,
      howlProtectionEnabled: get().howlProtectionEnabled,
      tuningReferenceHz: get().tuningReferenceHz,
      inputChannels: get().inputChannels,
    });
  },

  setMasterVolume: (value) => {
    const masterVolume = clamp(value, 0, 1);
    audioEngine.setMasterVolume(masterVolume);
    set({ masterVolume });
    persistIoSettings({
      inputGainDb: get().inputGainDb,
      masterVolume,
      howlProtectionEnabled: get().howlProtectionEnabled,
      tuningReferenceHz: get().tuningReferenceHz,
      inputChannels: get().inputChannels,
    });
  },

  setHowlProtectionEnabled: (enabled) => {
    resetHowlWatch();
    audioEngine.setHowlProtection(enabled);
    set({ howlProtectionEnabled: enabled });
    persistIoSettings({
      inputGainDb: get().inputGainDb,
      masterVolume: get().masterVolume,
      howlProtectionEnabled: enabled,
      tuningReferenceHz: get().tuningReferenceHz,
      inputChannels: get().inputChannels,
    });
  },

  setTunerActive: (active) => {
    audioEngine.setTunerActive(active);
    set({ isTunerActive: active, pitch: emptyPitch });
  },

  setTuningPreset: (preset) => {
    audioEngine.setTuningPreset(preset);
    set({ tuningPreset: preset, pitch: emptyPitch });
  },

  setTuningReferenceHz: (referenceHz) => {
    if (!Number.isFinite(referenceHz)) return;
    const value = Math.round(clamp(referenceHz, 400, 480));
    audioEngine.setTuningReferenceHz(value);
    set({ tuningReferenceHz: value, pitch: emptyPitch });
    persistIoSettings({
      inputGainDb: get().inputGainDb,
      masterVolume: get().masterVolume,
      howlProtectionEnabled: get().howlProtectionEnabled,
      tuningReferenceHz: value,
      inputChannels: get().inputChannels,
    });
  },

  refreshChainGainWarning: () => {
    const activeDistortionAmounts = usePedalStore
      .getState()
      .pedals.filter(
        (pedal) =>
          pedal.enabled &&
          !pedal.bypassed &&
          (pedal.type === 'drive' || pedal.type === 'crunch' || pedal.type === 'fuzz'),
      )
      .map((pedal) => {
        if (pedal.type === 'drive') return (pedal.params as DriveParams).drive;
        if (pedal.type === 'crunch') return (pedal.params as CrunchParams).gain;
        return (pedal.params as FuzzParams).fuzz;
      });
    const isExcessive =
      activeDistortionAmounts.length >= 2 &&
      activeDistortionAmounts.every((amount) => amount > 60);

    set({
      chainGainWarning: isExcessive ? '왜곡 페달이 중첩되어 게인이 과도합니다' : null,
      estimatedChainGainDb: audioEngine.estimateChainGain(),
    });
  },

  loadDevices: async () => {
    try {
      const [devices, outputDevices] = await Promise.all([audioEngine.listInputDevices(), audioEngine.listOutputDevices()]);
      set({ outputDevices });
      const state = get();
      const missing = Boolean(state.selectedDeviceId) && !devices.some((device) => device.deviceId === state.selectedDeviceId);
      if (missing && state.isRunning && state.inputMode === 'device') {
        await stopSession('device-lost');
        set({ devices, selectedDeviceId: '' });
      } else {
        set({ devices, ...(missing ? { selectedDeviceId: '' } : {}) });
      }
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  setOutputDevice: async (deviceId) => {
    try {
      await audioEngine.setOutputDevice(deviceId);
      set({ selectedOutputDeviceId: deviceId, error: null });
      try { window.localStorage.setItem(OUTPUT_STORAGE_KEY, deviceId); } catch { notifyStorageFailure(); }
    } catch {
      set({ error: '출력 장치를 변경할 수 없습니다. 장치 연결과 브라우저 권한을 확인해 주세요.' });
    }
  },

  setSelectedDevice: async (deviceId) => {
    const wasRunning = get().isRunning;
    set({ selectedDeviceId: deviceId, error: null });
    loadInputChannels(deviceId);

    if (!wasRunning || get().inputMode !== 'device') return;

    resetHowlWatch();
    set({ isLoading: true });

    try {
      await finishActiveRecording('finalize');
      const outcome = await audioSession.start({ kind: 'device', deviceId: deviceId || undefined });
      if (outcome === 'cancelled') return;
      const devices = await audioEngine.listInputDevices().catch(() => get().devices);
      set({
        devices,
        isRunning: true,
        inputMode: 'device',
        uploadedFileName: null,
        fileCurrentTime: 0,
        fileDuration: 0,
        isFilePaused: true,
        isLoading: false,
        error: null,
        inputChannelSelectable: audioEngine.getInputInfo()?.selectable ?? null,
      });
    } catch (error) {
      set({
        error: toErrorMessage(error),
        isRunning: false,
        inputMode: 'idle',
        isLoading: false,
        ...resetReadings(),
      });
    }
  },

  start: async () => {
    const { selectedDeviceId } = get();
    resetHowlWatch();
    set({ isLoading: true, error: null });
    loadInputChannels(selectedDeviceId);

    try {
      await finishActiveRecording('finalize');
      const outcome = await audioSession.start({ kind: 'device', deviceId: selectedDeviceId || undefined });
      if (outcome === 'cancelled') return;
      const devices = await audioEngine.listInputDevices().catch(() => get().devices);
      set({
        devices,
        isRunning: true,
        inputMode: 'device',
        uploadedFileName: null,
        fileCurrentTime: 0,
        fileDuration: 0,
        isFilePaused: true,
        isLoading: false,
        error: null,
        inputChannelSelectable: audioEngine.getInputInfo()?.selectable ?? null,
      });
    } catch (error) {
      set({
        error: toErrorMessage(error),
        isRunning: false,
        inputMode: 'idle',
        isLoading: false,
      });
    }
  },

  startFile: async (file) => {
    resetHowlWatch();
    set({ isLoading: true, error: null });

    try {
      await finishActiveRecording('finalize');
      const outcome = await audioSession.start({ kind: 'file', file });
      if (outcome === 'cancelled') return;
      const playback = audioEngine.readFilePlayback();
      set({
        isRunning: true,
        inputMode: 'file',
        uploadedFileName: file.name,
        fileCurrentTime: playback.currentTime,
        fileDuration: playback.duration,
        isFilePaused: playback.isPaused,
        isLoading: false,
        error: null,
        inputChannelSelectable: false,
      });
    } catch (error) {
      set({
        error: toErrorMessage(error),
        isRunning: false,
        inputMode: 'idle',
        uploadedFileName: null,
        fileCurrentTime: 0,
        fileDuration: 0,
        isFilePaused: true,
        isLoading: false,
      });
    }
  },

  playFile: async () => {
    set({ isLoading: true, error: null });

    try {
      const engine = AudioEngine.getInstance();
      await engine.playUploadedFile();
      const playback = engine.readFilePlayback();
      set({
        isRunning: true,
        inputMode: 'file',
        fileCurrentTime: playback.currentTime,
        fileDuration: playback.duration,
        isFilePaused: playback.isPaused,
        isLoading: false,
      });
    } catch (error) {
      set({
        error: toErrorMessage(error),
        isLoading: false,
      });
    }
  },

  pauseFile: () => {
    const engine = AudioEngine.getInstance();
    engine.pauseUploadedFile();
    const playback = engine.readFilePlayback();
    set({
      fileCurrentTime: playback.currentTime,
      fileDuration: playback.duration,
      isFilePaused: playback.isPaused,
    });
  },

  seekFile: (deltaSeconds) => {
    const engine = AudioEngine.getInstance();
    engine.seekUploadedFile(deltaSeconds);
    const playback = engine.readFilePlayback();
    set({
      fileCurrentTime: playback.currentTime,
      fileDuration: playback.duration,
      isFilePaused: playback.isPaused,
    });
  },

  stop: async () => {
    await stopSession('user-disconnect');
  },

  panic: () => {
    void stopSession('panic');
  },

  tapTempoTap: () => {
    const nextTapTempo = addTapTempoTap(get().tapTempo, performance.now());
    set({ tapTempo: nextTapTempo });

    if (nextTapTempo.taps.length >= 2) {
      applyGlobalBpmToSyncedPedals(nextTapTempo.bpm);
    }
  },

  setGlobalBpm: (value) => {
    const bpm = normalizeTapTempoBpm(value, get().tapTempo.bpm);
    set({ tapTempo: { taps: [], bpm } });
    applyGlobalBpmToSyncedPedals(bpm);
  },

  setTempoSync: (pedalId, sync) => {
    applyTempoSyncToPedal(pedalId, sync, get().tapTempo.bpm);
  },

  adoptTempoFromPedals: () => {
    const syncedPedal = usePedalStore
      .getState()
      .pedals.find((pedal) => isTempoPedal(pedal) && pedal.params.sync);
    const bpm = syncedPedal && isTempoPedal(syncedPedal)
      ? normalizeTapTempoBpm(syncedPedal.params.bpm, get().tapTempo.bpm)
      : get().tapTempo.bpm;

    set({ tapTempo: { taps: [], bpm } });
    applyGlobalBpmToSyncedPedals(bpm);
  },

  connectSavedMidi: async (force = false) => {
    if (!get().midiSupported || (!force && !Object.keys(get().midiMappings).length)) return;
    const generation = midiSessionGeneration;
    try {
      const access = await requestMidiAccessForLearn();
      if (generation === midiSessionGeneration) attachMidiAccess(access);
    } catch {
      if (generation === midiSessionGeneration) set({ midiError: '저장된 MIDI 매핑을 연결하지 못했습니다. MIDI 권한을 확인해 주세요.' });
    }
  },

  setMidiMode: (pedalId, mode) => {
    const mapping = get().midiMappings[pedalId];
    if (!mapping) return;
    const midiMappings = { ...get().midiMappings, [pedalId]: { ...mapping, mode } };
    midiPressed.delete(pedalId);
    persistMidiMappings(midiMappings);
    set({ midiMappings });
  },

  startMidiLearn: async (pedalId) => {
    if (!get().midiSupported) return;
    const pedalExists = usePedalStore
      .getState()
      .pedals.some((pedal) => pedal.id === pedalId);
    if (!pedalExists) return;

    const generation = midiSessionGeneration;
    set({ midiLearningPedalId: pedalId, midiError: null });

    try {
      const access = await requestMidiAccessForLearn();
      if (generation !== midiSessionGeneration) return;
      attachMidiAccess(access);
    } catch {
      if (generation !== midiSessionGeneration) return;
      set({
        midiDevices: [],
        midiLearningPedalId: null,
        midiError: 'MIDI 접근 권한을 확인할 수 없습니다.',
      });
    }
  },

  cancelMidiLearn: () => set({ midiLearningPedalId: null }),

  removeMidiMapping: (pedalId) => {
    const midiMappings = { ...get().midiMappings };
    if (!Object.hasOwn(midiMappings, pedalId)) return;
    delete midiMappings[pedalId];
    persistMidiMappings(midiMappings);
    set({ midiMappings });
  },

  disposeMidi: () => {
    disposeMidiRuntime();
    set({
      midiDevices: [],
      midiLearningPedalId: null,
      midiError: null,
    });
  },

  startRecording: () => {
    const state = get();
    if (!state.isRunning || activeRecorder || activeWavRecorder || wavCompletion || (state.recordingFormat === 'webm' && !state.recordingSupported)) return;

    revokeRecordingUrl(state.recordedUrl);
    set({
      recordingStatus: 'idle',
      recordedUrl: null,
      recordingElapsed: 0,
      error: null,
    });

    try {
      const stream = audioEngine.createRecorderStream();
      if (state.recordingFormat === 'wav') {
        if (typeof AudioContext === 'undefined' || !AudioContext.prototype.createScriptProcessor) throw new Error('이 브라우저는 WAV 녹음을 지원하지 않습니다.');
        recordingStartedAt = recordingNow();
        activeWavRecorder = new WavRecorder(stream, () => {
          void finishActiveRecording('finalize');
          useAudioStore.setState({ error: 'WAV 녹음 제한에 도달했거나 오디오를 시작할 수 없어 녹음을 종료했습니다.' });
        });
        recordingTimer = window.setInterval(() => useAudioStore.setState({ recordingElapsed: Math.floor((recordingNow() - recordingStartedAt) / 1000) }), RECORDING_TIMER_INTERVAL_MS);
        set({ recordingStatus: 'recording', recordingElapsed: 0 });
        return;
      }
      const mimeType = selectRecorderMimeType(
        typeof MediaRecorder.isTypeSupported === 'function'
          ? MediaRecorder.isTypeSupported.bind(MediaRecorder)
          : undefined,
      );
      const candidate = mimeType
        ? new MediaRecorder(stream, { mimeType })
        : new MediaRecorder(stream);
      const generation = ++recordingGeneration;

      activeRecorder = candidate;
      recordingChunks = [];
      recordingStartedAt = recordingNow();
      recordingEndMode = 'finalize';
      recordingStopRequested = false;
      recordingMimeType = mimeType ?? candidate.mimeType ?? '';
      recordingCompletion = new Promise((resolve) => {
        resolveRecordingCompletion = resolve;
      });

      candidate.ondataavailable = (event) => {
        if (
          candidate === activeRecorder &&
          generation === recordingGeneration &&
          event.data.size > 0
        ) {
          recordingChunks.push(event.data);
        }
      };
      candidate.onstop = () => settleRecording(candidate, generation);
      candidate.onerror = () => {
        if (candidate.state !== 'inactive') {
          try {
            candidate.stop();
          } catch {
            // The recorder may already be transitioning to the inactive state.
          }
        }
        settleRecording(candidate, generation, '녹음 중 오류가 발생했습니다.');
      };

      candidate.start(RECORDING_TIMER_INTERVAL_MS);
      recordingTimer = window.setInterval(() => {
        if (candidate !== activeRecorder || generation !== recordingGeneration) return;
        useAudioStore.setState({
          recordingElapsed: Math.floor((recordingNow() - recordingStartedAt) / 1000),
        });
      }, RECORDING_TIMER_INTERVAL_MS);
      set({ recordingStatus: 'recording', recordingElapsed: 0 });
    } catch (error) {
      clearRecordingTimer();
      clearRecordingStopFallback();
      if (activeRecorder) {
        activeRecorder.ondataavailable = null;
        activeRecorder.onstop = null;
        activeRecorder.onerror = null;
      }
      activeRecorder = null;
      recordingChunks = [];
      recordingStopRequested = false;
      recordingCompletion = null;
      resolveRecordingCompletion = null;
      set({
        recordingStatus: 'idle',
        recordedUrl: null,
        recordingElapsed: 0,
        error: toErrorMessage(error),
      });
    }
  },

  stopRecording: () => finishActiveRecording('finalize'),

  disposeRecording: () => disposeRecordingRuntime(get().recordedUrl),

  refreshMeters: (inputLevel, outputLevel) => {
    const engine = AudioEngine.getInstance();
    const state = get();
    const pitch = state.isTunerActive ? engine.readPitch() : emptyPitch;
    const latency = engine.readLatency();
    const playback = engine.readFilePlayback();
    const activeEffectCount = usePedalStore
      .getState()
      .pedals.filter((pedal) => pedal.enabled && !pedal.bypassed).length;
    const audioGlitchCount = engine.readAudioGlitchCount();

    set((current) => ({
      inputLevel,
      outputLevel,
      pitch: isSamePitch(current.pitch, pitch) ? current.pitch : pitch,
      latency: isSameLatency(current.latency, latency) ? current.latency : latency,
      fileCurrentTime: playback.currentTime,
      fileDuration: playback.duration,
      isFilePaused: playback.isPaused,
      activeEffectCount,
      audioGlitchCount,
    }));
  },
}));

if (initialOutputDevice && audioEngine.supportsOutputSelection) {
  void audioEngine.setOutputDevice(initialOutputDevice);
}

// 자동 입력 채널 판정이 나면(세션마다 한 번) 화면에 보이고 이 장치의 기억에 남긴다.
const initialChannelState = useAudioStore.getState();
audioEngine.setInputChannelMode(initialChannelState.inputChannelMode);
audioEngine.setRememberedChannelDecision(
  initialChannelState.inputChannelDecision === 'pending' ? null : initialChannelState.inputChannelDecision,
);
audioEngine.setInputDecisionHandler((decision) => {
  useAudioStore.setState({ inputChannelDecision: decision });
  rememberInputChannels();
});

audioEngine.setInputEndedHandler(() => {
  const state = useAudioStore.getState();
  if (!state.isRunning || state.inputMode !== 'device' || state.isLoading) return;
  void stopSession('device-lost');
});

// 음원 파일 재생이 끝나면 연결 해제와 같은 정리 절차로 마친다.
audioEngine.setPlaybackEndedHandler(() => {
  void stopSession('user-disconnect');
});

// The audio worklet detects and mutes without depending on any mounted meter UI.
audioEngine.setHowlProtection(initialIoSettings.howlProtectionEnabled);
audioEngine.setHowlHandler(() => {
  const state = useAudioStore.getState();
  if (!state.isRunning || state.inputMode !== 'device' || !state.howlProtectionEnabled) return;
  void stopSession('howl');
});
