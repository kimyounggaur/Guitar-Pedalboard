import type { PedalParamValue, ReverbParams } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface ReverbPedalProps {
  params: ReverbParams;
  onChange: (key: keyof ReverbParams, value: PedalParamValue) => void;
}

export function ReverbPedal({ params, onChange }: ReverbPedalProps) {
  return (
    <>
      <label className="select-control">
        <span>Mode</span>
        <select value={params.mode} onChange={(event) => onChange('mode', event.currentTarget.value)}>
          <option value="room">Room</option>
          <option value="hall">Hall</option>
          <option value="plate">Plate</option>
          <option value="spring">Spring</option>
          <option value="ambient">Ambient</option>
        </select>
      </label>
      <SliderControl
        label="Decay"
        value={params.decay}
        min={0.2}
        max={10}
        step={0.1}
        displayValue={`${params.decay.toFixed(1)} s`}
        onChange={(value) => onChange('decay', value)}
      />
      <SliderControl label="Pre Delay" value={params.preDelay} min={0} max={200} step={1} unit=" ms" onChange={(value) => onChange('preDelay', value)} />
      <SliderControl label="Low Cut" value={params.lowCut} min={20} max={500} step={5} unit=" Hz" onChange={(value) => onChange('lowCut', value)} />
      <SliderControl label="High Cut" value={params.highCut} min={1000} max={12000} step={100} unit=" Hz" onChange={(value) => onChange('highCut', value)} />
    </>
  );
}
