import { useEffect, useRef, useState } from 'react';
import type {
  ButtonHTMLAttributes,
  CSSProperties,
  MouseEvent as ReactMouseEvent,
  SyntheticEvent,
} from 'react';
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
import { formatMidiMapping } from '../audio/midi';
import { useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';
import { ToggleSwitch } from './ToggleSwitch';
import { SliderControl } from './SliderControl';
import { StompToggleSwitch } from './StompToggleSwitch';
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

export function PedalCard({ pedal, dragHandleProps, isDragging = false }: PedalCardProps) {
  const [isMidiMenuOpen, setIsMidiMenuOpen] = useState(false);
  const midiMenuRef = useRef<HTMLDivElement>(null);
  const midiMenuItemRef = useRef<HTMLButtonElement>(null);
  const setActivePedal = usePedalStore((state) => state.setActivePedal);
  const setPedalBypass = usePedalStore((state) => state.setPedalBypass);
  const togglePedal = usePedalStore((state) => state.togglePedal);
  const updatePedalParam = usePedalStore((state) => state.updatePedalParam);
  const midiSupported = useAudioStore((state) => state.midiSupported);
  const midiLearningPedalId = useAudioStore((state) => state.midiLearningPedalId);
  const midiMapping = useAudioStore((state) => state.midiMappings[pedal.id]);
  const startMidiLearn = useAudioStore((state) => state.startMidiLearn);
  const cancelMidiLearn = useAudioStore((state) => state.cancelMidiLearn);
  const removeMidiMapping = useAudioStore((state) => state.removeMidiMapping);
  const isMidiLearning = midiLearningPedalId === pedal.id;

  useEffect(() => {
    if (!isMidiMenuOpen) return;

    midiMenuItemRef.current?.focus();
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && midiMenuRef.current?.contains(event.target)) return;
      setIsMidiMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsMidiMenuOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown, true);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [isMidiMenuOpen]);

  const stopControlEvent = (event: SyntheticEvent) => {
    event.stopPropagation();
  };

  const toggleEnabled = () => {
    togglePedal(pedal.id);
    const updatedPedal = usePedalStore
      .getState()
      .pedals.find((candidate) => candidate.id === pedal.id);
    if (updatedPedal) {
      AudioEngine.getInstance().setPedalEnabled(pedal.id, updatedPedal.enabled);
    }
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

  const openMidiMenu = (event: ReactMouseEvent<HTMLLabelElement>) => {
    if (!midiSupported) return;
    event.preventDefault();
    event.stopPropagation();
    setIsMidiMenuOpen(true);
  };

  const requestMidiLearn = () => {
    setIsMidiMenuOpen(false);
    void startMidiLearn(pedal.id);
  };

  const midiStatus = isMidiLearning
    ? 'MIDI 입력 대기 중…'
    : midiMapping
      ? `매핑됨 · ${formatMidiMapping(midiMapping)}`
      : 'MIDI 미매핑';
  const bypassToggle = (
    <ToggleSwitch
      label="Bypass"
      checked={pedal.bypassed}
      onChange={(checked) => commitParam('bypassed', checked)}
      onContextMenu={midiSupported ? openMidiMenu : undefined}
    />
  );

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
      }${pedal.bypassed ? ' is-bypassed' : ''}${!pedal.enabled ? ' is-disabled' : ''}${
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
          <p className="pedal-kicker">{pedal.type}</p>
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

      <footer
        className="pedal-switches"
        onPointerDown={stopControlEvent}
        onMouseDown={stopControlEvent}
        onTouchStart={stopControlEvent}
        onKeyDown={stopControlEvent}
      >
        <StompToggleSwitch label="On/Off" checked={pedal.enabled} onChange={toggleEnabled} />
        {midiSupported ? (
          <div className="midi-bypass-control">
            {bypassToggle}
              <button
                className="midi-learn-button"
                type="button"
                aria-label={`${pedal.name} MIDI 학습${isMidiLearning ? ' 취소' : ''}`}
                onClick={isMidiLearning ? cancelMidiLearn : requestMidiLearn}
              >
                {isMidiLearning ? '학습 취소' : 'MIDI 학습'}
              </button>
              <span
                className={`midi-mapping-status${isMidiLearning ? ' is-learning' : ''}`}
                role="status"
                aria-live="polite"
                aria-atomic="true"
              >
                {midiStatus}
              </span>
              {isMidiMenuOpen ? (
                <div
                  ref={midiMenuRef}
                  className="midi-learn-menu"
                  role="menu"
                  aria-label={`${pedal.name} Bypass MIDI 메뉴`}
                >
                  <button
                    ref={midiMenuItemRef}
                    type="button"
                    role="menuitem"
                    onClick={requestMidiLearn}
                  >
                    MIDI 학습
                  </button>
                  {midiMapping ? (
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => {
                        removeMidiMapping(pedal.id);
                        setIsMidiMenuOpen(false);
                      }}
                    >
                      매핑 해제
                    </button>
                  ) : null}
                </div>
              ) : null}
          </div>
        ) : (
          bypassToggle
        )}
      </footer>
    </article>
  );
}
