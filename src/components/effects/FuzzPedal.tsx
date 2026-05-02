import type { CSSProperties } from 'react';
import type { FuzzParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface FuzzPedalProps {
  params: FuzzParams;
  onChange: (key: keyof FuzzParams, value: PedalParamValue) => void;
}

interface FuzzKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  size?: 'small' | 'large';
  onChange: (value: number) => void;
}

const fuzzModes: FuzzParams['mode'][] = ['classic', 'gated', 'velcro'];

function FuzzKnob({ label, value, min, max, step, size = 'large', onChange }: FuzzKnobProps) {
  const progress = (value - min) / (max - min);
  const rotation = -135 + Math.min(Math.max(progress, 0), 1) * 270;

  return (
    <label className={`fuzz-knob fuzz-knob-${size}`}>
      <span
        className="fuzz-knob-shell"
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

export function FuzzPedal({ params, onChange }: FuzzPedalProps) {
  const modeIndex = Math.max(0, fuzzModes.indexOf(params.mode));

  return (
    <div className="fuzz-stomp-ui" aria-label="Fuzz controls">
      <section className="fuzz-face">
        <div className="fuzz-check-row">
          <span>CHECK</span>
          <i aria-hidden="true" />
        </div>

        <div className="fuzz-knob-layout">
          <FuzzKnob
            label="Level"
            value={params.level}
            min={0}
            max={100}
            step={1}
            onChange={(value) => onChange('level', value)}
          />
          <FuzzKnob
            label="Mode"
            value={modeIndex}
            min={0}
            max={fuzzModes.length - 1}
            step={1}
            size="small"
            onChange={(value) => onChange('mode', fuzzModes[value])}
          />
          <FuzzKnob
            label="Fuzz"
            value={params.fuzz}
            min={0}
            max={100}
            step={1}
            onChange={(value) => onChange('fuzz', value)}
          />
        </div>

        <div className="fuzz-io-row">
          <span>← OUT PUT</span>
          <span>INPUT ←</span>
        </div>

        <strong className="fuzz-logo">Fuzz</strong>
        <div className="fuzz-footswitch-pad" aria-hidden="true" />
      </section>

      <div className="fuzz-utility-controls">
        <SliderControl
          label="Tone"
          value={params.tone}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.tone)}%`}
          onChange={(value) => onChange('tone', value)}
        />
        <SliderControl
          label="Bias"
          value={params.bias}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.bias)}%`}
          onChange={(value) => onChange('bias', value)}
        />
        <SliderControl
          label="Gate"
          value={params.gate}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.gate)}%`}
          onChange={(value) => onChange('gate', value)}
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
      </div>
    </div>
  );
}
