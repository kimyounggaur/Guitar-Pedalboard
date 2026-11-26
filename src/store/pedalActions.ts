// 페달을 켜고 끄는 단 하나의 입구(S2.4, 설계서 R2-2·4.7).
// 화면의 발스위치·키보드 단축키·MIDI 가 모두 이 함수를 부른다. 저장소(저장 포함)를 먼저 바꾸고 엔진에 알린다 —
// 엔진은 저장소의 새 값을 다시 읽어 소리를 바꾸므로 순서가 바뀌면 이전 상태로 소리가 난다.
// 프리셋·A/B 는 페달 전체를 한꺼번에 적용하는 길(`applyPresetPedals` → `setPedals` + `rebuildChain`)이라 여기를 지나지 않는다.
// 두 길 모두 같은 `active` 필드를 쓰므로 어느 쪽으로 켜도 화면·LED·엔진·저장이 같은 값을 본다.
import { AudioEngine } from '../audio/AudioEngine';
import { usePedalStore } from './pedalStore';

/** 페달 하나를 켜거나 끈다. 바꿨으면 true, 없는 페달이거나 이미 그 상태면 false(저장도 엔진 호출도 하지 않는다). */
export function setPedalActive(pedalId: string, active: boolean): boolean {
  const pedal = usePedalStore.getState().pedals.find((candidate) => candidate.id === pedalId);
  if (!pedal || pedal.active === active) return false;

  usePedalStore.getState().setActive(pedalId, active);
  AudioEngine.getInstance().setPedalActive(pedalId, active);
  return true;
}

/** 지금과 반대로 바꾼다(키보드 단축키·MIDI 토글). 바꿨으면 바뀐 뒤의 값을, 없는 페달이면 null 을 돌려준다. */
export function togglePedalActive(pedalId: string): boolean | null {
  const pedal = usePedalStore.getState().pedals.find((candidate) => candidate.id === pedalId);
  if (!pedal) return null;

  const next = !pedal.active;
  setPedalActive(pedalId, next);
  return next;
}
