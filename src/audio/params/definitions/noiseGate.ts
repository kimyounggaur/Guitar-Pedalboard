import type { EffectSchema } from '../types';
import { fmtRounded, fmtSlider, levelParam, mixParam, param } from './shared';

// 화면의 노브 3개(Threshold·Decay·간격)와 아래 슬라이더 5개(Reduction·Attack·Hold·Mix·Level).
// 'Decay' 가 가리키는 저장 키는 releaseMs, '간격' 은 hysteresisDb 다(설계서 4.9 의 HYST: 예전 이름 'Mode' 를 바로잡은 것).
export const noiseGateSchema: EffectSchema = {
  type: 'noiseGate',
  params: [
    param({ key: 'thresholdDb', label: 'Threshold', name: '문턱값(게이트가 열리는 세기)', unit: 'dB', min: -80, max: -20, step: 1, default: -54, format: fmtRounded(' dB') }),
    param({ key: 'releaseMs', label: 'Decay', name: '닫히는 시간(릴리스)', unit: 'ms', min: 20, max: 1000, step: 10, default: 180, format: fmtRounded(' ms') }),
    param({ key: 'hysteresisDb', label: '간격', name: '열림·닫힘 간격(dB)', unit: 'dB', min: 0, max: 10, step: 0.5, default: 4, format: (value) => `${Number(value.toFixed(1))} dB` }),
    param({ key: 'reductionDb', label: 'Reduction', name: '닫혔을 때 줄이는 크기', unit: 'dB', min: -80, max: 0, step: 1, default: -80, format: fmtSlider(' dB') }),
    param({ key: 'attackMs', label: 'Attack', name: '열리는 시간(어택)', unit: 'ms', min: 1, max: 50, step: 1, default: 6, format: fmtSlider(' ms') }),
    param({ key: 'holdMs', label: 'Hold', name: '열린 채로 버티는 시간', unit: 'ms', min: 0, max: 300, step: 5, default: 70, format: fmtSlider(' ms') }),
    mixParam(100),
    levelParam(100, 100),
  ],
  choices: [],
  defaultMix: 100,
};
