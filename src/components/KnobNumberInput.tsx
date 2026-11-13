import { useRef, useState } from 'react';
import { knobDragValue } from '../hooks/useKnobDrag';

interface KnobNumberInputProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function KnobNumberInput({ label, value, min, max, step, disabled = false, onChange }: KnobNumberInputProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const cancel = useRef(false);
  const commit = () => {
    if (!cancel.current && editing !== null && editing.trim() !== '') {
      const next = Number(editing);
      if (Number.isFinite(next)) onChange(knobDragValue(next, 0, min, max, step));
    }
    cancel.current = false;
    setEditing(null);
  };
  return <input className="knob-number-input" type="number" aria-label={`${label} 값 직접 입력`}
    min={min} max={max} step={step} disabled={disabled} value={editing ?? value}
    onFocus={() => setEditing(String(value))} onChange={(event) => setEditing(event.currentTarget.value)} onBlur={commit}
    onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancel.current = true; event.currentTarget.blur(); } }} />;
}
