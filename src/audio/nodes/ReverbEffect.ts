import { BaseEffect } from './BaseEffect';
import type { PedalState, ReverbParams } from '../types';
import { createImpulseResponse } from '../utils/impulse';
import { smoothParam } from '../utils/smoothing';

export class ReverbEffect extends BaseEffect {
  private readonly convolver: ConvolverNode;
  private readonly tone: BiquadFilterNode;
  private lastDecay = 0;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.convolver = context.createConvolver();
    this.tone = context.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 5600;

    this.effectInput.connect(this.convolver);
    this.convolver.connect(this.tone);
    this.tone.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as ReverbParams;

    if (Math.abs(params.decay - this.lastDecay) > 0.05) {
      this.lastDecay = params.decay;
      this.convolver.buffer = createImpulseResponse(
        this.context,
        Math.max(0.2, params.decay),
        2.2,
      );
    }

    smoothParam(this.tone.frequency, 1500 + params.tone * 8500, this.context);
  }

  override dispose(): void {
    this.convolver.disconnect();
    this.tone.disconnect();
    super.dispose();
  }
}
