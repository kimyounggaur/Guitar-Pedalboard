import type { EffectSchema, ParamDef } from '../types';
import { fmtPercent, fmtSignedDb, param } from './shared';

// 7밴드. 슬라이더의 접근 가능한 이름은 '100 Hz', '1.6k Hz' 처럼 중심 주파수 + Hz 다.
const bands: readonly [key: string, label: string, hz: number][] = [
  ['band100', '100 Hz', 100],
  ['band200', '200 Hz', 200],
  ['band400', '400 Hz', 400],
  ['band800', '800 Hz', 800],
  ['band1600', '1.6k Hz', 1600],
  ['band3200', '3.2k Hz', 3200],
  ['band6400', '6.4k Hz', 6400],
];

const bandParams: ParamDef[] = bands.map(([key, label, hz]) =>
  param({ key, label, name: `${hz} Hz 대역 증감`, unit: 'dB', min: -12, max: 12, step: 0.5, default: 0, format: fmtSignedDb }),
);

export const graphicEQSchema: EffectSchema = {
  type: 'graphicEQ',
  params: [
    ...bandParams,
    param({ key: 'mix', label: 'Graphic EQ Mix', name: '믹스(원음과 섞는 비율)', unit: '%', min: 0, max: 100, step: 1, default: 100, format: fmtPercent }),
    param({ key: 'level', label: 'Graphic EQ Level', name: '출력 레벨', unit: '%', min: 0, max: 200, step: 1, default: 100, format: fmtPercent }),
  ],
  choices: [],
  defaultMix: 100,
};
