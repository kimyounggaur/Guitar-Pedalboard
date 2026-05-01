import { BaseEffect } from './BaseEffect';
import type { DriveParams, PedalState } from '../types';
import { createDriveCurve } from '../utils/curves';
import { smoothParam } from '../utils/smoothing';

export class DriveEffect extends BaseEffect {
  private readonly shaper: WaveShaperNode;
  private readonly tone: BiquadFilterNode;
  private lastMode: DriveParams['mode'] | null = null;
  private lastDrive = -1;
  private lastBias = 99;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.shaper = context.createWaveShaper();
    this.shaper.oversample = '4x';
    this.tone = context.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.7;

    this.effectInput.connect(this.shaper);
    this.shaper.connect(this.tone);
    this.tone.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as DriveParams;

    if (
      params.mode !== this.lastMode ||
      Math.abs(params.drive - this.lastDrive) > 0.5 ||
      Math.abs(params.bias - this.lastBias) > 0.02
    ) {
      this.lastMode = params.mode;
      this.lastDrive = params.drive;
      this.lastBias = params.bias;
      this.shaper.curve = createDriveCurve(params.mode, params.drive, params.bias);
    }

    const toneFrequency = 700 + (params.tone / 100) * 9800;
    smoothParam(this.tone.frequency, toneFrequency, this.context);
  }

  override dispose(): void {
    this.shaper.disconnect();
    this.tone.disconnect();
    super.dispose();
  }
}
