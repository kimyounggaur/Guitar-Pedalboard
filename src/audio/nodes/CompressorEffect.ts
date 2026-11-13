import { BaseEffect } from './BaseEffect';
import type { CompressorParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';

export class CompressorEffect extends BaseEffect {
  private readonly compressor: DynamicsCompressorNode;
  private readonly dryDelay: DelayNode;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.compressor = context.createDynamicsCompressor();
    // DynamicsCompressorNode uses a 6 ms look-ahead. Match the parallel dry
    // path to avoid phase cancellation when Mix is between 0 and 100 percent.
    this.dryDelay = context.createDelay(0.01);
    this.dryDelay.delayTime.value = 0.006;
    this.effectGate.disconnect(this.dryGain);
    this.effectGate.connect(this.dryDelay);
    this.dryDelay.connect(this.dryGain);

    this.effectInput.connect(this.compressor);
    this.compressor.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as CompressorParams;
    const sustainAmount = clamp(params.sustain / 100, 0, 1);
    const threshold = clamp(params.threshold - sustainAmount * 18, -60, -10);
    const ratio = clamp(params.ratio + sustainAmount * 8, 1, 20);

    smoothParam(this.compressor.threshold, threshold, this.context);
    smoothParam(this.compressor.ratio, ratio, this.context);
    smoothParam(this.compressor.attack, params.attack, this.context);
    smoothParam(this.compressor.release, params.release, this.context);
    smoothParam(this.compressor.knee, params.knee, this.context);
  }

  /** Actual gain reduction in dB, as reported by the Web Audio compressor. */
  getGainReduction(): number {
    return this.compressor.reduction;
  }

  override dispose(): void {
    this.compressor.disconnect();
    this.dryDelay.disconnect();
    super.dispose();
  }
}
