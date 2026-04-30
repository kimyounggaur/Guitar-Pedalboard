import { BaseEffect } from './BaseEffect';
import type { DelayParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';

export class DelayEffect extends BaseEffect {
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly tone: BiquadFilterNode;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.delay = context.createDelay(1.5);
    this.feedback = context.createGain();
    this.tone = context.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.frequency.value = 4200;

    this.effectInput.connect(this.delay);
    this.delay.connect(this.tone);
    this.tone.connect(this.effectOutput);
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as DelayParams;

    smoothParam(this.delay.delayTime, params.time, this.context);
    smoothParam(this.feedback.gain, clamp(params.feedback, 0, 0.88), this.context);
    smoothParam(this.tone.frequency, 1200 + params.tone * 7200, this.context);
  }

  override dispose(): void {
    this.delay.disconnect();
    this.feedback.disconnect();
    this.tone.disconnect();
    super.dispose();
  }
}
