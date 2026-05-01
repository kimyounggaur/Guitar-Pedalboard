import type { ButtonHTMLAttributes, CSSProperties, SyntheticEvent } from 'react';
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
  const setActivePedal = usePedalStore((state) => state.setActivePedal);
  const setPedalBypass = usePedalStore((state) => state.setPedalBypass);
  const togglePedal = usePedalStore((state) => state.togglePedal);
  const updatePedalParam = usePedalStore((state) => state.updatePedalParam);

  const stopControlEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const toggleEnabled = () => {
    togglePedal(pedal.id);
    void AudioEngine.getInstance().rebuildChain(usePedalStore.getState().pedals);
  };

  const commitParam = (key: string, value: number | string | boolean) => {
    if ((key === 'bypass' || key === 'bypassed') && typeof value === 'boolean') {
      setPedalBypass(pedal.id, value);
      AudioEngine.getInstance().setPedalBypass(pedal.id, value);
      return;
    }

    updatePedalParam(pedal.id, key, value);
    AudioEngine.getInstance().setPedalParam(pedal.id, key, value);
  };

  return (
    <article
      className={`pedal-card${pedal.bypassed ? ' is-bypassed' : ''}${
        !pedal.enabled ? ' is-disabled' : ''
      }${
        isDragging ? ' is-dragging' : ''
      }`}
      style={{ '--pedal-color': pedal.color } as CSSProperties}
      onClick={() => setActivePedal(pedal.id)}
    >
      <header className="pedal-header">
        <button
          className="drag-handle"
          type="button"
          aria-label={`${pedal.name} 순서 변경`}
          {...(dragHandleProps as ButtonHTMLAttributes<HTMLButtonElement>)}
        >
          ≡
        </button>
        <div>
          <p className="pedal-kicker">{pedal.type}</p>
          <h2>{pedal.name}</h2>
        </div>
        <div
          className="pedal-switches"
          onPointerDown={stopControlEvent}
          onMouseDown={stopControlEvent}
          onTouchStart={stopControlEvent}
          onKeyDown={stopControlEvent}
        >
          <ToggleSwitch label="On" checked={pedal.enabled} onChange={toggleEnabled} />
          <ToggleSwitch
            label="Bypass"
            checked={pedal.bypassed}
            onChange={(checked) => commitParam('bypassed', checked)}
          />
        </div>
      </header>

      <div
        className="pedal-controls"
        onPointerDown={stopControlEvent}
        onMouseDown={stopControlEvent}
        onTouchStart={stopControlEvent}
        onKeyDown={stopControlEvent}
      >
        <SliderControl
          label="Mix"
          value={pedal.params.mix}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(pedal.params.mix)}%`}
          onChange={(value) => commitParam('mix', value)}
        />
        <SliderControl
          label="Level"
          value={pedal.params.level}
          min={0}
          max={100}
          step={1}
          displayValue={`${Math.round(pedal.params.level)}%`}
          onChange={(value) => commitParam('level', value)}
        />

        {pedal.type === 'noiseGate' && (
          <NoiseGatePedal
            params={pedal.params as NoiseGateParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'compressor' && (
          <CompressorPedal
            params={pedal.params as CompressorParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'drive' && (
          <DrivePedal
            params={pedal.params as DriveParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'eq' && (
          <EQPedal
            params={pedal.params as EQParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'delay' && (
          <DelayPedal
            params={pedal.params as DelayParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'reverb' && (
          <ReverbPedal
            params={pedal.params as ReverbParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
      </div>
    </article>
  );
}
