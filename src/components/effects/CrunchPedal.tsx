import type { CSSProperties } from 'react';
import type { CrunchParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface CrunchPedalProps {
  params: CrunchParams;
  onChange: (key: keyof CrunchParams, value: PedalParamValue) => void;
}

interface CrunchKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function CrunchKnob({ label, value, min, max, step, onChange }: CrunchKnobProps) {
  const progress = (value - min) / (max - min);
  const rotation = -135 + Math.min(Math.max(progress, 0), 1) * 270;

  return (
    <label className={`crunch-knob crunch-knob-${label.toLowerCase().replace('.', '')}`}>
      <span
        className="crunch-knob-shell"
        style={{ '--knob-rotation': `${rotation}deg` } as CSSProperties}
      >
        <i aria-hidden="true" />
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
      </span>
      <strong>{label}</strong>
    </label>
  );
}

export function CrunchPedal({ params, onChange }: CrunchPedalProps) {
  return (
    <div className="crunch-box-ui" aria-label="Crunch Box controls">
      <section className="crunch-face">
        <div className="crunch-knob-layout">
          <CrunchKnob
            label="Vol."
            value={params.volume}
            min={0}
            max={100}
            step={1}
            onChange={(value) => onChange('volume', value)}
          />
          <CrunchKnob
            label="Tone"
            value={params.tone}
            min={0}
            max={100}
            step={1}
            onChange={(value) => onChange('tone', value)}
          />
          <CrunchKnob
            label="Gain"
            value={params.gain}
            min={0}
            max={100}
            step={1}
            onChange={(value) => onChange('gain', value)}
          />
        </div>

        <div className="crunch-led" aria-hidden="true" />
        <span className="crunch-side-label crunch-side-out">OUT</span>
        <span className="crunch-side-label crunch-side-in">IN</span>
        <strong className="crunch-brand">Crunch Box</strong>
        <div className="crunch-footswitch" aria-hidden="true">
          <span />
        </div>
        <strong className="crunch-mode-label">Distortion</strong>
      </section>

      <div className="crunch-utility-controls">
        <SliderControl
          label="Presence"
          value={params.presence}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.presence)}%`}
          onChange={(value) => onChange('presence', value)}
        />
        <SliderControl
          label="Low Cut"
          value={params.lowCut}
          min={40}
          max={180}
          step={1}
          unit=" Hz"
          onChange={(value) => onChange('lowCut', value)}
        />
        <SliderControl
          label="Mix"
          value={params.mix}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.mix)}%`}
          onChange={(value) => onChange('mix', value)}
        />
        <SliderControl
          label="Level"
          value={params.level}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.level)}%`}
          onChange={(value) => onChange('level', value)}
        />
      </div>
    </div>
  );
}
