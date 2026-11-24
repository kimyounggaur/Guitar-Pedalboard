import type { EffectSchema } from '../types';
import { fmtFixed, fmtPercent, fmtRounded, fmtSlider, levelParam, mixParam, param } from './shared';

// attack·release 는 초로 저장하고 ms 로 보인다. 'Knee' 는 예전 'Tone' 노브를 바로잡은 이름이다(설계서 4.9).
export const compressorSchema: EffectSchema = {
  type: 'compressor',
  params: [
    levelParam(100, 100),
    param({ key: 'knee', label: 'Knee', name: '압축 시작 완만함(dB)', unit: 'dB', min: 0, max: 40, step: 1, default: 18, format: fmtRounded(' dB') }),
    param({ key: 'attack', label: 'Attack', name: '압축이 걸리는 시간(어택)', unit: 'ms', min: 0.001, max: 0.1, step: 0.001, default: 0.006, format: (value) => `${Math.round(value * 1000)} ms` }),
    param({ key: 'sustain', label: 'Sustain', name: '서스테인(여운 보강)', unit: '%', min: 0, max: 100, step: 1, default: 35, format: fmtPercent }),
    param({ key: 'ratio', label: 'Ratio', name: '압축 비율', unit: ':1', min: 1, max: 20, step: 0.5, default: 4, format: fmtFixed(1, ':1') }),
    param({ key: 'threshold', label: 'Threshold', name: '문턱값(압축이 시작되는 세기)', unit: 'dB', min: -60, max: -10, step: 1, default: -24, format: fmtSlider(' dB') }),
    param({ key: 'release', label: 'Release', name: '압축이 풀리는 시간(릴리스)', unit: 'ms', min: 0.05, max: 1, step: 0.01, default: 0.18, format: (value) => `${Math.round(value * 1000)} ms` }),
    mixParam(75),
  ],
  choices: [],
  defaultMix: 75,
};
