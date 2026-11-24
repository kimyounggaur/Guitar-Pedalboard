import type { EffectSchema } from '../types';
import { choice, fmtSlider, levelParam, mixParam, param } from './shared';

// Decay 의 범위(초). 6 초를 넘는 값은 엔진이 어차피 6 초로 잘라 써서 6~10 초 구간은 소리가 같았다(설계서 D14).
// 임펄스 응답 캐시와 작업자가 이 상수를 같이 쓰고, 저장값은 불러올 때 이 범위로 맞춘다(M3).
export const REVERB_DECAY_MIN = 0.2;
export const REVERB_DECAY_MAX = 6;

// 'Tone' 은 highCut(Hz)을 가리킨다. 화면에는 '7.2k' 처럼 단위 없이 보이고, 접근 가능한 값 설명은 '7.2 kHz' 다.
export const reverbSchema: EffectSchema = {
  type: 'reverb',
  params: [
    levelParam(100, 100),
    param({ key: 'decay', label: 'Decay', name: '잔향 길이', unit: 's', min: REVERB_DECAY_MIN, max: REVERB_DECAY_MAX, step: 0.1, default: 1.8, format: (value) => `${value.toFixed(1)}s` }),
    param({ key: 'highCut', label: 'Tone', name: '톤(고음 상한)', unit: 'Hz', min: 1000, max: 12000, step: 100, default: 7200, format: (value) => `${(value / 1000).toFixed(1)}k` }),
    mixParam(25),
    param({ key: 'preDelay', label: 'Pre Delay', name: '잔향이 시작되기까지의 시간', unit: 'ms', min: 0, max: 200, step: 1, default: 24, format: fmtSlider(' ms') }),
    param({ key: 'lowCut', label: 'Low Cut', name: '로우컷 주파수', unit: 'Hz', min: 20, max: 500, step: 5, default: 120, format: fmtSlider(' Hz') }),
  ],
  choices: [
    choice({
      key: 'mode',
      label: 'Mode',
      name: '잔향 방식',
      kind: 'enum',
      options: [
        { value: 'room', label: 'Room' },
        { value: 'hall', label: 'Hall' },
        { value: 'plate', label: 'Plate' },
        { value: 'spring', label: 'Spring' },
        { value: 'ambient', label: 'Ambient' },
      ],
      default: 'hall',
    }),
    choice({ key: 'trails', label: 'Trails', name: '꺼도 잔향 이어가기', kind: 'boolean', default: true }),
  ],
  defaultMix: 25,
};
