import type { EffectSchema } from '../types';
import { fmtFixed, levelParam, mixParam, param, percentParam } from './shared';

/** 부호를 붙인 퍼센트: 60 → '+60%', 0 → '0%', -20 → '-20%' */
const signedPercent = (value: number): string => {
  const rounded = Math.round(value);
  return `${rounded > 0 ? '+' : ''}${rounded}%`;
};

export const flangerSchema: EffectSchema = {
  type: 'flanger',
  params: [
    param({ key: 'rate', label: 'Rate', name: '속도', unit: 'Hz', min: 0.05, max: 5, step: 0.05, default: 0.25, format: fmtFixed(2, ' Hz') }),
    percentParam('depth', 'Depth', '깊이', 55),
    param({ key: 'feedback', label: 'Feedback', name: '피드백(되먹임)', unit: '%', min: -95, max: 95, step: 1, default: 60, format: signedPercent }),
    param({ key: 'manual', label: 'Manual', name: '기준 지연 시간', unit: 'ms', min: 0.5, max: 10, step: 0.1, default: 2, format: fmtFixed(1, ' ms') }),
    mixParam(35),
    levelParam(100, 200),
  ],
  choices: [],
  defaultMix: 35,
};
