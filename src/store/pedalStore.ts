import { create } from 'zustand';
import type { PedalState } from '../audio/types';

export const initialPedals: PedalState[] = [
  {
    id: 'noise-gate',
    type: 'noiseGate',
    name: 'Noise Gate',
    color: '#3f8f85',
    params: {
      bypass: false,
      mix: 1,
      level: 1,
      threshold: -54,
      release: 0.09,
    },
  },
  {
    id: 'compressor',
    type: 'compressor',
    name: 'Compressor',
    color: '#b48a3c',
    params: {
      bypass: false,
      mix: 0.75,
      level: 1,
      threshold: -24,
      ratio: 4,
      attack: 0.006,
      release: 0.18,
    },
  },
  {
    id: 'drive',
    type: 'drive',
    name: 'Drive',
    color: '#bd5d45',
    params: {
      bypass: false,
      mix: 0.88,
      level: 0.95,
      drive: 0.42,
      tone: 0.55,
    },
  },
  {
    id: 'eq',
    type: 'eq',
    name: '3-Band EQ',
    color: '#526fb3',
    params: {
      bypass: false,
      mix: 1,
      level: 1,
      low: 1.5,
      mid: -0.5,
      high: 1.8,
    },
  },
  {
    id: 'delay',
    type: 'delay',
    name: 'Delay',
    color: '#6a7d4f',
    params: {
      bypass: true,
      mix: 0.3,
      level: 1,
      time: 0.28,
      feedback: 0.34,
      tone: 0.6,
    },
  },
  {
    id: 'reverb',
    type: 'reverb',
    name: 'Reverb',
    color: '#8b6f9f',
    params: {
      bypass: true,
      mix: 0.25,
      level: 1,
      decay: 1.8,
      tone: 0.68,
    },
  },
];

export function clonePedals(pedals: PedalState[]): PedalState[] {
  return pedals.map((pedal) => ({
    ...pedal,
    params: { ...pedal.params },
  }));
}

interface PedalStore {
  pedals: PedalState[];
  draggingId: string | null;
  setPedals: (pedals: PedalState[]) => void;
  updatePedal: (pedal: PedalState) => void;
  setDraggingId: (id: string | null) => void;
  resetPedals: () => void;
}

export const usePedalStore = create<PedalStore>((set) => ({
  pedals: clonePedals(initialPedals),
  draggingId: null,
  setPedals: (pedals) => set({ pedals: clonePedals(pedals) }),
  updatePedal: (pedal) =>
    set((state) => ({
      pedals: state.pedals.map((current) =>
        current.id === pedal.id ? { ...pedal, params: { ...pedal.params } } : current,
      ),
    })),
  setDraggingId: (id) => set({ draggingId: id }),
  resetPedals: () => set({ pedals: clonePedals(initialPedals), draggingId: null }),
}));
