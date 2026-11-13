import type { CSSProperties } from 'react';
import { useKnobDrag } from '../hooks/useKnobDrag';
import { KnobNumberInput } from './KnobNumberInput';

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
  defaultValue?: number;
}

export function SliderControl({ label, value, min, max, step, unit = '', displayValue, ariaValueText, onChange, defaultValue }: SliderControlProps) {
  const shownValue = displayValue ?? `${Number(value.toFixed(2))}${unit}`;
  const accessibleValue = ariaValueText ?? shownValue;
  const progress = max === min ? 0 : (value - min) / (max - min);
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const rotation = -135 + clampedProgress * 270;
  const dragHandlers = useKnobDrag(value, min, max, step, onChange, defaultValue);

  return (
    <div className="slider-control knob-control">
      <span className="knob-control-head">
        <span>{label}</span>
        <output>{shownValue}</output>
      </span>
      <span className="knob-control-shell" style={{ '--knob-rotation': `${rotation}deg`, '--knob-fill': `${clampedProgress * 75}%` } as CSSProperties}>
        <i aria-hidden="true" />
        <input type="range" min={min} max={max} step={step} value={value} aria-label={label}
          {...dragHandlers}
          aria-valuetext={`${label} ${accessibleValue}`} onChange={(event) => onChange(Number(event.currentTarget.value))} />
      </span>
      <KnobNumberInput label={label} value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}
