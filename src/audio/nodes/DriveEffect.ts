import { BaseEffect } from './BaseEffect';
import type { DriveParams, PedalState } from '../types';
import { smoothParam } from '../utils/smoothing';

export class DriveEffect extends BaseEffect {
  private readonly drive: AudioWorkletNode;
  private readonly tone: BiquadFilterNode;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    const params = pedal.params as DriveParams;

    this.drive = new AudioWorkletNode(context, 'drive-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      parameterData: {
        drive: params.drive,
      },
    });
    this.tone = context.createBiquadFilter();
    this.tone.type = 'lowpass';
    this.tone.Q.value = 0.6;

    this.effectInput.connect(this.drive);
    this.drive.connect(this.tone);
    this.tone.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as DriveParams;
    const drive = this.drive.parameters.get('drive');
    const toneFrequency = 900 + params.tone * 8500;

    if (drive) smoothParam(drive, params.drive, this.context);
    smoothParam(this.tone.frequency, toneFrequency, this.context);
  }

  override dispose(): void {
    this.drive.disconnect();
    this.tone.disconnect();
    super.dispose();
  }
}
