import { create } from 'zustand';
import { AudioEngine } from '../audio/AudioEngine';
import type { LevelReading, PedalState, PitchReading } from '../audio/types';

const silentLevel: LevelReading = { db: -120, linear: 0 };
const emptyPitch: PitchReading = { frequency: null, note: null, cents: 0 };

interface AudioStore {
  devices: MediaDeviceInfo[];
  selectedDeviceId: string;
  isRunning: boolean;
  isLoading: boolean;
  error: string | null;
  inputLevel: LevelReading;
  outputLevel: LevelReading;
  pitch: PitchReading;
  loadDevices: () => Promise<void>;
  setSelectedDevice: (deviceId: string, pedals?: PedalState[]) => Promise<void>;
  start: (pedals: PedalState[]) => Promise<void>;
  stop: () => Promise<void>;
  refreshMeters: () => void;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return '오디오 장치를 시작하지 못했습니다.';
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
  isRunning: false,
  isLoading: false,
  error: null,
  inputLevel: silentLevel,
  outputLevel: silentLevel,
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
        isLoading: false,
        error: null,
      });
    } catch (error) {
      set({
        error: toErrorMessage(error),
        isRunning: false,
        isLoading: false,
        inputLevel: silentLevel,
        outputLevel: silentLevel,
        pitch: emptyPitch,
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
        isLoading: false,
        error: null,
      });
    } catch (error) {
      set({
        error: toErrorMessage(error),
        isRunning: false,
        isLoading: false,
      });
    }
  },

  stop: async () => {
    set({ isLoading: true, error: null });
    await AudioEngine.getInstance().stop();
    set({
      isRunning: false,
      isLoading: false,
      inputLevel: silentLevel,
      outputLevel: silentLevel,
      pitch: emptyPitch,
    });
  },

  refreshMeters: () => {
    const engine = AudioEngine.getInstance();
    set({
      inputLevel: engine.readInputLevel(),
      outputLevel: engine.readOutputLevel(),
      pitch: engine.readPitch(),
    });
  },
}));
