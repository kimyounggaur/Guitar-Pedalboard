// 프로브 전용: 오디오 노드가 새로 만들어진 횟수를 센다(P-23 '새 노드 0'). 앱 코드에는 들어가지 않는다.
// 생성자(new GainNode(...))와 팩토리 메서드(context.createGain())를 모두 감싼다.
import type { NodeCounter } from './probes';

const NODE_CONSTRUCTORS = [
  'AudioWorkletNode',
  'GainNode',
  'BiquadFilterNode',
  'DelayNode',
  'WaveShaperNode',
  'ConvolverNode',
  'OscillatorNode',
  'AudioBufferSourceNode',
  'ChannelSplitterNode',
  'ChannelMergerNode',
  'DynamicsCompressorNode',
  'StereoPannerNode',
  'AnalyserNode',
  'ConstantSourceNode',
  'IIRFilterNode',
  'PannerNode',
] as const;

const FACTORY_METHODS = [
  'createGain',
  'createBiquadFilter',
  'createDelay',
  'createWaveShaper',
  'createConvolver',
  'createOscillator',
  'createBufferSource',
  'createChannelSplitter',
  'createChannelMerger',
  'createDynamicsCompressor',
  'createStereoPanner',
  'createAnalyser',
  'createConstantSource',
  'createIIRFilter',
  'createPanner',
] as const;

type NodeConstructor = new (...args: unknown[]) => object;

export function installNodeCounter(): NodeCounter {
  const counter: NodeCounter = { count: 0 };

  const globals = window as unknown as Record<string, unknown>;
  for (const name of NODE_CONSTRUCTORS) {
    const Original = globals[name] as NodeConstructor | undefined;
    if (!Original) continue;
    globals[name] = class extends Original {
      constructor(...args: unknown[]) {
        super(...args);
        counter.count += 1;
      }
    };
  }

  const prototype = BaseAudioContext.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
  for (const name of FACTORY_METHODS) {
    const original = prototype[name];
    if (typeof original !== 'function') continue;
    prototype[name] = function countedFactory(this: unknown, ...args: unknown[]): unknown {
      counter.count += 1;
      return original.apply(this, args);
    };
  }

  return counter;
}
