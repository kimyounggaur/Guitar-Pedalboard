import type { ReverbParams } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface ReverbPedalProps {
  params: ReverbParams;
  onChange: (key: keyof ReverbParams, value: number) => void;
}

export function ReverbPedal({ params, onChange }: ReverbPedalProps) {
  return (
    <>
      <SliderControl
        label="Decay"
        value={params.decay}
        min={0.2}
        max={5}
        step={0.1}
        displayValue={`${params.decay.toFixed(1)} s`}
        onChange={(value) => onChange('decay', value)}
      />
      <SliderControl
        label="Tone"
        value={params.tone}
        min={0}
        max={1}
        step={0.01}
        displayValue={`${Math.round(params.tone * 100)}%`}
        onChange={(value) => onChange('tone', value)}
      />
    </>
  );
}
