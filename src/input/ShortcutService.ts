// 키보드 단축키의 실행(설계서 4.11, S2.11). 해석(shortcutKeys)과 화면(GlobalKeyboardShortcuts·ShortcutHelp) 사이에서
//   · 포커스가 어디 있느냐에 따라 단축키를 막고(isShortcutBlockedByTarget),
//   · 명령을 스토어에 전하고(executeShortcutCommand),
//   · keydown 하나를 처음부터 끝까지 처리하는 함수(createShortcutKeydownHandler)를 만든다.
// React 에 기대지 않으므로 가짜 이벤트·가짜 요소로 Node 에서 시험한다.
import { useAudioStore } from '../store/audioStore';
import { togglePedalActive } from '../store/pedalActions';
import { usePedalStore } from '../store/pedalStore';
import { usePresetStore } from '../store/presetStore';
import { resolveShortcutCommand, type ShortcutCommand, type ShortcutKeyEvent } from './shortcutKeys';

export { resolveShortcutCommand } from './shortcutKeys';
export type { ShortcutCommand } from './shortcutKeys';

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
        // 파일 모드의 Space 는 재생/일시정지다. 마이크는 켜지지 않는다(설계서 4.11, E-10).
        if (audioState.isFilePaused) void audioState.playFile();
        else audioState.pauseFile();
      } else if (audioState.isRunning) {
        void audioState.stop();
      } else if (audioState.uploadedFile) {
        // 정지·Panic 으로 세션이 끝나도 열어 둔 파일은 남는다. 파일이 열려 있으면 Space 는 마이크가 아니라 그 파일을 다시 튼다.
        void audioState.playFile();
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

/** keydown 하나를 처리하는 데 필요한 화면 쪽 손잡이. 도움말이 열려 있는지와 열고 닫는 일만 화면이 안다. */
export interface ShortcutKeydownContext {
  isHelpOpen: () => boolean;
  openHelp: () => void;
  closeHelp: () => void;
}

export type ShortcutKeydownEvent = ShortcutKeyEvent & Pick<KeyboardEvent, 'target' | 'preventDefault' | 'stopPropagation'>;

/**
 * 전역 keydown 처리기. 순서: ① 도움말이 열려 있으면 Esc 는 도움말만 닫고 긴급 정지로 가지 않는다(다른 키는 무시).
 * ② 해석된 명령이 없거나 포커스 위치가 막으면 아무것도 하지 않고 `preventDefault` 도 부르지 않는다. ③ 실행한 키만 `preventDefault`.
 */
export function createShortcutKeydownHandler(context: ShortcutKeydownContext): (event: ShortcutKeydownEvent) => void {
  return (event) => {
    const command = resolveShortcutCommand(event);

    if (context.isHelpOpen()) {
      if (command?.type === 'panic') {
        event.preventDefault();
        event.stopPropagation();
        context.closeHelp();
      }
      return;
    }

    if (!command || isShortcutBlockedByTarget(command, event)) return;

    if (executeShortcutCommand(command, context.openHelp)) {
      event.preventDefault();
    }
  };
}
