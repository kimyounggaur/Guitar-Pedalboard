import type { PedalParamValue, PhaserParams } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface PhaserPedalProps {
  params: PhaserParams;
  onChange: (key: keyof PhaserParams, value: PedalParamValue) => void;
}

const stageOptions: PhaserParams['stages'][] = [4, 6, 8, 12];

export function PhaserPedal({ params, onChange }: PhaserPedalProps) {
  return (
    <div className="phaser-ui" role="group" aria-label="페이저 컨트롤">
      <div className="phaser-orbit-panel" aria-hidden="true">
        <span />
        <span />
        <span />
        <i />
        <strong>PHASE SHIFT</strong>
      </div>

      <div className="phaser-knob-grid">
        <SliderControl
          label="Rate"
          value={params.rate}
          min={0.05}
          max={8}
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
          min={0}
          max={90}
          step={1}
          displayValue={`${Math.round(params.feedback)}%`}
          onChange={(value) => onChange('feedback', value)}
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

      <fieldset className="phaser-stage-selector">
        <legend>Stages</legend>
        <div>
          {stageOptions.map((stages) => (
            <button
              key={stages}
              type="button"
              aria-pressed={params.stages === stages}
              onClick={() => onChange('stages', stages)}
            >
              {stages}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="phaser-brand-plate">
        <strong>PHASER</strong>
        <span>Multi Stage All-Pass</span>
      </div>
    </div>
  );
}
