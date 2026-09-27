import type { PedalParamValue, TremoloParams } from '../../audio/types';
import { useAudioStore } from '../../store/audioStore';
import { SliderControl } from '../SliderControl';
import { TapTempoControl } from '../TapTempoControl';
import { ToggleSwitch } from '../ToggleSwitch';

interface TremoloPedalProps {
  pedalId: string;
  params: TremoloParams;
  onChange: (key: keyof TremoloParams, value: PedalParamValue) => void;
}

const shapeOptions: TremoloParams['shape'][] = ['sine', 'triangle', 'square'];

export function TremoloPedal({ pedalId, params, onChange }: TremoloPedalProps) {
  const setTempoSync = useAudioStore((state) => state.setTempoSync);

  return (
    <div className="tremolo-ui" role="group" aria-label="트레몰로 컨트롤">
      <div className="tremolo-pulse-panel" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
        <span />
        <strong>AMPLITUDE PULSE</strong>
      </div>

      <div className="tremolo-knob-grid">
        <SliderControl
          label="Rate"
          value={params.rate}
          min={0.5}
          max={20}
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

      <fieldset className="tremolo-shape-selector">
        <legend>Shape</legend>
        <div>
          {shapeOptions.map((shape) => (
            <button
              key={shape}
              type="button"
              aria-pressed={params.shape === shape}
              onClick={() => onChange('shape', shape)}
            >
              {shape}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="tremolo-sync-controls">
        <ToggleSwitch
          label="Sync"
          checked={params.sync}
          onChange={(checked) => setTempoSync(pedalId, checked)}
        />
        <TapTempoControl />
        <label className="select-control tremolo-division-control">
          <span>Division</span>
          <select
            value={params.division}
            onChange={(event) => onChange('division', event.currentTarget.value)}
          >
            <option value="1/4">1/4</option>
            <option value="1/8">1/8</option>
            <option value="dotted1/8">Dotted 1/8</option>
            <option value="1/16">1/16</option>
          </select>
        </label>
      </div>

      <div className="tremolo-brand-plate">
        <strong>TREMOLO</strong>
        <span>Click-Safe Amplitude Modulation</span>
      </div>
    </div>
  );
}
