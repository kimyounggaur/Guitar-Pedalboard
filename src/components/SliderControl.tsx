import { useRef, useState, type CSSProperties } from 'react';

interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  displayValue?: string;
  ariaValueText?: string;
  onChange: (value: number) => void;
}

export function SliderControl({ label, value, min, max, step, unit = '', displayValue, ariaValueText, onChange }: SliderControlProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const cancelEdit = useRef(false);
  const shownValue = displayValue ?? `${Number(value.toFixed(2))}${unit}`;
  const accessibleValue = ariaValueText ?? shownValue;
  const progress = max === min ? 0 : (value - min) / (max - min);
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const rotation = -135 + clampedProgress * 270;

  const commitNumber = () => {
    if (!cancelEdit.current && editing !== null && editing.trim() !== '') {
      const parsed = Number(editing);
      if (Number.isFinite(parsed)) {
        const rounded = min + Math.round((parsed - min) / step) * step;
        const decimals = (String(step).split('.')[1] ?? '').length;
        onChange(Number(Math.min(max, Math.max(min, rounded)).toFixed(decimals)));
      }
    }
    cancelEdit.current = false;
    setEditing(null);
  };

  return (
    <div className="slider-control knob-control">
      <span className="knob-control-head">
        <span>{label}</span>
        <output>{shownValue}</output>
      </span>
      <span className="knob-control-shell" style={{ '--knob-rotation': `${rotation}deg`, '--knob-fill': `${clampedProgress * 75}%` } as CSSProperties}>
        <i aria-hidden="true" />
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
          aria-valuetext={`${label} ${accessibleValue}`} onChange={(event) => onChange(Number(event.currentTarget.value))} />
      </span>
      <input type="number" aria-label={`${label} 값 직접 입력`} min={min} max={max} step={step}
        value={editing ?? value} onFocus={() => setEditing(String(value))}
        onChange={(event) => setEditing(event.currentTarget.value)} onBlur={commitNumber}
        onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); if (event.key === 'Escape') { cancelEdit.current = true; event.currentTarget.blur(); } }}
        style={{ width: '5rem', maxWidth: '100%' }} />
    </div>
  );
}
