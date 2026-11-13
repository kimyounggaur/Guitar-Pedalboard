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

export function resolveShortcutCommand(event: ShortcutKeyEvent): ShortcutCommand | null {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return null;

  const isHelpKey = event.key === '?' || (event.code === 'Slash' && event.shiftKey);
  if (event.shiftKey && !isHelpKey) return null;
  if (isHelpKey) return { type: 'show-help' };

  // Physical keys work with Korean IME too. Ignore composition when code is unavailable.
  if (event.isComposing && !event.code) return null;
  const code = event.code;
  const pedalKeys = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyY'];
  if (code) {
    const index = pedalKeys.indexOf(code);
    if (index >= 0) return { type: 'toggle-pedal', index };
    if (code === 'Space') return { type: 'toggle-audio' };
    if (code === 'KeyT') return { type: 'tap-tempo' };
    if (code === 'KeyA' || code === 'KeyB') return { type: 'activate-slot', slot: code === 'KeyA' ? 'A' : 'B' };
    if (code === 'Escape') return { type: 'panic' };
    return null;
  }
  const fallbackKeys = ['1','2','3','4','5','6','7','8','9','0','q','w','e','r','y'];
  const key = event.key.toLowerCase();
  const index = fallbackKeys.indexOf(key);
  if (index >= 0) return { type: 'toggle-pedal', index };
  if (key === ' ' || key === 'spacebar') return { type: 'toggle-audio' };
  if (key === 't') return { type: 'tap-tempo' };
  if (key === 'a' || key === 'b') return { type: 'activate-slot', slot: key === 'a' ? 'A' : 'B' };
  if (key === 'escape' || key === 'esc') return { type: 'panic' };
  return null;
}
