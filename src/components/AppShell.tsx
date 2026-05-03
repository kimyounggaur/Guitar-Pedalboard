import { useEffect } from 'react';
import { ChainText } from './ChainText';
import { Meter } from './Meter';
import { PedalBoard } from './PedalBoard';
import { PresetPanel } from './PresetPanel';
import { usePedalStore } from '../store/pedalStore';

export function AppShell() {
  const loadPedalsFromStorage = usePedalStore((state) => state.loadPedalsFromStorage);

  useEffect(() => {
    loadPedalsFromStorage();
  }, [loadPedalsFromStorage]);

  return (
    <main className="app-shell">
      <div className="workspace">
        <PedalBoard />
        <aside className="sidebar" aria-label="오디오와 프리셋 패널">
          <PresetPanel />
          <Meter />
          <ChainText />
        </aside>
      </div>
    </main>
  );
}
