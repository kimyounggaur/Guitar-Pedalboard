import { create } from 'zustand';
import { AudioEngine } from '../audio/AudioEngine';
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
import { selectRecorderMimeType } from '../audio/recording';
import { usePedalStore } from './pedalStore';

const IO_STORAGE_KEY = 'guitar-pedalboard:io';
const HOWL_THRESHOLD_DB = -3;
const HOWL_DURATION_MS = 1200;
const RECORDING_TIMER_INTERVAL_MS = 250;
const RECORDING_STOP_FALLBACK_MS = 1000;

interface IoSettings {
  inputGainDb: number;
  masterVolume: number;
  howlProtectionEnabled: boolean;
}

const defaultIoSettings: IoSettings = {
  inputGainDb: 0,
  masterVolume: 0.9,
  howlProtectionEnabled: true,
};

const silentLevel: LevelReading = {
  db: -120,
  linear: 0,
  peakDb: -120,
  peakLinear: 0,
  isClipping: false,
  clipHoldUntil: 0,
};
const emptyPitch: PitchReading = { frequency: null, note: null, cents: 0 };
const emptyLatency: LatencyReading = { base: 0, output: 0, sampleRate: 0 };

let howlThresholdStartedAt: number | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readIoSettings(): IoSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return { ...defaultIoSettings };
  }

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
    };
  } catch {
    return { ...defaultIoSettings };
  }
}

function persistIoSettings(settings: IoSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;

  try {
    window.localStorage.setItem(IO_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Audio controls continue to work even if storage is unavailable or full.
  }
}

function resetHowlWatch(): void {
  howlThresholdStartedAt = null;
}

function isSamePitch(left: PitchReading, right: PitchReading): boolean {
  return (
    left.frequency === right.frequency &&
    left.note === right.note &&
    left.cents === right.cents
  );
}

function isSameLatency(left: LatencyReading, right: LatencyReading): boolean {
  return (
    left.base === right.base &&
    left.output === right.output &&
    left.sampleRate === right.sampleRate
  );
}

const initialIoSettings = readIoSettings();
const audioEngine = AudioEngine.getInstance();
audioEngine.setInputGain(initialIoSettings.inputGainDb);
audioEngine.setMasterVolume(initialIoSettings.masterVolume);
audioEngine.setTunerActive(false);
audioEngine.setTuningPreset('standard');

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
    // MIDI control remains available for this session if storage is unavailable.
  }
}

function handleMidiMessage(event: MIDIMessageEvent): void {
  const message = parseMidiMessage(event.data);
  if (!message) return;

  const audioState = useAudioStore.getState();
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
    if (!pedal || pedal.bypassed === message.bypassed) return;

    pedalStore.setPedalBypass(pedalId, message.bypassed);
    audioEngine.setPedalBypass(pedalId, message.bypassed);
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
let recordingChunks: Blob[] = [];
let recordingTimer: number | null = null;
let recordingStopFallback: number | null = null;
let recordingStartedAt = 0;
let recordingGeneration = 0;
let recordingEndMode: RecordingEndMode = 'finalize';
let recordingStopRequested = false;
let recordingMimeType = 'audio/webm';
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
      const blob = new Blob(chunks, { type: candidate.mimeType || recordingMimeType });
      const recordedUrl = URL.createObjectURL(blob);
      useAudioStore.setState({
        recordingStatus: 'ready',
        recordedUrl,
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
  audioGlitchCount: number;
  pitch: PitchReading;
  isTunerActive: boolean;
  tuningPreset: TuningPresetId;
  latency: LatencyReading;
  inputGainDb: number;
  masterVolume: number;
  howlProtectionEnabled: boolean;
  chainGainWarning: string | null;
  estimatedChainGainDb: number;
  tapTempo: { taps: number[]; bpm: number };
  midiDevices: MidiDeviceInfo[];
  midiSupported: boolean;
  midiLearningPedalId: string | null;
  midiMappings: MidiMappings;
  midiError: string | null;
  recordingSupported: boolean;
  recordingStatus: RecordingStatus;
  recordedUrl: string | null;
  recordingElapsed: number;
  loadDevices: () => Promise<void>;
  setInputGainDb: (value: number) => void;
  setMasterVolume: (value: number) => void;
  setHowlProtectionEnabled: (enabled: boolean) => void;
  setTunerActive: (active: boolean) => void;
  setTuningPreset: (preset: TuningPresetId) => void;
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
  if (error instanceof Error) return error.message;
  return '오디오 장치를 시작하지 못했습니다.';
}

function resetReadings() {
  return {
    inputLevel: silentLevel,
    outputLevel: silentLevel,
    activeEffectCount: 0,
    audioGlitchCount: 0,
    pitch: emptyPitch,
    latency: emptyLatency,
    fileCurrentTime: 0,
    fileDuration: 0,
    isFilePaused: true,
  };
}

async function connectWithDevice(deviceId: string) {
  await AudioEngine.getInstance().start(deviceId || undefined);
  return AudioEngine.getInstance().listInputDevices();
}

async function switchInputDevice(deviceId: string) {
  await AudioEngine.getInstance().setInputDevice(deviceId);
  return AudioEngine.getInstance().listInputDevices();
}

export const useAudioStore = create<AudioStore>((set, get) => ({
  devices: [],
  selectedDeviceId: '',
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
  audioGlitchCount: 0,
  pitch: emptyPitch,
  isTunerActive: false,
  tuningPreset: 'standard',
  latency: emptyLatency,
  inputGainDb: initialIoSettings.inputGainDb,
  masterVolume: initialIoSettings.masterVolume,
  howlProtectionEnabled: initialIoSettings.howlProtectionEnabled,
  chainGainWarning: null,
  estimatedChainGainDb: 0,
  tapTempo: { taps: [], bpm: readInitialTempoBpm() },
  midiDevices: [],
  midiSupported: MIDI_SUPPORTED,
  midiLearningPedalId: null,
  midiMappings: readMidiMappings(),
  midiError: null,
  recordingSupported: MEDIA_RECORDER_SUPPORTED,
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
    });
  },

  setHowlProtectionEnabled: (enabled) => {
    resetHowlWatch();
    set({ howlProtectionEnabled: enabled });
    persistIoSettings({
      inputGainDb: get().inputGainDb,
      masterVolume: get().masterVolume,
      howlProtectionEnabled: enabled,
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
      const devices = await AudioEngine.getInstance().listInputDevices();
      set({ devices });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  setSelectedDevice: async (deviceId) => {
    const wasRunning = get().isRunning;
    set({ selectedDeviceId: deviceId, error: null });

    if (!wasRunning) return;

    resetHowlWatch();
    set({ isLoading: true });

    try {
      await finishActiveRecording('finalize');
      const devices = await switchInputDevice(deviceId);
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

    try {
      await finishActiveRecording('finalize');
      const devices = await connectWithDevice(selectedDeviceId);
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
      const engine = AudioEngine.getInstance();
      engine.setPlaybackEndedHandler(() => {
        void (async () => {
          resetHowlWatch();
          await finishActiveRecording('finalize');
          await engine.stop();
          set({
            isRunning: false,
            inputMode: 'idle',
            uploadedFileName: null,
            isLoading: false,
            ...resetReadings(),
          });
        })();
      });

      await engine.startFile(file);
      const playback = engine.readFilePlayback();
      set({
        isRunning: true,
        inputMode: 'file',
        uploadedFileName: file.name,
        fileCurrentTime: playback.currentTime,
        fileDuration: playback.duration,
        isFilePaused: playback.isPaused,
        isLoading: false,
        error: null,
      });
    } catch (error) {
      await AudioEngine.getInstance().stop();
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
    resetHowlWatch();
    set({ isLoading: true, error: null });
    await finishActiveRecording('finalize');
    await AudioEngine.getInstance().stop();
    set({
      isRunning: false,
      inputMode: 'idle',
      uploadedFileName: null,
      isLoading: false,
      ...resetReadings(),
    });
  },

  panic: () => {
    resetHowlWatch();
    void finishActiveRecording('abort');
    audioEngine.panic();
    set({
      isRunning: false,
      inputMode: 'idle',
      uploadedFileName: null,
      isLoading: false,
      error: '긴급 정지: 모든 오디오 노드를 차단하고 마스터 출력을 0으로 내렸습니다.',
      ...resetReadings(),
    });
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
    if (!state.recordingSupported || !state.isRunning || activeRecorder) return;

    revokeRecordingUrl(state.recordedUrl);
    set({
      recordingStatus: 'idle',
      recordedUrl: null,
      recordingElapsed: 0,
      error: null,
    });

    try {
      const stream = audioEngine.createRecorderStream();
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
      recordingMimeType = mimeType ?? (candidate.mimeType || 'audio/webm');
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
    const now = performance.now();
    const shouldWatchForHowl =
      state.isRunning && state.inputMode === 'device' && state.howlProtectionEnabled;

    if (shouldWatchForHowl && outputLevel.peakDb >= HOWL_THRESHOLD_DB) {
      howlThresholdStartedAt ??= now;

      if (now - howlThresholdStartedAt >= HOWL_DURATION_MS) {
        resetHowlWatch();
        void finishActiveRecording('abort');
        engine.panic();
        set({
          isRunning: false,
          inputMode: 'idle',
          uploadedFileName: null,
          isLoading: false,
          error: '하울링이 감지되어 출력을 차단했습니다. 헤드폰을 사용하세요.',
          ...resetReadings(),
        });
        return;
      }
    } else {
      resetHowlWatch();
    }

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
