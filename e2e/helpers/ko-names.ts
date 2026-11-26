// 화면에는 영어 얼굴 이름('Noise Gate')·노브 약어('Threshold')가 인쇄돼 있지만, 스크린 리더가 읽는 이름과 시험이 찾는 이름은 한국어다(S4.6).
// 시험은 영어로 쓴 얼굴 이름을 이 도우미에 넣어 한국어 이름을 얻는다 — 문구를 시험 파일마다 따로 적지 않는다.
import type { EffectType } from '../../src/audio/types';
import { ko } from '../../src/i18n/ko';
import { paramNames } from '../../src/i18n/paramName';
import { initialPedals } from '../../src/presets/initialPedals';

/** 얼굴에 인쇄된 페달 이름(`Noise Gate`) → 종류(`noiseGate`) */
export function pedalTypeOf(faceName: string): EffectType {
  const pedal = initialPedals.find((candidate) => candidate.name === faceName);
  if (!pedal) throw new Error(`기본 페달에 없는 이름: ${faceName}`);
  return pedal.type;
}

/** 얼굴 이름 → 한국어 전체 이름(`노이즈 게이트`). 카드는 '<이름> 이펙터' 영역이다. */
export const pedalKoName = (faceName: string): string => ko.pedal[pedalTypeOf(faceName)].name;

/** 카드 영역의 접근성 이름('노이즈 게이트 이펙터') */
export const pedalRegionName = (faceName: string): string => `${pedalKoName(faceName)} 이펙터`;

/** 노브·선택 상자에 인쇄된 약어(`Threshold`) → 스크린 리더 이름(`문턱값`). 페달은 얼굴 이름이나 종류 중 하나로 준다. */
export function knobKoName(pedal: string | EffectType, label: string): string {
  const type = initialPedals.some((candidate) => candidate.name === pedal) ? pedalTypeOf(pedal) : (pedal as EffectType);
  return paramNames(type, label).name;
}
