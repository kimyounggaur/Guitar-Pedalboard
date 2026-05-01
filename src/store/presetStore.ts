import { create } from 'zustand';
import type { PedalParamValue, PedalState, Preset } from '../audio/types';
import { clonePedals, initialPedals } from './pedalStore';

const STORAGE_KEY = 'web-guitar-pedalboard-presets';
const FACTORY_TIMESTAMP = 1767225600000;

type PresetExport = {
  version: 1;
  exportedAt: number;
  presets: Preset[];
};

export type PresetListItem = Preset & {
  isFactory?: boolean;
};

function clonePreset(preset: PresetListItem): PresetListItem {
  return {
    ...preset,
    pedals: clonePedals(preset.pedals),
  };
}

function withPedalOverrides(
  pedal: PedalState,
  overrides: Partial<Pick<PedalState, 'enabled' | 'bypassed'>> & {
    params?: Record<string, PedalParamValue>;
  },
): PedalState {
  const bypassed = overrides.bypassed ?? pedal.bypassed;

  return {
    ...pedal,
    enabled: overrides.enabled ?? pedal.enabled,
    bypassed,
    params: {
      ...pedal.params,
      ...overrides.params,
      bypassed,
    } as PedalState['params'],
  };
}

function createPreset(
  id: string,
  name: string,
  overrides: Record<string, Parameters<typeof withPedalOverrides>[1]>,
): PresetListItem {
  return {
    id,
    name,
    isFactory: true,
    updatedAt: FACTORY_TIMESTAMP,
    pedals: clonePedals(initialPedals).map((pedal) =>
      overrides[pedal.id] ? withPedalOverrides(pedal, overrides[pedal.id]) : pedal,
    ),
  };
}

export const defaultPresets: PresetListItem[] = [
  createPreset('factory-clean-practice', 'Clean Practice', {
    'noise-gate': { params: { thresholdDb: -60, reductionDb: -70, releaseMs: 160 } },
    compressor: { params: { threshold: -28, ratio: 2.4, sustain: 18, mix: 55 } },
    drive: { bypassed: true, params: { bypassed: true, mix: 0 } },
    eq: { params: { lowCut: 75, bassGain: 0.5, midGain: 0, trebleGain: 1, presenceGain: 1 } },
    delay: { bypassed: true, params: { bypassed: true } },
    reverb: { params: { mode: 'room', decay: 1.2, mix: 18, highCut: 6800 } },
  }),
  createPreset('factory-blues-lead', 'Blues Lead', {
    compressor: { params: { threshold: -30, ratio: 3.2, sustain: 42, mix: 70 } },
    drive: {
      params: { mode: 'overdrive', drive: 48, tone: 58, level: 96, mix: 88, bias: 0.14 },
    },
    eq: { params: { bassGain: 2, midFreq: 720, midGain: 2.5, trebleGain: 1.5, presenceGain: 2 } },
    delay: { params: { bypassed: false, mode: 'analog', timeMs: 310, feedback: 0.25, mix: 18, tone: 45 } },
    reverb: { params: { bypassed: false, mode: 'spring', decay: 1.7, mix: 22, highCut: 6200 } },
  }),
  createPreset('factory-classic-rock', 'Classic Rock', {
    compressor: { params: { threshold: -24, ratio: 4.5, sustain: 30, mix: 65 } },
    drive: { params: { mode: 'crunch', drive: 64, tone: 62, level: 92, mix: 92, bias: 0.04 } },
    eq: { params: { lowCut: 85, bassGain: 2.5, midFreq: 850, midGain: -1.5, trebleGain: 3, presenceGain: 2 } },
    delay: { bypassed: true, params: { bypassed: true } },
    reverb: { params: { mode: 'plate', decay: 1.5, mix: 16, highCut: 7400 } },
  }),
  createPreset('factory-ambient-delay', 'Ambient Delay', {
    compressor: { params: { threshold: -32, ratio: 2.6, sustain: 48, mix: 72 } },
    drive: { bypassed: true, params: { bypassed: true, mix: 0 } },
    eq: { params: { lowCut: 95, bassGain: -1, midFreq: 1000, midGain: -1, trebleGain: 2, presenceGain: 3 } },
    delay: {
      params: {
        bypassed: false,
        mode: 'tape',
        sync: true,
        bpm: 90,
        division: 'dotted1/8',
        feedback: 0.62,
        mix: 48,
        tone: 38,
      },
    },
    reverb: { params: { bypassed: false, mode: 'ambient', decay: 6.2, preDelay: 65, mix: 45, highCut: 8200 } },
  }),
  createPreset('factory-fuzz-experiment', 'Fuzz Experiment', {
    compressor: { params: { threshold: -34, ratio: 6, sustain: 62, mix: 82 } },
    drive: { params: { mode: 'fuzz', drive: 92, tone: 42, level: 82, mix: 100, bias: -0.12 } },
    eq: { params: { lowCut: 110, bassGain: 4, midFreq: 620, midGain: -5, trebleGain: 4, presenceGain: 5 } },
    delay: { params: { bypassed: false, mode: 'slapback', timeMs: 95, feedback: 0.15, mix: 18, tone: 60 } },
    reverb: { params: { bypassed: false, mode: 'plate', decay: 2.2, mix: 24, highCut: 6800 } },
  }),
];

function canUseStorage(): boolean {
  return typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';
}

function isPreset(value: unknown): value is Preset {
  const preset = value as Preset;

  return (
    !!preset &&
    typeof preset.id === 'string' &&
    typeof preset.name === 'string' &&
    typeof preset.updatedAt === 'number' &&
    Array.isArray(preset.pedals)
  );
}

function normalizeImportedPreset(preset: Preset): Preset {
  return {
    id: preset.id || createId(),
    name: preset.name.trim() || 'Imported Preset',
    pedals: clonePedals(preset.pedals),
    updatedAt: typeof preset.updatedAt === 'number' ? preset.updatedAt : Date.now(),
  };
}

function parsePresetJson(json: string): Preset[] {
  const parsed = JSON.parse(json);
  const candidates = Array.isArray(parsed) ? parsed : (parsed as PresetExport).presets;

  if (!Array.isArray(candidates)) {
    throw new Error('프리셋 JSON 형식이 올바르지 않습니다.');
  }

  return candidates.filter(isPreset).map(normalizeImportedPreset);
}

function readUserPresets(): Preset[] {
  if (!canUseStorage()) return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return parsePresetJson(raw);
  } catch {
    return [];
  }
}

function writeUserPresets(presets: Preset[]): void {
  if (!canUseStorage()) return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function createId(): string {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function toPresetList(userPresets: Preset[]): PresetListItem[] {
  return [...defaultPresets.map(clonePreset), ...userPresets.map(clonePreset)];
}

interface PresetStore {
  presets: PresetListItem[];
  savePreset: (name: string, pedals: PedalState[]) => void;
  deletePreset: (id: string) => void;
  reloadPresets: () => void;
  exportPresets: () => string;
  importPresets: (json: string) => number;
}

export const usePresetStore = create<PresetStore>((set, get) => ({
  presets: toPresetList(readUserPresets()),

  savePreset: (name, pedals) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const userPresets = get().presets.filter((preset) => !preset.isFactory);
    const existing = userPresets.find((preset) => preset.name === trimmedName);
    const nextPreset: Preset = {
      id: existing?.id ?? createId(),
      name: trimmedName,
      pedals: clonePedals(pedals),
      updatedAt: Date.now(),
    };

    const nextUserPresets = existing
      ? userPresets.map((preset) => (preset.id === existing.id ? nextPreset : preset))
      : [nextPreset, ...userPresets];

    writeUserPresets(nextUserPresets);
    set({ presets: toPresetList(nextUserPresets) });
  },

  deletePreset: (id) => {
    const preset = get().presets.find((item) => item.id === id);
    if (preset?.isFactory) return;

    const userPresets = get().presets.filter((item) => !item.isFactory && item.id !== id);
    writeUserPresets(userPresets);
    set({ presets: toPresetList(userPresets) });
  },

  reloadPresets: () => set({ presets: toPresetList(readUserPresets()) }),

  exportPresets: () => {
    const exportPayload: PresetExport = {
      version: 1,
      exportedAt: Date.now(),
      presets: get().presets.map(({ isFactory: _isFactory, ...preset }) => ({
        ...preset,
        pedals: clonePedals(preset.pedals),
      })),
    };

    return JSON.stringify(exportPayload, null, 2);
  },

  importPresets: (json) => {
    const importedPresets = parsePresetJson(json).map((preset) => ({
      ...preset,
      id: preset.id.startsWith('factory-') ? createId() : preset.id,
      updatedAt: Date.now(),
    }));
    const userPresets = get().presets.filter((preset) => !preset.isFactory);
    const nextByName = new Map<string, Preset>();

    [...userPresets, ...importedPresets].forEach((preset) => {
      nextByName.set(preset.name, preset);
    });

    const nextUserPresets = Array.from(nextByName.values());
    writeUserPresets(nextUserPresets);
    set({ presets: toPresetList(nextUserPresets) });

    return importedPresets.length;
  },
}));
