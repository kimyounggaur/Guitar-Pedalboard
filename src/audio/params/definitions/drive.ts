import { DRIVE_BIAS_LIMIT } from '../../utils/curves';
import type { EffectSchema } from '../types';
import { choice, fmtFixed, levelParam, mixParam, param, percentParam } from './shared';

export const driveSchema: EffectSchema = {
  type: 'drive',
  params: [
    percentParam('drive', 'Drive', '드라이브(왜곡 세기)', 42),
    percentParam('tone', 'Tone', '톤(밝기)', 55),
    levelParam(95, 100),
    mixParam(88),
    param({ key: 'bias', label: 'Bias', name: '바이어스(비대칭 정도)', unit: '', min: -DRIVE_BIAS_LIMIT, max: DRIVE_BIAS_LIMIT, step: 0.01, default: 0.08, format: fmtFixed(2, '') }),
  ],
  choices: [
    choice({
      key: 'mode',
      label: 'Mode',
      name: '왜곡 방식',
      kind: 'enum',
      options: [
        { value: 'overdrive', label: 'Overdrive' },
        { value: 'crunch', label: 'Crunch' },
        { value: 'distortion', label: 'Distortion' },
        { value: 'fuzz', label: 'Fuzz' },
      ],
      default: 'overdrive',
    }),
  ],
  defaultMix: 88,
};
