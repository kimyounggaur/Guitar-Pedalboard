import { create } from 'zustand';
import type { Pedal, PedalParamValue, PedalParams, PedalState } from '../audio/types';

const STORAGE_KEY = 'guitar-pedalboard:pedals';

type StoredPedal = Pick<Pedal, 'id' | 'enabled' | 'bypassed' | 'params'>;

export const initialPedals: PedalState[] = [
  {
    id: 'noise-gate',
    type: 'noiseGate',
    name: 'Noise Gate',
    enabled: true,
    bypassed: false,
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
    enabled: true,
    bypassed: false,
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
    enabled: true,
    bypassed: false,
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
    name: 'EQ',
    enabled: true,
    bypassed: false,
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
    enabled: true,
    bypassed: true,
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
    enabled: true,
    bypassed: true,
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
  return pedals.map(clonePedal);
}

function clonePedal(pedal: PedalState): PedalState {
  return {
    ...pedal,
    bypassed: pedal.bypassed ?? Boolean(pedal.params.bypass),
    params: {
      ...pedal.params,
      bypass: pedal.bypassed ?? Boolean(pedal.params.bypass),
    } as PedalParams,
  };
}

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function toStoredPedals(pedals: PedalState[]): StoredPedal[] {
  return pedals.map((pedal) => ({
    id: pedal.id,
    enabled: pedal.enabled,
    bypassed: pedal.bypassed,
    params: { ...pedal.params },
  }));
}

function savePedals(pedals: PedalState[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(toStoredPedals(pedals)));
}

function readStoredPedals(): StoredPedal[] | null {
  if (!canUseStorage()) return null;

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    return parsed.filter(
      (pedal): pedal is StoredPedal =>
        !!pedal &&
        typeof pedal.id === 'string' &&
        typeof pedal.enabled === 'boolean' &&
        typeof pedal.bypassed === 'boolean' &&
        typeof pedal.params === 'object' &&
        pedal.params !== null,
    );
  } catch {
    return null;
  }
}

function mergeStoredPedals(storedPedals: StoredPedal[] | null): PedalState[] {
  if (!storedPedals) return clonePedals(initialPedals);

  const defaultsById = new Map(initialPedals.map((pedal) => [pedal.id, pedal]));
  const usedIds = new Set<string>();
  const restored: PedalState[] = [];

  storedPedals.forEach((storedPedal) => {
    const defaultPedal = defaultsById.get(storedPedal.id);
    if (!defaultPedal || usedIds.has(storedPedal.id)) return;

    usedIds.add(storedPedal.id);
    restored.push(
      clonePedal({
        ...defaultPedal,
        enabled: storedPedal.enabled,
        bypassed: storedPedal.bypassed,
        params: {
          ...defaultPedal.params,
          ...storedPedal.params,
          bypass: storedPedal.bypassed,
        } as PedalParams,
      }),
    );
  });

  initialPedals.forEach((pedal) => {
    if (!usedIds.has(pedal.id)) {
      restored.push(clonePedal(pedal));
    }
  });

  return restored;
}

function movePedal(pedals: PedalState[], oldIndex: number, newIndex: number): PedalState[] {
  if (
    oldIndex === newIndex ||
    oldIndex < 0 ||
    newIndex < 0 ||
    oldIndex >= pedals.length ||
    newIndex >= pedals.length
  ) {
    return clonePedals(pedals);
  }

  const nextPedals = clonePedals(pedals);
  const [movedPedal] = nextPedals.splice(oldIndex, 1);
  nextPedals.splice(newIndex, 0, movedPedal);
  return nextPedals;
}

interface PedalStore {
  pedals: PedalState[];
  activePedalId: string | null;
  draggingPedalId: string | null;
  draggingId: string | null;
  reorderPedals: (oldIndex: number, newIndex: number) => void;
  togglePedal: (id: string) => void;
  setPedalBypass: (id: string, bypassed: boolean) => void;
  updatePedalParam: (id: string, paramName: string, value: PedalParamValue) => void;
  setActivePedal: (id: string | null) => void;
  setDraggingPedal: (id: string | null) => void;
  loadPedalsFromStorage: () => void;
  savePedalsToStorage: () => void;
  resetPedalOrder: () => void;
  setPedals: (pedals: PedalState[]) => void;
  updatePedal: (pedal: PedalState) => void;
  setDraggingId: (id: string | null) => void;
  resetPedals: () => void;
}

export const usePedalStore = create<PedalStore>((set, get) => ({
  pedals: mergeStoredPedals(readStoredPedals()),
  activePedalId: null,
  draggingPedalId: null,
  draggingId: null,

  reorderPedals: (oldIndex, newIndex) =>
    set((state) => {
      const pedals = movePedal(state.pedals, oldIndex, newIndex);
      savePedals(pedals);
      return { pedals };
    }),

  togglePedal: (id) =>
    set((state) => {
      const pedals = state.pedals.map((pedal) =>
        pedal.id === id ? { ...clonePedal(pedal), enabled: !pedal.enabled } : clonePedal(pedal),
      );
      savePedals(pedals);
      return { pedals };
    }),

  setPedalBypass: (id, bypassed) =>
    set((state) => {
      const pedals = state.pedals.map((pedal) =>
        pedal.id === id
          ? clonePedal({
              ...pedal,
              bypassed,
              params: {
                ...pedal.params,
                bypass: bypassed,
              } as PedalParams,
            })
          : clonePedal(pedal),
      );
      savePedals(pedals);
      return { pedals };
    }),

  updatePedalParam: (id, paramName, value) =>
    set((state) => {
      const pedals = state.pedals.map((pedal) => {
        if (pedal.id !== id) return clonePedal(pedal);

        const bypassed = paramName === 'bypass' && typeof value === 'boolean' ? value : pedal.bypassed;

        return clonePedal({
          ...pedal,
          bypassed,
          params: {
            ...pedal.params,
            [paramName]: value,
            bypass: bypassed,
          } as PedalParams,
        });
      });

      savePedals(pedals);
      return { pedals };
    }),

  setActivePedal: (id) => set({ activePedalId: id }),

  setDraggingPedal: (id) => set({ draggingPedalId: id, draggingId: id }),

  loadPedalsFromStorage: () => {
    const pedals = mergeStoredPedals(readStoredPedals());
    set({ pedals });
  },

  savePedalsToStorage: () => savePedals(get().pedals),

  resetPedalOrder: () => {
    const pedals = clonePedals(initialPedals);
    savePedals(pedals);
    set({
      pedals,
      activePedalId: null,
      draggingPedalId: null,
      draggingId: null,
    });
  },

  setPedals: (pedals) => {
    const nextPedals = clonePedals(pedals);
    savePedals(nextPedals);
    set({ pedals: nextPedals });
  },

  updatePedal: (pedal) =>
    set((state) => {
      const nextPedal = clonePedal(pedal);
      const pedals = state.pedals.map((current) =>
        current.id === pedal.id ? nextPedal : clonePedal(current),
      );
      savePedals(pedals);
      return { pedals };
    }),

  setDraggingId: (id) => set({ draggingPedalId: id, draggingId: id }),

  resetPedals: () => get().resetPedalOrder(),
}));
