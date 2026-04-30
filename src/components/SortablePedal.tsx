import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { PedalState } from '../audio/types';
import { PedalCard } from './PedalCard';

interface SortablePedalProps {
  pedal: PedalState;
}

export function SortablePedal({ pedal }: SortablePedalProps) {
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pedal.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div ref={setNodeRef} style={style} className="sortable-pedal">
      <PedalCard
        pedal={pedal}
        isDragging={isDragging}
        dragHandleProps={{
          ...attributes,
          ...listeners,
          ref: setActivatorNodeRef,
        }}
      />
    </div>
  );
}
