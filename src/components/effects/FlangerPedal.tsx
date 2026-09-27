import type { FlangerParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface FlangerPedalProps {
  params: FlangerParams;
  onChange: (key: keyof FlangerParams, value: PedalParamValue) => void;
}

function signedPercent(value: number): string {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
}

export function FlangerPedal({ params, onChange }: FlangerPedalProps) {
  return (
    <div className="flanger-ui" role="group" aria-label="플랜저 컨트롤">
      <div className="flanger-jet-panel" aria-hidden="true">
        <span className="flanger-jet-line flanger-jet-line-a" />
        <span className="flanger-jet-line flanger-jet-line-b" />
        <strong>JET SWEEP</strong>
      </div>

      <div className="flanger-knob-grid">
        <SliderControl
          label="Rate"
          value={params.rate}
          min={0.05}
          max={5}
          step={0.05}
          displayValue={`${params.rate.toFixed(2)} Hz`}
          onChange={(value) => onChange('rate', value)}
        />
        <SliderControl
          label="Depth"
          value={params.depth}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.depth)}%`}
          onChange={(value) => onChange('depth', value)}
        />
        <SliderControl
          label="Feedback"
          value={params.feedback}
          min={-95}
          max={95}
          step={1}
          displayValue={signedPercent(params.feedback)}
          onChange={(value) => onChange('feedback', value)}
        />
        <SliderControl
          label="Manual"
          value={params.manual}
          min={0.5}
          max={10}
          step={0.1}
          displayValue={`${params.manual.toFixed(1)} ms`}
          onChange={(value) => onChange('manual', value)}
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
          max={200}
          step={1}
          displayValue={`${Math.round(params.level)}%`}
          onChange={(value) => onChange('level', value)}
        />
      </div>

      <div className="flanger-brand-plate">
        <strong>FLANGER</strong>
        <span>Regenerative Jet Modulation</span>
      </div>
    </div>
  );
}
