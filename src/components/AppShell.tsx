import { ChainText } from './ChainText';
import { ConnectGuitarPanel } from './ConnectGuitarPanel';
import { Meter } from './Meter';
import { PedalBoard } from './PedalBoard';
import { PresetPanel } from './PresetPanel';

export function AppShell() {
  return (
    <main className="app-shell">
      <div className="workspace">
        <PedalBoard />
        <aside className="sidebar" aria-label="오디오와 프리셋 패널">
          <ConnectGuitarPanel />
          <Meter />
          <ChainText />
          <PresetPanel />
        </aside>
      </div>
    </main>
  );
}
