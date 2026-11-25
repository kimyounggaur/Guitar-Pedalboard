import { BaseEffect } from './BaseEffect';
import { delayTimeSeconds } from '../params/definitions/delay';
import type { DelayParams, PedalState } from '../types';
import { clamp } from '../utils/db';
import { smoothParam } from '../utils/smoothing';

// Tape 모드의 음정 흔들림은 느린 와우(wow)와 빠른 플러터(flutter) 두 LFO 가 지연 시간(delayTime)을 흔들어 만든다.
// 지연이 d(t) = A·sin(2π·f·t) 로 흔들리면 반복음의 순간 주파수는 −d'(t) 만큼, 곧 최대 A·2π·f 비율(±)로 변한다.
// 그래서 지연 깊이 A(초) = 목표 주파수 편차(비율) / (2π·f) 로 정한다(설계서 S3.3).
/** 느린 와우 LFO 의 주파수(Hz). */
export const TAPE_WOW_HZ = 0.8;
/** 와우 지연 깊이(초). 음정 편차 약 ±0.3%. */
export const TAPE_WOW_DEPTH_S = 0.003 / (2 * Math.PI * TAPE_WOW_HZ);
/** 빠른 플러터 LFO 의 주파수(Hz). */
export const TAPE_FLUTTER_HZ = 6.5;
/** 플러터 지연 깊이(초). 음정 편차 약 ±0.1%. */
export const TAPE_FLUTTER_DEPTH_S = 0.001 / (2 * Math.PI * TAPE_FLUTTER_HZ);

export class DelayEffect extends BaseEffect {
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly wow: OscillatorNode;
  private readonly wowDepth: GainNode;
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

  constructor(context: BaseAudioContext, pedal: PedalState) {
    super(context, pedal, { mixLaw: 'additive' });
    this.delay = context.createDelay(2);
    this.feedback = context.createGain();
    this.tone = context.createBiquadFilter();
    this.wow = context.createOscillator();
    this.wowDepth = context.createGain();
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
    // 두 LFO 는 늘 같은 주파수로 돈다. Tape 가 아닐 때는 깊이만 0 으로 줄여 지연을 흔들지 않는다
    // (주파수를 바꾸면 위상이 튀므로 건드리지 않는다).
    this.wow.type = 'sine';
    this.wow.frequency.value = TAPE_WOW_HZ;
    this.wowDepth.gain.value = 0;
    this.flutter.type = 'sine';
    this.flutter.frequency.value = TAPE_FLUTTER_HZ;
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

    this.wow.connect(this.wowDepth);
    this.wowDepth.connect(this.delay.delayTime);
    this.flutter.connect(this.flutterDepth);
    this.flutterDepth.connect(this.delay.delayTime);
    this.wow.start();
    this.flutter.start();
    this.update(pedal);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    const params = pedal.params as DelayParams;
    const delayTime = delayTimeSeconds(params);
    const feedback = params.mode === 'slapback' ? Math.min(params.feedback, 0.22) : params.feedback;
    const feedbackAmount = clamp(feedback, 0, 0.95);
    const isPingPong = params.mode === 'pingpong';
    const toneMax = params.mode === 'analog' ? 5200 : params.mode === 'tape' ? 4200 : 9500;
    const toneMin = params.mode === 'analog' ? 700 : 1100;
    const toneFrequency = toneMin + (params.tone / 100) * (toneMax - toneMin);

    smoothParam(this.delay.delayTime, isPingPong ? delayTime / 2 : delayTime, this.context);
    smoothParam(this.feedback.gain, isPingPong ? 0 : feedbackAmount, this.context);
    smoothParam(this.tone.frequency, toneFrequency, this.context);
    const isTape = params.mode === 'tape';
    smoothParam(this.wowDepth.gain, isTape ? TAPE_WOW_DEPTH_S : 0, this.context);
    smoothParam(this.flutterDepth.gain, isTape ? TAPE_FLUTTER_DEPTH_S : 0, this.context);
    smoothParam(this.pingPongLeftDelay.delayTime, delayTime, this.context);
    smoothParam(this.pingPongRightDelay.delayTime, delayTime, this.context);
    smoothParam(this.pingPongLeftTone.frequency, toneFrequency, this.context);
    smoothParam(this.pingPongRightTone.frequency, toneFrequency, this.context);
    smoothParam(this.pingPongLeftFeedback.gain, isPingPong ? feedbackAmount : 0, this.context);
    smoothParam(this.pingPongRightFeedback.gain, isPingPong ? feedbackAmount : 0, this.context);
    smoothParam(this.monoPathGain.gain, isPingPong ? 0 : 1, this.context);
    smoothParam(this.pingPongPathGain.gain, isPingPong ? 1 : 0, this.context);
  }

  override dispose(): void {
    this.wow.stop();
    this.flutter.stop();
    this.delay.disconnect();
    this.feedback.disconnect();
    this.tone.disconnect();
    this.wow.disconnect();
    this.wowDepth.disconnect();
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
