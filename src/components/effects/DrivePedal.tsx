import type { CSSProperties } from 'react';
import type { DriveParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface DrivePedalProps {
  params: DriveParams;
  onChange: (key: keyof DriveParams, value: PedalParamValue) => void;
}

const presets: Record<string, Pick<DriveParams, 'mode' | 'drive' | 'tone' | 'level' | 'mix' | 'bias'>> = {
  'TS Clean': { mode: 'overdrive', drive: 28, tone: 54, level: 96, mix: 82, bias: 0.1 },
  'TS Boost': { mode: 'overdrive', drive: 42, tone: 58, level: 100, mix: 88, bias: 0.12 },
  Crunch: { mode: 'crunch', drive: 62, tone: 62, level: 92, mix: 90, bias: 0.04 },
};

export function DrivePedal({ params, onChange }: DrivePedalProps) {
  const applyPreset = (name: string) => {
    const preset = presets[name];
    Object.entries(preset).forEach(([key, value]) => onChange(key as keyof DriveParams, value));
  };

  return (
    <div className="tube-drive-ui" aria-label="Tube style overdrive controls">
      <div className="tube-knob-deck">
        <DriveKnob
          label="Drive"
          value={params.drive}
          min={0}
          max={100}
          onChange={(value) => onChange('drive', value)}
        />
        <DriveKnob
          label="Tone"
          value={params.tone}
          min={0}
          max={100}
          size="small"
          onChange={(value) => onChange('tone', value)}
        />
        <DriveKnob
          label="Level"
          value={params.level}
          min={0}
          max={100}
          onChange={(value) => onChange('level', value)}
        />
      </div>

      <div className="tube-brand-plate">
        <strong>TS-9</strong>
        <span>Tube Screamer</span>
      </div>

      <div className="tube-footswitch-pad" aria-hidden="true">
        <span />
      </div>

      <div className="tube-utility-controls">
        <label className="select-control">
          <span>Mode</span>
          <select value={params.mode} onChange={(event) => onChange('mode', event.currentTarget.value)}>
            <option value="overdrive">Overdrive</option>
            <option value="crunch">Crunch</option>
            <option value="distortion">Distortion</option>
            <option value="fuzz">Fuzz</option>
          </select>
        </label>

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
          label="Bias"
          value={params.bias}
          min={-1}
          max={1}
          step={0.01}
          displayValue={params.bias.toFixed(2)}
          onChange={(value) => onChange('bias', value)}
        />

        <div className="tube-preset-row">
          {Object.keys(presets).map((name) => (
            <button type="button" key={name} onClick={() => applyPreset(name)}>
              {name}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface DriveKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  size?: 'small' | 'large';
  onChange: (value: number) => void;
}

function DriveKnob({ label, value, min, max, size = 'large', onChange }: DriveKnobProps) {
  const normalized = (value - min) / (max - min);
  const rotation = -135 + normalized * 270;

  return (
    <label className={`tube-knob tube-knob-${size}`}>
      <span className="tube-knob-shell" style={{ '--knob-rotation': `${rotation}deg` } as CSSProperties}>
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <i />
      </span>
      <span className="tube-knob-label">{label}</span>
    </label>
  );
}
