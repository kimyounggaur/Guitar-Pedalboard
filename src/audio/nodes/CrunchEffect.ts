import { BaseEffect } from './BaseEffect';
import type { CrunchParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { createCrunchCurve } from '../utils/curves';
import { smoothParam } from '../utils/smoothing';

export class CrunchEffect extends BaseEffect {
  private readonly preGain: GainNode;
  private readonly lowCut: BiquadFilterNode;
  private readonly shaper: WaveShaperNode;
  private readonly tone: BiquadFilterNode;
  private readonly presence: BiquadFilterNode;
  private readonly volumeGain: GainNode;
  private lastGain = -1;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);

    this.preGain = context.createGain();
    this.lowCut = context.createBiquadFilter();
    this.shaper = context.createWaveShaper();
    this.tone = context.createBiquadFilter();
    this.presence = context.createBiquadFilter();
    this.volumeGain = context.createGain();

    this.lowCut.type = 'highpass';
    this.lowCut.Q.value = 0.72;
    this.shaper.oversample = '4x';
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.78;
    this.presence.type = 'peaking';
    this.presence.frequency.value = 3800;
    this.presence.Q.value = 0.9;

    this.effectInput.connect(this.preGain);
    this.preGain.connect(this.lowCut);
    this.lowCut.connect(this.shaper);
    this.shaper.connect(this.tone);
    this.tone.connect(this.presence);
    this.presence.connect(this.volumeGain);
    this.volumeGain.connect(this.effectOutput);

    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as CrunchParams;

    if (Math.abs(params.gain - this.lastGain) > 0.5) {
      this.lastGain = params.gain;
      this.shaper.curve = createCrunchCurve(params.gain);
    }

    const preGain = 1 + (params.gain / 100) * 22;
    const toneFrequency = 1200 + (params.tone / 100) * 9400;
    const presenceFrequency = 3000 + (params.presence / 100) * 2200;
    const presenceGain = -3 + (params.presence / 100) * 9;
    const volume = clamp(params.volume / 100, 0, 1.6);

    smoothParam(this.preGain.gain, preGain, this.context);
    smoothParam(this.lowCut.frequency, params.lowCut, this.context);
    smoothParam(this.tone.frequency, toneFrequency, this.context);
    smoothParam(this.presence.frequency, presenceFrequency, this.context);
    smoothParam(this.presence.gain, presenceGain, this.context);
    smoothParam(this.volumeGain.gain, volume, this.context);
  }

  override dispose(): void {
    this.preGain.disconnect();
    this.lowCut.disconnect();
    this.shaper.disconnect();
    this.tone.disconnect();
    this.presence.disconnect();
    this.volumeGain.disconnect();
    super.dispose();
  }
}
