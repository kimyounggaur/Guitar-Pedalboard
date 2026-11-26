import { useSortable } from '@dnd-kit/sortable';
import { memo, useMemo } from 'react';
import { CSS } from '@dnd-kit/utilities';
import { usePedalById } from '../store/pedalSelectors';
import { PedalCard } from './PedalCard';

interface SortablePedalProps {
  pedalId: string;
}

/** 페달 하나를 자기 id 로만 구독한다. 다른 페달의 노브·켜짐이 바뀌어도 다시 그려지지 않는다(S4.3). */
export const SortablePedal = memo(function SortablePedal({ pedalId }: SortablePedalProps) {
  const pedal = usePedalById(pedalId);
  const {
    attributes,
    listeners,
    setActivatorNodeRef,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: pedalId });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 5 : undefined,
  };

  const dragHandleProps = useMemo(
    () => ({ ...attributes, ...listeners, ref: setActivatorNodeRef }),
    [attributes, listeners, setActivatorNodeRef],
  );

  // 페달이 지워진 순간(프리셋을 불러오는 중 등)에는 그릴 것이 없다.
  if (!pedal) return null;

  return (
    <div ref={setNodeRef} style={style} className="sortable-pedal">
      <PedalCard pedal={pedal} isDragging={isDragging} dragHandleProps={dragHandleProps} />
    </div>
  );
});
