import type { DelayParams } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface DelayPedalProps {
  params: DelayParams;
  onChange: (key: keyof DelayParams, value: number) => void;
}

export function DelayPedal({ params, onChange }: DelayPedalProps) {
  return (
    <>
      <SliderControl
        label="Time"
        value={params.time}
        min={0.04}
        max={1.2}
        step={0.01}
        displayValue={`${Math.round(params.time * 1000)} ms`}
        onChange={(value) => onChange('time', value)}
      />
      <SliderControl
        label="Feedback"
        value={params.feedback}
        min={0}
        max={0.88}
        step={0.01}
        displayValue={`${Math.round(params.feedback * 100)}%`}
        onChange={(value) => onChange('feedback', value)}
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
