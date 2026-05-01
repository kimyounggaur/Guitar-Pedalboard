import { create } from 'zustand';
import type { Pedal, PedalParamValue, PedalParams, PedalState, PedalType } from '../audio/types';

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
      bypassed: false,
      mix: 100,
      level: 100,
      thresholdDb: -54,
      reductionDb: -80,
      attackMs: 6,
      holdMs: 70,
      releaseMs: 180,
      hysteresisDb: 4,
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
      bypassed: false,
      mix: 75,
      level: 100,
      threshold: -24,
      ratio: 4,
      attack: 0.006,
      release: 0.18,
      knee: 18,
      sustain: 35,
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
      bypassed: false,
      mix: 88,
      level: 95,
      mode: 'overdrive',
      drive: 42,
      tone: 55,
      bias: 0.08,
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
      bypassed: false,
      mix: 100,
      level: 100,
      lowCut: 70,
      bassGain: 1.5,
      midFreq: 800,
      midGain: -0.5,
      midQ: 0.9,
      trebleGain: 1.8,
      presenceGain: 1,
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
      bypassed: true,
      mix: 30,
      level: 100,
      mode: 'digital',
      timeMs: 280,
      feedback: 0.34,
      tone: 60,
      sync: false,
      bpm: 120,
      division: '1/4',
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
      bypassed: true,
      mix: 25,
      level: 100,
      mode: 'hall',
      decay: 1.8,
      preDelay: 24,
      lowCut: 120,
      highCut: 7200,
    },
  },
];

export function clonePedals(pedals: PedalState[]): PedalState[] {
  return pedals.map(clonePedal);
}

function clonePedal(pedal: PedalState): PedalState {
  const bypassed = pedal.bypassed ?? Boolean(pedal.params.bypassed ?? pedal.params.bypass);

  return {
    ...pedal,
    bypassed,
    params: {
      ...pedal.params,
      bypassed,
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
        params: normalizeStoredParams(defaultPedal.type, defaultPedal.params, storedPedal),
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

function normalizePercent(value: PedalParamValue | undefined, fallback: number): number {
  return typeof value === 'number' ? (value <= 2 ? Math.round(value * 100) : value) : fallback;
}

function normalizeStoredParams(
  type: PedalType,
  defaultParams: PedalParams,
  storedPedal: StoredPedal,
): PedalParams {
  const storedParams = storedPedal.params;
  const params = {
    ...defaultParams,
    ...storedParams,
    bypassed: storedPedal.bypassed,
    mix: normalizePercent(storedParams.mix, Number(defaultParams.mix)),
    level: normalizePercent(storedParams.level, Number(defaultParams.level)),
  } as Record<string, PedalParamValue>;

  if (type === 'noiseGate') {
    params.thresholdDb = typeof storedParams.thresholdDb === 'number' ? storedParams.thresholdDb : (storedParams.threshold as number) ?? params.thresholdDb;
    params.releaseMs =
      typeof storedParams.releaseMs === 'number'
        ? storedParams.releaseMs
        : typeof storedParams.release === 'number'
          ? Math.round(storedParams.release * 1000)
          : params.releaseMs;
  }

  if (type === 'drive') {
    params.drive = normalizePercent(storedParams.drive, Number(params.drive));
    params.tone = normalizePercent(storedParams.tone, Number(params.tone));
  }

  if (type === 'eq') {
    params.bassGain = typeof storedParams.bassGain === 'number' ? storedParams.bassGain : (storedParams.low as number) ?? params.bassGain;
    params.midGain = typeof storedParams.midGain === 'number' ? storedParams.midGain : (storedParams.mid as number) ?? params.midGain;
    params.trebleGain = typeof storedParams.trebleGain === 'number' ? storedParams.trebleGain : (storedParams.high as number) ?? params.trebleGain;
  }

  if (type === 'delay') {
    params.timeMs =
      typeof storedParams.timeMs === 'number'
        ? storedParams.timeMs
        : typeof storedParams.time === 'number'
          ? Math.round(storedParams.time * 1000)
          : params.timeMs;
    params.tone = normalizePercent(storedParams.tone, Number(params.tone));
  }

  if (type === 'reverb') {
    params.highCut =
      typeof storedParams.highCut === 'number'
        ? storedParams.highCut
        : typeof storedParams.tone === 'number'
          ? 1000 + normalizePercent(storedParams.tone, 60) * 110
          : params.highCut;
  }

  return params as PedalParams;
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
                bypassed,
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

        const bypassed =
          (paramName === 'bypass' || paramName === 'bypassed') && typeof value === 'boolean'
            ? value
            : pedal.bypassed;

        return clonePedal({
          ...pedal,
          bypassed,
          params: {
            ...pedal.params,
            [paramName]: value,
            bypassed,
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
