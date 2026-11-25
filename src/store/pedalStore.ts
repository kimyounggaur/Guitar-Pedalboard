import { create } from 'zustand';
import { getBoot, readBoard, writeBoard, writeBoardDebounced } from '../persistence/appData';
import { clonePedal, clonePedals, initialPedals } from '../presets/initialPedals';
import type { PedalParamValue, PedalParams, PedalState } from '../audio/types';
import { clampTrimDb, roundTrimDb } from '../audio/offline/loudnessSpec';

// 이전 위치에서 쓰던 이름을 그대로 내보낸다(S2.4 선행 이동: 가져오는 쪽 코드는 바꾸지 않는다).
export { clonePedals, initialPedals } from '../presets/initialPedals';
export { migratePedalCollection, migrations, migrateStoredState, SCHEMA_VERSION } from '../persistence/legacy/boardV1';
export type { StoredPedal, StoredState } from '../persistence/legacy/boardV1';

/** 지금 쓴다(밀려 있던 지연 저장은 SafeStorage 가 이 값으로 대신한다). 어느 키에 어떤 모양으로 쓰는지는 persistence/appData 가 정한다(S2.4). */
function savePedals(pedals: PedalState[], presetTrimDb: number): void {
  writeBoard(pedals, presetTrimDb);
}

/** 노브를 돌리는 동안에는 쓰지 않고 마지막 변경 300 ms 뒤에 한 번 쓴다. 페이지가 가려지거나 닫히면 SafeStorage 가 바로 쓴다. */
function schedulePedalSave(pedals: PedalState[], presetTrimDb: number): void {
  writeBoardDebounced(pedals, presetTrimDb, 300);
}

/**
 * 순서만 바꾼 새 배열을 만든다. 페달 객체는 그대로 쓴다(S4.3: 바뀐 것이 없는 페달은 참조를 유지해야 카드가 다시 그려지지 않는다).
 * 범위를 벗어났거나 자리가 같으면 순서는 그대로인 새 배열이다.
 */
function movePedal(pedals: PedalState[], oldIndex: number, newIndex: number): PedalState[] {
  const nextPedals = [...pedals];
  if (
    oldIndex === newIndex ||
    oldIndex < 0 ||
    newIndex < 0 ||
    oldIndex >= pedals.length ||
    newIndex >= pedals.length
  ) {
    return nextPedals;
  }

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
  /**
   * 페달 하나를 켜거나 끄고 바로 저장한다. 저장소 값만 바꾼다 — 소리까지 바꾸려면 `setPedalActive`(store/pedalActions)를 쓴다.
   * S2.4: 옛 `togglePedal`·`setPedalBypass` 를 이 하나로 합쳤다.
   */
  setActive: (id: string, active: boolean) => void;
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

// 저장 형식은 앱을 열 때 한 번 정해지고(필요하면 v1 에서 v2 로 옮긴다), 읽어 온 보드는 이미 메모리 모양이다.
const restoredBoard = getBoot().board;

export const usePedalStore = create<PedalStore>((set, get) => ({
  pedals: restoredBoard ? clonePedals(restoredBoard.pedals) : clonePedals(initialPedals),
  presetTrimDb: clampTrimDb(restoredBoard?.trimDb),
  activePedalId: null,
  draggingPedalId: null,

  reorderPedals: (oldIndex, newIndex) =>
    set((state) => {
      const pedals = movePedal(state.pedals, oldIndex, newIndex);
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

  setActive: (id, active) =>
    set((state) => {
      // S4.3: 바뀌는 페달만 새 객체로 만들고 나머지는 참조를 그대로 둔다. 이미 같은 상태면 배열도 그대로다.
      let changed = false;
      const pedals = state.pedals.map((pedal) => {
        if (pedal.id !== id || pedal.active === active) return pedal;
        changed = true;
        return clonePedal({ ...pedal, active });
      });
      savePedals(pedals, state.presetTrimDb);
      return changed ? { pedals } : state;
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

        // 같은 값이면 그대로 둔다(끌다가 끝에 닿아 같은 값이 거듭 들어와도 카드가 다시 그려지지 않는다).
        if (Object.is((pedal.params as unknown as Record<string, unknown>)[paramName], nextValue)) return pedal;

        return clonePedal({
          ...pedal,
          params: {
            ...pedal.params,
            [paramName]: nextValue,
          } as PedalParams,
        });
      });

      if (pedals.every((pedal, index) => pedal === state.pedals[index])) return state;
      schedulePedalSave(pedals, state.presetTrimDb);
      return { pedals };
    }),

  setActivePedal: (id) => set({ activePedalId: id }),

  setDraggingPedal: (id) => set({ draggingPedalId: id }),

  loadPedalsFromStorage: () => {
    const board = readBoard();
    set({
      pedals: board ? clonePedals(board.pedals) : clonePedals(initialPedals),
      presetTrimDb: clampTrimDb(board?.trimDb),
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
      const pedals = state.pedals.map((current) => (current.id === pedal.id ? nextPedal : current));
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

}));
