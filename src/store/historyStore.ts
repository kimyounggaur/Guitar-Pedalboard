import { create } from 'zustand';
import { AudioEngine } from '../audio/AudioEngine';
import type { PedalState } from '../audio/types';
import { clonePedals, usePedalStore } from './pedalStore';
import { useAudioStore } from './audioStore';

const MAX_HISTORY = 50;
const COALESCE_MS = 350;
// 실행 취소·다시 실행은 페달과 프리셋 음량 보정(S1.4c)을 함께 되돌린다. 보정이 따로 남으면 되돌린 프리셋의 음량이 틀어진다.
type Snapshot = { pedals: PedalState[]; presetTrimDb: number };
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
function changedParameterKey(before: PedalState[], after: PedalState[]): string | null {
  if (before.length !== after.length) return null;
  let key: string | null = null;
  for (let i = 0; i < before.length; i++) {
    const oldPedal = before[i];
    const newPedal = after[i];
    if (oldPedal === newPedal) continue; // 바뀌지 않은 페달은 참조가 같다(S4.3)
    if (oldPedal.id !== newPedal.id || oldPedal.active !== newPedal.active) return null;
    for (const param of new Set([...Object.keys(oldPedal.params), ...Object.keys(newPedal.params)])) {
      if (oldPedal.params[param] !== newPedal.params[param]) {
        if (key) return null;
        key = `${oldPedal.id}:${param}`;
      }
    }
  }
  return key;
}

/**
 * 페달 목록의 내용이 달라졌는가. 참조가 같은 페달은 견주지 않고(S4.3: 바뀌지 않은 페달은 참조를 유지한다),
 * 참조가 다른 페달만 내용(JSON)을 견준다. 배열 전체를 JSON 으로 견준 것과 결과가 같다.
 */
function pedalListChanged(before: PedalState[], after: PedalState[]): boolean {
  if (before === after) return false;
  if (before.length !== after.length) return true;
  return after.some((pedal, index) => pedal !== before[index] && JSON.stringify(pedal) !== JSON.stringify(before[index]));
}

function snapshotOf(pedals: PedalState[], presetTrimDb: number): Snapshot {
  return { pedals: clonePedals(pedals), presetTrimDb };
}

function currentSnapshot(): Snapshot {
  const { pedals, presetTrimDb } = usePedalStore.getState();
  return snapshotOf(pedals, presetTrimDb);
}

function restore(snapshot: Snapshot) {
  restoring = true;
  try {
    usePedalStore.getState().setPedals(clonePedals(snapshot.pedals), snapshot.presetTrimDb);
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
    const current = currentSnapshot();
    restore(previous);
    set({ past: past.slice(0, -1), future: [...future, current].slice(-MAX_HISTORY) });
  },
  redo: () => {
    const { past, future } = get();
    const next = future.at(-1);
    if (!next) return;
    const current = currentSnapshot();
    restore(next);
    set({ past: [...past, current].slice(-MAX_HISTORY), future: future.slice(0, -1) });
  },
}));

usePedalStore.subscribe((state, previous) => {
  if (restoring) return;
  const trimChanged = state.presetTrimDb !== previous.presetTrimDb;
  const pedalsChanged = pedalListChanged(previous.pedals, state.pedals);
  if (!pedalsChanged && !trimChanged) return;
  // 노브 하나를 계속 돌리는 편집만 한 단계로 묶는다. 음량 보정이 함께 바뀐 편집(프리셋 불러오기, 음량 맞추기)은 항상 한 단계다.
  const key = trimChanged ? null : changedParameterKey(previous.pedals, state.pedals);
  const now = Date.now();
  const coalesce = key !== null && key === lastParameterKey && now - lastChangeAt <= COALESCE_MS;
  useHistoryStore.setState((history) => ({
    past: coalesce ? history.past : [...history.past, snapshotOf(previous.pedals, previous.presetTrimDb)].slice(-MAX_HISTORY),
    future: [],
  }));
  lastParameterKey = key;
  lastChangeAt = now;
});
