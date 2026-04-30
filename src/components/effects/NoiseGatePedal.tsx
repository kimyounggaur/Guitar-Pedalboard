import type { NoiseGateParams } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface NoiseGatePedalProps {
  params: NoiseGateParams;
  onChange: (key: keyof NoiseGateParams, value: number) => void;
}

export function NoiseGatePedal({ params, onChange }: NoiseGatePedalProps) {
  return (
    <>
      <SliderControl
        label="Threshold"
        value={params.threshold}
        min={-90}
        max={-20}
        step={1}
        unit=" dB"
        onChange={(value) => onChange('threshold', value)}
      />
      <SliderControl
        label="Release"
        value={params.release}
        min={0.01}
        max={0.4}
        step={0.01}
        displayValue={`${Math.round(params.release * 1000)} ms`}
        onChange={(value) => onChange('release', value)}
      />
    </>
  );
}
