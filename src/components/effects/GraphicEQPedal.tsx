import type { GraphicEQParams, PedalParamValue } from '../../audio/types';
import { VerticalFader } from '../VerticalFader';

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
  return (
    <div className="graphic-eq7-ui" role="group" aria-label="7밴드 그래픽 이퀄라이저 컨트롤">
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
        <label>
          <span>
            Mix <output>{Math.round(params.mix)}%</output>
          </span>
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={params.mix}
            aria-label="Graphic EQ Mix"
            aria-valuetext={`Graphic EQ Mix ${Math.round(params.mix)}%`}
            onChange={(event) => onChange('mix', Number(event.currentTarget.value))}
          />
        </label>
        <label>
          <span>
            Level <output>{Math.round(params.level)}%</output>
          </span>
          <input
            type="range"
            min={0}
            max={200}
            step={1}
            value={params.level}
            aria-label="Graphic EQ Level"
            aria-valuetext={`Graphic EQ Level ${Math.round(params.level)}%`}
            onChange={(event) => onChange('level', Number(event.currentTarget.value))}
          />
        </label>
      </div>

      <div className="graphic-eq7-brand-plate">
        <strong>GRAPHIC EQ</strong>
        <span>7 BAND · ±12 dB</span>
      </div>
    </div>
  );
}
