import { BaseEffect } from './BaseEffect';
import type { CompressorParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';

export class CompressorEffect extends BaseEffect {
  private readonly compressor: DynamicsCompressorNode;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.compressor = context.createDynamicsCompressor();

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

  override dispose(): void {
    this.compressor.disconnect();
    super.dispose();
  }
}
