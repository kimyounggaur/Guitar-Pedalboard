import { BaseEffect } from './BaseEffect';
import type { CompressorParams, PedalState } from '../types';
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

    smoothParam(this.compressor.threshold, params.threshold, this.context);
    smoothParam(this.compressor.ratio, params.ratio, this.context);
    smoothParam(this.compressor.attack, params.attack, this.context);
    smoothParam(this.compressor.release, params.release, this.context);
  }

  override dispose(): void {
    this.compressor.disconnect();
    super.dispose();
  }
}
