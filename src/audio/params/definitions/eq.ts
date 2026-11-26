import type { EffectSchema } from '../types';
import { fmtRounded, levelParam, mixParam, param } from './shared';

// 설계서 4.9 의 이름 변경 표(EQ 페이더 7개)를 화면에 맞춘 이름이다.
// 화면의 'Mid Hz' 가 표의 'MID FREQ' 에 해당한다(뜻이 같아 화면 글자를 그대로 두었다. 기록 L-82).
// 값 표시에는 숫자와 단위 사이에 공백이 없다('70Hz', '1.5dB'): 지금 화면 그대로다.
export const eqSchema: EffectSchema = {
  type: 'eq',
  params: [
    param({ key: 'lowCut', label: 'Low Cut', name: '로우컷 주파수', unit: 'Hz', min: 40, max: 160, step: 1, default: 70, format: fmtRounded('Hz') }),
    param({ key: 'bassGain', label: 'Bass', name: '저음 증감', unit: 'dB', min: -12, max: 12, step: 0.5, default: 1.5, format: (value) => `${value.toFixed(1)}dB` }),
    param({ key: 'midGain', label: 'Mid', name: '중음 증감', unit: 'dB', min: -12, max: 12, step: 0.5, default: -0.5, format: (value) => `${value.toFixed(1)}dB` }),
    param({ key: 'midFreq', label: 'Mid Hz', name: '중음 주파수', unit: 'Hz', min: 250, max: 1500, step: 10, default: 800, format: fmtRounded('Hz') }),
    param({ key: 'midQ', label: 'Mid Q', name: '중음 폭(Q)', unit: '', min: 0.3, max: 4, step: 0.1, default: 0.9, format: (value) => `Q ${value.toFixed(1)}` }),
    param({ key: 'trebleGain', label: 'Treble', name: '고음 증감', unit: 'dB', min: -12, max: 12, step: 0.5, default: 1.8, format: (value) => `${value.toFixed(1)}dB` }),
    param({ key: 'presenceGain', label: 'Presence', name: '프레즌스 증감', unit: 'dB', min: -12, max: 12, step: 0.5, default: 1, format: (value) => `${value.toFixed(1)}dB` }),
    levelParam(100, 200), // 화면 페이더를 0~200 으로 넓혔다: 공장 프리셋 'Solo Boost'(108)를 그릴 수 있고 엔진이 받는 범위와 같다(기록 L-81).
    mixParam(100),
  ],
  choices: [],
  defaultMix: 100,
};

// 안내: 기본값 trebleGain 1.8 은 step 0.5 의 눈금(…1.5, 2.0…)에 놓이지 않는다. 저장된 값과 소리를 그대로 두려고 바꾸지 않았다(기록 L-82).
