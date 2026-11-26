import { BaseEffect } from './BaseEffect';
import { isFeatureEnabled } from '../../config/flags';
import type { CompressorParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';

function safe(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

export class CompressorEffect extends BaseEffect {
  /** 워클릿 경로: 1 = 옛 경로(피크 검출기·자동 메이크업), 2 = 새 경로(RMS 검출기·수동 메이크업만, 기능 플래그 newCompressor, S3.6). */
  readonly engineVersion: 1 | 2;
  private readonly compressor: AudioWorkletNode;
  private reduction = 0;
  private disposed = false;

  constructor(context: BaseAudioContext, pedal: PedalState) {
    super(context, pedal);
    // 플래그는 이펙트를 만들 때 한 번 읽는다. 바꾸려면 페이지를 새로 연다(src/config/flags.ts).
    this.engineVersion = isFeatureEnabled('newCompressor') ? 2 : 1;
    this.compressor = new AudioWorkletNode(context, 'compressor-processor', {
      numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [2],
      processorOptions: { version: this.engineVersion, detector: 'rms' },
    });
    this.compressor.port.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data as { type?: unknown; value?: unknown } | null;
      if (message?.type === 'reduction' && typeof message.value === 'number' && Number.isFinite(message.value)) {
        this.reduction = Math.min(0, message.value);
      }
    };
    this.effectInput.connect(this.compressor);
    this.compressor.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as CompressorParams;
    const sustain = safe(params.sustain, 0, 0, 100) / 100;
    this.setParam('threshold', clamp(safe(params.threshold, -30, -60, -10) - sustain * 18, -60, -10));
    this.setParam('ratio', clamp(safe(params.ratio, 4, 1, 20) + sustain * 8, 1, 20));
    this.setParam('attack', safe(params.attack, .003, .001, .1));
    this.setParam('release', safe(params.release, .2, .05, 1));
    this.setParam('knee', safe(params.knee, 20, 0, 40));
  }

  private setParam(name: string, value: number): void {
    const param = this.compressor.parameters.get(name);
    if (param) smoothParam(param, value, this.context);
  }

  getGainReduction(): number {
    return this.reduction;
  }

  override dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.compressor.port.onmessage = null;
    this.compressor.port.postMessage({ type: 'dispose' });
    this.compressor.disconnect();
    super.dispose();
  }
}
