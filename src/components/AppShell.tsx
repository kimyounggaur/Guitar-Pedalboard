import { useHistoryStore } from '../store/historyStore';
import { HistoryControls } from './HistoryControls';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChainText } from './ChainText';
import { ConnectGuitarPanel } from './ConnectGuitarPanel';
import { GlobalKeyboardShortcuts } from './GlobalKeyboardShortcuts';
import { Meter } from './Meter';
import { PedalBoard } from './PedalBoard';
import { PresetPanel } from './PresetPanel';
import { useDockHeight } from '../hooks/useDockHeight';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { useSidebar } from '../hooks/useSidebar';
import { useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';

const MOBILE_LAYOUT_QUERY = '(max-width: 767px)';

/**
 * 휴대폰 하단 도크의 탭. '페달' 탭이 기본이고, 그 탭에서는 도크가 탭 줄만 남기고 접힌다(설계서 S1.6).
 * 다른 탭을 누르면 최대 50dvh 로 펼치고, 펼쳐진 탭을 다시 누르면 '페달' 로 돌아가 접힌다. 열림 여부는 따로 저장하지 않고 탭에서 정한다.
 */
const mobileTabs = [
  { id: 'pedals', label: '페달' },
  { id: 'input', label: '입력' },
  { id: 'meter', label: '미터' },
  { id: 'preset', label: '프리셋' },
] as const;

type MobileTabId = (typeof mobileTabs)[number]['id'];

/** '페달' 탭이 가리키는 영역(PedalBoard 의 section). 이 탭은 도크 안에 패널이 없고 페달 보드 자체가 내용이다. */
const PEDAL_BOARD_SECTION_ID = 'pedal-board-section';

function readOnlineStatus(): boolean {
  return typeof navigator === 'undefined' ? true : navigator.onLine;
}

export function AppShell() {
  const isMobileLayout = useMediaQuery(MOBILE_LAYOUT_QUERY);
  const [activeMobileTab, setActiveMobileTab] = useState<MobileTabId>('pedals');
  const [dockElement, setDockElement] = useState<HTMLElement | null>(null);
  const mobileDockOpen = isMobileLayout && activeMobileTab !== 'pedals';
  // 오른쪽 오디오 패널: 1280px 이상은 붙박이(기본 열림, 접은 선택을 기억), 768~1279px 는 위에 뜨는 서랍(기본 닫힘)이다(S1.8).
  const { docked: sidebarDocked, open: sidebarOpen, setOpen: setSidebarOpen } = useSidebar();
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const drawerCloseRef = useRef<HTMLButtonElement>(null);
  const wasDrawerOpenRef = useRef(false);
  const [isOnline, setIsOnline] = useState(readOnlineStatus);
  const loadPedalsFromStorage = usePedalStore((state) => state.loadPedalsFromStorage);
  const refreshChainGainWarning = useAudioStore((state) => state.refreshChainGainWarning);
  const adoptTempoFromPedals = useAudioStore((state) => state.adoptTempoFromPedals);
  const disposeMidi = useAudioStore((state) => state.disposeMidi);
  const disposeRecording = useAudioStore((state) => state.disposeRecording);

  useEffect(() => {
    loadPedalsFromStorage();
    useHistoryStore.getState().clear();
    adoptTempoFromPedals();
  }, [adoptTempoFromPedals, loadPedalsFromStorage]);

  useEffect(() => {
    refreshChainGainWarning();
    return usePedalStore.subscribe(() => refreshChainGainWarning());
  }, [refreshChainGainWarning]);

  useEffect(() => {
    void useAudioStore.getState().connectSavedMidi();
    return () => disposeMidi();
  }, [disposeMidi]);
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

  useDockHeight(dockElement);

  // 서랍을 열면 포커스를 서랍의 닫기 버튼으로 옮기고, 닫으면 여는 데 쓴 버튼으로 돌려 보낸다. 붙박이 패널은 포커스를 건드리지 않는다.
  const drawerOpen = !isMobileLayout && !sidebarDocked && sidebarOpen;
  useEffect(() => {
    if (drawerOpen) drawerCloseRef.current?.focus();
    else if (wasDrawerOpenRef.current) sidebarToggleRef.current?.focus();
    wasDrawerOpenRef.current = drawerOpen;
  }, [drawerOpen]);

  const handleMobileTabClick = (tabId: MobileTabId) => {
    setActiveMobileTab((current) => (current === tabId ? 'pedals' : tabId));
  };

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
    <main className={`app-shell${mobileDockOpen ? ' mobile-dock-open' : ''}`}>
      <GlobalKeyboardShortcuts />
      {/* 실행 취소·다시 실행과 오디오 패널 버튼을 한 줄에 둔다(S1.8 상단 압축: 따로 두면 줄이 둘이라 첫 페달이 그만큼 내려간다). */}
      <div className={`app-toolbar${!isMobileLayout ? ' has-sidebar-toggle' : ''}`}>
        <HistoryControls />
        {!isMobileLayout && (
          <button ref={sidebarToggleRef} className="sidebar-toggle" type="button" aria-expanded={sidebarOpen} aria-controls="desktop-sidebar" onClick={() => setSidebarOpen(!sidebarOpen)}>
            {sidebarOpen ? '오디오 패널 접기' : '오디오 패널 펼치기'}
          </button>
        )}
      </div>
      {!isOnline ? (
        <div className="offline-notice" role="status" aria-live="polite">
          <strong>오프라인 상태입니다.</strong>
          <span>
            기타 실시간 입력은 사용할 수 없습니다. 음원 파일 재생 모드로 톤을 확인해 주세요.
          </span>
        </div>
      ) : null}
      <div className={`workspace${!sidebarOpen && sidebarDocked && !isMobileLayout ? ' sidebar-collapsed' : ''}${!sidebarDocked && !isMobileLayout ? ' sidebar-drawer-mode' : ''}`}>
        <PedalBoard inputPanel={isMobileLayout ? undefined : inputPanel} />
        {!isMobileLayout ? (
          <>
            {drawerOpen ? <div className="sidebar-scrim" aria-hidden="true" onClick={() => setSidebarOpen(false)} /> : null}
            <aside id="desktop-sidebar" className={`sidebar${!sidebarDocked ? ' is-drawer' : ''}`} aria-label="오디오와 프리셋 패널" hidden={!sidebarOpen}>
              {!sidebarDocked ? (
                <button ref={drawerCloseRef} type="button" className="sidebar-drawer-close" onClick={() => setSidebarOpen(false)}>
                  오디오 패널 닫기
                </button>
              ) : null}
              {presetPanel}
              {meterPanel}
              <ChainText />
            </aside>
          </>
        ) : null}
      </div>

      {isMobileLayout ? (
        <section ref={setDockElement} className="mobile-control-dock" aria-label="모바일 오디오 컨트롤">
          <div className="mobile-bottom-tabs" role="tablist" aria-label="모바일 컨트롤 패널">
            {mobileTabs.map((tab) => {
              const isActive = activeMobileTab === tab.id;
              return (
                <button
                  id={`mobile-tab-${tab.id}`}
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-controls={tab.id === 'pedals' ? PEDAL_BOARD_SECTION_ID : `mobile-panel-${tab.id}`}
                  aria-selected={isActive}
                  tabIndex={isActive ? 0 : -1}
                  onClick={() => handleMobileTabClick(tab.id)}
                  onKeyDown={handleMobileTabKeyDown}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div id="mobile-control-panels" className="mobile-control-panels" hidden={!mobileDockOpen}>
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
