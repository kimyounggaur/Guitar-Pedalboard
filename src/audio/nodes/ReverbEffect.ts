import { BaseEffect } from './BaseEffect';
import type { PedalState, ReverbParams } from '../types';
import { createImpulseResponse } from '../utils/impulse';
import { smoothParam } from '../utils/smoothing';

export class ReverbEffect extends BaseEffect {
  private readonly preDelay: DelayNode;
  private readonly convolver: ConvolverNode;
  private readonly lowCut: BiquadFilterNode;
  private readonly highCut: BiquadFilterNode;
  private lastDecay = 0;
  private lastMode: ReverbParams['mode'] | null = null;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.preDelay = context.createDelay(0.25);
    this.convolver = context.createConvolver();
    this.lowCut = context.createBiquadFilter();
    this.highCut = context.createBiquadFilter();

    this.lowCut.type = 'highpass';
    this.highCut.type = 'lowpass';

    this.effectInput.connect(this.preDelay);
    this.preDelay.connect(this.convolver);
    this.convolver.connect(this.lowCut);
    this.lowCut.connect(this.highCut);
    this.highCut.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as ReverbParams;

    if (Math.abs(params.decay - this.lastDecay) > 0.05 || params.mode !== this.lastMode) {
      this.lastDecay = params.decay;
      this.lastMode = params.mode;
      this.convolver.buffer = createImpulseResponse(this.context, Math.max(0.2, params.decay), params.mode);
    }

    smoothParam(this.preDelay.delayTime, params.preDelay / 1000, this.context);
    smoothParam(this.lowCut.frequency, params.lowCut, this.context);
    smoothParam(this.highCut.frequency, params.highCut, this.context);
  }

  override dispose(): void {
    this.preDelay.disconnect();
    this.convolver.disconnect();
    this.lowCut.disconnect();
    this.highCut.disconnect();
    super.dispose();
  }
}
