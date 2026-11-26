// '기본 페달 설정'(설계서의 Default Chain)과 그것을 되돌리는 길(S2.8, 설계서 R2-14).
//
// 모든 페달을 처음 값으로 돌리면 노브·켜짐·순서·음량 보정이 한꺼번에 바뀐다.
// 되돌리려면 그 전 상태를 통째로 기억해 둬야 한다. 화면(`PresetPanel`)은 이 두 함수만 부르고 토스트의 '실행 취소' 에 복원 함수를 건넨다.
// 사용자 캐비닛 IR 은 여기서 다루지 않는다(S5.4): IR 은 저장소에 따로 남고 어느 IR 을 쓸지는 Cab 의 모델 값('내 IR')이 정하므로,
// 페달 값을 처음으로 돌리면 모델이 기본 캐비닛으로 돌아갈 뿐 IR 은 지워지지 않고, 되돌리면 모델과 함께 IR 도 다시 쓰인다.
import { AudioEngine } from '../audio/AudioEngine';
import type { PedalState } from '../audio/types';
import { useAudioStore } from './audioStore';
import { clonePedals, initialPedals, usePedalStore } from './pedalStore';

/** '기본 페달 설정' 을 누르기 전의 상태 */
export interface ChainSnapshot {
  pedals: PedalState[];
  presetTrimDb: number;
}

/** 지금 상태를 기억해 둔다. 저장소의 값은 복사해 두므로 이후의 변경이 기억해 둔 값에 닿지 않는다. */
export function captureChainSnapshot(): ChainSnapshot {
  const { pedals, presetTrimDb } = usePedalStore.getState();
  return { pedals: clonePedals(pedals), presetTrimDb };
}

/** 이미 처음 상태인가(모든 페달이 처음 값이고 음량 보정이 0 dB 이다). 이때는 되돌릴 것도 되돌릴 방법을 남길 것도 없다. */
export function isDefaultChain(snapshot: ChainSnapshot): boolean {
  return snapshot.presetTrimDb === 0 && JSON.stringify(snapshot.pedals) === JSON.stringify(initialPedals);
}

/** 모든 페달을 처음 값(켜짐·순서·노브·음량 보정 0 dB)으로 돌린다. 소리까지 바꾼다. 저장된 사용자 IR 은 그대로 둔다. */
export function resetToDefaultChain(): void {
  const engine = AudioEngine.getInstance();
  usePedalStore.getState().resetPedalOrder();
  engine.rebuildChain();
}

/** `captureChainSnapshot` 으로 기억한 상태로 되돌린다. 저장하고 소리까지 바꾼다. */
export function restoreChainSnapshot(snapshot: ChainSnapshot): void {
  const engine = AudioEngine.getInstance();
  usePedalStore.getState().setPedals(clonePedals(snapshot.pedals), snapshot.presetTrimDb);
  useAudioStore.getState().adoptTempoFromPedals();
  engine.rebuildChain();
}
