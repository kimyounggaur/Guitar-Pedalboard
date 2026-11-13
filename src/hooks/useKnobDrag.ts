import { useRef, type PointerEvent, type MouseEvent } from 'react';

export function knobDragValue(startValue: number, deltaY: number, min: number, max: number, step: number): number {
  const next = startValue + deltaY / 200 * (max - min);
  const rounded = min + Math.round((next - min) / step) * step;
  const decimals = (String(step).split('.')[1] ?? '').length;
  return Number(Math.min(max, Math.max(min, rounded)).toFixed(decimals));
}

/** Vertical movement gives the full range over 200 px while retaining keyboard input. */
export function useKnobDrag(value: number, min: number, max: number, step: number, onChange: (value: number) => void, defaultValue?: number) {
  const drag = useRef<{ pointerId: number; y: number; value: number } | null>(null);
  const normalize = (next: number) => {
    return knobDragValue(next, 0, min, max, step);
  };
  return {
    onPointerDown(event: PointerEvent<HTMLInputElement>) {
      if (event.button !== 0 || event.currentTarget.disabled) return;
      event.preventDefault();
      event.currentTarget.focus();
      event.currentTarget.setPointerCapture(event.pointerId);
      drag.current = { pointerId: event.pointerId, y: event.clientY, value };
    },
    onPointerMove(event: PointerEvent<HTMLInputElement>) {
      const start = drag.current;
      if (!start || start.pointerId !== event.pointerId) return;
      onChange(knobDragValue(start.value, start.y - event.clientY, min, max, step));
    },
    onPointerUp(event: PointerEvent<HTMLInputElement>) {
      if (drag.current?.pointerId === event.pointerId) drag.current = null;
    },
    onPointerCancel() { drag.current = null; },
    onDoubleClick(event: MouseEvent<HTMLInputElement>) {
      if (defaultValue === undefined || event.currentTarget.disabled) return;
      event.preventDefault();
      onChange(normalize(defaultValue));
    },
  };
}
