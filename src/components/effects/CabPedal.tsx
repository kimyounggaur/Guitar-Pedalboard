import type { CabParams, PedalParamValue } from '../../audio/types';
import { SliderControl } from '../SliderControl';

interface CabPedalProps {
  params: CabParams;
  onChange: (key: keyof CabParams, value: PedalParamValue) => void;
}

const cabModels: Array<{ value: CabParams['model']; label: string }> = [
  { value: 'v30-4x12', label: 'Modern 4×12' },
  { value: 'greenback-4x12', label: 'Vintage 4×12' },
  { value: 'blue-1x12', label: 'Blue 1×12' },
  { value: 'jensen-1x12', label: 'American 1×12' },
  { value: 'tweed-1x10', label: 'Tweed 1×10' },
  { value: 'off', label: 'IR 끄기' },
];

export function CabPedal({ params, onChange }: CabPedalProps) {
  return (
    <div className="cab-sim-ui" role="group" aria-label="캐비닛 시뮬레이터 컨트롤">
      <div className="cab-grille" aria-hidden="true">
        <span />
        <strong>CAB SIM</strong>
        <em>Speaker &amp; Mic</em>
      </div>

      <label className="cab-model-control">
        <span>캐비닛 모델</span>
        <select
          value={params.model}
          onChange={(event) => onChange('model', event.currentTarget.value as CabParams['model'])}
        >
          {cabModels.map((model) => (
            <option key={model.value} value={model.value}>
              {model.label}
            </option>
          ))}
        </select>
      </label>

      <div className="cab-knob-grid">
        <SliderControl
          label="마이크 위치"
          value={params.micPosition}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.micPosition)}%`}
          onChange={(value) => onChange('micPosition', value)}
        />
        <SliderControl
          label="거리"
          value={params.distance}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.distance)}%`}
          onChange={(value) => onChange('distance', value)}
        />
        <SliderControl
          label="프레즌스"
          value={params.presence}
          min={-6}
          max={6}
          step={0.1}
          displayValue={`${params.presence > 0 ? '+' : ''}${params.presence.toFixed(1)} dB`}
          onChange={(value) => onChange('presence', value)}
        />
        <SliderControl
          label="믹스"
          value={params.mix}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(params.mix)}%`}
          onChange={(value) => onChange('mix', value)}
        />
        <SliderControl
          label="레벨"
          value={params.level}
          min={0}
          max={200}
          step={1}
          displayValue={`${Math.round(params.level)}%`}
          onChange={(value) => onChange('level', value)}
        />
      </div>

      <div className="cab-filter-grid">
        <CabRangeControl
          label="로우 컷"
          value={params.lowCut}
          min={40}
          max={200}
          step={1}
          displayValue={`${Math.round(params.lowCut)} Hz`}
          onChange={(value) => onChange('lowCut', value)}
        />
        <CabRangeControl
          label="하이 컷"
          value={params.highCut}
          min={3000}
          max={12000}
          step={100}
          displayValue={`${(params.highCut / 1000).toFixed(1)} kHz`}
          onChange={(value) => onChange('highCut', value)}
        />
      </div>

      <p className="cab-mic-legend">
        <span>가장자리 · 부드러움</span>
        <span>중앙 · 선명함</span>
      </p>
    </div>
  );
}

interface CabRangeControlProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}

function CabRangeControl({
  label,
  value,
  min,
  max,
  step,
  displayValue,
  onChange,
}: CabRangeControlProps) {
  return (
    <label className="cab-range-control">
      <span>
        <strong>{label}</strong>
        <output>{displayValue}</output>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        aria-valuetext={`${label} ${displayValue}`}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
    </label>
  );
}
