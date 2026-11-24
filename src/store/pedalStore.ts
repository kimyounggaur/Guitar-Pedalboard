import { create } from 'zustand';
import { safeStorage, STORAGE_KEYS } from '../persistence';
import {
  mergeStoredPedals,
  migrateStoredState,
  normalizeStoredState,
  SCHEMA_VERSION,
  toStoredPedals,
  type StoredState,
} from '../persistence/legacy/boardV1';
import { clonePedal, clonePedals, initialPedals } from '../presets/initialPedals';
import type { PedalParamValue, PedalParams, PedalState } from '../audio/types';
import { clampTrimDb, roundTrimDb } from '../audio/offline/loudnessSpec';

// 이전 위치에서 쓰던 이름을 그대로 내보낸다(S2.4 선행 이동: 가져오는 쪽 코드는 바꾸지 않는다).
export { clonePedals, initialPedals } from '../presets/initialPedals';
export { migratePedalCollection, migrations, migrateStoredState, SCHEMA_VERSION } from '../persistence/legacy/boardV1';
export type { StoredPedal, StoredState } from '../persistence/legacy/boardV1';

/** 저장본을 만든다. 음량 보정이 0 이면 필드를 쓰지 않아, 보정이 없는 저장본은 이전 버전과 똑같은 모양이다. */
function buildStoredState(pedals: PedalState[], presetTrimDb: number): StoredState {
  const storedState: StoredState = {
    version: SCHEMA_VERSION,
    pedals: toStoredPedals(pedals),
  };
  const trimDb = clampTrimDb(presetTrimDb);
  if (trimDb !== 0) storedState.presetTrimDb = trimDb;
  return storedState;
}

/** 지금 쓴다(밀려 있던 지연 저장은 SafeStorage 가 이 값으로 대신한다). 실패는 SafeStorage 가 한 번 알리고 메모리에 유지한다. */
function savePedals(pedals: PedalState[], presetTrimDb: number): void {
  safeStorage.set(STORAGE_KEYS.pedals, buildStoredState(pedals, presetTrimDb));
}

/** 노브를 돌리는 동안에는 쓰지 않고 마지막 변경 300 ms 뒤에 한 번 쓴다. 페이지가 가려지거나 닫히면 SafeStorage 가 바로 쓴다. */
function schedulePedalSave(pedals: PedalState[], presetTrimDb: number): void {
  safeStorage.setDebounced(STORAGE_KEYS.pedals, () => buildStoredState(pedals, presetTrimDb), 300);
}

function readStoredState(): StoredState | null {
  // 읽지 못하는 값(깨졌거나 더 새로운 버전)은 SafeStorage 가 보관해 두고 한 번 알린 뒤 null 을 돌려 준다 — 기본값으로 시작한다.
  return safeStorage.read<StoredState | null>(
    STORAGE_KEYS.pedals,
    (raw) => migrateStoredState(normalizeStoredState(JSON.parse(raw))),
    null,
  );
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
  /** 지금 프리셋의 음량 보정(dB). 프리셋을 불러올 때 따라 들어오고, 페달 상태와 함께 저장된다. 기본 0. */
  presetTrimDb: number;
  activePedalId: string | null;
  draggingPedalId: string | null;
  reorderPedals: (oldIndex: number, newIndex: number) => void;
  togglePedal: (id: string) => void;
  setPedalBypass: (id: string, bypassed: boolean) => void;
  updatePedalParam: (id: string, paramName: string, value: PedalParamValue) => void;
  setActivePedal: (id: string | null) => void;
  setDraggingPedal: (id: string | null) => void;
  loadPedalsFromStorage: () => void;
  savePedalsToStorage: () => void;
  resetPedalOrder: () => void;
  /** 페달 전체를 바꾼다. `presetTrimDb` 를 주면 음량 보정도 같이 바꾸고, 안 주면 지금 값을 그대로 둔다. */
  setPedals: (pedals: PedalState[], presetTrimDb?: number) => void;
  /** 음량 보정만 바꾼다('음량 맞추기'). 0.1 dB 단위·±24 dB 로 정리하고 바로 저장한다. */
  setPresetTrimDb: (presetTrimDb: number) => void;
  updatePedal: (pedal: PedalState) => void;
}

const restoredState = readStoredState();

export const usePedalStore = create<PedalStore>((set, get) => ({
  pedals: mergeStoredPedals(restoredState?.pedals ?? null),
  presetTrimDb: clampTrimDb(restoredState?.presetTrimDb),
  activePedalId: null,
  draggingPedalId: null,

  reorderPedals: (oldIndex, newIndex) =>
    set((state) => {
      const pedals = movePedal(state.pedals, oldIndex, newIndex);
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

  togglePedal: (id) =>
    set((state) => {
      const pedals = state.pedals.map((pedal) =>
        pedal.id === id ? { ...clonePedal(pedal), enabled: true, bypassed: pedal.enabled && !pedal.bypassed } : clonePedal(pedal),
      );
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

  setPedalBypass: (id, bypassed) =>
    set((state) => {
      const pedals = state.pedals.map((pedal) =>
        pedal.id === id ? clonePedal({ ...pedal, enabled: true, bypassed }) : clonePedal(pedal),
      );
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

  updatePedalParam: (id, paramName, value) =>
    set((state) => {
      const pedals = state.pedals.map((pedal) => {
        if (pedal.id !== id) return pedal;
        if (paramName === 'bypass' || paramName === 'bypassed') return pedal;

        const nextValue =
          pedal.type === 'delay' && paramName === 'feedback' && typeof value === 'number'
            ? Math.min(0.95, Math.max(0, value))
            : value;

        return clonePedal({
          ...pedal,
          params: {
            ...pedal.params,
            [paramName]: nextValue,
          } as PedalParams,
        });
      });

      schedulePedalSave(pedals, state.presetTrimDb);
      return { pedals };
    }),

  setActivePedal: (id) => set({ activePedalId: id }),

  setDraggingPedal: (id) => set({ draggingPedalId: id }),

  loadPedalsFromStorage: () => {
    const stored = readStoredState();
    set({
      pedals: mergeStoredPedals(stored?.pedals ?? null),
      presetTrimDb: clampTrimDb(stored?.presetTrimDb),
    });
  },

  savePedalsToStorage: () => savePedals(get().pedals, get().presetTrimDb),

  resetPedalOrder: () => {
    const pedals = clonePedals(initialPedals);
    // 초기 보드는 보정 없이(0 dB) 시작한다.
    savePedals(pedals, 0);
    set({
      pedals,
      presetTrimDb: 0,
      activePedalId: null,
      draggingPedalId: null,
    });
  },

  setPedals: (pedals, presetTrimDb) => {
    const nextPedals = clonePedals(pedals);
    const nextTrimDb = presetTrimDb === undefined ? get().presetTrimDb : clampTrimDb(presetTrimDb);
    savePedals(nextPedals, nextTrimDb);
    set({ pedals: nextPedals, presetTrimDb: nextTrimDb });
  },

  setPresetTrimDb: (presetTrimDb) => {
    const nextTrimDb = roundTrimDb(clampTrimDb(presetTrimDb));
    // 대기 중이던 페달 저장도 이 시점의 페달로 함께 쓴다(저장본에서 페달과 보정이 어긋나지 않게).
    savePedals(get().pedals, nextTrimDb);
    set({ presetTrimDb: nextTrimDb });
  },

  updatePedal: (pedal) =>
    set((state) => {
      const nextPedal = clonePedal(pedal);
      const pedals = state.pedals.map((current) =>
        current.id === pedal.id ? nextPedal : clonePedal(current),
      );
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

}));
