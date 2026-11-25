import { isFeatureEnabled, type FeatureFlagName } from '../../config/flags';

/** WaveShaperNode 에 줄 수 있는 오버샘플링 중 왜곡 페달이 쓰는 두 가지. */
export type OversampleMode = '2x' | '4x';

/** 오버샘플링 배수를 고르는 왜곡 페달. */
export type OversamplePedal = 'drive' | 'crunch' | 'fuzz';

const PEDAL_FLAGS: Readonly<Record<OversamplePedal, FeatureFlagName>> = {
  drive: 'oversample2xDrive',
  crunch: 'oversample2xCrunch',
  fuzz: 'oversample2xFuzz',
};

/**
 * 페달의 WaveShaper 가 쓸 오버샘플링(S3.7). 마스터 플래그 `oversample2x` 와 그 페달의 플래그가 모두 켜져 있으면 2배(지연이 짧다),
 * 아니면 4배(에일리어싱이 적다)다. 이펙트를 만들 때 한 번 읽는다(플래그를 바꾼 뒤에는 새로 고친다).
 */
export function oversampleModeFor(pedal: OversamplePedal): OversampleMode {
  return isFeatureEnabled('oversample2x') && isFeatureEnabled(PEDAL_FLAGS[pedal]) ? '2x' : '4x';
}
