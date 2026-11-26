import type { EffectSchema } from '../types';
import { choice, fmtFixed, levelParam, mixParam, param, percentParam, sameLabelOptions } from './shared';

export const chorusSchema: EffectSchema = {
  type: 'chorus',
  params: [
    param({ key: 'rate', label: 'Rate', name: '속도', unit: 'Hz', min: 0.1, max: 8, step: 0.1, default: 0.8, format: fmtFixed(1, ' Hz') }),
    percentParam('depth', 'Depth', '깊이', 45),
    percentParam('spread', 'Spread', '스테레오 퍼짐', 60),
    percentParam('tone', 'Tone', '톤(밝기)', 60),
    mixParam(35),
    levelParam(100, 200),
  ],
  // 목소리 수는 화면에서 '2 / 3 / 4' 버튼으로 고른다.
  choices: [choice({ key: 'voices', label: '목소리 수', name: '코러스 목소리 수', kind: 'enum', options: sameLabelOptions([2, 3, 4]), default: 3 })],
  defaultMix: 35,
};
