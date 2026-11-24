import type { EffectSchema } from '../types';
import { choice, fmtFixed, fmtPercent, levelParam, mixParam, param, percentParam, sameLabelOptions } from './shared';

export const phaserSchema: EffectSchema = {
  type: 'phaser',
  params: [
    param({ key: 'rate', label: 'Rate', name: '속도', unit: 'Hz', min: 0.05, max: 8, step: 0.05, default: 0.5, format: fmtFixed(2, ' Hz') }),
    percentParam('depth', 'Depth', '깊이', 70),
    param({ key: 'feedback', label: 'Feedback', name: '피드백(되먹임)', unit: '%', min: 0, max: 90, step: 1, default: 40, format: fmtPercent }),
    mixParam(45),
    levelParam(100, 200),
  ],
  // 단 수는 화면에서 '4 / 6 / 8 / 12' 버튼으로 고른다.
  choices: [choice({ key: 'stages', label: '단 수', name: '페이저 단 수', kind: 'enum', options: sameLabelOptions([4, 6, 8, 12]), default: 6 })],
  defaultMix: 45,
};
