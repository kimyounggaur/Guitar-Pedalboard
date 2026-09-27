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
  private readonly monoPathGain: GainNode;
  private readonly pingPongPathGain: GainNode;
  private readonly pingPongLeftDelay: DelayNode;
  private readonly pingPongRightDelay: DelayNode;
  private readonly pingPongLeftPanner: StereoPannerNode;
  private readonly pingPongRightPanner: StereoPannerNode;
  private readonly pingPongLeftTone: BiquadFilterNode;
  private readonly pingPongRightTone: BiquadFilterNode;
  private readonly pingPongLeftFeedback: GainNode;
  private readonly pingPongRightFeedback: GainNode;

  constructor(context: AudioContext, pedal: PedalState) {
    super(context, pedal);
    this.delay = context.createDelay(2);
    this.feedback = context.createGain();
    this.tone = context.createBiquadFilter();
    this.flutter = context.createOscillator();
    this.flutterDepth = context.createGain();
    this.monoPathGain = context.createGain();
    this.pingPongPathGain = context.createGain();
    this.pingPongLeftDelay = context.createDelay(2);
    this.pingPongRightDelay = context.createDelay(2);
    this.pingPongLeftPanner = context.createStereoPanner();
    this.pingPongRightPanner = context.createStereoPanner();
    this.pingPongLeftTone = context.createBiquadFilter();
    this.pingPongRightTone = context.createBiquadFilter();
    this.pingPongLeftFeedback = context.createGain();
    this.pingPongRightFeedback = context.createGain();

    this.tone.type = 'lowpass';
    this.tone.frequency.value = 6500;
    this.flutter.type = 'sine';
    this.flutter.frequency.value = 4.6;
    this.flutterDepth.gain.value = 0;
    this.monoPathGain.gain.value = 1;
    this.pingPongPathGain.gain.value = 0;
    this.pingPongLeftPanner.pan.value = -1;
    this.pingPongRightPanner.pan.value = 1;
    this.pingPongLeftTone.type = 'lowpass';
    this.pingPongRightTone.type = 'lowpass';
    this.pingPongLeftTone.frequency.value = 6500;
    this.pingPongRightTone.frequency.value = 6500;
    this.pingPongLeftFeedback.gain.value = 0;
    this.pingPongRightFeedback.gain.value = 0;

    this.effectInput.connect(this.delay);
    this.delay.connect(this.monoPathGain);
    this.monoPathGain.connect(this.effectOutput);
    this.delay.connect(this.tone);
    this.tone.connect(this.feedback);
    this.feedback.connect(this.delay);

    // The shared input delay supplies the ping-pong path's first left tap at t / 2.
    // Both feedback-loop delays remain at t so every later tap alternates at the
    // requested interval without rebuilding the graph when the mode changes.
    this.delay.connect(this.pingPongLeftPanner);
    this.delay.connect(this.pingPongLeftTone);
    this.pingPongLeftDelay.connect(this.pingPongLeftPanner);
    this.pingPongLeftDelay.connect(this.pingPongLeftTone);
    this.pingPongLeftTone.connect(this.pingPongLeftFeedback);
    this.pingPongLeftFeedback.connect(this.pingPongRightDelay);
    this.pingPongRightDelay.connect(this.pingPongRightPanner);
    this.pingPongRightDelay.connect(this.pingPongRightTone);
    this.pingPongRightTone.connect(this.pingPongRightFeedback);
    this.pingPongRightFeedback.connect(this.pingPongLeftDelay);
    this.pingPongLeftPanner.connect(this.pingPongPathGain);
    this.pingPongRightPanner.connect(this.pingPongPathGain);
    this.pingPongPathGain.connect(this.effectOutput);

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
    const feedbackAmount = clamp(feedback, 0, 0.95);
    const isPingPong = params.mode === 'pingpong';
    const toneMax = params.mode === 'analog' ? 5200 : params.mode === 'tape' ? 4200 : 9500;
    const toneMin = params.mode === 'analog' ? 700 : 1100;
    const toneFrequency = toneMin + (params.tone / 100) * (toneMax - toneMin);

    smoothParam(this.delay.delayTime, isPingPong ? delayTime / 2 : delayTime, this.context);
    smoothParam(this.feedback.gain, isPingPong ? 0 : feedbackAmount, this.context);
    smoothParam(this.tone.frequency, toneFrequency, this.context);
    smoothParam(this.flutterDepth.gain, params.mode === 'tape' ? 0.006 : 0, this.context);
    smoothParam(this.flutter.frequency, params.mode === 'tape' ? 4.2 : 0.1, this.context);
    smoothParam(this.pingPongLeftDelay.delayTime, delayTime, this.context);
    smoothParam(this.pingPongRightDelay.delayTime, delayTime, this.context);
    smoothParam(this.pingPongLeftTone.frequency, toneFrequency, this.context);
    smoothParam(this.pingPongRightTone.frequency, toneFrequency, this.context);
    smoothParam(this.pingPongLeftFeedback.gain, isPingPong ? feedbackAmount : 0, this.context);
    smoothParam(this.pingPongRightFeedback.gain, isPingPong ? feedbackAmount : 0, this.context);
    smoothParam(this.monoPathGain.gain, isPingPong ? 0 : 1, this.context);
    smoothParam(this.pingPongPathGain.gain, isPingPong ? 1 : 0, this.context);
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
    this.monoPathGain.disconnect();
    this.pingPongPathGain.disconnect();
    this.pingPongLeftDelay.disconnect();
    this.pingPongRightDelay.disconnect();
    this.pingPongLeftPanner.disconnect();
    this.pingPongRightPanner.disconnect();
    this.pingPongLeftTone.disconnect();
    this.pingPongRightTone.disconnect();
    this.pingPongLeftFeedback.disconnect();
    this.pingPongRightFeedback.disconnect();
    super.dispose();
  }
}
