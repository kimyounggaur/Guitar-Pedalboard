import type { EQParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface EQPedalProps {
  params: EQParams;
  onChange: (key: keyof EQParams, value: PedalParamValue) => void;
}

interface EQFaderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}

const presets: Record<string, Partial<EQParams>> = {
  Clean: { lowCut: 70, bassGain: 0, midFreq: 800, midGain: 0, midQ: 0.9, trebleGain: 1, presenceGain: 1 },
  Warm: { lowCut: 55, bassGain: 3, midFreq: 650, midGain: 1.5, midQ: 0.8, trebleGain: -1, presenceGain: -2 },
  Rock: { lowCut: 80, bassGain: 2, midFreq: 900, midGain: -2, midQ: 1.1, trebleGain: 3, presenceGain: 2 },
  Metal: { lowCut: 95, bassGain: 4, midFreq: 700, midGain: -6, midQ: 1.6, trebleGain: 4, presenceGain: 5 },
};

function EQFader({ label, value, min, max, step, displayValue, onChange }: EQFaderProps) {
  const progress = (value - min) / (max - min);
  const position = 100 - Math.min(Math.max(progress, 0), 1) * 100;

  return (
    <label className="graphic-eq-fader">
      <span>{label}</span>
      <span className="graphic-eq-slot">
        <span className="graphic-eq-scale" aria-hidden="true" />
        <span className="graphic-eq-thumb" style={{ top: `${position}%` }} aria-hidden="true" />
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

export function EQPedal({ params, onChange }: EQPedalProps) {
  const applyPreset = (name: string) => {
    Object.entries(presets[name]).forEach(([key, value]) => {
      if (value !== undefined) onChange(key as keyof EQParams, value);
    });
  };

  return (
    <div className="graphic-eq-ui" aria-label="Graphic Equalizer controls">
      <section className="graphic-eq-slider-panel">
        <div className="graphic-eq-led" aria-hidden="true" />
        <div className="graphic-eq-fader-bank">
          <EQFader
            label="100"
            value={params.lowCut}
            min={40}
            max={160}
            step={1}
            displayValue={`${Math.round(params.lowCut)}Hz`}
            onChange={(value) => onChange('lowCut', value)}
          />
          <EQFader
            label="200"
            value={params.bassGain}
            min={-12}
            max={12}
            step={0.5}
            displayValue={`${params.bassGain.toFixed(1)}dB`}
            onChange={(value) => onChange('bassGain', value)}
          />
          <EQFader
            label="400"
            value={params.midGain}
            min={-12}
            max={12}
            step={0.5}
            displayValue={`${params.midGain.toFixed(1)}dB`}
            onChange={(value) => onChange('midGain', value)}
          />
          <EQFader
            label="800"
            value={params.midFreq}
            min={250}
            max={1500}
            step={10}
            displayValue={`${Math.round(params.midFreq)}Hz`}
            onChange={(value) => onChange('midFreq', value)}
          />
          <EQFader
            label="1.6k"
            value={params.midQ}
            min={0.3}
            max={4}
            step={0.1}
            displayValue={`Q ${params.midQ.toFixed(1)}`}
            onChange={(value) => onChange('midQ', value)}
          />
          <EQFader
            label="3.2k"
            value={params.trebleGain}
            min={-12}
            max={12}
            step={0.5}
            displayValue={`${params.trebleGain.toFixed(1)}dB`}
            onChange={(value) => onChange('trebleGain', value)}
          />
          <EQFader
            label="6.4k"
            value={params.presenceGain}
            min={-12}
            max={12}
            step={0.5}
            displayValue={`${params.presenceGain.toFixed(1)}dB`}
            onChange={(value) => onChange('presenceGain', value)}
          />
          <EQFader
            label="Level"
            value={params.level}
            min={0}
            max={100}
            step={1}
            displayValue={`${Math.round(params.level)}%`}
            onChange={(value) => onChange('level', value)}
          />
        </div>
      </section>

      <section className="graphic-eq-brand-panel">
        <div className="graphic-eq-io-row">
          <span>← OUT</span>
          <span>IN ←</span>
        </div>
        <strong>
          Graphic
          <br />
          Equalizer
        </strong>
      </section>

      <div className="graphic-eq-footswitch-pad" aria-hidden="true" />

      <div className="graphic-eq-utility-controls">
        <div className="preset-buttons">
          {Object.keys(presets).map((name) => (
            <button type="button" className="text-button" key={name} onClick={() => applyPreset(name)}>
              {name}
            </button>
          ))}
        </div>
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
