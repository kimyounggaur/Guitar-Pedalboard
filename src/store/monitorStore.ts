// 레벨·가드 상태의 최신값을 두는 곳(설계서 4.3절). MonitorService 가 워클릿 메시지로 채우고,
// 화면 미터는 자기 rAF 에서 `useMonitorStore.getState()` 로 읽어 그리기만 한다(React 리렌더 없음).
// 오디오 스레드의 판정·측정은 화면이 보이는지, 어느 탭인지와 상관없이 돈다. 이 스토어는 그 결과를 보여 주는 쪽의 사본일 뿐이다.
import { create } from 'zustand';
import { SILENT_TAP, toLevelReading, type TapState } from '../audio/monitor/levelReading';
import type { InputLevelWarning } from '../audio/monitor/levelWarning';
import type { GuardStatus, MonitorSink } from '../audio/monitor/MonitorService';
import type { LevelReading } from '../audio/types';

export type { GuardStatus };

export interface MonitorState {
  input: TapState;
  output: TapState;
  /** 최근 100 ms 의 리미터 최대 이득 감소량(dB, 양수). 보고가 멈추면(줄일 일이 없으면) 0. */
  limiterGrDb: number;
  guard: GuardStatus;
  /**
   * 입력 레벨 경고(설계서 4.12). MonitorService 가 판정한 결과이고, 바뀔 때만 갱신된다(30 Hz 로 갱신하지 않는다).
   * 화면은 이 값을 읽어 보여 주기만 한다. 어느 탭이 열려 있는지, 미터가 그려지는지와 상관없이 같은 값이다.
   */
  inputWarning: InputLevelWarning | null;
  setInput(tap: TapState): void;
  setOutput(tap: TapState): void;
  setLimiterGr(grDb: number): void;
  setGuard(patch: Partial<GuardStatus>): void;
  setInputWarning(warning: InputLevelWarning | null): void;
  /** 세션이 끝났을 때 모두 무음·초기 상태로 되돌린다. */
  reset(): void;
}

const initialGuard: GuardStatus = { mode: 'off', suspect: null, cut: null };

export const useMonitorStore = create<MonitorState>((set) => ({
  input: SILENT_TAP,
  output: SILENT_TAP,
  limiterGrDb: 0,
  guard: initialGuard,
  inputWarning: null,
  setInput: (tap) => set({ input: tap }),
  setOutput: (tap) => set({ output: tap }),
  setLimiterGr: (grDb) => set({ limiterGrDb: grDb }),
  setGuard: (patch) => set((state) => ({ guard: { ...state.guard, ...patch } })),
  setInputWarning: (warning) => set({ inputWarning: warning }),
  reset: () => set({ input: SILENT_TAP, output: SILENT_TAP, limiterGrDb: 0, guard: initialGuard, inputWarning: null }),
}));

/** MonitorService 가 값을 내보내는 곳. AudioEngine 에 주입한다(audioStore 가 시작할 때 `setMonitorSink`). */
export const monitorSink: MonitorSink = {
  setInput: (tap) => useMonitorStore.getState().setInput(tap),
  setOutput: (tap) => useMonitorStore.getState().setOutput(tap),
  setLimiterGr: (grDb) => useMonitorStore.getState().setLimiterGr(grDb),
  setGuard: (patch) => useMonitorStore.getState().setGuard(patch),
  setInputWarning: (warning) => useMonitorStore.getState().setInputWarning(warning),
  reset: () => useMonitorStore.getState().reset(),
};

/** 입력 막대·클리핑 표시용 읽기. 새 측정이 없으면 마지막 값을 그대로 돌려준다. */
export function readInputLevel(nowMs: number = performance.now()): LevelReading {
  return toLevelReading(useMonitorStore.getState().input, nowMs);
}

export function readOutputLevel(nowMs: number = performance.now()): LevelReading {
  return toLevelReading(useMonitorStore.getState().output, nowMs);
}
