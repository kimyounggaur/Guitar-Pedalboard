import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioEngine } from '../audio/AudioEngine';
import { useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';
import { usePresetStore } from '../store/presetStore';
import { ShortcutHelp } from './ShortcutHelp';
import { resolveShortcutCommand, type ShortcutCommand } from './keyboardShortcuts';

export function isInteractiveShortcutTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const tagName = target.tagName.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'select' ||
    tagName === 'textarea' ||
    tagName === 'button' ||
    (tagName === 'a' && target.hasAttribute('href')) ||
    target.closest(
      'button, a[href], summary, audio[controls], video[controls], [contenteditable]:not([contenteditable="false"]), [role="button"], [role="link"], [role="textbox"], [role="combobox"], [role="slider"], [role="switch"], [role="tab"], [tabindex]:not([tabindex="-1"])',
    ) !== null
  );
}

export function executeShortcutCommand(
  command: ShortcutCommand,
  openHelp: () => void,
): boolean {
  switch (command.type) {
    case 'toggle-pedal': {
      if (!Number.isInteger(command.index) || command.index < 0 || command.index > 8) return false;

      const pedalStore = usePedalStore.getState();
      const pedal = pedalStore.pedals[command.index];
      if (!pedal) return false;

      const bypassed = !pedal.bypassed;
      pedalStore.setPedalBypass(pedal.id, bypassed);
      AudioEngine.getInstance().setPedalBypass(pedal.id, bypassed);
      return true;
    }
    case 'toggle-audio': {
      const audioState = useAudioStore.getState();
      if (audioState.isLoading) return true;

      if (audioState.isRunning) {
        void audioState.stop();
      } else {
        void audioState.start();
      }
      return true;
    }
    case 'tap-tempo':
      useAudioStore.getState().tapTempoTap();
      return true;
    case 'activate-slot':
      return usePresetStore.getState().activateSlot(command.slot);
    case 'panic':
      useAudioStore.getState().panic();
      return true;
    case 'show-help':
      openHelp();
      return true;
    default:
      command satisfies never;
      return false;
  }
}

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const command = resolveShortcutCommand(event);

      if (helpOpenRef.current) {
        if (command?.type === 'panic') {
          event.preventDefault();
          event.stopPropagation();
          closeHelp();
        }
        return;
      }

      if (!command || isInteractiveShortcutTarget(event.target)) return;

      if (executeShortcutCommand(command, openHelp)) {
        event.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [closeHelp, openHelp]);

  return (
    <>
      <output className="visually-hidden" role="status" aria-live="polite" aria-atomic="true">
        글로벌 템포 {bpm} BPM, 탭 {tapCount}회, 프리셋 비교 {activeSlot} 슬롯
      </output>
      {isHelpOpen ? <ShortcutHelp onClose={closeHelp} /> : null}
    </>
  );
}
