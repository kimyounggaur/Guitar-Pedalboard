import type { CSSProperties } from 'react';
import { useKnobDrag } from '../hooks/useKnobDrag';
import { KnobNumberInput } from './KnobNumberInput';
import { useParamNames } from './ParamScope';

interface VerticalFaderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  ariaValueText?: string;
  onChange: (value: number) => void;
  defaultValue: number;
}

export function VerticalFader({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  ariaValueText = displayValue,
  onChange,
  defaultValue,
}: VerticalFaderProps) {
  const { name: accessibleName, tip } = useParamNames(label);
  const progress = max === min ? 0 : (value - min) / (max - min);
  const clampedProgress = Math.min(Math.max(progress, 0), 1);
  const dragHandlers = useKnobDrag(value, min, max, step, onChange, defaultValue, { touchAxis: 'y' });

  return (
    <div className="vertical-fader">
      <span className="vertical-fader-label" title={tip}>{label}</span>
      <span
        className="vertical-fader-rail" {...dragHandlers}
        style={{ '--vertical-fader-position': `${(1 - clampedProgress) * 100}%` } as CSSProperties}
      >
        <span className="vertical-fader-ticks" aria-hidden="true" />
        <span className="vertical-fader-thumb" aria-hidden="true" />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={accessibleName}
          aria-orientation="vertical"
          aria-valuetext={`${accessibleName} ${ariaValueText}`}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      </span>
      <output>{displayValue}</output>
      <KnobNumberInput label={accessibleName} value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}
