import type { CSSProperties } from 'react';
import type { DelayParams, PedalParamValue } from '../../audio/types';
import { useAudioStore } from '../../store/audioStore';
import { SliderControl } from '../SliderControl';
import { TapTempoControl } from '../TapTempoControl';
import { ToggleSwitch } from '../ToggleSwitch';

interface DelayPedalProps {
  pedalId: string;
  params: DelayParams;
  onChange: (key: keyof DelayParams, value: PedalParamValue) => void;
}

const delayModes: DelayParams['mode'][] = ['digital', 'analog', 'tape', 'slapback', 'pingpong'];
const delayModeLabels: Record<DelayParams['mode'], string> = {
  digital: 'Digital',
  analog: 'Analog',
  tape: 'Tape',
  slapback: 'Slapback',
  pingpong: 'Pingpong',
};

export function DelayPedal({ pedalId, params, onChange }: DelayPedalProps) {
  const modeIndex = delayModes.indexOf(params.mode);
  const setTempoSync = useAudioStore((state) => state.setTempoSync);

  return (
    <div className="delay-echo-ui" role="group" aria-label="Delay Echo controls">
      <div className="delay-led" aria-hidden="true" />

      <div className="delay-knob-grid">
        <DelayKnob
          label="E.Level"
          value={params.mix}
          min={0}
          max={100}
          ariaValueText={`${Math.round(params.mix)}%`}
          onChange={(value) => onChange('mix', value)}
        />
        <DelayKnob
          label="D.Time"
          value={params.timeMs}
          min={20}
          max={2000}
          ariaValueText={`${Math.round(params.timeMs)} ms`}
          onChange={(value) => onChange('timeMs', value)}
        />
        <DelayKnob
          label="F.Back"
          value={Math.round(params.feedback * 100)}
          min={0}
          max={95}
          ariaValueText={`${Math.round(params.feedback * 100)}%`}
          onChange={(value) => onChange('feedback', value / 100)}
        />
        <DelayKnob
          label="Mode"
          value={Math.max(0, modeIndex)}
          min={0}
          max={4}
          step={1}
          ariaValueText={delayModeLabels[params.mode]}
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
        <ToggleSwitch
          label="Sync"
          checked={params.sync}
          onChange={(checked) => setTempoSync(pedalId, checked)}
        />
        <ToggleSwitch
          label="Trails"
          checked={params.trails}
          onChange={(checked) => onChange('trails', checked)}
        />
        <SliderControl
          label="Tone"
          value={params.tone}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.tone)}%`}
          onChange={(value) => onChange('tone', value)}
        />
        <TapTempoControl />
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
  ariaValueText: string;
  onChange: (value: number) => void;
}

function DelayKnob({ label, value, min, max, step = 1, ariaValueText, onChange }: DelayKnobProps) {
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
          aria-valuetext={`${label} ${ariaValueText}`}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <i />
      </span>
      <span>{label}</span>
    </label>
  );
}
