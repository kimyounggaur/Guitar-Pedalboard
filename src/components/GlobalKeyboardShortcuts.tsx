import { useCallback, useEffect, useRef, useState } from 'react';
import { useAudioStore } from '../store/audioStore';
import { togglePedalActive } from '../store/pedalActions';
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

const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'image', 'radio', 'range', 'reset', 'submit']);

/**
 * Esc 를 그 컨트롤 자신이 먼저 써야 하는 대상인지: 글자·숫자를 고치는 칸(Esc 로 편집 취소),
 * 열린 목록·메뉴·대화상자(Esc 로 닫기). 그 밖의 곳에서는 포커스가 어디 있든 Esc 가 긴급 정지로 통한다.
 * 연주 중에는 포커스가 페달 스위치·슬라이더·버튼에 있는 것이 보통이라, 거기서 Esc 가 무시되면
 * 하울링이 날 때 쓸 수 없다(보고서 R2-12, REFACTOR_LOG L-17).
 */
export function isEscapeOwnedByTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;

  const tagName = target.tagName.toLowerCase();
  if (tagName === 'select' || tagName === 'textarea') return true;
  if (tagName === 'input') return !NON_TEXT_INPUT_TYPES.has((target as HTMLInputElement).type);
  return (
    target.closest(
      '[contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="searchbox"], [role="spinbutton"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"], [aria-modal="true"], [aria-haspopup][aria-expanded="true"]',
    ) !== null
  );
}

/**
 * 포커스 위치 때문에 이 단축키를 막을지. 숫자·Space·T·A/B 는 컨트롤이 먼저 쓰므로 컨트롤에 포커스가 있으면 막지만,
 * 긴급 정지(Esc)는 컨트롤에 포커스가 있어도 통한다. 막는 것은 Esc 를 자기 일에 쓰는 곳(위)과 한글 조합 취소뿐이다.
 */
export function isShortcutBlockedByTarget(
  command: ShortcutCommand,
  event: Pick<KeyboardEvent, 'target' | 'isComposing'>,
): boolean {
  if (command.type === 'panic') return event.isComposing || isEscapeOwnedByTarget(event.target);
  return isInteractiveShortcutTarget(event.target);
}

export function executeShortcutCommand(
  command: ShortcutCommand,
  openHelp: () => void,
): boolean {
  switch (command.type) {
    case 'toggle-pedal': {
      if (!Number.isInteger(command.index) || command.index < 0 || command.index > 14) return false;

      const pedal = usePedalStore.getState().pedals[command.index];
      if (!pedal) return false;

      togglePedalActive(pedal.id);
      return true;
    }
    case 'toggle-audio': {
      const audioState = useAudioStore.getState();
      if (audioState.isLoading) return true;

      if (audioState.inputMode === 'file') {
        if (audioState.isFilePaused) void audioState.playFile();
        else audioState.pauseFile();
      } else if (audioState.isRunning) {
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

      if (!command || isShortcutBlockedByTarget(command, event)) return;

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
