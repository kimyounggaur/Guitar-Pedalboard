import type { AutoWahParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface AutoWahPedalProps {
  params: AutoWahParams;
  onChange: (key: keyof AutoWahParams, value: PedalParamValue) => void;
}

const modeOptions: AutoWahParams['mode'][] = ['auto', 'manual'];

export function AutoWahPedal({ params, onChange }: AutoWahPedalProps) {
  return (
    <div className="auto-wah-ui" role="group" aria-label="오토 와우 컨트롤">
      <div className="auto-wah-sweep-panel" aria-hidden="true">
        <span />
        <span />
        <span />
        <i />
        <strong>ENVELOPE SWEEP</strong>
      </div>

      <fieldset className="auto-wah-mode-selector">
        <legend>Mode</legend>
        <div>
          {modeOptions.map((mode) => (
            <button
              key={mode}
              type="button"
              aria-pressed={params.mode === mode}
              onClick={() => onChange('mode', mode)}
            >
              {mode}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="auto-wah-knob-grid">
        <SliderControl
          label="Sensitivity"
          value={params.sensitivity}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.sensitivity)}%`}
          onChange={(value) => onChange('sensitivity', value)}
        />
        <SliderControl
          label="Range"
          value={params.range}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.range)}%`}
          onChange={(value) => onChange('range', value)}
        />
        <SliderControl
          label="Resonance"
          value={params.resonance}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.resonance)}%`}
          onChange={(value) => onChange('resonance', value)}
        />
        <div className={params.mode === 'manual' ? '' : 'auto-wah-manual-inactive'}>
          <SliderControl
            label="Manual"
            value={params.manual}
            min={0}
            max={100}
            step={1}
            displayValue={`${Math.round(params.manual)}%`}
            onChange={(value) => onChange('manual', value)}
          />
        </div>
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

      <div className="auto-wah-brand-plate">
        <strong>AUTO WAH</strong>
        <span>Touch Responsive Filter</span>
      </div>
    </div>
  );
}
