import { create } from 'zustand';
import { AudioEngine } from '../audio/AudioEngine';
import type { PedalState } from '../audio/types';
import { clonePedals, usePedalStore } from './pedalStore';
import { useAudioStore } from './audioStore';

const MAX_HISTORY = 50;
const COALESCE_MS = 350;
type Snapshot = PedalState[];
interface HistoryStore {
  past: Snapshot[];
  future: Snapshot[];
  undo: () => void;
  redo: () => void;
  clear: () => void;
}
let restoring = false;
let lastParameterKey: string | null = null;
let lastChangeAt = 0;

// Group consecutive moves of the same knob as one edit, while keeping unrelated edits separate.
function changedParameterKey(before: Snapshot, after: Snapshot): string | null {
  if (before.length !== after.length) return null;
  let key: string | null = null;
  for (let i = 0; i < before.length; i++) {
    const oldPedal = before[i];
    const newPedal = after[i];
    if (oldPedal.id !== newPedal.id || oldPedal.enabled !== newPedal.enabled || oldPedal.bypassed !== newPedal.bypassed) return null;
    for (const param of new Set([...Object.keys(oldPedal.params), ...Object.keys(newPedal.params)])) {
      if (oldPedal.params[param] !== newPedal.params[param]) {
        if (key) return null;
        key = `${oldPedal.id}:${param}`;
      }
    }
  }
  return key;
}

function restore(pedals: Snapshot) {
  restoring = true;
  try {
    usePedalStore.getState().setPedals(clonePedals(pedals));
    useAudioStore.getState().adoptTempoFromPedals();
    AudioEngine.getInstance().rebuildChain();
  } finally {
    restoring = false;
    lastParameterKey = null;
  }
}

export const useHistoryStore = create<HistoryStore>((set, get) => ({
  past: [], future: [],
  clear: () => {
    lastParameterKey = null;
    lastChangeAt = 0;
    set({ past: [], future: [] });
  },
  undo: () => {
    const { past, future } = get();
    const previous = past.at(-1);
    if (!previous) return;
    const current = clonePedals(usePedalStore.getState().pedals);
    restore(previous);
    set({ past: past.slice(0, -1), future: [...future, current].slice(-MAX_HISTORY) });
  },
  redo: () => {
    const { past, future } = get();
    const next = future.at(-1);
    if (!next) return;
    const current = clonePedals(usePedalStore.getState().pedals);
    restore(next);
    set({ past: [...past, current].slice(-MAX_HISTORY), future: future.slice(0, -1) });
  },
}));

usePedalStore.subscribe((state, previous) => {
  if (restoring || state.pedals === previous.pedals) return;
  if (JSON.stringify(state.pedals) === JSON.stringify(previous.pedals)) return;
  const key = changedParameterKey(previous.pedals, state.pedals);
  const now = Date.now();
  const coalesce = key !== null && key === lastParameterKey && now - lastChangeAt <= COALESCE_MS;
  useHistoryStore.setState((history) => ({
    past: coalesce ? history.past : [...history.past, clonePedals(previous.pedals)].slice(-MAX_HISTORY),
    future: [],
  }));
  lastParameterKey = key;
  lastChangeAt = now;
});
