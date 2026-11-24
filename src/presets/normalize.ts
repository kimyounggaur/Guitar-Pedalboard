// 불러온 페달 목록을 앱이 쓰는 모양으로 바로잡는 순수 함수들(S2.1).
// 저장소에서 읽을 때·프리셋 파일을 가져올 때 같은 함수를 쓴다. 저장 형식을 바꾸는 S2.4 의 마이그레이션 M2 도 이 함수를 그대로 쓴다.
import type { PedalParams, PedalState } from '../audio/types';

/** 페달 id → 그 페달의 기본 Mix(%). 기본값을 모르는 id 는 undefined. */
export type DefaultMixLookup = (pedalId: string) => number | undefined;

/**
 * 페달이 꺼져 있는가. 저장 형식 11 부터는 `enabled` 가 항상 true 이고 꺼짐을 `bypassed` 로만 쓰지만,
 * 이전 형식의 값(`enabled: false`)이 섞여 들어와도 같은 뜻으로 읽는다.
 */
export function isPedalOff(pedal: Pick<PedalState, 'enabled' | 'bypassed'>): boolean {
  return !pedal.enabled || pedal.bypassed;
}

/**
 * M2 — 꺼진 페달의 Mix 가 0 이면 그 페달의 기본 Mix 로 바꾼다.
 *
 * 꺼진 페달은 소리가 지나가지 않으므로 불러온 직후의 소리는 같다. 바꾸지 않으면 사용자가 켜도 원음만 지나가
 * '스위치를 눌렀는데 아무 일도 없는' 페달이 된다(R2-2).
 *
 * - 켜진 페달의 Mix 0 은 사용자가 정한 값이라 그대로 둔다.
 * - 기본 Mix 를 모르거나 0 이하인 페달(알 수 없는 id)은 건드리지 않는다.
 * - 바꿀 것이 없으면 같은 페달 객체를 그대로 돌려준다(입력은 바꾸지 않고, 몇 번을 적용해도 결과가 같다).
 */
export function restoreMixOfOffPedals(pedals: PedalState[], defaultMixOf: DefaultMixLookup): PedalState[] {
  return pedals.map((pedal) => {
    if (!isPedalOff(pedal) || pedal.params.mix !== 0) return pedal;
    const fallback = defaultMixOf(pedal.id);
    if (typeof fallback !== 'number' || !Number.isFinite(fallback) || fallback <= 0) return pedal;
    return { ...pedal, params: { ...pedal.params, mix: fallback } as PedalParams };
  });
}
