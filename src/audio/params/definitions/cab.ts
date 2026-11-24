import type { EffectSchema } from '../types';
import { choice, fmtRounded, levelParam, mixParam, param, percentParam } from './shared';

// Cab 화면은 한국어 이름을 쓴다(마이크 위치·거리·프레즌스·믹스·레벨·로우 컷·하이 컷).
export const cabSchema: EffectSchema = {
  type: 'cab',
  params: [
    percentParam('micPosition', '마이크 위치', '마이크 위치(스피커 중심 ↔ 가장자리)', 55),
    percentParam('distance', '거리', '마이크와 스피커의 거리', 30),
    param({ key: 'presence', label: '프레즌스', name: '프레즌스(고음 선명도)', unit: 'dB', min: -6, max: 6, step: 0.1, default: 1.5, format: (value) => `${value > 0 ? '+' : ''}${value.toFixed(1)} dB` }),
    mixParam(100, '믹스'),
    levelParam(100, 200, '레벨'),
    param({ key: 'lowCut', label: '로우 컷', name: '로우컷 주파수', unit: 'Hz', min: 40, max: 200, step: 1, default: 85, format: fmtRounded(' Hz') }),
    param({ key: 'highCut', label: '하이 컷', name: '하이컷 주파수', unit: 'Hz', min: 3000, max: 12000, step: 100, default: 5400, format: (value) => `${(value / 1000).toFixed(1)} kHz` }),
  ],
  choices: [
    choice({
      key: 'model',
      label: '캐비닛 모델',
      name: '캐비닛 모델',
      kind: 'enum',
      options: [
        { value: 'v30-4x12', label: 'Modern 4×12' },
        { value: 'greenback-4x12', label: 'Vintage 4×12' },
        { value: 'blue-1x12', label: 'Blue 1×12' },
        { value: 'jensen-1x12', label: 'American 1×12' },
        { value: 'tweed-1x10', label: 'Tweed 1×10' },
        { value: 'off', label: 'IR 끄기' },
      ],
      default: 'v30-4x12',
    }),
  ],
  defaultMix: 100,
};
