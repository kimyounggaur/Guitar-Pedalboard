import type { DelayParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';
import { ToggleSwitch } from '../ToggleSwitch';

interface DelayPedalProps {
  params: DelayParams;
  onChange: (key: keyof DelayParams, value: PedalParamValue) => void;
}

export function DelayPedal({ params, onChange }: DelayPedalProps) {
  return (
    <>
      <label className="select-control">
        <span>Mode</span>
        <select value={params.mode} onChange={(event) => onChange('mode', event.currentTarget.value)}>
          <option value="digital">Digital</option>
          <option value="analog">Analog</option>
          <option value="tape">Tape</option>
          <option value="slapback">Slapback</option>
          <option value="pingpong">Pingpong</option>
        </select>
      </label>
      <ToggleSwitch label="Sync" checked={params.sync} onChange={(checked) => onChange('sync', checked)} />
      <SliderControl
        label="Time"
        value={params.timeMs}
        min={20}
        max={2000}
        step={10}
        unit=" ms"
        onChange={(value) => onChange('timeMs', value)}
      />
      <SliderControl
        label="Feedback"
        value={params.feedback}
        min={0}
        max={0.95}
        step={0.01}
        displayValue={`${Math.round(params.feedback * 100)}%`}
        onChange={(value) => onChange('feedback', value)}
      />
      <SliderControl label="Tone" value={params.tone} min={0} max={100} step={1} unit="%" onChange={(value) => onChange('tone', value)} />
      <SliderControl label="BPM" value={params.bpm} min={40} max={240} step={1} onChange={(value) => onChange('bpm', value)} />
      <label className="select-control">
        <span>Division</span>
        <select value={params.division} onChange={(event) => onChange('division', event.currentTarget.value)}>
          <option value="1/4">1/4</option>
          <option value="1/8">1/8</option>
          <option value="dotted1/8">Dotted 1/8</option>
          <option value="1/16">1/16</option>
        </select>
      </label>
    </>
  );
}
