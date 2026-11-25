// 키보드 단축키의 해석(설계서 4.11, S2.11). 브라우저 이벤트 하나를 명령 하나로 바꾸는 순수 함수와 키 표만 둔다.
// DOM·스토어에 기대지 않으므로 호출 기록 없이 Node 에서 모든 키 조합을 시험할 수 있다. 포커스 위치에 따라 막는 일과 명령을 실행하는 일은 ShortcutService 가 한다.
//
// 판단은 `KeyboardEvent.code`(물리 키) 기준이다. 한글 입력 상태에서 T 를 누르면 `key` 는 'ㅅ'(또는 'Process')이지만 `code` 는 항상 'KeyT' 이다.
export type ShortcutCommand =
  | { type: 'toggle-pedal'; index: number }
  | { type: 'toggle-audio' }
  | { type: 'tap-tempo' }
  | { type: 'activate-slot'; slot: 'A' | 'B' }
  | { type: 'panic' }
  | { type: 'show-help' };

export interface ShortcutKeyEvent {
  key: string;
  code?: string;
  repeat: boolean;
  isComposing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/** 1~15번째 페달을 켜고 끄는 키. 배열 위치가 곧 페달 순서다(현재 보드 순서 기준). */
export const PEDAL_KEY_CODES = [
  'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9',
  'Digit0', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyY',
] as const;

/** Shift 와 함께 누르면 10~15번째 페달(D13). 위 줄의 0 Q W E R Y 와 같은 여섯 페달이다. */
export const SHIFT_PEDAL_KEY_CODES = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6'] as const;
export const SHIFT_PEDAL_FIRST_INDEX = 9;

/** `code` 를 알려 주지 않는 환경(일부 가상 키보드)에서 `key` 로 알아보는 글자들. Shift 조합은 글자가 달라져 알아볼 수 없다. */
const FALLBACK_PEDAL_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'q', 'w', 'e', 'r', 'y'] as const;

export function resolveShortcutCommand(event: ShortcutKeyEvent): ShortcutCommand | null {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return null;

  const isHelpKey = event.key === '?' || (event.code === 'Slash' && event.shiftKey);
  if (isHelpKey) return { type: 'show-help' };

  // 물리 키는 한글 입력기와 상관없이 통한다. `code` 가 없는데 조합 중이면 글자를 믿을 수 없으니 무시한다.
  if (event.isComposing && !event.code) return null;
  const code = event.code;
  if (code) {
    // Shift 와 함께 쓰는 단축키는 Shift + 1~6(10~15번째 페달)과 도움말('?')뿐이다.
    if (event.shiftKey) {
      const shifted = SHIFT_PEDAL_KEY_CODES.indexOf(code as (typeof SHIFT_PEDAL_KEY_CODES)[number]);
      return shifted >= 0 ? { type: 'toggle-pedal', index: SHIFT_PEDAL_FIRST_INDEX + shifted } : null;
    }
    const index = PEDAL_KEY_CODES.indexOf(code as (typeof PEDAL_KEY_CODES)[number]);
    if (index >= 0) return { type: 'toggle-pedal', index };
    if (code === 'Space') return { type: 'toggle-audio' };
    if (code === 'KeyT') return { type: 'tap-tempo' };
    if (code === 'KeyA' || code === 'KeyB') return { type: 'activate-slot', slot: code === 'KeyA' ? 'A' : 'B' };
    if (code === 'Escape') return { type: 'panic' };
    return null;
  }
  if (event.shiftKey) return null;
  const key = event.key.toLowerCase();
  const index = FALLBACK_PEDAL_KEYS.indexOf(key as (typeof FALLBACK_PEDAL_KEYS)[number]);
  if (index >= 0) return { type: 'toggle-pedal', index };
  if (key === ' ' || key === 'spacebar') return { type: 'toggle-audio' };
  if (key === 't') return { type: 'tap-tempo' };
  if (key === 'a' || key === 'b') return { type: 'activate-slot', slot: key === 'a' ? 'A' : 'B' };
  if (key === 'escape' || key === 'esc') return { type: 'panic' };
  return null;
}

/** 도움말 한 행이 말하는 키 하나와, 그 키가 실제로 내는 명령(시험이 눌러 보고 맞는지 본다) */
export interface ShortcutSample {
  code: string;
  shift?: boolean;
  command: ShortcutCommand;
}

export interface ShortcutHelpRow {
  /** 도움말에 보이는 키 이름 */
  label: string;
  description: string;
  samples: readonly ShortcutSample[];
}

/**
 * 도움말 표. 키 표(위)와 같은 곳에 두어 도움말이 실제 동작과 어긋나지 않게 한다 — 행마다 `samples` 로 말한 키를 하나하나 눌러 보는 시험이 있다.
 * 행이 말하는 키는 이 표에만 쓰고, 화면(ShortcutHelp)은 이 표를 그대로 그린다.
 */
export const SHORTCUT_HELP_ROWS: readonly ShortcutHelpRow[] = [
  {
    label: '1–9 / 0 / Q W E R Y',
    description: '현재 순서의 1–15번째 페달 전환',
    samples: PEDAL_KEY_CODES.map((code, index) => ({ code, command: { type: 'toggle-pedal', index } })),
  },
  {
    label: 'Shift + 1–6',
    description: '현재 순서의 10–15번째 페달 전환(0 Q W E R Y 와 같은 페달)',
    samples: SHIFT_PEDAL_KEY_CODES.map((code, offset) => ({
      code,
      shift: true,
      command: { type: 'toggle-pedal', index: SHIFT_PEDAL_FIRST_INDEX + offset },
    })),
  },
  {
    label: 'Space',
    description: '음원 파일이 열려 있으면 재생·일시정지, 아니면 기타 입력 연결·해제',
    samples: [{ code: 'Space', command: { type: 'toggle-audio' } }],
  },
  { label: 'T', description: '탭 템포 입력', samples: [{ code: 'KeyT', command: { type: 'tap-tempo' } }] },
  {
    label: 'A / B',
    description: '저장된 프리셋 비교 슬롯 활성화',
    samples: [
      { code: 'KeyA', command: { type: 'activate-slot', slot: 'A' } },
      { code: 'KeyB', command: { type: 'activate-slot', slot: 'B' } },
    ],
  },
  {
    label: 'Esc',
    description: '긴급 정지 — 녹음 중이면 녹음을 저장하고 멈춥니다 (도움말이 열려 있으면 도움말 닫기)',
    samples: [{ code: 'Escape', command: { type: 'panic' } }],
  },
  {
    label: '?',
    description: '이 단축키 도움말 열기',
    samples: [{ code: 'Slash', shift: true, command: { type: 'show-help' } }],
  },
];
