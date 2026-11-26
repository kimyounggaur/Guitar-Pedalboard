// 화면 한쪽에 잠깐 떴다 사라지는 안내(토스트). 정지 이유 안내(S1.2)가 처음 쓰고,
// 저장 문제 안내·예기치 못한 오류 안내(S1.7)와 이후 실행 취소(S2.8)가 같은 구조를 재사용한다.
import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'warning' | 'error';

/** 토스트 안의 버튼 하나(예: '오류 정보 복사', 이후 '되돌리기'). 누르면 `onAction` 을 부르고 토스트를 닫는다. */
export interface ToastAction {
  label: string;
  onAction: () => void;
}

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  /** 같은 key 의 토스트는 하나만 남는다. 새 것이 이전 것을 대신하고 표시 시간이 다시 시작된다. */
  key: string;
  /** 0 이면 사용자가 닫을 때까지 남는다. */
  durationMs: number;
  /** 있으면 닫기 버튼 앞에 동작 버튼이 하나 붙는다. */
  action?: ToastAction;
}

export interface ToastInput {
  message: string;
  kind?: ToastKind;
  key?: string;
  durationMs?: number;
  action?: ToastAction;
}

/** 정보·성공은 5초, 경고는 10초, 오류는 닫을 때까지. */
export const DEFAULT_TOAST_DURATION_MS: Record<ToastKind, number> = {
  info: 5000,
  success: 5000,
  warning: 10000,
  error: 0,
};

/** 한꺼번에 보여 주는 최대 개수. 넘치면 가장 오래된 것부터 지운다. */
export const MAX_VISIBLE_TOASTS = 4;

interface ToastStore {
  toasts: Toast[];
  show: (input: ToastInput) => number;
  dismiss: (id: number) => void;
  clear: () => void;
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();
let nextId = 1;

function cancelTimer(id: number): void {
  const timer = timers.get(id);
  if (timer === undefined) return;
  clearTimeout(timer);
  timers.delete(id);
}

export const useToastStore = create<ToastStore>((set, get) => ({
  toasts: [],

  show: (input) => {
    const kind = input.kind ?? 'info';
    const key = input.key ?? `${kind}:${input.message}`;
    const toast: Toast = {
      id: nextId++,
      kind,
      message: input.message,
      key,
      durationMs: input.durationMs ?? DEFAULT_TOAST_DURATION_MS[kind],
      ...(input.action ? { action: input.action } : {}),
    };

    const kept: Toast[] = [];
    for (const existing of get().toasts) {
      if (existing.key === key) cancelTimer(existing.id);
      else kept.push(existing);
    }
    const next = [...kept, toast];
    while (next.length > MAX_VISIBLE_TOASTS) {
      const dropped = next.shift();
      if (dropped) cancelTimer(dropped.id);
    }
    set({ toasts: next });

    if (toast.durationMs > 0) {
      const timer = setTimeout(() => get().dismiss(toast.id), toast.durationMs);
      // Node 시험이 토스트 타이머 때문에 끝나지 않는 일을 막는다. 브라우저의 숫자 타이머에는 unref 가 없다.
      (timer as { unref?: () => void }).unref?.();
      timers.set(toast.id, timer);
    }
    return toast.id;
  },

  dismiss: (id) => {
    cancelTimer(id);
    set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }));
  },

  clear: () => {
    timers.forEach((timer) => clearTimeout(timer));
    timers.clear();
    set({ toasts: [] });
  },
}));

/** React 밖(스토어, 엔진 콜백)에서 부르는 짧은 길. */
export function showToast(input: ToastInput): number {
  return useToastStore.getState().show(input);
}
