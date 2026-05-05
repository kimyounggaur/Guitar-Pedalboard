import type { CSSProperties } from 'react';
import { useEffect, useState } from 'react';
import type { NoiseGateParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface NoiseGatePedalProps {
  params: NoiseGateParams;
  onChange: (key: keyof NoiseGateParams, value: PedalParamValue) => void;
}

interface NoiseGateKnobProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  className?: string;
  onChange: (value: number) => void;
}

function NoiseGateKnob({ label, value, min, max, step, className = '', onChange }: NoiseGateKnobProps) {
  const normalized = (value - min) / (max - min);
  const rotation = -135 + Math.min(Math.max(normalized, 0), 1) * 270;

  return (
    <label className={`noise-gate-knob ${className}`}>
      <span
        className="noise-gate-knob-shell"
        style={{ '--knob-rotation': `${rotation}deg` } as CSSProperties}
      >
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          aria-label={label}
          onChange={(event) => onChange(Number(event.currentTarget.value))}
        />
        <i aria-hidden="true" />
      </span>
      <strong>{label}</strong>
    </label>
  );
}

export function NoiseGatePedal({ params, onChange }: NoiseGatePedalProps) {
  const [gateState, setGateState] = useState('Closed');

  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ state: string }>).detail;
      if (detail?.state) setGateState(detail.state);
    };

    window.addEventListener('noise-gate-state', listener);
    return () => window.removeEventListener('noise-gate-state', listener);
  }, []);

  return (
    <div className="noise-gate-stomp-ui" aria-label="Noise Gate controls">
      <section className="noise-gate-face">
        <div className={`noise-gate-led state-${gateState.toLowerCase()}`} aria-label={`Gate ${gateState}`} />

        <div className="noise-gate-knob-layout">
          <NoiseGateKnob
            label="Threshold"
            value={params.thresholdDb}
            min={-80}
            max={-20}
            step={1}
            className="noise-gate-knob-threshold"
            onChange={(value) => onChange('thresholdDb', value)}
          />
          <NoiseGateKnob
            label="Decay"
            value={params.releaseMs}
            min={20}
            max={1000}
            step={10}
            className="noise-gate-knob-decay"
            onChange={(value) => onChange('releaseMs', value)}
          />
          <NoiseGateKnob
            label="Mode"
            value={params.hysteresisDb}
            min={0}
            max={10}
            step={0.5}
            className="noise-gate-knob-mode"
            onChange={(value) => onChange('hysteresisDb', value)}
          />
        </div>

        <div className="noise-gate-brand-panel">
          <span className="noise-gate-arrow noise-gate-arrow-left" />
          <strong>OUT</strong>
          <em>NOISE GATE</em>
          <strong>IN</strong>
          <span className="noise-gate-arrow noise-gate-arrow-right" />
        </div>
      </section>

      <div className="noise-gate-utility-controls">
        <div className={`effect-status state-${gateState.toLowerCase()}`}>Gate: {gateState}</div>
        <SliderControl
          label="Reduction"
          value={params.reductionDb}
          min={-80}
          max={0}
          step={1}
          unit=" dB"
          onChange={(value) => onChange('reductionDb', value)}
        />
        <SliderControl
          label="Attack"
          value={params.attackMs}
          min={1}
          max={50}
          step={1}
          unit=" ms"
          onChange={(value) => onChange('attackMs', value)}
        />
        <SliderControl
          label="Hold"
          value={params.holdMs}
          min={0}
          max={300}
          step={5}
          unit=" ms"
          onChange={(value) => onChange('holdMs', value)}
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
