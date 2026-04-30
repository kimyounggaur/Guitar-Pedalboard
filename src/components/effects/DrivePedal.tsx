import type { DriveParams } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface DrivePedalProps {
  params: DriveParams;
  onChange: (key: keyof DriveParams, value: number) => void;
}

export function DrivePedal({ params, onChange }: DrivePedalProps) {
  return (
    <>
      <SliderControl
        label="Drive"
        value={params.drive}
        min={0}
        max={1}
        step={0.01}
        displayValue={`${Math.round(params.drive * 100)}%`}
        onChange={(value) => onChange('drive', value)}
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
