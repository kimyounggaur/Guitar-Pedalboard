export type ShortcutCommand =
  | { type: 'toggle-pedal'; index: number }
  | { type: 'toggle-audio' }
  | { type: 'tap-tempo' }
  | { type: 'activate-slot'; slot: 'A' | 'B' }
  | { type: 'panic' }
  | { type: 'show-help' };

export interface ShortcutKeyEvent {
  key: string;
  repeat: boolean;
  isComposing: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

export function resolveShortcutCommand(event: ShortcutKeyEvent): ShortcutCommand | null {
  if (event.repeat || event.isComposing || event.ctrlKey || event.metaKey || event.altKey) {
    return null;
  }

  const isHelpKey = event.key === '?';
  if (event.shiftKey && !isHelpKey) return null;
  if (isHelpKey) return { type: 'show-help' };

  if (/^[1-9]$/.test(event.key)) {
    return { type: 'toggle-pedal', index: Number(event.key) - 1 };
  }

  const key = event.key.toLowerCase();
  if (key === ' ' || key === 'spacebar') return { type: 'toggle-audio' };
  if (key === 't') return { type: 'tap-tempo' };
  if (key === 'a' || key === 'b') {
    return { type: 'activate-slot', slot: key === 'a' ? 'A' : 'B' };
  }
  if (key === 'escape' || key === 'esc') return { type: 'panic' };

  return null;
}
