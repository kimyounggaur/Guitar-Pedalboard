import type { ChorusParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface ChorusPedalProps {
  params: ChorusParams;
  onChange: (key: keyof ChorusParams, value: PedalParamValue) => void;
}

const voiceOptions: ChorusParams['voices'][] = [2, 3, 4];

export function ChorusPedal({ params, onChange }: ChorusPedalProps) {
  return (
    <div className="chorus-ui" role="group" aria-label="코러스 컨트롤">
      <div className="chorus-wave-panel" aria-hidden="true">
        <span />
        <span />
        <span />
        <strong>ENSEMBLE</strong>
      </div>

      <div className="chorus-knob-grid">
        <SliderControl
          label="Rate"
          value={params.rate}
          min={0.1}
          max={8}
          step={0.1}
          displayValue={`${params.rate.toFixed(1)} Hz`}
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
          label="Spread"
          value={params.spread}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.spread)}%`}
          onChange={(value) => onChange('spread', value)}
        />
        <SliderControl
          label="Tone"
          value={params.tone}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.tone)}%`}
          onChange={(value) => onChange('tone', value)}
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

      <fieldset className="chorus-voice-selector">
        <legend>Voices</legend>
        <div>
          {voiceOptions.map((voices) => (
            <button
              key={voices}
              type="button"
              aria-pressed={params.voices === voices}
              onClick={() => onChange('voices', voices)}
            >
              {voices}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="chorus-brand-plate">
        <strong>CHORUS</strong>
        <span>Multi Voice Modulation</span>
      </div>
    </div>
  );
}
