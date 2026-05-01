import { BaseEffect } from './BaseEffect';
import type { EQParams, PedalState } from '../types';
import { smoothParam } from '../utils/smoothing';

export class EQEffect extends BaseEffect {
  private readonly lowCut: BiquadFilterNode;
  private readonly bass: BiquadFilterNode;
  private readonly mid: BiquadFilterNode;
  private readonly treble: BiquadFilterNode;
  private readonly presence: BiquadFilterNode;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.lowCut = context.createBiquadFilter();
    this.bass = context.createBiquadFilter();
    this.mid = context.createBiquadFilter();
    this.treble = context.createBiquadFilter();
    this.presence = context.createBiquadFilter();

    this.lowCut.type = 'highpass';
    this.lowCut.Q.value = 0.707;
    this.bass.type = 'lowshelf';
    this.bass.frequency.value = 140;
    this.mid.type = 'peaking';
    this.treble.type = 'highshelf';
    this.treble.frequency.value = 3200;
    this.presence.type = 'peaking';
    this.presence.frequency.value = 5200;
    this.presence.Q.value = 0.8;

    this.effectInput.connect(this.lowCut);
    this.lowCut.connect(this.bass);
    this.bass.connect(this.mid);
    this.mid.connect(this.treble);
    this.treble.connect(this.presence);
    this.presence.connect(this.effectOutput);
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as EQParams;

    smoothParam(this.lowCut.frequency, params.lowCut, this.context);
    smoothParam(this.bass.gain, params.bassGain, this.context);
    smoothParam(this.mid.frequency, params.midFreq, this.context);
    smoothParam(this.mid.gain, params.midGain, this.context);
    smoothParam(this.mid.Q, params.midQ, this.context);
    smoothParam(this.treble.gain, params.trebleGain, this.context);
    smoothParam(this.presence.gain, params.presenceGain, this.context);
  }

  override dispose(): void {
    this.lowCut.disconnect();
    this.bass.disconnect();
    this.mid.disconnect();
    this.treble.disconnect();
    this.presence.disconnect();
    super.dispose();
  }
}
