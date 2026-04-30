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
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { AudioEngine } from '../audio/AudioEngine';
import { usePedalStore } from '../store/pedalStore';
import { SortablePedal } from './SortablePedal';

export function PedalBoard() {
  const pedals = usePedalStore((state) => state.pedals);
  const reorderPedals = usePedalStore((state) => state.reorderPedals);
  const setDraggingPedal = usePedalStore((state) => state.setDraggingPedal);
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

    const nextPedals = arrayMove(pedals, oldIndex, newIndex);

    reorderPedals(oldIndex, newIndex);
    void AudioEngine.getInstance().rebuildChain(nextPedals);
  };

  return (
    <section className="board-section" aria-label="페달보드">
      <div className="section-heading">
        <div>
          <p className="eyebrow">Pedalboard</p>
          <h1>Web Guitar Multi-Effects</h1>
        </div>
        <span className="hint">드래그 종료 후 체인을 재연결합니다</span>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragStart={handleDragStart}
        onDragCancel={() => setDraggingPedal(null)}
        onDragEnd={handleDragEnd}
      >
        <SortableContext items={pedals.map((pedal) => pedal.id)} strategy={verticalListSortingStrategy}>
          <div className="pedal-board">
            {pedals.map((pedal) => (
              <SortablePedal key={pedal.id} pedal={pedal} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
    </section>
  );
}
