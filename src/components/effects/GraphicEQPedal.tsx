import type { GraphicEQParams, PedalParamValue } from '../../audio/types';
import { VerticalFader } from '../VerticalFader';
import { knobDefault } from '../knobDefaults';
import { KnobNumberInput } from '../KnobNumberInput';
import { useParamNames } from '../ParamScope';
import { ko } from '../../i18n/ko';

interface GraphicEQPedalProps {
  params: GraphicEQParams;
  onChange: (key: keyof GraphicEQParams, value: PedalParamValue) => void;
}

const bands = [
  { key: 'band100', frequency: 100, label: '100' },
  { key: 'band200', frequency: 200, label: '200' },
  { key: 'band400', frequency: 400, label: '400' },
  { key: 'band800', frequency: 800, label: '800' },
  { key: 'band1600', frequency: 1600, label: '1.6k' },
  { key: 'band3200', frequency: 3200, label: '3.2k' },
  { key: 'band6400', frequency: 6400, label: '6.4k' },
] as const satisfies readonly {
  key: keyof GraphicEQParams;
  frequency: number;
  label: string;
}[];

function formatDb(value: number): string {
  const rounded = Number(value.toFixed(1));
  return `${rounded > 0 ? '+' : ''}${rounded} dB`;
}

export function GraphicEQPedal({ params, onChange }: GraphicEQPedalProps) {
  const mixNames = useParamNames('Graphic EQ Mix');
  const levelNames = useParamNames('Graphic EQ Level');
  return (
    <div className="graphic-eq7-ui" role="group" aria-label={ko.pedal.graphicEQ.controls}>
      <div className="graphic-eq7-meter" aria-hidden="true">
        <span>+12</span>
        <strong>LEVEL</strong>
        <span>−12</span>
      </div>

      <div className="graphic-eq7-fader-bank">
        {bands.map(({ key, frequency, label }) => {
          const value = params[key] as number;
          const shownValue = formatDb(value);

          return (
            <VerticalFader
              key={key}
              label={`${label} Hz`}
              value={value}
              defaultValue={knobDefault('graphicEQ', key)}
              min={-12}
              max={12}
              step={0.5}
              displayValue={shownValue}
              ariaValueText={`${frequency} 헤르츠, ${shownValue}`}
              onChange={(nextValue) => onChange(key, nextValue)}
            />
          );
        })}
      </div>

      <div className="graphic-eq7-utility-controls">
        <div>
          <span>
            Mix <output>{Math.round(params.mix)}%</output>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={params.mix}
            aria-label={mixNames.name}
            aria-valuetext={`${mixNames.name} ${Math.round(params.mix)}%`}
            onDoubleClick={() => onChange('mix', knobDefault('graphicEQ', 'mix'))}
            onChange={(event) => onChange('mix', Number(event.currentTarget.value))}
          />
          <KnobNumberInput label={mixNames.name} value={params.mix} min={0} max={100} step={1} onChange={(value) => onChange('mix', value)} />
        </div>
        <div>
          <span>
            Level <output>{Math.round(params.level)}%</output>
          </span>
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={params.level}
            aria-label={levelNames.name}
            aria-valuetext={`${levelNames.name} ${Math.round(params.level)}%`}
            onDoubleClick={() => onChange('level', knobDefault('graphicEQ', 'level'))}
            onChange={(event) => onChange('level', Number(event.currentTarget.value))}
          />
          <KnobNumberInput label={levelNames.name} value={params.level} min={0} max={200} step={1} onChange={(value) => onChange('level', value)} />
        </div>
      </div>

      <div className="graphic-eq7-brand-plate">
        <strong>GRAPHIC EQ</strong>
        <span>7 BAND · ±12 dB</span>
      </div>
    </div>
  );
}
