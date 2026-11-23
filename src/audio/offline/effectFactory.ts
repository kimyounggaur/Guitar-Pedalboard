// 페달 상태 → 이펙트 클래스. AudioEngine.createEffect()와 같은 대응이다.
// PedalType 이 늘어나면 아래 switch 의 `satisfies never` 가 컴파일 오류로 알려 준다.
import { AutoWahEffect } from '../nodes/AutoWahEffect';
import { CabEffect } from '../nodes/CabEffect';
import { ChorusEffect } from '../nodes/ChorusEffect';
import { CompressorEffect } from '../nodes/CompressorEffect';
import { CrunchEffect } from '../nodes/CrunchEffect';
import { DelayEffect } from '../nodes/DelayEffect';
import { DriveEffect } from '../nodes/DriveEffect';
import { EQEffect } from '../nodes/EQEffect';
import { FlangerEffect } from '../nodes/FlangerEffect';
import { FuzzEffect } from '../nodes/FuzzEffect';
import { GraphicEQEffect } from '../nodes/GraphicEQEffect';
import { NoiseGateEffect } from '../nodes/NoiseGateEffect';
import { PhaserEffect } from '../nodes/PhaserEffect';
import { ReverbEffect } from '../nodes/ReverbEffect';
import { TremoloEffect } from '../nodes/TremoloEffect';
import type { EffectNodeWrapper, PedalState } from '../types';
import type { ImpulseCache } from '../utils/impulseCache';

export function createOfflineEffect(
  context: BaseAudioContext,
  pedal: PedalState,
  impulseCache: ImpulseCache,
): EffectNodeWrapper {
  switch (pedal.type) {
    case 'noiseGate':
      return new NoiseGateEffect(context, pedal);
    case 'compressor':
      return new CompressorEffect(context, pedal);
    case 'autoWah':
      return new AutoWahEffect(context, pedal);
    case 'drive':
      return new DriveEffect(context, pedal);
    case 'crunch':
      return new CrunchEffect(context, pedal);
    case 'fuzz':
      return new FuzzEffect(context, pedal);
    case 'graphicEQ':
      return new GraphicEQEffect(context, pedal);
    case 'eq':
      return new EQEffect(context, pedal);
    case 'cab':
      return new CabEffect(context, pedal);
    case 'chorus':
      return new ChorusEffect(context, pedal);
    case 'flanger':
      return new FlangerEffect(context, pedal);
    case 'phaser':
      return new PhaserEffect(context, pedal);
    case 'tremolo':
      return new TremoloEffect(context, pedal);
    case 'delay':
      return new DelayEffect(context, pedal);
    case 'reverb':
      return new ReverbEffect(context, pedal, impulseCache);
    default:
      throw new Error(`알 수 없는 이펙터 타입입니다: ${pedal.type satisfies never}`);
  }
}
