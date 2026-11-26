import { useEffect, useRef, useState, type ReactNode } from 'react';
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  rectSortingStrategy,
  SortableContext,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { AudioEngine } from '../audio/AudioEngine';
import { useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';
import { useChainItems, usePedalIds } from '../store/pedalSelectors';
import { useRenderCount } from '../testing/renderCount';
import { PedalIcon } from './PedalIcon';
import { SortablePedal } from './SortablePedal';
import { ko } from '../i18n/ko';

// 로고는 표시 폭(데스크톱 높이 56 px ≈ 113 px, 좁은 화면 최대 520 px)에 맞춰 520 px·1040 px 두 가지만 둔다(S4.1).
// srcset·sizes 는 index.html 의 preload(imagesrcset·imagesizes)와 같은 값이어야 미리 받은 그림을 그대로 쓴다 — E-19 가 한 번만 받는지 본다.
const logoBase = import.meta.env.BASE_URL;
const logoUrl = `${logoBase}logo-520.webp`;
const logoSrcSet = `${logoBase}logo-520.webp 520w, ${logoBase}logo-1040.webp 1040w`;
const logoSizes = '(min-width: 768px) 113px, min(520px, 62vw)';

interface PedalBoardProps {
  inputPanel?: ReactNode;
}

/** '기타 입력 -> 페달 -> … -> 출력' 한 줄. 이름·종류·색만 구독해서 노브·켜짐이 바뀔 때는 다시 그려지지 않는다(S4.3). */
function SignalChainText() {
  useRenderCount('SignalChainText');
  const items = useChainItems(false);
  return (
    <div
      className="signal-chain-text"
      role="region"
      aria-label="현재 신호 체인"
      aria-live="polite"
      aria-atomic="true"
      tabIndex={0}
    >
      <span className="chain-endpoint">기타 입력</span>
      {items.map((pedal) => (
        <span className="signal-chain-hop" key={pedal.id}>
          <span className="chain-arrow" aria-hidden="true">
            -&gt;
          </span>
          <span className="chain-effect-pill">
            <PedalIcon type={pedal.type} color={pedal.color} />
            <span>{pedal.name}</span>
          </span>
        </span>
      ))}
      <span className="signal-chain-hop">
        <span className="chain-arrow" aria-hidden="true">
          -&gt;
        </span>
        <span className="chain-endpoint">출력</span>
      </span>
    </div>
  );
}

export function PedalBoard({ inputPanel }: PedalBoardProps) {
  const [showChainToast, setShowChainToast] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  useRenderCount('PedalBoard');
  // 보드는 페달 id 순서만 구독한다. 카드 하나하나는 SortablePedal 이 자기 페달만 구독한다(S4.3).
  const pedalIds = usePedalIds();
  const reorderPedals = usePedalStore((state) => state.reorderPedals);
  // 기타를 연결하면 연결 패널이 한 줄 상태 표시줄로 줄어든다(ConnectGuitarPanel). 머리말도 로고 옆에 붙여 높이를 아낀다(S1.8).
  const isLiveConnected = useAudioStore((state) => state.isRunning && state.inputMode === 'device');
  const setDraggingPedal = usePedalStore((state) => state.setDraggingPedal);
  useEffect(() => {
    return () => {
      if (toastTimerRef.current) {
        window.clearTimeout(toastTimerRef.current);
      }
    };
  }, []);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const handleDragStart = (event: DragStartEvent) => {
    setDraggingPedal(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setDraggingPedal(null);
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const oldIndex = pedalIds.indexOf(String(active.id));
    const newIndex = pedalIds.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;

    reorderPedals(oldIndex, newIndex);
    AudioEngine.getInstance().rebuildChain();
    setShowChainToast(true);

    if (toastTimerRef.current) {
      window.clearTimeout(toastTimerRef.current);
    }

    toastTimerRef.current = window.setTimeout(() => {
      setShowChainToast(false);
      toastTimerRef.current = null;
    }, 1800);
  };

  return (
    <section id="pedal-board-section" className="board-section" aria-label="페달보드">
      <div className={`section-heading${inputPanel && isLiveConnected ? ' is-connected' : ''}`}>
        <div className="brand-lockup">
          <p className="eyebrow">{ko.app.eyebrow.pedalboard}</p>
          <h1 className="app-logo-title">
            <img
              src={logoUrl}
              srcSet={logoSrcSet}
              sizes={logoSizes}
              alt={ko.app.logoAlt}
              width="520"
              height="259"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </h1>
        </div>
        <div className="header-tools">
          <span className="hint">페달을 끌어서 순서를 바꿀 수 있습니다.</span>
          {inputPanel}
        </div>
      </div>

      <SignalChainText />

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={() => setDraggingPedal(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={pedalIds} strategy={rectSortingStrategy}>
          <div className="pedal-board">
            {pedalIds.map((pedalId) => (
              <SortablePedal key={pedalId} pedalId={pedalId} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {showChainToast && (
        <div className="chain-toast" role="status">
          {ko.chain.reordered}
        </div>
      )}
    </section>
  );
}
