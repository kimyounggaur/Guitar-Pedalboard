import type { EffectSchema } from '../types';
import { choice, levelParam, mixParam, percentParam, sameLabelOptions } from './shared';

export const autoWahSchema: EffectSchema = {
  type: 'autoWah',
  params: [
    percentParam('sensitivity', 'Sensitivity', '감도(연주 세기에 반응하는 정도)', 55),
    percentParam('range', 'Range', '움직이는 범위', 60),
    percentParam('resonance', 'Resonance', '공명(필터 날카로움)', 45),
    percentParam('manual', 'Manual', '수동 위치(수동 모드의 필터 위치)', 50),
    mixParam(100),
    levelParam(100, 200),
  ],
  choices: [choice({ key: 'mode', label: 'Mode', name: '동작 방식', kind: 'enum', options: sameLabelOptions(['auto', 'manual']), default: 'auto' })],
  defaultMix: 100,
};
