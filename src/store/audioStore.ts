import { create } from 'zustand';
import { AudioEngine } from '../audio/AudioEngine';
import type { LevelReading, PedalState, PitchReading } from '../audio/types';

const silentLevel: LevelReading = {
  db: -120,
  linear: 0,
  peakDb: -120,
  peakLinear: 0,
  isClipping: false,
};
const emptyPitch: PitchReading = { frequency: null, note: null, cents: 0 };

type InputMode = 'idle' | 'device' | 'file';

interface AudioStore {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  inputMode: InputMode;
  uploadedFileName: string | null;
  isRunning: boolean;
  isLoading: boolean;
  error: string | null;
  inputLevel: LevelReading;
  outputLevel: LevelReading;
  inputWaveform: number[];
  outputWaveform: number[];
  cpuLoad: number;
  pitch: PitchReading;
  loadDevices: () => Promise<void>;
  setSelectedDevice: (deviceId: string, pedals?: PedalState[]) => Promise<void>;
  start: (pedals: PedalState[]) => Promise<void>;
  startFile: (file: File, pedals: PedalState[]) => Promise<void>;
  stop: () => Promise<void>;
  panic: () => void;
  refreshMeters: () => void;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '오디오 장치를 시작하지 못했습니다.';
}

function resetReadings() {
  return {
    inputLevel: silentLevel,
    outputLevel: silentLevel,
    inputWaveform: [],
    outputWaveform: [],
    cpuLoad: 0,
    pitch: emptyPitch,
  };
}

async function connectWithDevice(deviceId: string, pedals: PedalState[]) {
  await AudioEngine.getInstance().start(pedals, deviceId || undefined);
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
  isRunning: false,
  isLoading: false,
  error: null,
  inputLevel: silentLevel,
  outputLevel: silentLevel,
  inputWaveform: [],
  outputWaveform: [],
  cpuLoad: 0,
  pitch: emptyPitch,

  loadDevices: async () => {
    try {
      const devices = await AudioEngine.getInstance().listInputDevices();
      set({ devices });
    } catch (error) {
      set({ error: toErrorMessage(error) });
    }
  },

  setSelectedDevice: async (deviceId, pedals) => {
    const wasRunning = get().isRunning;
    set({ selectedDeviceId: deviceId, error: null });

    if (!wasRunning || !pedals) return;

    set({ isLoading: true });

    try {
      const devices = await switchInputDevice(deviceId);
      set({
        devices,
        isRunning: true,
        inputMode: 'device',
        uploadedFileName: null,
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

  start: async (pedals) => {
    const { selectedDeviceId } = get();
    set({ isLoading: true, error: null });

    try {
      const devices = await connectWithDevice(selectedDeviceId, pedals);
      set({
        devices,
        isRunning: true,
        inputMode: 'device',
        uploadedFileName: null,
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

  startFile: async (file, pedals) => {
    set({ isLoading: true, error: null });

    try {
      const engine = AudioEngine.getInstance();
      engine.setPlaybackEndedHandler(() => {
        void engine.stop();
        set({
          isRunning: false,
          inputMode: 'idle',
          uploadedFileName: null,
          isLoading: false,
          ...resetReadings(),
        });
      });

      await engine.startFile(file, pedals);
      set({
        isRunning: true,
        inputMode: 'file',
        uploadedFileName: file.name,
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
        isLoading: false,
      });
    }
  },

  stop: async () => {
    set({ isLoading: true, error: null });
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
    AudioEngine.getInstance().panic();
    set({
      isRunning: false,
      inputMode: 'idle',
      uploadedFileName: null,
      isLoading: false,
      error: 'Panic: 모든 오디오 노드를 차단하고 master output을 0으로 내렸습니다.',
      ...resetReadings(),
    });
  },

  refreshMeters: () => {
    const startedAt = performance.now();
    const engine = AudioEngine.getInstance();
    const inputLevel = engine.readInputLevel();
    const outputLevel = engine.readOutputLevel();
    const inputWaveform = engine.readInputWaveform();
    const outputWaveform = engine.readOutputWaveform();
    const pitch = engine.readPitch();
    const elapsed = performance.now() - startedAt;

    set({
      inputLevel,
      outputLevel,
      inputWaveform,
      outputWaveform,
      pitch,
      cpuLoad: Math.min(100, Math.round((elapsed / 90) * 100)),
    });
  },
}));
