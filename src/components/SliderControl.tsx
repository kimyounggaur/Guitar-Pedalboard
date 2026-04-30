interface SliderControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  displayValue?: string;
  onChange: (value: number) => void;
}

export function SliderControl({
  label,
  value,
  min,
  max,
  step,
  unit = '',
  displayValue,
  onChange,
}: SliderControlProps) {
  const shownValue = displayValue ?? `${Number(value.toFixed(2))}${unit}`;

  return (
    <label className="slider-control">
      <span className="control-row">
        <span>{label}</span>
        <output>{shownValue}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
