import { BaseEffect } from './BaseEffect';
import type { CabParams, PedalState } from '../types';
import { createCabinetImpulse } from '../utils/cabinet';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';

function finiteParam(value: number, fallback: number, min: number, max: number): number {
  return Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

export class CabEffect extends BaseEffect {
  private readonly lowCut: BiquadFilterNode;
  private readonly convolver: ConvolverNode;
  private readonly convolvedGain: GainNode;
  private readonly bypassGain: GainNode;
  private readonly highCut: BiquadFilterNode;
  private readonly presence: BiquadFilterNode;
  private lastModel: CabParams['model'] | null = null;
  private lastMicPosition = Number.NaN;
  private lastDistance = Number.NaN;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);

    this.lowCut = context.createBiquadFilter();
    this.convolver = context.createConvolver();
    this.convolvedGain = context.createGain();
    this.bypassGain = context.createGain();
    this.highCut = context.createBiquadFilter();
    this.presence = context.createBiquadFilter();

    this.lowCut.type = 'highpass';
    this.lowCut.Q.value = 0.707;
    this.convolvedGain.gain.value = 0;
    this.bypassGain.gain.value = 1;
    this.highCut.type = 'lowpass';
    this.highCut.Q.value = 0.707;
    this.presence.type = 'peaking';
    this.presence.frequency.value = 4000;
    this.presence.Q.value = 0.8;

    this.effectInput.connect(this.lowCut);
    this.lowCut.connect(this.convolver);
    this.convolver.connect(this.convolvedGain);
    this.convolvedGain.connect(this.highCut);
    this.lowCut.connect(this.bypassGain);
    this.bypassGain.connect(this.highCut);
    this.highCut.connect(this.presence);
    this.presence.connect(this.effectOutput);

    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as CabParams;
    const micPosition = finiteParam(params.micPosition, 55, 0, 100);
    const distance = finiteParam(params.distance, 30, 0, 100);

    smoothParam(this.lowCut.frequency, finiteParam(params.lowCut, 85, 40, 200), this.context);
    smoothParam(this.highCut.frequency, finiteParam(params.highCut, 5400, 3000, 12000), this.context);
    smoothParam(this.presence.gain, finiteParam(params.presence, 1.5, -6, 6), this.context);

    if (params.model === 'off') {
      smoothParam(this.convolvedGain.gain, 0, this.context);
      smoothParam(this.bypassGain.gain, 1, this.context);
      this.lastModel = params.model;
      this.lastMicPosition = micPosition;
      this.lastDistance = distance;
      return;
    }

    if (
      params.model !== this.lastModel ||
      micPosition !== this.lastMicPosition ||
      distance !== this.lastDistance
    ) {
      this.convolver.buffer = createCabinetImpulse(
        this.context,
        params.model,
        micPosition,
        distance,
      );
      this.lastModel = params.model;
      this.lastMicPosition = micPosition;
      this.lastDistance = distance;
    }

    smoothParam(this.convolvedGain.gain, 1, this.context);
    smoothParam(this.bypassGain.gain, 0, this.context);
  }

  override dispose(): void {
    this.lowCut.disconnect();
    this.convolver.disconnect();
    this.convolvedGain.disconnect();
    this.bypassGain.disconnect();
    this.highCut.disconnect();
    this.presence.disconnect();
    super.dispose();
  }
}
