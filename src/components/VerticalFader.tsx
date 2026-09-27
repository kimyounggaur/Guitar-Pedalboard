import type { CSSProperties } from 'react';

interface VerticalFaderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  ariaValueText?: string;
  onChange: (value: number) => void;
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
}: VerticalFaderProps) {
  const progress = max === min ? 0 : (value - min) / (max - min);
  const clampedProgress = Math.min(Math.max(progress, 0), 1);

  return (
    <label className="vertical-fader">
      <span className="vertical-fader-label">{label}</span>
      <span
        className="vertical-fader-rail"
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
          aria-label={label}
          aria-orientation="vertical"
          aria-valuetext={`${label} ${ariaValueText}`}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      </span>
      <output>{displayValue}</output>
    </label>
  );
}
