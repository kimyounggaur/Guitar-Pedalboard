import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createShortcutKeydownHandler } from '../input/ShortcutService';
import { useAudioStore } from '../store/audioStore';
import { usePresetStore } from '../store/presetStore';
import { ShortcutHelp } from './ShortcutHelp';

/** 전역 keydown 리스너를 하나만 달고 도움말 대화상자를 연다. 키를 해석하고 실행하는 일은 `input/ShortcutService` 가 한다(설계서 S2.11). */
export function GlobalKeyboardShortcuts() {
  const [isHelpOpen, setIsHelpOpen] = useState(false);
  const helpOpenRef = useRef(false);
  const bpm = useAudioStore((state) => state.tapTempo.bpm);
  const tapCount = useAudioStore((state) => state.tapTempo.taps.length);
  const activeSlot = usePresetStore((state) => state.activeSlot);

  const setHelpOpen = useCallback((open: boolean) => {
    helpOpenRef.current = open;
    setIsHelpOpen(open);
  }, []);
  const openHelp = useCallback(() => setHelpOpen(true), [setHelpOpen]);
  const closeHelp = useCallback(() => setHelpOpen(false), [setHelpOpen]);
  const handleKeyDown = useMemo(
    () => createShortcutKeydownHandler({ isHelpOpen: () => helpOpenRef.current, openHelp, closeHelp }),
    [closeHelp, openHelp],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [handleKeyDown]);

  return (
    <>
      <output className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        글로벌 템포 {bpm} BPM, 탭 {tapCount}회, 프리셋 비교 {activeSlot} 슬롯
      </output>
      {isHelpOpen ? <ShortcutHelp onClose={closeHelp} /> : null}
    </>
  );
}
