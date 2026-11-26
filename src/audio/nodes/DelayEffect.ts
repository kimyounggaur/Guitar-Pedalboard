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

/** 되먹임 꼬리가 이 크기(−60 dB)까지 줄면 들리지 않는다고 본다. 꺼진 뒤 이 시간이 지나면 되먹임 고리를 끊어 쉰다(S4.2). */
const TAIL_FLOOR = 0.001;
/** 꼬리 시간의 상한(초). 되먹임 0.95·지연 2 초 같은 극단에서도 쉬는 시각이 무한히 밀리지 않게 한다. */
const MAX_TAIL_SECONDS = 60;

export class DelayEffect extends BaseEffect {
  private feedbackTarget = 0;
  private pingPongFeedbackTarget = 0;
  /** 깨어난 직후 첫 갱신에서는 되먹임 이득을 램프 없이 목표로 바로 놓는다(쉬는 동안 0 이었으므로 램프가 첫 반복음을 깎지 않게). */
  private snapFeedback = false;
  private lastDelaySeconds = 0.3;
  private lastFeedbackAmount = 0;
  private readonly delay: DelayNode;
  private readonly feedback: GainNode;
  private readonly tone: BiquadFilterNode;
  private readonly wow: OscillatorNode;
  private readonly wowDepth: GainNode;
  private readonly lfoSum: GainNode;
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
    this.lfoSum = context.createGain();
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
    this.lfoSum.gain.value = 1;
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

    // 두 LFO 를 delayTime 에 따로 꽂지 않고 게인 하나에 먼저 더해 한 줄로 꽂는다. 파라미터에 입력 둘이 따로 들어가면
    // (자체 값 + 와우 + 플러터) 세 수를 더하는 순서를 브라우저가 정하는데, 그 순서가 실행마다 달라 소수 끝자리가 흔들린다
    // (오프라인 렌더의 널 시험이 −200 dB 와 −124 dB 사이를 오갔다, REFACTOR_LOG L-232). 둘을 먼저 더하면 항이 둘뿐이라 순서와 상관없다.
    this.wow.connect(this.wowDepth);
    this.wowDepth.connect(this.lfoSum);
    this.flutter.connect(this.flutterDepth);
    this.flutterDepth.connect(this.lfoSum);
    this.lfoSum.connect(this.delay.delayTime);
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

    this.lastDelaySeconds = delayTime;
    this.lastFeedbackAmount = feedbackAmount;
    this.feedbackTarget = isPingPong ? 0 : feedbackAmount;
    this.pingPongFeedbackTarget = isPingPong ? feedbackAmount : 0;

    smoothParam(this.delay.delayTime, isPingPong ? delayTime / 2 : delayTime, this.context);
    smoothParam(this.tone.frequency, toneFrequency, this.context);
    const isTape = params.mode === 'tape';
    smoothParam(this.wowDepth.gain, isTape ? TAPE_WOW_DEPTH_S : 0, this.context);
    smoothParam(this.flutterDepth.gain, isTape ? TAPE_FLUTTER_DEPTH_S : 0, this.context);
    smoothParam(this.pingPongLeftDelay.delayTime, delayTime, this.context);
    smoothParam(this.pingPongRightDelay.delayTime, delayTime, this.context);
    smoothParam(this.pingPongLeftTone.frequency, toneFrequency, this.context);
    smoothParam(this.pingPongRightTone.frequency, toneFrequency, this.context);
    this.applyFeedbackGains();
    smoothParam(this.monoPathGain.gain, isPingPong ? 0 : 1, this.context);
    smoothParam(this.pingPongPathGain.gain, isPingPong ? 1 : 0, this.context);
  }

  /**
   * 꺼진 뒤 되먹임 꼬리가 −60 dB 아래로 줄 때까지의 시간(초). Trails 가 켜졌을 때만 BaseEffect 가 이 값만큼 더 기다린 뒤 쉰다.
   * 반복음 n 번째의 크기는 feedback^n 이므로 n = ln(0.001) / ln(feedback) 번이면 충분하고, 한 번 돌 때마다 지연 시간만큼 걸린다.
   */
  protected override tailSeconds(): number {
    const taps = this.lastFeedbackAmount > 0.001 ? Math.ceil(Math.log(TAIL_FLOOR) / Math.log(this.lastFeedbackAmount)) : 0;
    return Math.min(MAX_TAIL_SECONDS, this.lastDelaySeconds * (taps + 1));
  }

  /** 쉴 때 되먹임 고리를 끊고(남은 소리가 없으니 고리가 계속 돌 이유가 없다), 깨어나면 목표 이득을 바로 되돌린다. */
  protected override onIdleChange(idle: boolean): void {
    if (idle) {
      const now = this.context.currentTime;
      for (const gain of this.feedbackGains()) {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(0, now);
      }
      return;
    }
    this.snapFeedback = true;
  }

  private feedbackGains(): AudioParam[] {
    return [this.feedback.gain, this.pingPongLeftFeedback.gain, this.pingPongRightFeedback.gain];
  }

  private applyFeedbackGains(): void {
    if (this.isIdle) return;
    const targets = [this.feedbackTarget, this.pingPongFeedbackTarget, this.pingPongFeedbackTarget];
    const gains = this.feedbackGains();
    if (this.snapFeedback) {
      this.snapFeedback = false;
      const now = this.context.currentTime;
      gains.forEach((gain, index) => {
        gain.cancelScheduledValues(now);
        gain.setValueAtTime(targets[index], now);
      });
      return;
    }
    gains.forEach((gain, index) => smoothParam(gain, targets[index], this.context));
  }

  override dispose(): void {
    this.wow.stop();
    this.flutter.stop();
    this.delay.disconnect();
    this.feedback.disconnect();
    this.tone.disconnect();
    this.wow.disconnect();
    this.wowDepth.disconnect();
    this.lfoSum.disconnect();
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
