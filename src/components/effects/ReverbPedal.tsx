import type { CSSProperties } from 'react';
import type { PedalParamValue, ReverbParams } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface ReverbPedalProps {
  params: ReverbParams;
  onChange: (key: keyof ReverbParams, value: PedalParamValue) => void;
}

interface ReverbKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}

function ReverbKnob({ label, value, min, max, step, displayValue, onChange }: ReverbKnobProps) {
  const progress = (value - min) / (max - min);
  const rotation = -135 + Math.min(Math.max(progress, 0), 1) * 270;

  return (
    <label className="reverb-knob">
      <span>{label}</span>
      <span
        className="reverb-knob-shell"
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
      <output>{displayValue}</output>
    </label>
  );
}

export function ReverbPedal({ params, onChange }: ReverbPedalProps) {
  return (
    <div className="reverb-stomp-ui" aria-label="Reverb controls">
      <div className="reverb-wave-panel">
        <div className="reverb-led" aria-hidden="true" />
        <div className="reverb-knob-grid">
          <ReverbKnob
            label="Level"
            value={params.level}
            min={0}
            max={100}
            step={1}
            displayValue={`${Math.round(params.level)}%`}
            onChange={(value) => onChange('level', value)}
          />
          <ReverbKnob
            label="Decay"
            value={params.decay}
            min={0.2}
            max={10}
            step={0.1}
            displayValue={`${params.decay.toFixed(1)}s`}
            onChange={(value) => onChange('decay', value)}
          />
          <ReverbKnob
            label="Tone"
            value={params.highCut}
            min={1000}
            max={12000}
            step={100}
            displayValue={`${(params.highCut / 1000).toFixed(1)}k`}
            onChange={(value) => onChange('highCut', value)}
          />
          <ReverbKnob
            label="Mix"
            value={params.mix}
            min={0}
            max={100}
            step={1}
            displayValue={`${Math.round(params.mix)}%`}
            onChange={(value) => onChange('mix', value)}
          />
        </div>
        <strong className="reverb-title">REVERB</strong>
      </div>

      <div className="reverb-footswitch" aria-hidden="true">
        <span />
      </div>

      <div className="reverb-utility-controls">
        <label className="select-control">
          <span>Mode</span>
          <select value={params.mode} onChange={(event) => onChange('mode', event.currentTarget.value)}>
            <option value="room">Room</option>
            <option value="hall">Hall</option>
            <option value="plate">Plate</option>
            <option value="spring">Spring</option>
            <option value="ambient">Ambient</option>
          </select>
        </label>
        <SliderControl
          label="Pre Delay"
          value={params.preDelay}
          min={0}
          max={200}
          step={1}
          unit=" ms"
          onChange={(value) => onChange('preDelay', value)}
        />
        <SliderControl
          label="Low Cut"
          value={params.lowCut}
          min={20}
          max={500}
          step={5}
          unit=" Hz"
          onChange={(value) => onChange('lowCut', value)}
        />
      </div>
    </div>
  );
}
