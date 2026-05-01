import type { EQParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface EQPedalProps {
  params: EQParams;
  onChange: (key: keyof EQParams, value: PedalParamValue) => void;
}

const presets: Record<string, Partial<EQParams>> = {
  Clean: { lowCut: 70, bassGain: 0, midFreq: 800, midGain: 0, midQ: 0.9, trebleGain: 1, presenceGain: 1 },
  Warm: { lowCut: 55, bassGain: 3, midFreq: 650, midGain: 1.5, midQ: 0.8, trebleGain: -1, presenceGain: -2 },
  Rock: { lowCut: 80, bassGain: 2, midFreq: 900, midGain: -2, midQ: 1.1, trebleGain: 3, presenceGain: 2 },
  Metal: { lowCut: 95, bassGain: 4, midFreq: 700, midGain: -6, midQ: 1.6, trebleGain: 4, presenceGain: 5 },
};

export function EQPedal({ params, onChange }: EQPedalProps) {
  const applyPreset = (name: string) => {
    Object.entries(presets[name]).forEach(([key, value]) => {
      if (value !== undefined) onChange(key as keyof EQParams, value);
    });
  };

  return (
    <>
      <EQCurve params={params} />
      <div className="preset-buttons">
        {Object.keys(presets).map((name) => (
          <button type="button" className="text-button" key={name} onClick={() => applyPreset(name)}>
            {name}
          </button>
        ))}
      </div>
      <SliderControl label="Low Cut" value={params.lowCut} min={40} max={160} step={1} unit=" Hz" onChange={(value) => onChange('lowCut', value)} />
      <SliderControl label="Bass" value={params.bassGain} min={-12} max={12} step={0.5} unit=" dB" onChange={(value) => onChange('bassGain', value)} />
      <SliderControl label="Mid Freq" value={params.midFreq} min={250} max={1500} step={10} unit=" Hz" onChange={(value) => onChange('midFreq', value)} />
      <SliderControl label="Mid" value={params.midGain} min={-12} max={12} step={0.5} unit=" dB" onChange={(value) => onChange('midGain', value)} />
      <SliderControl label="Mid Q" value={params.midQ} min={0.3} max={4} step={0.1} onChange={(value) => onChange('midQ', value)} />
      <SliderControl label="Treble" value={params.trebleGain} min={-12} max={12} step={0.5} unit=" dB" onChange={(value) => onChange('trebleGain', value)} />
      <SliderControl label="Presence" value={params.presenceGain} min={-12} max={12} step={0.5} unit=" dB" onChange={(value) => onChange('presenceGain', value)} />
    </>
  );
}

function EQCurve({ params }: { params: EQParams }) {
  const points = [params.bassGain, params.midGain, params.trebleGain, params.presenceGain].map((gain, index) => {
    const x = 8 + index * 48;
    const y = 34 - gain * 1.8;
    return `${x},${Math.max(8, Math.min(60, y))}`;
  });

  return (
    <svg className="eq-curve" viewBox="0 0 160 68" role="img" aria-label="EQ curve">
      <path d="M0 34H160" />
      <polyline points={points.join(' ')} />
    </svg>
  );
}
