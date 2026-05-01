import type { CSSProperties } from 'react';
import type { DelayParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';
import { ToggleSwitch } from '../ToggleSwitch';

interface DelayPedalProps {
  params: DelayParams;
  onChange: (key: keyof DelayParams, value: PedalParamValue) => void;
}

const delayModes: DelayParams['mode'][] = ['digital', 'analog', 'tape', 'slapback', 'pingpong'];

export function DelayPedal({ params, onChange }: DelayPedalProps) {
  const modeIndex = delayModes.indexOf(params.mode);

  return (
    <div className="delay-echo-ui" aria-label="Delay Echo controls">
      <div className="delay-led" aria-label={params.bypassed ? 'Delay bypassed' : 'Delay active'} />

      <div className="delay-knob-grid">
        <DelayKnob
          label="E.Level"
          value={params.mix}
          min={0}
          max={100}
          onChange={(value) => onChange('mix', value)}
        />
        <DelayKnob
          label="D.Time"
          value={params.timeMs}
          min={20}
          max={2000}
          onChange={(value) => onChange('timeMs', value)}
        />
        <DelayKnob
          label="F.Back"
          value={Math.round(params.feedback * 100)}
          min={0}
          max={95}
          onChange={(value) => onChange('feedback', value / 100)}
        />
        <DelayKnob
          label="Mode"
          value={Math.max(0, modeIndex)}
          min={0}
          max={4}
          step={1}
          onChange={(value) => onChange('mode', delayModes[value])}
        />
      </div>

      <div className="delay-brand-strip">
        <span className="delay-arrow delay-arrow-left" />
        <strong>OUT</strong>
        <em>Delay / Echo</em>
        <strong>IN</strong>
        <span className="delay-arrow delay-arrow-right" />
      </div>

      <div className="delay-footswitch-pad" aria-hidden="true" />

      <div className="delay-utility-controls">
        <label className="select-control">
          <span>Mode</span>
          <select value={params.mode} onChange={(event) => onChange('mode', event.currentTarget.value)}>
            <option value="digital">Digital</option>
            <option value="analog">Analog</option>
            <option value="tape">Tape</option>
            <option value="slapback">Slapback</option>
            <option value="pingpong">Pingpong</option>
          </select>
        </label>
        <ToggleSwitch label="Sync" checked={params.sync} onChange={(checked) => onChange('sync', checked)} />
        <SliderControl
          label="Tone"
          value={params.tone}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.tone)}%`}
          onChange={(value) => onChange('tone', value)}
        />
        <SliderControl label="BPM" value={params.bpm} min={40} max={240} step={1} onChange={(value) => onChange('bpm', value)} />
        <label className="select-control">
          <span>Division</span>
          <select value={params.division} onChange={(event) => onChange('division', event.currentTarget.value)}>
            <option value="1/4">1/4</option>
            <option value="1/8">1/8</option>
            <option value="dotted1/8">Dotted 1/8</option>
            <option value="1/16">1/16</option>
          </select>
        </label>
      </div>
    </div>
  );
}

interface DelayKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}

function DelayKnob({ label, value, min, max, step = 1, onChange }: DelayKnobProps) {
  const normalized = (value - min) / (max - min);
  const rotation = -135 + normalized * 270;

  return (
    <label className="delay-knob">
      <span className="delay-knob-shell" style={{ '--knob-rotation': `${rotation}deg` } as CSSProperties}>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <i />
      </span>
      <span>{label}</span>
    </label>
  );
}
