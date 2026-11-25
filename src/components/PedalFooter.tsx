import { memo, useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, SyntheticEvent } from 'react';
import { describeMidiConnection, formatMidiMapping } from '../audio/midi';
import { useAudioStore } from '../store/audioStore';
import { setPedalActive } from '../store/pedalActions';
import { useRenderCount } from '../testing/renderCount';
import { StompToggleSwitch } from './StompToggleSwitch';

interface PedalFooterProps {
  pedalId: string;
  pedalName: string;
  active: boolean;
}

/**
 * 카드 아래의 켜고 끄는 발스위치와 MIDI 설정(S4.3 에서 PedalCard 에서 떼어 냈다).
 * 노브를 돌릴 때는 props(id·이름·켜짐)가 그대로라 다시 그려지지 않고, MIDI 상태는 여기서 직접 구독한다.
 */
export const PedalFooter = memo(function PedalFooter({ pedalId, pedalName, active }: PedalFooterProps) {
  useRenderCount(`PedalFooter:${pedalId}`);
  const [isMidiMenuOpen, setIsMidiMenuOpen] = useState(false);
  const midiMenuRef = useRef<HTMLDivElement>(null);
  const midiMenuItemRef = useRef<HTMLButtonElement>(null);
  const midiSupported = useAudioStore((state) => state.midiSupported);
  const midiLearningPedalId = useAudioStore((state) => state.midiLearningPedalId);
  const midiMapping = useAudioStore((state) => state.midiMappings[pedalId]);
  const midiLink = useAudioStore((state) => state.midiLink);
  const midiDeviceCount = useAudioStore((state) => state.midiDevices.length);
  const startMidiLearn = useAudioStore((state) => state.startMidiLearn);
  const cancelMidiLearn = useAudioStore((state) => state.cancelMidiLearn);
  const setMidiMode = useAudioStore((state) => state.setMidiMode);
  const removeMidiMapping = useAudioStore((state) => state.removeMidiMapping);
  const isMidiLearning = midiLearningPedalId === pedalId;

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

  const openMidiMenu = (event: ReactMouseEvent<HTMLElement>) => {
    if (!midiSupported) return;
    event.preventDefault();
    event.stopPropagation();
    setIsMidiMenuOpen(true);
  };

  const requestMidiLearn = () => {
    setIsMidiMenuOpen(false);
    void startMidiLearn(pedalId);
  };

  const midiStatus = isMidiLearning
    ? 'MIDI 입력 대기 중…'
    : midiMapping
      ? `매핑됨 · ${describeMidiConnection(midiLink, midiDeviceCount)} · ${formatMidiMapping(midiMapping)}`
      : 'MIDI 미매핑';

  return (
    <footer
      className="pedal-switches"
      onPointerDown={stopControlEvent}
      onMouseDown={stopControlEvent}
      onTouchStart={stopControlEvent}
      onKeyDown={stopControlEvent}
    >
      <StompToggleSwitch label="효과" checked={active} onChange={(checked) => setPedalActive(pedalId, checked)} />
      {midiSupported ? (
        <div className="midi-bypass-control">
          <button type="button" className="midi-learn-button" aria-haspopup="menu" aria-expanded={isMidiMenuOpen} onClick={() => setIsMidiMenuOpen((open) => !open)} onContextMenu={openMidiMenu}>
            MIDI 설정
          </button>
            <button
              className="midi-learn-button"
              type="button"
              aria-label={`${pedalName} MIDI 학습${isMidiLearning ? ' 취소' : ''}`}
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
                onClick={() => setMidiMode(pedalId, midiMapping.mode === 'toggle' ? 'momentary' : 'toggle')}
              >
                방식: {midiMapping.mode === 'toggle' ? '토글' : '래치'}
              </button>
            ) : null}
            {isMidiMenuOpen ? (
              <div
                ref={midiMenuRef}
                className="midi-learn-menu"
                role="menu"
                aria-label={`${pedalName} MIDI 메뉴`}
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
                      removeMidiMapping(pedalId);
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
  );
});
