import { memo } from 'react';
import type { ButtonHTMLAttributes, CSSProperties, SyntheticEvent } from 'react';
import type {
  AutoWahParams,
  CabParams,
  ChorusParams,
  CompressorParams,
  CrunchParams,
  DelayParams,
  DriveParams,
  EQParams,
  FlangerParams,
  FuzzParams,
  GraphicEQParams,
  NoiseGateParams,
  PedalState,
  PhaserParams,
  ReverbParams,
  TremoloParams,
} from '../audio/types';
import { AudioEngine } from '../audio/AudioEngine';
import { usePedalStore } from '../store/pedalStore';
import { useRenderCount } from '../testing/renderCount';
import { SliderControl } from './SliderControl';
import { knobDefault } from './knobDefaults';
import { PedalFooter } from './PedalFooter';
import { NoiseGatePedal } from './effects/NoiseGatePedal';
import { PhaserPedal } from './effects/PhaserPedal';
import { CabPedal } from './effects/CabPedal';
import { ChorusPedal } from './effects/ChorusPedal';
import { CompressorPedal } from './effects/CompressorPedal';
import { CrunchPedal } from './effects/CrunchPedal';
import { DrivePedal } from './effects/DrivePedal';
import { EQPedal } from './effects/EQPedal';
import { FlangerPedal } from './effects/FlangerPedal';
import { FuzzPedal } from './effects/FuzzPedal';
import { GraphicEQPedal } from './effects/GraphicEQPedal';
import { DelayPedal } from './effects/DelayPedal';
import { ReverbPedal } from './effects/ReverbPedal';
import { TremoloPedal } from './effects/TremoloPedal';
import { AutoWahPedal } from './effects/AutoWahPedal';

interface PedalCardProps {
  pedal: PedalState;
  dragHandleProps?: Record<string, unknown>;
  isDragging?: boolean;
}

const customPedalChrome = new Set<PedalState['type']>([
  'noiseGate',
  'compressor',
  'autoWah',
  'drive',
  'crunch',
  'fuzz',
  'graphicEQ',
  'eq',
  'cab',
  'chorus',
  'flanger',
  'phaser',
  'tremolo',
  'delay',
  'reverb',
]);

/** 같은 페달(참조)·같은 끌기 상태면 다시 그리지 않는다(S4.3). 페달 객체는 바뀐 것만 새로 만들어진다. */
export const PedalCard = memo(function PedalCard({ pedal, dragHandleProps, isDragging = false }: PedalCardProps) {
  useRenderCount(`PedalCard:${pedal.id}`);
  const setActivePedal = usePedalStore((state) => state.setActivePedal);
  const updatePedalParam = usePedalStore((state) => state.updatePedalParam);

  const stopControlEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };


  const commitParam = (key: string, value: number | string | boolean) => {
    updatePedalParam(pedal.id, key, value);
    AudioEngine.getInstance().setPedalParam(pedal.id, key, value);
  };

  return (
    <article
      role="group"
      aria-label={`${pedal.name} 이펙터`}
      className={`pedal-card${pedal.type === 'compressor' ? ' pedal-card-compressor' : ''}${
        pedal.type === 'drive' ? ' pedal-card-drive' : ''
      }${pedal.type === 'autoWah' ? ' pedal-card-auto-wah' : ''
      }${pedal.type === 'noiseGate' ? ' pedal-card-noise-gate' : ''}${
        pedal.type === 'crunch' ? ' pedal-card-crunch' : ''
      }${
        pedal.type === 'fuzz' ? ' pedal-card-fuzz' : ''
      }${pedal.type === 'graphicEQ' ? ' pedal-card-graphic-eq' : ''}${pedal.type === 'eq' ? ' pedal-card-eq' : ''}${pedal.type === 'cab' ? ' pedal-card-cab' : ''}${pedal.type === 'chorus' ? ' pedal-card-chorus' : ''}${pedal.type === 'flanger' ? ' pedal-card-flanger' : ''}${pedal.type === 'phaser' ? ' pedal-card-phaser' : ''}${pedal.type === 'tremolo' ? ' pedal-card-tremolo' : ''}${pedal.type === 'delay' ? ' pedal-card-delay' : ''}${
        pedal.type === 'reverb' ? ' pedal-card-reverb' : ''
      }${!pedal.active ? ' is-bypassed' : ''}${
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
          ::
        </button>
        <div>
          <p className="pedal-kicker">이펙터</p>
          <h2>{pedal.name}</h2>
        </div>
      </header>

      <div
        className="pedal-controls"
        onPointerDown={stopControlEvent}
        onMouseDown={stopControlEvent}
        onTouchStart={stopControlEvent}
        onKeyDown={stopControlEvent}
      >
        {!customPedalChrome.has(pedal.type) && (
          <>
            <SliderControl
              label="Mix"
              value={pedal.params.mix}
              defaultValue={knobDefault(pedal.type, 'mix')}
              min={0}
              max={100}
              step={1}
              displayValue={`${Math.round(pedal.params.mix)}%`}
              onChange={(value) => commitParam('mix', value)}
            />
            <SliderControl
              label="Level"
              value={pedal.params.level}
              defaultValue={knobDefault(pedal.type, 'level')}
              min={0}
              max={100}
              step={1}
              displayValue={`${Math.round(pedal.params.level)}%`}
              onChange={(value) => commitParam('level', value)}
            />
          </>
        )}

        {pedal.type === 'noiseGate' && (
          <NoiseGatePedal
            params={pedal.params as NoiseGateParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'compressor' && (
          <CompressorPedal
            pedalId={pedal.id}
            params={pedal.params as CompressorParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'autoWah' && (
          <AutoWahPedal
            params={pedal.params as AutoWahParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'drive' && (
          <DrivePedal
            params={pedal.params as DriveParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'crunch' && (
          <CrunchPedal
            params={pedal.params as CrunchParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'fuzz' && (
          <FuzzPedal
            params={pedal.params as FuzzParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'graphicEQ' && (
          <GraphicEQPedal
            params={pedal.params as GraphicEQParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'eq' && (
          <EQPedal
            params={pedal.params as EQParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'cab' && (
          <CabPedal
            pedalId={pedal.id}
            params={pedal.params as CabParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'chorus' && (
          <ChorusPedal
            params={pedal.params as ChorusParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'flanger' && (
          <FlangerPedal
            params={pedal.params as FlangerParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'phaser' && (
          <PhaserPedal
            params={pedal.params as PhaserParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'tremolo' && (
          <TremoloPedal
            pedalId={pedal.id}
            params={pedal.params as TremoloParams}
            onChange={(key, value) => commitParam(String(key), value)}
          />
        )}
        {pedal.type === 'delay' && (
          <DelayPedal
            pedalId={pedal.id}
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

      <PedalFooter pedalId={pedal.id} pedalName={pedal.name} active={pedal.active} />
    </article>
  );
});
