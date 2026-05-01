import { BaseEffect } from './BaseEffect';
import type { DelayParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';

const divisionBeats: Record<DelayParams['division'], number> = {
  '1/4': 1,
  '1/8': 0.5,
  'dotted1/8': 0.75,
  '1/16': 0.25,
};

export class DelayEffect extends BaseEffect {
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly flutter: OscillatorNode;
  private readonly flutterDepth: GainNode;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.delay = context.createDelay(2);
    this.feedback = context.createGain();
    this.tone = context.createBiquadFilter();
    this.flutter = context.createOscillator();
    this.flutterDepth = context.createGain();

    this.tone.type = 'lowpass';
    this.tone.frequency.value = 6500;
    this.flutter.type = 'sine';
    this.flutter.frequency.value = 4.6;
    this.flutterDepth.gain.value = 0;

    this.effectInput.connect(this.delay);
    this.delay.connect(this.effectOutput);
    this.delay.connect(this.tone);
    this.tone.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.flutter.connect(this.flutterDepth);
    this.flutterDepth.connect(this.delay.delayTime);
    this.flutter.start();
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as DelayParams;
    const delayTime = this.getDelayTime(params);
    const feedback = params.mode === 'slapback' ? Math.min(params.feedback, 0.22) : params.feedback;
    const toneMax = params.mode === 'analog' ? 5200 : params.mode === 'tape' ? 4200 : 9500;
    const toneMin = params.mode === 'analog' ? 700 : 1100;

    smoothParam(this.delay.delayTime, delayTime, this.context);
    smoothParam(this.feedback.gain, clamp(feedback, 0, 0.95), this.context);
    smoothParam(this.tone.frequency, toneMin + (params.tone / 100) * (toneMax - toneMin), this.context);
    smoothParam(this.flutterDepth.gain, params.mode === 'tape' ? 0.006 : 0, this.context);
    smoothParam(this.flutter.frequency, params.mode === 'tape' ? 4.2 : 0.1, this.context);
  }

  private getDelayTime(params: DelayParams): number {
    if (params.mode === 'slapback') return clamp(params.timeMs / 1000, 0.02, 0.14);
    if (!params.sync) return clamp(params.timeMs / 1000, 0.02, 2);

    const secondsPerBeat = 60 / clamp(params.bpm, 40, 240);
    return clamp(secondsPerBeat * divisionBeats[params.division], 0.02, 2);
  }

  override dispose(): void {
    this.flutter.stop();
    this.delay.disconnect();
    this.feedback.disconnect();
    this.tone.disconnect();
    this.flutter.disconnect();
    this.flutterDepth.disconnect();
    super.dispose();
  }
}
