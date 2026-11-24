import type { EffectSchema } from '../types';
import { choice, fmtFixed, levelParam, mixParam, param, percentParam, sameLabelOptions } from './shared';

// 'BPM' 슬라이더는 앱 전체 템포(탭 템포와 같은 값)를 움직이고, Sync 가 켜진 페달의 bpm 저장값에 반영된다.
export const tremoloSchema: EffectSchema = {
  type: 'tremolo',
  params: [
    param({ key: 'rate', label: 'Rate', name: '속도', unit: 'Hz', min: 0.5, max: 20, step: 0.1, default: 5, format: fmtFixed(1, ' Hz') }),
    percentParam('depth', 'Depth', '깊이', 50),
    mixParam(100),
    levelParam(100, 200),
    param({ key: 'bpm', label: 'BPM', name: '템포(분당 박자 수)', unit: '', min: 40, max: 240, step: 1, default: 120, format: (value) => `${value}` }),
  ],
  choices: [
    choice({ key: 'shape', label: 'Shape', name: '파형', kind: 'enum', options: sameLabelOptions(['sine', 'triangle', 'square']), default: 'sine' }),
    choice({ key: 'sync', label: 'Sync', name: '템포에 맞추기', kind: 'boolean', default: false }),
    choice({
      key: 'division',
      label: 'Division',
      name: '음표 단위',
      kind: 'enum',
      options: [
        { value: '1/4', label: '1/4' },
        { value: '1/8', label: '1/8' },
        { value: 'dotted1/8', label: 'Dotted 1/8' },
        { value: '1/16', label: '1/16' },
      ],
      default: '1/8',
    }),
  ],
  defaultMix: 100,
};
