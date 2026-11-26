import { useRef, type MouseEvent, type PointerEvent } from 'react';
import { beginHistoryGesture, endHistoryGesture } from '../store/historyStore';

/** 이만큼(px) 끌면 전체 범위를 지난다. */
export const KNOB_DRAG_RANGE_PX = 200;
/** Shift 를 누르고 끌면 10배 정밀하다(S4.4). */
export const KNOB_FINE_FACTOR = 10;
/** 손가락이 이만큼(px) 움직여야 가로 끌기인지 세로 쓸기인지 가른다. */
const TOUCH_INTENT_PX = 6;
/** 두 번 짧게 눌러 기본값으로 되돌리는 허용 시간(ms)과 두 번 누른 자리 차이(px). */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_SLOP_PX = 24;

/**
 * 끌어서 얻는 값. `delta` 는 '값이 늘어나는 쪽'으로 움직인 거리(px)다.
 * `fine` 이 true 면 같은 거리로 1/10 만 움직인다(정밀 조절).
 */
export function knobDragValue(startValue: number, delta: number, min: number, max: number, step: number, fine = false): number {
  const next = startValue + (delta / KNOB_DRAG_RANGE_PX) * (max - min) / (fine ? KNOB_FINE_FACTOR : 1);
  const rounded = min + Math.round((next - min) / step) * step;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(Math.min(max, Math.max(min, rounded)).toFixed(decimals));
}

interface DragState {
  pointerId: number;
  /** 끌기를 시작한(또는 Shift 를 바꾼) 자리와 그때의 값 */
  x: number;
  y: number;
  value: number;
  fine: boolean;
  /** 마지막으로 내보낸 값 — Shift 를 바꿀 때 여기서 이어 간다 */
  latest: number;
  touch: boolean;
  /** 손가락은 가로로 끌려는지 세로로 쓸려는지 정해질 때까지 'pending' */
  mode: 'pending' | 'drag' | 'scroll';
}

interface KnobDragOptions {
  /**
   * 손가락으로 끌 때의 방향. 노브는 'x'(오른쪽 = 증가, 세로로 쓸면 페이지가 스크롤된다),
   * 세로 페이더는 'y'(위로 = 증가, 페이지 스크롤과 겹치지 않게 CSS 의 touch-action: none 과 함께 쓴다).
   * 마우스·펜은 언제나 위로 끌면 증가한다.
   */
  touchAxis?: 'x' | 'y';
}

/** 끌기 껍데기 안의 range 입력(키보드·보조기기용으로만 남은 것) */
function rangeInside(shell: HTMLElement): HTMLInputElement | null {
  return shell.querySelector<HTMLInputElement>('input[type="range"]');
}

/**
 * 노브 끌기. 반환값을 노브의 **껍데기 요소**(링·바늘·투명 range 를 담은 `span`)에 펼친다 — range 입력에 펼치지 않는다.
 * 투명 range 는 CSS `pointer-events: none` 이라 포인터 입력을 받지 않고 키보드·보조기기만 받는다. 입력이 포인터를 직접 받으면
 * 브라우저가 누른 자리로 값을 뛰게 하는데(터치는 pointerdown 의 preventDefault 로도 막히지 않는다) 끌기와 싸운다.
 *
 * 마우스·펜은 세로로 끈다(위로 = 증가, 200 px = 전체 범위, Shift = 10배 정밀).
 * 터치는 가로로 끌면 조절되고(오른쪽 = 증가) 세로로 쓸면 브라우저가 페이지를 스크롤한다(CSS `touch-action: pan-y`).
 * 누르기만 해서는 값이 바뀌지 않는다. 더블클릭·더블탭은 기본값으로 되돌린다. 키보드는 range 입력의 기본 동작을 그대로 쓴다.
 */
export function useKnobDrag(
  value: number,
  min: number,
  max: number,
  step: number,
  onChange: (value: number) => void,
  defaultValue?: number,
  options: KnobDragOptions = {},
) {
  const touchAxis = options.touchAxis ?? 'x';
  const drag = useRef<DragState | null>(null);
  const lastTap = useRef<{ time: number; x: number; y: number } | null>(null);
  const normalize = (next: number) => knobDragValue(next, 0, min, max, step);
  const resetToDefault = () => {
    if (defaultValue !== undefined) onChange(normalize(defaultValue));
  };

  return {
    /** 껍데기를 알아보는 표지(시험이 '이 점을 받는 것은 끌기 껍데기인가'를 볼 때 쓴다) */
    'data-knob-drag': '',
    onPointerDown(event: PointerEvent<HTMLElement>) {
      const input = rangeInside(event.currentTarget);
      if (event.button !== 0 || !input || input.disabled) return;
      event.preventDefault();
      input.focus({ preventScroll: true });
      event.currentTarget.setPointerCapture(event.pointerId);
      const touch = event.pointerType === 'touch';
      drag.current = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        value,
        fine: event.shiftKey,
        latest: value,
        touch,
        mode: touch && touchAxis === 'x' ? 'pending' : 'drag',
      };
      // 누르는 순간부터 떼는 순간까지가 실행 취소 한 단계다(S5.3). 누르기만 하고 값이 안 바뀌면 단계가 생기지 않는다.
      beginHistoryGesture();
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = drag.current;
      if (!start || start.pointerId !== event.pointerId) return;

      if (start.mode === 'pending') {
        const dx = event.clientX - start.x;
        const dy = event.clientY - start.y;
        if (Math.abs(dx) < TOUCH_INTENT_PX && Math.abs(dy) < TOUCH_INTENT_PX) return;
        if (Math.abs(dx) > Math.abs(dy)) {
          // 가로로 끌기 시작 — 방향을 가린 자리에서 이어 가므로 값이 튀지 않는다.
          start.mode = 'drag';
          start.x = event.clientX;
          start.y = event.clientY;
        } else {
          start.mode = 'scroll';
          return;
        }
      }
      if (start.mode === 'scroll') return;

      // Shift 를 누르거나 뗀 순간부터는 그때의 자리·값에서 이어 간다(값이 튀지 않는다).
      if (event.shiftKey !== start.fine) {
        start.fine = event.shiftKey;
        start.x = event.clientX;
        start.y = event.clientY;
        start.value = start.latest;
      }
      const delta = start.touch && touchAxis === 'x' ? event.clientX - start.x : start.y - event.clientY;
      const next = knobDragValue(start.value, delta, min, max, step, start.fine);
      start.latest = next;
      onChange(next);
    },
    onPointerUp(event: PointerEvent<HTMLElement>) {
      const start = drag.current;
      if (start?.pointerId !== event.pointerId) return;
      drag.current = null;
      endHistoryGesture();
      if (!start.touch || start.mode !== 'pending') return;
      // 움직이지 않고 뗀 손가락 — 짧은 시간 안에 같은 자리를 두 번 누르면 기본값으로 되돌린다(더블탭).
      const now = event.timeStamp;
      const previous = lastTap.current;
      if (previous && now - previous.time <= DOUBLE_TAP_MS && Math.hypot(event.clientX - previous.x, event.clientY - previous.y) <= DOUBLE_TAP_SLOP_PX) {
        lastTap.current = null;
        resetToDefault();
      } else {
        lastTap.current = { time: now, x: event.clientX, y: event.clientY };
      }
    },
    onPointerCancel() {
      drag.current = null;
      endHistoryGesture();
    },
    onLostPointerCapture() {
      // 캡처를 잃었는데 끌기가 남아 있다면(요소가 바뀌었거나 브라우저가 가져갔다) 끝난 것으로 본다.
      drag.current = null;
      endHistoryGesture();
    },
    onDoubleClick(event: MouseEvent<HTMLElement>) {
      if (defaultValue === undefined || rangeInside(event.currentTarget)?.disabled) return;
      event.preventDefault();
      resetToDefault();
    },
  };
}
