import type { CompressorParams } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface CompressorPedalProps {
  params: CompressorParams;
  onChange: (key: keyof CompressorParams, value: number) => void;
}

export function CompressorPedal({ params, onChange }: CompressorPedalProps) {
  return (
    <>
      <SliderControl
        label="Threshold"
        value={params.threshold}
        min={-60}
        max={0}
        step={1}
        unit=" dB"
        onChange={(value) => onChange('threshold', value)}
      />
      <SliderControl
        label="Ratio"
        value={params.ratio}
        min={1}
        max={20}
        step={0.5}
        displayValue={`${params.ratio.toFixed(1)}:1`}
        onChange={(value) => onChange('ratio', value)}
      />
      <SliderControl
        label="Attack"
        value={params.attack}
        min={0.001}
        max={0.08}
        step={0.001}
        displayValue={`${Math.round(params.attack * 1000)} ms`}
        onChange={(value) => onChange('attack', value)}
      />
      <SliderControl
        label="Release"
        value={params.release}
        min={0.03}
        max={0.8}
        step={0.01}
        displayValue={`${Math.round(params.release * 1000)} ms`}
        onChange={(value) => onChange('release', value)}
      />
    </>
  );
}
