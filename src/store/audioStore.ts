import { create } from 'zustand';
import { AudioEngine } from '../audio/AudioEngine';
import {
  chooseRememberedOutput,
  makeRemembered,
  parseRememberedDevice,
  reconcileInputSelection,
  rememberedPresence,
  shouldAnnounceMissing,
  watchDeviceChanges,
  type RememberedDevice,
} from '../audio/devices/DeviceManager';
import {
  AudioSession,
  type StartOutcome,
  type StopDetail,
  type StopReason,
  type StopResult,
} from '../audio/engine/AudioSession';
import type { ChannelDecision } from '../audio/engine/channelDecision';
import { audioErrorMessage, connectErrorMessage, shouldRetryWithDefaultInput } from '../audio/engine/errors';
import { EMPTY_LATENCY } from '../audio/engine/latency';
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
  MidiRouter,
  MidiService,
  parseMidiMessage,
  validateMidiMappings,
  type MidiDeviceInfo,
  type MidiLink,
  type MidiMappings,
  type MidiModeNotice,
  type MidiPermission,
} from '../audio/midi';
import {
  DEFAULT_WAV_BIT_DEPTH,
  DEFAULT_WAV_MAX_SECONDS,
  normalizeWavBitDepth,
  normalizeWavMaxSeconds,
  recordingFormatFromMime,
  selectRecorderMimeType,
  WavRecorder,
  type RecordingFileFormat,
  type WavBitDepth,
} from '../audio/recording';
import { ko } from '../i18n/ko';
import { safeStorage, STORAGE_KEYS } from '../persistence';
import { monitorSink } from './monitorStore';
import { setPedalActive } from './pedalActions';
import { usePedalStore } from './pedalStore';
import { showToast } from './toastStore';

/**
 * 마지막으로 고른 출력 장치 id. JSON 이 아니라 문자열 그대로 저장된다(S1.7 에서도 형식은 그대로).
 * S2.13 부터 id·이름은 입출력 설정(`io`)에도 함께 저장하고, 이 키도 같은 값으로 계속 쓴다(옛 빌드로 되돌아가도 읽을 수 있게). 읽을 때는 아래 `chooseRememberedOutput`.
 */
function readLegacyOutputDevice(): string | null {
  return safeStorage.getRaw(STORAGE_KEYS.outputDevice);
}
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
  /** S2.13 에서 추가한 필드: 사용자가 마지막으로 고른 입력·출력 장치(id 와 이름). 기존 저장값에는 없고, 없으면 둘 다 null(기본 장치)로 읽는다. */
  devices: { input: RememberedDevice | null; output: RememberedDevice | null };
  /** S5.1 에서 추가한 필드: 녹음 형식('wav' 가 기본)·WAV 비트 깊이·WAV 최대 길이(초). 기존 저장값에는 없고, 없으면 기본값으로 읽는다. */
  recordingFormat: 'webm' | 'wav';
  wavBitDepth: WavBitDepth;
  wavMaxSeconds: number;
}

const defaultIoSettings: IoSettings = {
  inputGainDb: 0,
  masterVolume: 0.9,
  howlProtectionEnabled: true,
  tuningReferenceHz: 440,
  inputChannels: {},
  devices: { input: null, output: null },
  recordingFormat: 'wav',
  wavBitDepth: DEFAULT_WAV_BIT_DEPTH,
  wavMaxSeconds: DEFAULT_WAV_MAX_SECONDS,
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
const emptyLatency: LatencyReading = EMPTY_LATENCY;
/** 지연·끊김 수를 다시 읽는 간격(ms). 브라우저가 playbackStats 를 1초마다 갱신한다. */
const SLOW_READ_INTERVAL_MS = 1000;
let lastSlowReadAt = Number.NEGATIVE_INFINITY;


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
    devices: readRememberedDevices(stored.devices),
    recordingFormat: stored.recordingFormat === 'webm' ? 'webm' : 'wav',
    wavBitDepth: normalizeWavBitDepth(stored.wavBitDepth),
    wavMaxSeconds: normalizeWavMaxSeconds(stored.wavMaxSeconds),
  };
}

function readRememberedDevices(value: unknown): IoSettings['devices'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { input: null, output: null };
  const { input, output } = value as Record<string, unknown>;
  return { input: parseRememberedDevice(input), output: parseRememberedDevice(output) };
}

function readIoSettings(): IoSettings {
  return safeStorage.read<IoSettings>(STORAGE_KEYS.io, parseIoSettings, { ...defaultIoSettings });
}

function persistIoSettings(settings: IoSettings): void {
  safeStorage.set(STORAGE_KEYS.io, settings);
}

/** 화면 상태에서 저장할 입출력 설정을 만든다. 저장 호출마다 필드를 나열하다 새 필드를 빠뜨리지 않게 한 곳에 모았다. */
function ioSettingsOf(state: IoSettingsSource, overrides: Partial<IoSettings> = {}): IoSettings {
  return {
    inputGainDb: state.inputGainDb,
    masterVolume: state.masterVolume,
    howlProtectionEnabled: state.howlProtectionEnabled,
    tuningReferenceHz: state.tuningReferenceHz,
    inputChannels: state.inputChannels,
    devices: { input: state.rememberedInput, output: state.rememberedOutput },
    recordingFormat: state.recordingFormat,
    wavBitDepth: state.wavBitDepth,
    wavMaxSeconds: state.wavMaxSeconds,
    ...overrides,
  };
}

function sameRemembered(left: RememberedDevice | null, right: RememberedDevice | null): boolean {
  return left === right || (left !== null && right !== null && left.id === right.id && left.label === right.label);
}

interface IoSettingsSource {
  inputGainDb: number;
  masterVolume: number;
  howlProtectionEnabled: boolean;
  tuningReferenceHz: number;
  inputChannels: Record<string, StoredInputChannel>;
  rememberedInput: RememberedDevice | null;
  rememberedOutput: RememberedDevice | null;
  recordingFormat: 'webm' | 'wav';
  wavBitDepth: WavBitDepth;
  wavMaxSeconds: number;
}

function isSamePitch(left: PitchReading, right: PitchReading): boolean {
  return (
    left.frequency === right.frequency &&
    left.note === right.note &&
    left.cents === right.cents &&
    left.targetNote === right.targetNote &&
    left.stringNumber === right.stringNumber &&
    left.octavesAbove === right.octavesAbove &&
    left.checkString === right.checkString
  );
}

function isSameLatency(left: LatencyReading, right: LatencyReading): boolean {
  return (
    left.sampleRate === right.sampleRate &&
    left.inputKind === right.inputKind &&
    left.input === right.input &&
    left.inputSource === right.inputSource &&
    left.pedals === right.pedals &&
    left.limiter === right.limiter &&
    left.outputBase === right.outputBase &&
    left.outputDevice === right.outputDevice
  );
}

const initialIoSettings = readIoSettings();
const initialRememberedInput = initialIoSettings.devices.input;
const initialRememberedOutput = chooseRememberedOutput(initialIoSettings.devices.output, readLegacyOutputDevice());
const initialOutputDevice = initialRememberedOutput?.id ?? '';
const audioEngine = AudioEngine.getInstance();
audioEngine.setInputGain(initialIoSettings.inputGainDb);
audioEngine.setMasterVolume(initialIoSettings.masterVolume);
audioEngine.setTunerActive(false);
audioEngine.setTuningPreset('standard');
audioEngine.setTuningReferenceHz(initialIoSettings.tuningReferenceHz);

const MIDI_SUPPORTED =
  typeof navigator !== 'undefined' && typeof navigator.requestMIDIAccess === 'function';

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
// MIDI 연결(권한·장치 감시)은 MidiService, 메시지를 어디에 쓸지는 MidiRouter 가 맡는다(S2.9). 여기는 둘을 이 저장소에 이어 붙일 뿐이다.
const midiService = new MidiService({
  onMessage: (event) => handleMidiMessage(event),
  onState: (state) => useAudioStore.setState({ midiLink: state.link, midiPermission: state.permission, midiDevices: state.devices }),
});

/** 학습이 끝난 뒤 방식을 어떻게 정했는지 알린다. 사용자가 방식을 고르지 않았으므로 무엇으로 정했고 어떻게 바꾸는지를 함께 말한다. */
function announceMidiMode(notice: MidiModeNotice): void {
  const pedal = usePedalStore.getState().pedals.find((candidate) => candidate.id === notice.pedalId);
  const name = pedal?.name ?? ko.midi.thisPedal;
  showToast({
    key: `midi-mode:${notice.pedalId}`,
    kind: 'info',
    durationMs: 8000,
    message:
      notice.mode === 'toggle' ? ko.midi.modeToggle(name) : ko.midi.modeLatch(name),
  });
}

const midiRouter = new MidiRouter({
  getMappings: () => useAudioStore.getState().midiMappings,
  learned: (midiMappings) => {
    persistMidiMappings(midiMappings);
    useAudioStore.setState({ midiMappings, midiLearningPedalId: null, midiError: null });
  },
  changeMappings: (midiMappings) => {
    persistMidiMappings(midiMappings);
    useAudioStore.setState({ midiMappings });
  },
  getLearningPedalId: () => useAudioStore.getState().midiLearningPedalId,
  endLearning: () => useAudioStore.setState({ midiLearningPedalId: null }),
  pedalActive: (pedalId) => usePedalStore.getState().pedals.find((pedal) => pedal.id === pedalId)?.active,
  setPedalActive: (pedalId, active) => {
    setPedalActive(pedalId, active);
  },
  notifyMode: announceMidiMode,
  setTimer: (callback, ms) => {
    const timer = setTimeout(callback, ms);
    // Node 시험이 이 타이머 때문에 끝나지 않는 일을 막는다. 브라우저의 숫자 타이머에는 unref 가 없다.
    (timer as { unref?: () => void }).unref?.();
    return timer;
  },
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
});

function handleMidiMessage(event: MIDIMessageEvent): void {
  const audioState = useAudioStore.getState();
  if (audioState.midiLearningPedalId && event.data && midiAdvancedMatches?.(event.data)) {
    useAudioStore.setState({ midiError: ko.midi.signalInUse });
    return;
  }
  if (!audioState.midiLearningPedalId && event.data && midiAdvancedHandler?.(event.data)) return;
  const message = parseMidiMessage(event.data);
  if (!message) return;
  midiRouter.handle(message, typeof event.timeStamp === 'number' ? event.timeStamp : performance.now());
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
        error: ko.recording.fileFailed,
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
    }).catch(() => useAudioStore.setState({ recordingStatus: 'idle', error: ko.recording.wavSaveFailed }))
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
    settleRecording(candidate, generation, ko.recording.stopFailed);
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
  const savedNote = result.recordingSaved ? ko.session.savedNote : '';
  switch (result.reason) {
    case 'user-disconnect':
      if (result.recordingSaved) {
        showToast({ kind: 'success', key: 'recording-saved', message: ko.recording.saved });
      }
      break;
    case 'panic':
      showToast({
        kind: 'warning',
        key: 'session-stop',
        message: ko.session.panic(savedNote),
      });
      break;
    case 'howl': {
      const frequency = detail.howlFrequencyHz;
      const where = typeof frequency === 'number' && Number.isFinite(frequency) ? `(약 ${Math.round(frequency)} Hz)` : '';
      showToast({
        kind: 'warning',
        key: 'session-stop',
        message: ko.session.howl(where, savedNote),
      });
      break;
    }
    case 'device-lost':
      showToast({
        kind: 'warning',
        key: 'session-stop',
        message: ko.session.deviceLost(savedNote),
      });
      break;
    case 'error':
      break;
  }
  if (result.failedSteps.length > 0) {
    showToast({
      kind: 'error',
      key: 'session-stop-failed',
      message: ko.session.cleanupIncomplete,
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
  /**
   * 사용자가 마지막으로 직접 고른 입력·출력 장치(id 와 이름, S2.13). 기본 장치를 골랐으면 null.
   * 장치가 잠시 목록에서 사라져 선택이 기본 장치로 돌아가도 지우지 않는다 — 다시 꽂으면 그 장치를 다시 고르고, 다음 방문에도 이 장치를 찾는다.
   */
  rememberedInput: RememberedDevice | null;
  rememberedOutput: RememberedDevice | null;
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
  /** 세션 시작 뒤 출력 버퍼 부족으로 끊긴 횟수. null 이면 이 브라우저가 알려 주지 않는다('측정 불가'). */
  underrunCount: number | null;
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
  /** 연결 상태(권한·연결 중·연결됨 등)와 브라우저의 MIDI 권한. 카드의 '연결됨/장치 없음' 표시와 '다시 연결' 배너가 읽는다(S2.9). */
  midiLink: MidiLink;
  midiPermission: MidiPermission;
  midiSupported: boolean;
  midiLearningPedalId: string | null;
  midiMappings: MidiMappings;
  midiError: string | null;
  recordingSupported: boolean;
  recordingFormat: 'webm' | 'wav';
  recordedFormat: RecordingFileFormat;
  setRecordingFormat: (format: 'webm' | 'wav') => void;
  /** S5.1: WAV 비트 깊이(16 기본, 24 선택)와 최대 길이(초, 기본 300). 둘 다 저장한다. */
  wavBitDepth: WavBitDepth;
  setWavBitDepth: (depth: WavBitDepth) => void;
  wavMaxSeconds: number;
  setWavMaxSeconds: (seconds: number) => void;
  /** 지금 WAV 녹음이 담을 수 있는 최대 길이(초). 녹음을 시작할 때 정해지고, 샘플레이트가 높아 메모리 상한이 먼저 닿으면 고른 값보다 작다. 녹음 중이 아니면 의미 없다. */
  recordingLimitSeconds: number;
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
  /**
   * 저장된 MIDI 설정이 있으면 연결한다. `force`: 매핑이 없어도(고급 설정만 있어도) 시도한다.
   * `userAction`: 사용자가 버튼을 눌러 부른 것이라 권한 창이 떠도 된다. 아니면(페이지를 열 때) 권한이 이미 허용일 때만 연결한다.
   */
  connectSavedMidi: (options?: { force?: boolean; userAction?: boolean }) => Promise<void>;
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
    underrunCount: null,
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

/** 장치 목록을 읽은 차례. 늦게 끝난 옛 읽기가 더 새 읽기의 결과를 덮어쓰지 않게 한다(S2.13). */
let deviceLoadTicket = 0;
/** 기억해 둔 입력·출력 장치가 직전 목록에 있었는지(null 이면 아직 모른다). 'false → true' 가 '다시 나타났다'다. */
let lastInputPresence: boolean | null = null;
let lastOutputPresence: boolean | null = null;
/** '기본으로 연결했습니다' 안내를 이미 띄운 기억 장치의 id. 같은 장치에 대해 연결할 때마다 되풀이하지 않는다. */
let announcedMissingInputId: string | null = null;
let announcedMissingOutputId: string | null = null;

/** 기본 장치로 대신 연결했음을 알린다. 소리가 나오는 입력이 달라졌으므로 경고로 띄운다(내장 마이크가 스피커 소리를 다시 잡을 수 있다). */
function announceInputFallback(): void {
  announcedMissingInputId = useAudioStore.getState().rememberedInput?.id ?? null;
  showToast({ kind: 'warning', key: 'input-fallback', message: ko.connect.fellBackToDefault });
}

/**
 * 연결한 뒤 저장된 장치를 쓰지 못했다면 알린다(S2.13, 설계서 4.4).
 *  - 입력: 연결 단계에서 고른 장치가 없어 기본 장치로 다시 연결한 경우는 호출한 쪽이 이미 알렸다(`announceInputFallback`). 여기서는 목록에서 이미
 *    없다고 판단해 처음부터 기본 장치로 연결한 경우를 알린다(기억해 둔 장치가 있는데 선택이 비어 있고, 같은 장치에 대해 알린 적이 없을 때).
 *  - 출력: 저장된 출력 장치로 보내지 못해 엔진이 시스템 기본 출력으로 두었거나(`consumeOutputFallback`), 목록에 없다고 판단해 기본 출력을 쓰는 경우.
 */
async function announceUnavailableDevices(inputs: readonly MediaDeviceInfo[], announceInput: boolean): Promise<void> {
  try {
    await announceUnavailableDevicesUnsafe(inputs, announceInput);
  } catch {
    // 안내를 못 띄워도 이미 연결된 세션을 흐트러뜨리지 않는다.
  }
}

async function announceUnavailableDevicesUnsafe(inputs: readonly MediaDeviceInfo[], announceInput: boolean): Promise<void> {
  const before = useAudioStore.getState();
  if (announceInput && shouldAnnounceMissing(inputs, before.rememberedInput, before.selectedDeviceId, announcedMissingInputId)) {
    announceInputFallback();
  }
  const engineFellBack = audioEngine.consumeOutputFallback();
  const outputs = audioEngine.supportsOutputSelection ? await audioEngine.listOutputDevices().catch(() => before.outputDevices) : before.outputDevices;
  const state = useAudioStore.getState();
  if (engineFellBack) useAudioStore.setState({ selectedOutputDeviceId: '', outputDevices: outputs });
  const missing = shouldAnnounceMissing(outputs, state.rememberedOutput, engineFellBack ? '' : state.selectedOutputDeviceId, announcedMissingOutputId);
  if (engineFellBack || missing) {
    announcedMissingOutputId = state.rememberedOutput?.id ?? null;
    showToast({ kind: 'warning', key: 'output-fallback', message: ko.devices.outputFellBack });
  }
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
  persistIoSettings(ioSettingsOf(state, { inputChannels: next }));
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
  selectedDeviceId: initialRememberedInput?.id ?? '',
  rememberedInput: initialRememberedInput,
  rememberedOutput: initialRememberedOutput,
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
  underrunCount: null,
  pitch: emptyPitch,
  isTunerActive: false,
  tuningPreset: 'standard',
  tuningReferenceHz: initialIoSettings.tuningReferenceHz,
  latency: emptyLatency,
  inputGainDb: initialIoSettings.inputGainDb,
  masterVolume: initialIoSettings.masterVolume,
  howlProtectionEnabled: initialIoSettings.howlProtectionEnabled,
  inputChannelMode: initialIoSettings.inputChannels[inputChannelKey(initialRememberedInput?.id ?? '')]?.mode ?? 'auto',
  inputChannelDecision: initialIoSettings.inputChannels[inputChannelKey(initialRememberedInput?.id ?? '')]?.decision ?? 'pending',
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
  midiLink: MIDI_SUPPORTED ? 'idle' : 'unsupported',
  midiPermission: 'unknown',
  midiSupported: MIDI_SUPPORTED,
  midiLearningPedalId: null,
  midiMappings: readMidiMappings(),
  midiError: null,
  recordingSupported: MEDIA_RECORDER_SUPPORTED,
  recordingFormat: initialIoSettings.recordingFormat,
  recordedFormat: 'webm',
  setRecordingFormat: (format) => {
    if (get().recordingStatus === 'recording') return;
    set({ recordingFormat: format });
    persistIoSettings(ioSettingsOf(get(), { recordingFormat: format }));
  },
  wavBitDepth: initialIoSettings.wavBitDepth,
  setWavBitDepth: (depth) => {
    if (get().recordingStatus === 'recording') return;
    const wavBitDepth = normalizeWavBitDepth(depth);
    set({ wavBitDepth });
    persistIoSettings(ioSettingsOf(get(), { wavBitDepth }));
  },
  wavMaxSeconds: initialIoSettings.wavMaxSeconds,
  setWavMaxSeconds: (seconds) => {
    if (get().recordingStatus === 'recording') return;
    const wavMaxSeconds = normalizeWavMaxSeconds(seconds);
    set({ wavMaxSeconds });
    persistIoSettings(ioSettingsOf(get(), { wavMaxSeconds }));
  },
  recordingLimitSeconds: initialIoSettings.wavMaxSeconds,
  recordingStatus: 'idle',
  recordedUrl: null,
  recordingElapsed: 0,

  setInputGainDb: (value) => {
    const inputGainDb = clamp(value, -24, 24);
    audioEngine.setInputGain(inputGainDb);
    set({ inputGainDb });
    persistIoSettings(ioSettingsOf(get(), { inputGainDb }));
  },

  setMasterVolume: (value) => {
    const masterVolume = clamp(value, 0, 1);
    audioEngine.setMasterVolume(masterVolume);
    set({ masterVolume });
    persistIoSettings(ioSettingsOf(get(), { masterVolume }));
  },

  setHowlProtectionEnabled: (enabled) => {
    audioEngine.setHowlProtection(enabled);
    set({ howlProtectionEnabled: enabled });
    persistIoSettings(ioSettingsOf(get(), { howlProtectionEnabled: enabled }));
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
    persistIoSettings(ioSettingsOf(get(), { tuningReferenceHz: value }));
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

    const chainGainWarning = isExcessive ? ko.chain.gainExcessive : null;
    // 추정 게인은 경고 문구에만 쓴다. 경고가 없을 때는 0 으로 두어, Drive 같은 노브를 돌릴 때마다 값이 바뀌어 모든 구독자를 깨우지 않게 한다(S4.3).
    const estimatedChainGainDb = chainGainWarning ? audioEngine.estimateChainGain() : 0;
    // 값이 같으면 쓰지 않는다(노브를 돌릴 때마다 모든 오디오 스토어 구독자를 깨우지 않는다, S4.3).
    const current = get();
    if (current.chainGainWarning === chainGainWarning && current.estimatedChainGainDb === estimatedChainGainDb) return;
    set({ chainGainWarning, estimatedChainGainDb });
  },

  loadDevices: async () => {
    const ticket = ++deviceLoadTicket;
    try {
      const [devices, outputDevices] = await Promise.all([audioEngine.listInputDevices(), audioEngine.listOutputDevices()]);
      // 더 새 읽기가 시작되었다. 그쪽 결과가 화면에 올라간다.
      if (ticket !== deviceLoadTicket) return;
      const state = get();
      const running = state.isRunning && state.inputMode === 'device';

      // 입력: 고른 장치가 사라졌는지·돌아왔는지·id 만 바뀌었는지를 DeviceManager 가 판단한다. 권한 전(id 가 빈 목록)에는 아무것도 바꾸지 않는다.
      const inputPresence = rememberedPresence(devices, state.rememberedInput);
      const input = reconcileInputSelection({
        list: devices,
        selectedDeviceId: state.selectedDeviceId,
        remembered: state.rememberedInput,
        running,
        reappeared: lastInputPresence === false && inputPresence === true,
      });
      if (inputPresence !== null) lastInputPresence = inputPresence;
      if (inputPresence === true) announcedMissingInputId = null;

      // 출력: 연주 중에는 건드리지 않는다(브라우저가 알아서 기본 출력으로 돌린다). 쉬는 중에만 id 가 바뀐 장치를 이름으로 찾아 맞춘다.
      const outputPresence = rememberedPresence(outputDevices, state.rememberedOutput);
      const output = state.isRunning
        ? null
        : reconcileInputSelection({
            list: outputDevices,
            selectedDeviceId: state.selectedOutputDeviceId,
            remembered: state.rememberedOutput,
            running: false,
            reappeared: lastOutputPresence === false && outputPresence === true,
          });
      if (outputPresence !== null) lastOutputPresence = outputPresence;
      if (outputPresence === true) announcedMissingOutputId = null;

      const patch: Partial<AudioStore> = { devices, outputDevices };
      if (input.selectedDeviceId !== state.selectedDeviceId) patch.selectedDeviceId = input.selectedDeviceId;
      if (!sameRemembered(input.remembered, state.rememberedInput)) patch.rememberedInput = input.remembered;
      if (output) {
        if (output.selectedDeviceId !== state.selectedOutputDeviceId) {
          patch.selectedOutputDeviceId = output.selectedDeviceId;
          if (audioEngine.supportsOutputSelection) await audioEngine.setOutputDevice(output.selectedDeviceId).catch(() => undefined);
        }
        if (!sameRemembered(output.remembered, state.rememberedOutput)) {
          patch.rememberedOutput = output.remembered;
          safeStorage.setRaw(STORAGE_KEYS.outputDevice, output.remembered?.id ?? '');
        }
      }

      if (input.lost) await stopSession('device-lost');
      set(patch);
      if (patch.rememberedInput !== undefined || patch.rememberedOutput !== undefined) persistIoSettings(ioSettingsOf(get()));
      if (!running && patch.selectedDeviceId !== undefined) loadInputChannels(patch.selectedDeviceId);
    } catch (error) {
      set({ error: audioErrorMessage(error) });
    }
  },

  setOutputDevice: async (deviceId) => {
    try {
      await audioEngine.setOutputDevice(deviceId);
      const rememberedOutput = makeRemembered(get().outputDevices, deviceId);
      set({ selectedOutputDeviceId: deviceId, rememberedOutput, error: null });
      lastOutputPresence = rememberedOutput ? true : null;
      announcedMissingOutputId = null;
      safeStorage.setRaw(STORAGE_KEYS.outputDevice, deviceId);
      persistIoSettings(ioSettingsOf(get()));
    } catch {
      set({ error: ko.devices.outputChangeFailed });
    }
  },

  setSelectedDevice: async (deviceId) => {
    const wasRunning = get().isRunning;
    // 사용자가 직접 고른 장치는 기억한다(기본 입력 장치를 고르면 기억을 지운다).
    const rememberedInput = makeRemembered(get().devices, deviceId);
    set({ selectedDeviceId: deviceId, rememberedInput, error: null });
    lastInputPresence = rememberedInput ? true : null;
    announcedMissingInputId = null;
    persistIoSettings(ioSettingsOf(get()));
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
      // 사용자가 방금 고른 장치(또는 기본 장치)로 연결했으므로 '저장된 입력 장치를 찾지 못했다'고 따로 알릴 일이 없다. 출력만 확인한다.
      await announceUnavailableDevices(devices, false);
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
      await announceUnavailableDevices(devices, !fellBackToDefault);
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
      await announceUnavailableDevices(get().devices, false);
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

  connectSavedMidi: async ({ force = false, userAction = false } = {}) => {
    if (!get().midiSupported || (!force && !Object.keys(get().midiMappings).length)) return;
    const generation = midiService.generation;
    try {
      if (userAction) await midiService.connect();
      else await midiService.connectIfAllowed();
      if (generation === midiService.generation && get().midiError) set({ midiError: null });
    } catch {
      if (generation === midiService.generation) set({ midiError: ko.midi.reconnectFailed });
    }
  },

  setMidiMode: (pedalId, mode) => {
    const mapping = get().midiMappings[pedalId];
    if (!mapping) return;
    const midiMappings = { ...get().midiMappings, [pedalId]: { ...mapping, mode } };
    midiRouter.forget(pedalId);
    persistMidiMappings(midiMappings);
    set({ midiMappings });
  },

  startMidiLearn: async (pedalId) => {
    if (!get().midiSupported) return;
    const pedalExists = usePedalStore
      .getState()
      .pedals.some((pedal) => pedal.id === pedalId);
    if (!pedalExists) return;

    const generation = midiService.generation;
    set({ midiLearningPedalId: pedalId, midiError: null });

    try {
      await midiService.connect();
    } catch {
      if (generation !== midiService.generation) return;
      set({
        midiDevices: [],
        midiLearningPedalId: null,
        midiError: ko.midi.permissionUnknown,
      });
    }
  },

  cancelMidiLearn: () => set({ midiLearningPedalId: null }),

  removeMidiMapping: (pedalId) => {
    const midiMappings = { ...get().midiMappings };
    if (!Object.hasOwn(midiMappings, pedalId)) return;
    delete midiMappings[pedalId];
    midiRouter.forget(pedalId);
    persistMidiMappings(midiMappings);
    set({ midiMappings });
  },

  disposeMidi: () => {
    midiService.dispose();
    midiRouter.dispose();
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
        if (typeof AudioContext === 'undefined' || !AudioContext.prototype.createScriptProcessor) throw new Error(ko.recording.wavUnsupported);
        recordingStartedAt = recordingNow();
        activeWavRecorder = new WavRecorder(stream, () => {
          void finishActiveRecording('finalize');
          useAudioStore.setState({ error: ko.recording.wavLimit });
        }, { maxSeconds: state.wavMaxSeconds, bitDepth: state.wavBitDepth });
        recordingTimer = window.setInterval(() => useAudioStore.setState({ recordingElapsed: Math.floor((recordingNow() - recordingStartedAt) / 1000) }), RECORDING_TIMER_INTERVAL_MS);
        set({ recordingStatus: 'recording', recordingElapsed: 0, recordingLimitSeconds: activeWavRecorder.limitSeconds });
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
        settleRecording(candidate, generation, ko.recording.error);
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
    const playback = engine.readFilePlayback();
    const activeEffectCount = usePedalStore
      .getState()
      .pedals.filter((pedal) => pedal.active).length;
    // 입력·출력 지연과 끊김 수는 브라우저가 1초마다 갱신하는 값이라 1초마다만 다시 읽는다(설계서 4.12). 세션이 막 시작돼(읽은 샘플레이트가 0 → 컨텍스트의 값으로 바뀜) 아직 못 읽었으면 바로 읽는다.
    // 처리 지연(켜진 페달 + 리미터)은 페달을 켜고 끌 때, 그래프가 만들어질 때 바뀌므로 매번 읽는다(싸다).
    const now = performance.now();
    const processing = engine.readProcessingLatency();
    const rereadSlow = state.latency.sampleRate !== processing.sampleRate || now - lastSlowReadAt >= SLOW_READ_INTERVAL_MS;
    if (rereadSlow) lastSlowReadAt = now;
    const latency = rereadSlow ? engine.readLatency() : { ...state.latency, pedals: processing.pedals, limiter: processing.limiter };
    const underrunCount = rereadSlow ? engine.readUnderrunCount() : state.underrunCount;

    set((current) => ({
      inputLevel,
      outputLevel,
      pitch: isSamePitch(current.pitch, pitch) ? current.pitch : pitch,
      latency: isSameLatency(current.latency, latency) ? current.latency : latency,
      fileCurrentTime: playback.currentTime,
      fileDuration: playback.duration,
      isFilePaused: playback.isPaused,
      activeEffectCount,
      underrunCount,
    }));
  },
}));

if (initialOutputDevice && audioEngine.supportsOutputSelection) {
  void audioEngine.setOutputDevice(initialOutputDevice);
}

// 장치가 꽂히거나 빠지면(`devicechange`) 목록을 다시 읽는다(S2.13, 설계서 4.4 DeviceManager). 화면 컴포넌트가 아니라 스토어가 지켜서
// 패널이 접히거나 다시 그려져도 신호를 놓치지 않고, 연주 중 장치가 빠졌을 때 세션을 끝내는 일도 패널이 보이는지와 상관없이 일어난다.
// 연달아 오는 신호는 하나로 묶는다. 보안 출처가 아니면 `navigator.mediaDevices` 가 없고, 그러면 지켜볼 것이 없다.
if (typeof navigator !== 'undefined') {
  watchDeviceChanges(navigator.mediaDevices, () => {
    void useAudioStore.getState().loadDevices();
  });
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
