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
import { describeMidiConnection, formatMidiMapping } from '../audio/midi';
import { useAudioStore } from '../store/audioStore';
import { setPedalActive } from '../store/pedalActions';
import { usePedalStore } from '../store/pedalStore';
import { SliderControl } from './SliderControl';
import { knobDefault } from './knobDefaults';
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
  const updatePedalParam = usePedalStore((state) => state.updatePedalParam);
  const midiSupported = useAudioStore((state) => state.midiSupported);
  const midiLearningPedalId = useAudioStore((state) => state.midiLearningPedalId);
  const midiMapping = useAudioStore((state) => state.midiMappings[pedal.id]);
  const midiLink = useAudioStore((state) => state.midiLink);
  const midiDeviceCount = useAudioStore((state) => state.midiDevices.length);
  const startMidiLearn = useAudioStore((state) => state.startMidiLearn);
  const cancelMidiLearn = useAudioStore((state) => state.cancelMidiLearn);
  const setMidiMode = useAudioStore((state) => state.setMidiMode);
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


  const commitParam = (key: string, value: number | string | boolean) => {
    updatePedalParam(pedal.id, key, value);
    AudioEngine.getInstance().setPedalParam(pedal.id, key, value);
  };

  const openMidiMenu = (event: ReactMouseEvent<HTMLElement>) => {
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
      ? `매핑됨 · ${describeMidiConnection(midiLink, midiDeviceCount)} · ${formatMidiMapping(midiMapping)}`
      : 'MIDI 미매핑';


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

      <footer
        className="pedal-switches"
        onPointerDown={stopControlEvent}
        onMouseDown={stopControlEvent}
        onTouchStart={stopControlEvent}
        onKeyDown={stopControlEvent}
      >
        <StompToggleSwitch label="효과" checked={pedal.active} onChange={(checked) => setPedalActive(pedal.id, checked)} />
        {midiSupported ? (
          <div className="midi-bypass-control">
            <button type="button" className="midi-learn-button" aria-haspopup="menu" aria-expanded={isMidiMenuOpen} onClick={() => setIsMidiMenuOpen((open) => !open)} onContextMenu={openMidiMenu}>
              MIDI 설정
            </button>
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
              {midiMapping ? (
                <button
                  type="button"
                  className="midi-learn-button"
                  title={midiMapping.mode === 'toggle'
                    ? '토글: 누를 때마다 켜짐·꺼짐이 바뀝니다(뗌은 무시). 누르면 래치로 바뀝니다.'
                    : '래치: 스위치가 보내는 값을 따릅니다(64 이상 켜짐, 미만 꺼짐). 누르면 토글로 바뀝니다.'}
                  onClick={() => setMidiMode(pedal.id, midiMapping.mode === 'toggle' ? 'momentary' : 'toggle')}
                >
                  방식: {midiMapping.mode === 'toggle' ? '토글' : '래치'}
                </button>
              ) : null}
              {isMidiMenuOpen ? (
                <div
                  ref={midiMenuRef}
                  className="midi-learn-menu"
                  role="menu"
                  aria-label={`${pedal.name} MIDI 메뉴`}
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
        ) : null}
      </footer>
    </article>
  );
}
