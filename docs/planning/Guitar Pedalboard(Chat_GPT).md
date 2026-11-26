기존 React + TypeScript + Vite 기반 웹 기타 멀티이펙터 앱에 Drag & Drop UI를 구현해줘.

목표:
사용자가 페달보드에서 이펙터 페달의 순서를 마우스/터치로 자유롭게 바꿀 수 있게 한다.

기술:
- React
- TypeScript
- Zustand
- @dnd-kit/core
- @dnd-kit/sortable
- @dnd-kit/utilities

작업 단계:

1. 패키지 설치
- @dnd-kit/core
- @dnd-kit/sortable
- @dnd-kit/utilities

2. pedalStore 구조 수정
다음 상태를 만든다:
- pedals: Pedal[]
- activePedalId: string | null
- reorderPedals(oldIndex, newIndex)
- togglePedal(id)
- updatePedalParam(id, paramName, value)

Pedal 타입:
type Pedal = {
  id: string;
  type: "noiseGate" | "compressor" | "overdrive" | "eq" | "delay" | "reverb";
  name: string;
  enabled: boolean;
  params: Record<string, number | string | boolean>;
};

3. PedalBoard.tsx 구현
- DndContext로 전체 페달보드를 감싼다.
- SortableContext를 사용한다.
- horizontalListSortingStrategy를 사용한다.
- onDragStart에서 activePedalId 저장
- onDragEnd에서 oldIndex/newIndex 계산 후 reorderPedals 실행
- 드래그가 끝나면 AudioEngine.rebuildChain(pedals)를 호출한다.

4. SortablePedal.tsx 구현
- useSortable 훅 사용
- attributes, listeners, setNodeRef 적용
- transform, transition 스타일 적용
- 드래그 중인 페달은 opacity 0.6
- 선택된 페달은 scale 1.03
- 드래그 핸들을 별도로 만든다.
- 노브 조작 영역에서는 드래그가 시작되지 않도록 한다.

5. AudioEngine 연동
reorderPedals가 실행되면:
- 기존 오디오 노드 연결을 모두 disconnect
- pedals 배열 순서대로 다시 connect
- bypass 된 페달은 dry path로 통과
- 마지막 노드는 masterGain에 연결

AudioEngine에 다음 메서드를 추가한다:
rebuildChain(pedals: Pedal[]): void

주의:
- 드래그 중에는 오디오 체인을 재연결하지 않는다.
- 드래그 종료 후에만 체인을 재구성한다.
- 노브를 돌릴 때 페달이 끌려가지 않도록 drag handle을 분리한다.
- 모바일 터치에서도 동작하게 한다.
- 키보드 접근성도 지원한다.

6. UI 요구사항
- 페달보드는 가로 스크롤 형태
- 각 페달 위쪽에 작은 “≡” 드래그 핸들 표시
- 드래그 중인 위치에 placeholder 표시
- 페달 이동 시 부드러운 애니메이션
- 순서 변경 후 “Signal Chain Updated” 토스트 표시
- 체인 순서를 상단에 텍스트로 표시:
  Guitar Input → Noise Gate → Compressor → Drive → EQ → Delay → Reverb → Output

7. 저장 기능
- 변경된 페달 순서를 localStorage에 저장
- 앱 재시작 시 이전 순서를 복원
- 프리셋 저장 시 pedal order도 함께 저장

8. 테스트 기준
- 페달을 좌우로 드래그하면 순서가 바뀐다.
- 순서 변경 후 실제 오디오 체인도 바뀐다.
- 노브 조작 시 드래그가 발생하지 않는다.
- bypass 상태가 유지된다.
- 새로고침 후에도 순서가 유지된다.
- 모바일 터치 드래그가 가능하다.
- 오디오가 끊기거나 과도한 피드백이 발생하지 않는다.

구현 후 다음 파일을 보여줘:
- package.json 변경사항
- src/store/pedalStore.ts
- src/components/PedalBoard.tsx
- src/components/SortablePedal.tsx
- src/audio/AudioEngine.ts