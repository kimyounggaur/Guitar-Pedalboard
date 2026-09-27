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
import { usePedalStore } from '../store/pedalStore';
import { PedalIcon } from './PedalIcon';
import { SortablePedal } from './SortablePedal';

const logoUrl = `${import.meta.env.BASE_URL}logo.png`;

interface PedalBoardProps {
  inputPanel?: ReactNode;
}

export function PedalBoard({ inputPanel }: PedalBoardProps) {
  const [showChainToast, setShowChainToast] = useState(false);
  const toastTimerRef = useRef<number | null>(null);
  const pedals = usePedalStore((state) => state.pedals);
  const reorderPedals = usePedalStore((state) => state.reorderPedals);
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

    const oldIndex = pedals.findIndex((pedal) => pedal.id === active.id);
    const newIndex = pedals.findIndex((pedal) => pedal.id === over.id);
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
    <section className="board-section" aria-label="페달보드">
      <div className="section-heading">
        <div className="brand-lockup">
          <p className="eyebrow">Pedalboard</p>
          <h1 className="app-logo-title">
            <img
              src={logoUrl}
              alt="Guitar Pedal Board"
              width="2048"
              height="1021"
              loading="eager"
              fetchPriority="high"
              decoding="async"
            />
          </h1>
        </div>
        <div className="header-tools">
          <span className="hint">드래그 종료 후 체인을 재연결합니다</span>
          {inputPanel}
        </div>
      </div>

      <div
        className="signal-chain-text"
        role="region"
        aria-label="현재 신호 체인"
        aria-live="polite"
        aria-atomic="true"
        tabIndex={0}
      >
        <span className="chain-endpoint">Guitar Input</span>
        {pedals.map((pedal) => (
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
          <span className="chain-endpoint">Output</span>
        </span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={() => setDraggingPedal(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={pedals.map((pedal) => pedal.id)} strategy={rectSortingStrategy}>
          <div className="pedal-board">
            {pedals.map((pedal) => (
              <SortablePedal key={pedal.id} pedal={pedal} />
            ))}
          </div>
        </SortableContext>
      </DndContext>

      {showChainToast && (
        <div className="chain-toast" role="status">
          Signal Chain Updated
        </div>
      )}
    </section>
  );
}
