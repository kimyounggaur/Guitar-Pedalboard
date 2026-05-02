import { BaseEffect } from './BaseEffect';
import type { FuzzParams, PedalState } from '../types';
import { createFuzzCurve } from '../utils/curves';
import { smoothParam } from '../utils/smoothing';

export class FuzzEffect extends BaseEffect {
  private readonly preGain: GainNode;
  private readonly lowCut: BiquadFilterNode;
  private readonly shaper: WaveShaperNode;
  private readonly tone: BiquadFilterNode;
  private readonly gateTrim: GainNode;
  private lastMode: FuzzParams['mode'] | null = null;
  private lastFuzz = -1;
  private lastBias = -1;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);

    this.preGain = context.createGain();
    this.lowCut = context.createBiquadFilter();
    this.shaper = context.createWaveShaper();
    this.tone = context.createBiquadFilter();
    this.gateTrim = context.createGain();

    this.lowCut.type = 'highpass';
    this.lowCut.Q.value = 0.82;
    this.shaper.oversample = '4x';
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.9;

    this.effectInput.connect(this.preGain);
    this.preGain.connect(this.lowCut);
    this.lowCut.connect(this.shaper);
    this.shaper.connect(this.tone);
    this.tone.connect(this.gateTrim);
    this.gateTrim.connect(this.effectOutput);

    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as FuzzParams;

    if (
      params.mode !== this.lastMode ||
      Math.abs(params.fuzz - this.lastFuzz) > 0.5 ||
      Math.abs(params.bias - this.lastBias) > 0.5
    ) {
      this.lastMode = params.mode;
      this.lastFuzz = params.fuzz;
      this.lastBias = params.bias;
      this.shaper.curve = createFuzzCurve(params.mode, params.fuzz, params.bias);
    }

    const preGain = 1.8 + (params.fuzz / 100) * 32;
    const toneFrequency = 700 + (params.tone / 100) * 8200;
    const gateTrim = Math.max(0.28, 1 - (params.gate / 100) * 0.55);

    smoothParam(this.preGain.gain, preGain, this.context);
    smoothParam(this.lowCut.frequency, params.lowCut, this.context);
    smoothParam(this.tone.frequency, toneFrequency, this.context);
    smoothParam(this.gateTrim.gain, gateTrim, this.context);
  }

  override dispose(): void {
    this.preGain.disconnect();
    this.lowCut.disconnect();
    this.shaper.disconnect();
    this.tone.disconnect();
    this.gateTrim.disconnect();
    super.dispose();
  }
}
