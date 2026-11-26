import { clamp } from '../utils/db';

/**
 * 페달이 원음(dry)과 효과음(wet)을 섞는 방식(설계서 S3.1, R3-7).
 * - `crossfade`: Mix 가 오르면 원음이 그만큼 줄고 효과음이 는다(dry = 1 − mix, wet = mix). 소리를 바꾸는 페달(왜곡·EQ·코러스 등)의 방식이다.
 * - `additive`: 원음은 그대로 두고(dry = 1) 효과음만 Mix 만큼 더한다(wet = mix). 원음 위에 반복·공간을 얹는 딜레이·리버브의 방식이다.
 *   딜레이 기본 Mix 30% 를 crossfade 로 섞으면 원음이 20·log10(0.7) ≈ −3.1 dB 줄어든다(P-15 가 지키는 값은 0 dB).
 */
export type MixLaw = 'crossfade' | 'additive';

export interface MixGains {
  dry: number;
  wet: number;
}

/**
 * 원음·효과음 게인의 목표값.
 * @param law 섞는 방식
 * @param mix 0~1 의 Mix(범위를 벗어나면 맞춘다)
 * @param active 소리에 걸리는가. 꺼져 있으면 원음은 우회 경로가 맡고 dry 는 0 이다.
 * @param trails 꺼진 뒤에도 효과음의 꼬리를 남기는가(딜레이·리버브의 Trails). 꺼져 있고 trails 면 wet 만 Mix 로 남는다.
 */
export function mixGains(law: MixLaw, mix: number, active: boolean, trails: boolean): MixGains {
  const amount = clamp(mix, 0, 1);
  const dry = active ? (law === 'additive' ? 1 : 1 - amount) : 0;
  const wet = active || trails ? amount : 0;
  return { dry, wet };
}
