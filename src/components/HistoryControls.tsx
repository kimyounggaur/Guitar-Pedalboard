import { useEffect } from 'react';
import { endHistoryGesture, useHistoryStore } from '../store/historyStore';
import { isUndoOwnedByTarget } from '../input/ShortcutService';

export function HistoryControls() {
  const canUndo = useHistoryStore((state) => state.past.length > 0);
  const canRedo = useHistoryStore((state) => state.future.length > 0);
  const undo = useHistoryStore((state) => state.undo);
  const redo = useHistoryStore((state) => state.redo);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.isComposing || event.repeat || event.altKey || !(event.ctrlKey || event.metaKey) || isUndoOwnedByTarget(event.target)) return;
      const z = event.code === 'KeyZ' || event.key.toLowerCase() === 'z';
      const y = event.code === 'KeyY' || event.key.toLowerCase() === 'y';
      if (!z && !y) return;
      const history = useHistoryStore.getState();
      const shouldRedo = y || event.shiftKey;
      if (shouldRedo ? history.future.length === 0 : history.past.length === 0) return;
      event.preventDefault();
      if (shouldRedo) history.redo(); else history.undo();
    };
    // 노브 끌기는 그 노브가 끝낸다. 노브가 사라지거나 포인터를 잃어 끝 신호를 못 받아도 끌기가 영원히 열려 있지 않도록,
    // 어디서든 포인터가 끝나거나 창이 포커스를 잃으면 끌기를 닫는다.
    const closeGesture = () => endHistoryGesture();
    window.addEventListener('keydown', handleKey, true);
    window.addEventListener('pointerup', closeGesture, true);
    window.addEventListener('pointercancel', closeGesture, true);
    window.addEventListener('blur', closeGesture);
    return () => {
      window.removeEventListener('keydown', handleKey, true);
      window.removeEventListener('pointerup', closeGesture, true);
      window.removeEventListener('pointercancel', closeGesture, true);
      window.removeEventListener('blur', closeGesture);
    };
  }, []);
  return <div role="group" aria-label="페달 설정 변경 기록" className="history-controls">
    <button type="button" onClick={undo} disabled={!canUndo} title="Ctrl 또는 ⌘ + Z">실행 취소</button>
    <button type="button" onClick={redo} disabled={!canRedo} title="Ctrl 또는 ⌘ + Shift + Z">다시 실행</button>
  </div>;
}
