// 페달 스토어를 '필요한 만큼만' 구독하는 선택자(S4.3). 노브 한 칸마다 보드 전체가 아니라 바뀐 카드만 다시 그려지게 한다.
import { useMemo } from 'react';
import { useShallow } from 'zustand/react/shallow';
import type { PedalState } from '../audio/types';
import { usePedalStore } from './pedalStore';

/** 보드의 페달 id 순서. 노브·켜짐이 바뀌어도 같은 값이므로 구독한 컴포넌트가 다시 그려지지 않는다(순서·구성이 바뀔 때만 바뀐다). */
export function usePedalIds(): string[] {
  return usePedalStore(useShallow((state) => state.pedals.map((pedal) => pedal.id)));
}

/** 페달 하나. 그 페달이 바뀔 때만 새 값이 온다(스토어가 바뀌지 않은 페달의 참조를 유지한다). */
export function usePedalById(id: string): PedalState | undefined {
  return usePedalStore((state) => state.pedals.find((pedal) => pedal.id === id));
}

export interface ChainItem {
  id: string;
  name: string;
  type: PedalState['type'];
  color: string;
  active: boolean;
}

const KEY_FIELD = '\u0000';
const KEY_ITEM = '\u0001';
/** 페달 객체마다 한 번만 만든 요약 문자열(스토어가 바뀌지 않은 페달의 참조를 유지하므로 거의 다 캐시에서 나온다) */
const chainKeyCache = new WeakMap<PedalState, string>();

function chainKeyOf(pedal: PedalState): string {
  let key = chainKeyCache.get(pedal);
  if (key === undefined) {
    key = [pedal.id, pedal.name, pedal.type, pedal.color, pedal.active ? '1' : '0'].join(KEY_FIELD);
    chainKeyCache.set(pedal, key);
  }
  return key;
}

/**
 * 신호 체인 표시용 요약(이름·종류·색, 필요하면 켜짐). 노브 값이 바뀌어도 같은 문자열이라 다시 그려지지 않는다.
 * `withActive` 가 false 면 켜고 끄는 것에도 반응하지 않는다.
 */
export function useChainItems(withActive: boolean): ChainItem[] {
  const key = usePedalStore((state) => {
    const keys = state.pedals.map(chainKeyOf);
    // 켜짐에 반응하지 않는 요약은 켜짐 자리를 항상 '1' 로 맞춘다.
    return (withActive ? keys : keys.map((item) => `${item.slice(0, -1)}1`)).join(KEY_ITEM);
  });
  return useMemo(
    () =>
      key.split(KEY_ITEM).map((item) => {
        const [id, name, type, color, active] = item.split(KEY_FIELD);
        return { id, name, type: type as PedalState['type'], color, active: active === '1' };
      }),
    [key],
  );
}
