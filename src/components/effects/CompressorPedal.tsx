import type { CSSProperties } from 'react';
import type { CompressorParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface CompressorPedalProps {
  params: CompressorParams;
  onChange: (key: keyof CompressorParams, value: PedalParamValue) => void;
}

interface CompressorKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}

function CompressorKnob({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: CompressorKnobProps) {
  const progress = (value - min) / (max - min);
  const rotation = -135 + Math.min(Math.max(progress, 0), 1) * 270;

  return (
    <label className="compressor-knob">
      <span>{label}</span>
      <span
        className="compressor-knob-shell"
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

export function CompressorPedal({ params, onChange }: CompressorPedalProps) {
  const estimatedReduction = Math.min(24, Math.max(0, (params.sustain / 100) * 14 + (params.ratio - 1) * 0.35));

  return (
    <div className="compressor-stomp-ui" aria-label="Compressor controls">
      <section className="compressor-control-deck">
        <div className="compressor-check-row">
          <span>CHECK</span>
          <i aria-hidden="true" />
        </div>
        <div className="compressor-knob-row">
          <CompressorKnob
            label="Level"
            value={params.level}
            min={0}
            max={100}
            step={1}
            displayValue={`${Math.round(params.level)}%`}
            onChange={(value) => onChange('level', value)}
          />
          <CompressorKnob
            label="Tone"
            value={params.knee}
            min={0}
            max={40}
            step={1}
            displayValue={`${Math.round(params.knee)} dB`}
            onChange={(value) => onChange('knee', value)}
          />
          <CompressorKnob
            label="Attack"
            value={params.attack}
            min={0.001}
            max={0.1}
            step={0.001}
            displayValue={`${Math.round(params.attack * 1000)} ms`}
            onChange={(value) => onChange('attack', value)}
          />
          <CompressorKnob
            label="Sustain"
            value={params.sustain}
            min={0}
            max={100}
            step={1}
            displayValue={`${Math.round(params.sustain)}%`}
            onChange={(value) => onChange('sustain', value)}
          />
          <CompressorKnob
            label="Ratio"
            value={params.ratio}
            min={1}
            max={20}
            step={0.5}
            displayValue={`${params.ratio.toFixed(1)}:1`}
            onChange={(value) => onChange('ratio', value)}
          />
        </div>
        <div className="compressor-minmax-row" aria-hidden="true">
          <span>min</span>
          <span>max</span>
          <span>min</span>
          <span>max</span>
          <span>min</span>
          <span>max</span>
          <span>min</span>
          <span>max</span>
          <span>min</span>
          <span>max</span>
        </div>
      </section>

      <section className="compressor-brand-panel">
        <div className="compressor-io-row">
          <span>← OUTPUT</span>
          <span>INPUT ←</span>
        </div>
        <strong>
          Compression
          <br />
          Sustainer
        </strong>
      </section>

      <div className="compressor-footswitch-pad" aria-hidden="true" />

      <div className="compressor-utility-controls">
        <div className="gain-reduction-meter">
          <span className="control-row">
            <span>Gain Reduction</span>
            <output>-{estimatedReduction.toFixed(1)} dB</output>
          </span>
          <div className="meter-track">
            <span style={{ transform: `scaleX(${estimatedReduction / 24})` }} />
          </div>
        </div>
        <SliderControl
          label="Threshold"
          value={params.threshold}
          min={-60}
          max={-10}
          step={1}
          unit=" dB"
          onChange={(value) => onChange('threshold', value)}
        />
        <SliderControl
          label="Release"
          value={params.release}
          min={0.05}
          max={1}
          step={0.01}
          displayValue={`${Math.round(params.release * 1000)} ms`}
          onChange={(value) => onChange('release', value)}
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
