import { create } from 'zustand';
import { AudioEngine } from '../audio/AudioEngine';
import {
  AudioSession,
  type StartOutcome,
  type StopDetail,
  type StopReason,
  type StopResult,
} from '../audio/engine/AudioSession';
import type { ChannelDecision } from '../audio/engine/channelDecision';
import { audioErrorMessage, connectErrorMessage, shouldRetryWithDefaultInput } from '../audio/engine/errors';
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
  midiMappingMatches,
  parseMidiMessage,
  validateMidiMappings,
  type MidiDeviceInfo,
  type MidiMappings,
} from '../audio/midi';
import { recordingFormatFromMime, selectRecorderMimeType, WavRecorder, type RecordingFileFormat } from '../audio/recording';
import { ko } from '../i18n/ko';
import { safeStorage, STORAGE_KEYS } from '../persistence';
import { monitorSink } from './monitorStore';
import { setPedalActive } from './pedalActions';
import { usePedalStore } from './pedalStore';
import { showToast } from './toastStore';

/** 마지막으로 고른 출력 장치 id. JSON 이 아니라 문자열 그대로 저장된다(S1.7 에서도 형식은 그대로). */
function readOutputDevice(): string {
  return safeStorage.getRaw(STORAGE_KEYS.outputDevice) ?? '';
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

/** 저장된 입출력 설정을 해석한다. JSON 이 아니거나 객체가 아니면 던진다 — SafeStorage 가 깨진 값으로 보관하고 기본값을 쓴다. */
function parseIoSettings(raw: string): IoSettings {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('저장된 입출력 설정의 모양이 올바르지 않습니다.');

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
}

function readIoSettings(): IoSettings {
  return safeStorage.read<IoSettings>(STORAGE_KEYS.io, parseIoSettings, { ...defaultIoSettings });
}

function persistIoSettings(settings: IoSettings): void {
  safeStorage.set(STORAGE_KEYS.io, settings);
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
  // JSON 이 아니면 깨진 값으로 보관한다. 모양이 맞지 않는 항목은 예전처럼 걸러 낸다(validateMidiMappings).
  return safeStorage.read<MidiMappings>(STORAGE_KEYS.midi, (raw) => validateMidiMappings(JSON.parse(raw)), {});
}

function persistMidiMappings(mappings: MidiMappings): void {
  safeStorage.set(STORAGE_KEYS.midi, mappings);
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

    const pedal = usePedalStore.getState().pedals.find((candidate) => candidate.id === pedalId);
    if (!pedal) return;
    let active = message.active;
    if (mapping.mode === 'toggle') {
      const pressed = message.active;
      const wasPressed = midiPressed.get(pedalId) ?? false;
      midiPressed.set(pedalId, pressed);
      if (!pressed || wasPressed) return;
      active = !pedal.active;
    }
    // 이미 그 상태면 아무것도 하지 않는다(저장도 엔진 호출도 없다). 켜고 끄는 입구는 하나다.
    setPedalActive(pedalId, active);
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
  /**
   * 열어 둔 음원 File(설계서 4.11 '파일 유지'). 재생이 끝나거나 정지·Panic 으로 세션이 끝나도 남고,
   * 다른 파일을 열거나 '파일 닫기'를 누르거나 기타를 연결할 때만 놓는다. 화면이 보이는 이름은 `uploadedFileName` 이다.
   */
  uploadedFile: File | null;
  uploadedFileName: string | null;
  /** '반복 재생'(기본 켜짐). 저장하지 않는다 — 새로 열면 다시 켜져 있다. */
  fileLoop: boolean;
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
  /** 탐색 막대: 처음부터 몇 초 되는 자리로 곧바로 간다. */
  seekFileTo: (seconds: number) => void;
  setFileLoop: (loop: boolean) => void;
  /** '파일 닫기': 재생 중이면 멈추고, 열어 둔 파일을 놓는다. */
  closeFile: () => Promise<void>;
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

/**
 * 입력 장치로 연결한다. 골라 둔 장치가 없으면(OverconstrainedError·NotFoundError) 기본 장치로 한 번 다시 연결한다(설계서 4.13, S2.3).
 * 첫 시도가 실패하면 AudioSession 이 이미 같은 정리 절차를 지났으므로 두 번째 시도는 깨끗한 상태에서 시작한다.
 * 기본 장치로 바꿨다면 그 장치에 기억된 채널 설정을 다시 올린다. 두 번째 시도도 실패하면 오류는 그대로 던지되,
 * 선택은 고른 장치에 그대로 있으므로 채널 설정도 그 장치의 것으로 되돌린다(안 그러면 기본 장치의 판정이 화면에 남고,
 * 그 상태에서 채널 모드를 바꾸면 고른 장치의 기억으로 저장된다).
 */
async function startDeviceSession(deviceId: string): Promise<{ outcome: StartOutcome; fellBackToDefault: boolean }> {
  try {
    const outcome = await audioSession.start({ kind: 'device', deviceId: deviceId || undefined });
    return { outcome, fellBackToDefault: false };
  } catch (error) {
    if (!shouldRetryWithDefaultInput(error, deviceId)) throw error;
  }
  loadInputChannels('');
  try {
    const outcome = await audioSession.start({ kind: 'device' });
    return { outcome, fellBackToDefault: outcome === 'running' };
  } catch (error) {
    loadInputChannels(deviceId);
    throw error;
  }
}

/** 기본 장치로 대신 연결했음을 알린다. 소리가 나오는 입력이 달라졌으므로 경고로 띄운다(내장 마이크가 스피커 소리를 다시 잡을 수 있다). */
function announceInputFallback(): void {
  showToast({ kind: 'warning', key: 'input-fallback', message: ko.connect.fellBackToDefault });
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
    const { uploadedFile, fileDuration } = useAudioStore.getState();
    useAudioStore.setState({
      isRunning: false,
      inputMode: 'idle',
      isLoading: false,
      error: null,
      inputChannelSelectable: null,
      ...resetReadings(),
      // 열어 둔 파일은 정지해도 남는다(설계서 4.11): 이름과 전체 길이는 그대로 두고 위치·재생 상태만 처음으로 돌린다.
      fileDuration: uploadedFile ? fileDuration : 0,
    });
  }
  return audioSession.stop(reason, detail);
}

/**
 * 오류 경계가 화면을 잃었을 때 소리부터 끈다(S1.7, 설계서 4.8절). 마이크 표시등이 켜진 채 오류 화면만 남는 일을 막는다.
 * 정리 절차가 실패해도 던지지 않는다 — 오류 화면을 보여 주는 일이 먼저다. 안내(토스트)는 띄우지 않는다('error' 이유는 조용하다).
 */
export function stopSessionForError(): Promise<void> {
  try {
    return stopSession('error').then(
      () => undefined,
      () => undefined,
    );
  } catch {
    return Promise.resolve();
  }
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  devices: [],
  selectedDeviceId: '',
  outputDevices: [],
  selectedOutputDeviceId: initialOutputDevice,
  outputSelectionSupported: audioEngine.supportsOutputSelection,
  inputMode: 'idle',
  uploadedFile: null,
  uploadedFileName: null,
  fileLoop: true,
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
          pedal.active &&
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
      set({ error: audioErrorMessage(error) });
    }
  },

  setOutputDevice: async (deviceId) => {
    try {
      await audioEngine.setOutputDevice(deviceId);
      set({ selectedOutputDeviceId: deviceId, error: null });
      safeStorage.setRaw(STORAGE_KEYS.outputDevice, deviceId);
    } catch {
      set({ error: '출력 장치를 변경할 수 없습니다. 장치 연결과 브라우저 권한을 확인해 주세요.' });
    }
  },

  setSelectedDevice: async (deviceId) => {
    const wasRunning = get().isRunning;
    set({ selectedDeviceId: deviceId, error: null });
    loadInputChannels(deviceId);

    if (!wasRunning || get().inputMode !== 'device') return;

    set({ isLoading: true });

    try {
      await finishActiveRecording('finalize');
      const { outcome, fellBackToDefault } = await startDeviceSession(deviceId);
      if (outcome === 'cancelled') return;
      const devices = await audioEngine.listInputDevices().catch(() => get().devices);
      set({
        devices,
        ...(fellBackToDefault ? { selectedDeviceId: '' } : {}),
        isRunning: true,
        inputMode: 'device',
        uploadedFile: null,
        uploadedFileName: null,
        fileCurrentTime: 0,
        fileDuration: 0,
        isFilePaused: true,
        isLoading: false,
        error: null,
        inputChannelSelectable: audioEngine.getInputInfo()?.selectable ?? null,
      });
      if (fellBackToDefault) announceInputFallback();
    } catch (error) {
      set({
        error: connectErrorMessage(error),
        isRunning: false,
        inputMode: 'idle',
        isLoading: false,
        ...resetReadings(),
      });
    }
  },

  start: async () => {
    const { selectedDeviceId } = get();
    set({ isLoading: true, error: null });
    loadInputChannels(selectedDeviceId);

    try {
      await finishActiveRecording('finalize');
      const { outcome, fellBackToDefault } = await startDeviceSession(selectedDeviceId);
      if (outcome === 'cancelled') return;
      const devices = await audioEngine.listInputDevices().catch(() => get().devices);
      set({
        devices,
        ...(fellBackToDefault ? { selectedDeviceId: '' } : {}),
        isRunning: true,
        inputMode: 'device',
        uploadedFile: null,
        uploadedFileName: null,
        fileCurrentTime: 0,
        fileDuration: 0,
        isFilePaused: true,
        isLoading: false,
        error: null,
        inputChannelSelectable: audioEngine.getInputInfo()?.selectable ?? null,
      });
      if (fellBackToDefault) announceInputFallback();
    } catch (error) {
      set({
        error: connectErrorMessage(error),
        isRunning: false,
        inputMode: 'idle',
        isLoading: false,
      });
    }
  },

  startFile: async (file) => {
    set({ isLoading: true, error: null });

    try {
      await finishActiveRecording('finalize');
      const outcome = await audioSession.start({ kind: 'file', file });
      if (outcome === 'cancelled') return;
      const playback = audioEngine.readFilePlayback();
      set({
        isRunning: true,
        inputMode: 'file',
        uploadedFile: file,
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
        error: audioErrorMessage(error),
        isRunning: false,
        inputMode: 'idle',
        // 열지 못한 파일은 '열어 둔 파일'이 아니다. 시작이 실패하면 이전 세션도 정리 절차로 끝나 있다(AudioSession).
        uploadedFile: null,
        uploadedFileName: null,
        fileCurrentTime: 0,
        fileDuration: 0,
        isFilePaused: true,
        isLoading: false,
      });
    }
  },

  playFile: async () => {
    // 세션이 끝나 있어도(정지·Panic) 열어 둔 파일은 남아 있다. 새 세션 — 새 <audio> 요소와 Object URL, 옛 URL 은 정리 때 해제 — 로 처음부터 튼다(설계서 4.11).
    if (get().inputMode !== 'file') {
      const { uploadedFile } = get();
      if (uploadedFile) await get().startFile(uploadedFile);
      return;
    }

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
        error: audioErrorMessage(error),
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

  seekFileTo: (seconds) => {
    const engine = AudioEngine.getInstance();
    engine.seekUploadedFileTo(seconds);
    const playback = engine.readFilePlayback();
    set({
      fileCurrentTime: playback.currentTime,
      fileDuration: playback.duration,
      isFilePaused: playback.isPaused,
    });
  },

  setFileLoop: (loop) => {
    set({ fileLoop: loop });
    audioEngine.setFileLoop(loop);
  },

  closeFile: async () => {
    const wasPlaying = get().inputMode === 'file';
    // 먼저 놓는다: 아래 정리 절차가 도는 동안에도 화면은 '열어 둔 파일 없음' 이다.
    set({ uploadedFile: null, uploadedFileName: null, fileCurrentTime: 0, fileDuration: 0, isFilePaused: true });
    if (wasPlaying) await stopSession('user-disconnect');
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
        error: audioErrorMessage(error),
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
      .pedals.filter((pedal) => pedal.active).length;
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

// 반복을 끈 음원이 끝까지 재생됐다. 세션도 열어 둔 파일도 그대로 두고(맨 끝에서 멈춘 상태) 화면만 맞춘다.
// '재생' 은 같은 요소로 처음부터 다시 튼다. 반복이 켜져 있으면(기본) 이 이벤트는 오지 않는다(설계서 4.11).
audioEngine.setPlaybackEndedHandler(() => {
  if (useAudioStore.getState().inputMode !== 'file') return;
  const playback = audioEngine.readFilePlayback();
  useAudioStore.setState({
    fileCurrentTime: playback.currentTime,
    fileDuration: playback.duration,
    isFilePaused: playback.isPaused,
  });
});

// 레벨·가드 상태는 오디오 스레드의 워클릿이 재고 MonitorService 가 monitorStore 에 둔다. 화면은 읽어 그리기만 한다.
audioEngine.setMonitorSink(monitorSink);
// 하울링 판정과 안전 무음은 출력 가드 워클릿이 오디오 스레드에서 한다(미터 화면·탭·문서 가시성과 무관).
// 차단 보고가 오면 소리는 이미 무음이다. 하나뿐인 정리 절차로 세션을 끝내고(녹음은 남는다) 감지한 주파수를 안내에 싣는다.
// 보호 스위치를 끄는 순간과 겹쳐 차단이 먼저 일어났어도 무음으로 계속 돌지 않도록 스위치는 다시 확인하지 않는다.
audioEngine.setHowlProtection(initialIoSettings.howlProtectionEnabled);
audioEngine.setHowlHandler((freqHz) => {
  const state = useAudioStore.getState();
  if (!state.isRunning || state.inputMode !== 'device') return;
  void stopSession('howl', { howlFrequencyHz: freqHz });
});
