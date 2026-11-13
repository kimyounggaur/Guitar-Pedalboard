import { useEffect } from 'react';
import { useHistoryStore } from '../store/historyStore';
import { isInteractiveShortcutTarget } from './GlobalKeyboardShortcuts';

export function HistoryControls() {
  const canUndo = useHistoryStore((state) => state.past.length > 0);
  const canRedo = useHistoryStore((state) => state.future.length > 0);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.altKey || !(event.ctrlKey || event.metaKey) || isInteractiveShortcutTarget(event.target)) return;
      const z = event.code === 'KeyZ' || event.key.toLowerCase() === 'z';
      const y = event.code === 'KeyY' || event.key.toLowerCase() === 'y';
      if (!z && !y) return;
      const history = useHistoryStore.getState();
      const shouldRedo = y || event.shiftKey;
      if (shouldRedo ? history.future.length === 0 : history.past.length === 0) return;
      event.preventDefault();
      if (shouldRedo) history.redo(); else history.undo();
    };
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, []);
  return <div role="group" aria-label="페달 설정 변경 기록" className="history-controls">
    <button type="button" onClick={undo} disabled={!canUndo} title="Ctrl 또는 ⌘ + Z">실행 취소</button>
    <button type="button" onClick={redo} disabled={!canRedo} title="Ctrl 또는 ⌘ + Shift + Z">다시 실행</button>
  </div>;
}
