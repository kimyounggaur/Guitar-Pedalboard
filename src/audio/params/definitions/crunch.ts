import type { EffectSchema } from '../types';
import { choice, fmtSlider, levelParam, mixParam, param, percentParam, sameLabelOptions } from './shared';

// mode 는 'crunch' 하나뿐이고 화면에 조절기가 없다(hidden). 저장 형식에는 남아 있으므로 정의만 둔다.
export const crunchSchema: EffectSchema = {
  type: 'crunch',
  params: [
    percentParam('volume', 'Vol.', '볼륨(앰프 마스터)', 80),
    percentParam('tone', 'Tone', '톤(밝기)', 55),
    percentParam('gain', 'Gain', '게인(왜곡 세기)', 55),
    percentParam('presence', 'Presence', '프레즌스(고음 선명도)', 45),
    param({ key: 'lowCut', label: 'Low Cut', name: '로우컷 주파수', unit: 'Hz', min: 40, max: 180, step: 1, default: 80, format: fmtSlider(' Hz') }),
    mixParam(85),
    levelParam(90, 100),
  ],
  choices: [choice({ key: 'mode', label: 'Mode', name: '왜곡 방식', kind: 'enum', options: sameLabelOptions(['crunch']), default: 'crunch', hidden: true })],
  defaultMix: 85,
};
