import type { EQParams } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface EQPedalProps {
  params: EQParams;
  onChange: (key: keyof EQParams, value: number) => void;
}

export function EQPedal({ params, onChange }: EQPedalProps) {
  return (
    <>
      <SliderControl
        label="Low"
        value={params.low}
        min={-12}
        max={12}
        step={0.5}
        unit=" dB"
        onChange={(value) => onChange('low', value)}
      />
      <SliderControl
        label="Mid"
        value={params.mid}
        min={-12}
        max={12}
        step={0.5}
        unit=" dB"
        onChange={(value) => onChange('mid', value)}
      />
      <SliderControl
        label="High"
        value={params.high}
        min={-12}
        max={12}
        step={0.5}
        unit=" dB"
        onChange={(value) => onChange('high', value)}
      />
    </>
  );
}
