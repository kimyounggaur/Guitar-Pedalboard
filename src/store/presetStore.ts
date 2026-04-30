import { create } from 'zustand';
import type { PedalState, Preset } from '../audio/types';
import { clonePedals } from './pedalStore';

const STORAGE_KEY = 'web-guitar-pedalboard-presets';

function readPresets(): Preset[] {
  if (typeof window === 'undefined') return [];

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Preset[];
  } catch {
    return [];
  }
}

function writePresets(presets: Preset[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

function createId(): string {
  if (crypto.randomUUID) return crypto.randomUUID();
  return `preset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

interface PresetStore {
  presets: Preset[];
  savePreset: (name: string, pedals: PedalState[]) => void;
  deletePreset: (id: string) => void;
  reloadPresets: () => void;
}

export const usePresetStore = create<PresetStore>((set, get) => ({
  presets: readPresets(),

  savePreset: (name, pedals) => {
    const trimmedName = name.trim();
    if (!trimmedName) return;

    const existing = get().presets.find((preset) => preset.name === trimmedName);
    const nextPreset: Preset = {
      id: existing?.id ?? createId(),
      name: trimmedName,
      pedals: clonePedals(pedals),
      updatedAt: Date.now(),
    };

    const presets = existing
      ? get().presets.map((preset) => (preset.id === existing.id ? nextPreset : preset))
      : [nextPreset, ...get().presets];

    writePresets(presets);
    set({ presets });
  },

  deletePreset: (id) => {
    const presets = get().presets.filter((preset) => preset.id !== id);
    writePresets(presets);
    set({ presets });
  },

  reloadPresets: () => set({ presets: readPresets() }),
}));
