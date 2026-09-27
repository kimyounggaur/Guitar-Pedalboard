import { useEffect, useState, type KeyboardEvent } from 'react';
import { ChainText } from './ChainText';
import { ConnectGuitarPanel } from './ConnectGuitarPanel';
import { GlobalKeyboardShortcuts } from './GlobalKeyboardShortcuts';
import { Meter } from './Meter';
import { PedalBoard } from './PedalBoard';
import { PresetPanel } from './PresetPanel';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';

const MOBILE_LAYOUT_QUERY = '(max-width: 767px)';

const mobileTabs = [
  { id: 'input', label: '입력' },
  { id: 'meter', label: '미터' },
  { id: 'preset', label: '프리셋' },
] as const;

type MobileTabId = (typeof mobileTabs)[number]['id'];

function readOnlineStatus(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function AppShell() {
  const isMobileLayout = useMediaQuery(MOBILE_LAYOUT_QUERY);
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTabId>('input');
  const [isOnline, setIsOnline] = useState(readOnlineStatus);
  const loadPedalsFromStorage = usePedalStore((state) => state.loadPedalsFromStorage);
  const refreshChainGainWarning = useAudioStore((state) => state.refreshChainGainWarning);
  const adoptTempoFromPedals = useAudioStore((state) => state.adoptTempoFromPedals);
  const disposeMidi = useAudioStore((state) => state.disposeMidi);
  const disposeRecording = useAudioStore((state) => state.disposeRecording);

  useEffect(() => {
    loadPedalsFromStorage();
    adoptTempoFromPedals();
  }, [adoptTempoFromPedals, loadPedalsFromStorage]);

  useEffect(() => {
    refreshChainGainWarning();
    return usePedalStore.subscribe(() => refreshChainGainWarning());
  }, [refreshChainGainWarning]);

  useEffect(() => () => disposeMidi(), [disposeMidi]);
  useEffect(() => () => disposeRecording(), [disposeRecording]);

  useEffect(() => {
    const updateOnlineStatus = () => setIsOnline(navigator.onLine);

    window.addEventListener('online', updateOnlineStatus);
    window.addEventListener('offline', updateOnlineStatus);
    return () => {
      window.removeEventListener('online', updateOnlineStatus);
      window.removeEventListener('offline', updateOnlineStatus);
    };
  }, []);

  const handleMobileTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    const currentIndex = mobileTabs.findIndex((tab) => tab.id === activeMobileTab);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % mobileTabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + mobileTabs.length) % mobileTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = mobileTabs.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = mobileTabs[nextIndex];
    setActiveMobileTab(nextTab.id);
    document.getElementById(`mobile-tab-${nextTab.id}`)?.focus();
  };

  const inputPanel = <ConnectGuitarPanel isMobile={isMobileLayout} />;
  const meterPanel = <Meter active={!isMobileLayout || activeMobileTab === 'meter'} />;
  const presetPanel = <PresetPanel />;

  return (
    <main className="app-shell">
      <GlobalKeyboardShortcuts />
      {!isOnline ? (
        <div className="offline-notice" role="status" aria-live="polite">
          <strong>오프라인 상태입니다.</strong>
          <span>
            기타 실시간 입력은 사용할 수 없습니다. 음원 파일 재생 모드로 톤을 확인해 주세요.
          </span>
        </div>
      ) : null}
      <div className="workspace">
        <PedalBoard inputPanel={isMobileLayout ? undefined : inputPanel} />
        {!isMobileLayout ? (
          <aside className="sidebar" aria-label="오디오와 프리셋 패널">
            {presetPanel}
            {meterPanel}
            <ChainText />
          </aside>
        ) : null}
      </div>

      {isMobileLayout ? (
        <section className="mobile-control-dock" aria-label="모바일 오디오 컨트롤">
          <div className="mobile-bottom-tabs" role="tablist" aria-label="모바일 컨트롤 패널">
            {mobileTabs.map((tab) => {
              const isActive = activeMobileTab === tab.id;
              return (
                <button
                  id={`mobile-tab-${tab.id}`}
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-controls={`mobile-panel-${tab.id}`}
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => setActiveMobileTab(tab.id)}
                  onKeyDown={handleMobileTabKeyDown}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="mobile-control-panels">
            <div
              id="mobile-panel-input"
              className="mobile-control-panel"
              role="tabpanel"
              aria-labelledby="mobile-tab-input"
              tabIndex={0}
              hidden={activeMobileTab !== 'input'}
            >
              {inputPanel}
            </div>
            <div
              id="mobile-panel-meter"
              className="mobile-control-panel"
              role="tabpanel"
              aria-labelledby="mobile-tab-meter"
              tabIndex={0}
              hidden={activeMobileTab !== 'meter'}
            >
              {meterPanel}
            </div>
            <div
              id="mobile-panel-preset"
              className="mobile-control-panel mobile-preset-panel sidebar"
              role="tabpanel"
              aria-labelledby="mobile-tab-preset"
              tabIndex={0}
              hidden={activeMobileTab !== 'preset'}
            >
              {presetPanel}
            </div>
          </div>
        </section>
      ) : null}
    </main>
  );
}
