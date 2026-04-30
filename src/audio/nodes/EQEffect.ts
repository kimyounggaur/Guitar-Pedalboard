import { BaseEffect } from './BaseEffect';
import type { EQParams, PedalState } from '../types';
import { smoothParam } from '../utils/smoothing';

export class EQEffect extends BaseEffect {
  private readonly low: BiquadFilterNode;
  private readonly mid: BiquadFilterNode;
  private readonly high: BiquadFilterNode;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.low = context.createBiquadFilter();
    this.mid = context.createBiquadFilter();
    this.high = context.createBiquadFilter();

    this.low.type = 'lowshelf';
    this.low.frequency.value = 140;
    this.mid.type = 'peaking';
    this.mid.frequency.value = 850;
    this.mid.Q.value = 0.9;
    this.high.type = 'highshelf';
    this.high.frequency.value = 3200;

    this.effectInput.connect(this.low);
    this.low.connect(this.mid);
    this.mid.connect(this.high);
    this.high.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as EQParams;

    smoothParam(this.low.gain, params.low, this.context);
    smoothParam(this.mid.gain, params.mid, this.context);
    smoothParam(this.high.gain, params.high, this.context);
  }

  override dispose(): void {
    this.low.disconnect();
    this.mid.disconnect();
    this.high.disconnect();
    super.dispose();
  }
}
