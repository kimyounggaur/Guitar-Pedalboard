import type { ButtonHTMLAttributes, CSSProperties } from 'react';
import type {
  CompressorParams,
  DelayParams,
  DriveParams,
  EQParams,
  NoiseGateParams,
  PedalState,
  ReverbParams,
} from '../audio/types';
import { AudioEngine } from '../audio/AudioEngine';
import { usePedalStore } from '../store/pedalStore';
import { ToggleSwitch } from './ToggleSwitch';
import { SliderControl } from './SliderControl';
import { NoiseGatePedal } from './effects/NoiseGatePedal';
import { CompressorPedal } from './effects/CompressorPedal';
import { DrivePedal } from './effects/DrivePedal';
import { EQPedal } from './effects/EQPedal';
import { DelayPedal } from './effects/DelayPedal';
import { ReverbPedal } from './effects/ReverbPedal';

interface PedalCardProps {
  pedal: PedalState;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
}

export function PedalCard({ pedal, dragHandleProps, isDragging = false }: PedalCardProps) {
  const updatePedal = usePedalStore((state) => state.updatePedal);

  const commitParam = (key: string, value: number | boolean) => {
    const nextPedal: PedalState = {
      ...pedal,
      params: {
        ...pedal.params,
        [key]: value,
      } as PedalState['params'],
    };

    updatePedal(nextPedal);
    AudioEngine.getInstance().updatePedal(nextPedal);
  };

  return (
    <article
      className={`pedal-card${pedal.params.bypass ? ' is-bypassed' : ''}${
        isDragging ? ' is-dragging' : ''
      }`}
      style={{ '--pedal-color': pedal.color } as CSSProperties}
    >
      <header className="pedal-header">
        <button
          className="drag-handle"
          type="button"
          aria-label={`${pedal.name} 순서 변경`}
          {...(dragHandleProps as ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          ::
        </button>
        <div>
          <p className="pedal-kicker">{pedal.type}</p>
          <h2>{pedal.name}</h2>
        </div>
        <ToggleSwitch
          label="Bypass"
          checked={pedal.params.bypass}
          onChange={(checked) => commitParam('bypass', checked)}
        />
      </header>

      <div className="pedal-controls">
        <SliderControl
          label="Mix"
          value={pedal.params.mix}
          min={0}
          max={1}
          step={0.01}
          displayValue={`${Math.round(pedal.params.mix * 100)}%`}
          onChange={(value) => commitParam('mix', value)}
        />
        <SliderControl
          label="Level"
          value={pedal.params.level}
          min={0}
          max={2}
          step={0.01}
          displayValue={`${Math.round(pedal.params.level * 100)}%`}
          onChange={(value) => commitParam('level', value)}
        />

        {pedal.type === 'noiseGate' && (
          <NoiseGatePedal
            params={pedal.params as NoiseGateParams}
            onChange={(key, value) => commitParam(key, value)}
          />
        )}
        {pedal.type === 'compressor' && (
          <CompressorPedal
            params={pedal.params as CompressorParams}
            onChange={(key, value) => commitParam(key, value)}
          />
        )}
        {pedal.type === 'drive' && (
          <DrivePedal
            params={pedal.params as DriveParams}
            onChange={(key, value) => commitParam(key, value)}
          />
        )}
        {pedal.type === 'eq' && (
          <EQPedal
            params={pedal.params as EQParams}
            onChange={(key, value) => commitParam(key, value)}
          />
        )}
        {pedal.type === 'delay' && (
          <DelayPedal
            params={pedal.params as DelayParams}
            onChange={(key, value) => commitParam(key, value)}
          />
        )}
        {pedal.type === 'reverb' && (
          <ReverbPedal
            params={pedal.params as ReverbParams}
            onChange={(key, value) => commitParam(key, value)}
          />
        )}
      </div>
    </article>
  );
}
