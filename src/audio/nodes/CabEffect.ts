import { fixedLatencySeconds } from '../engine/latency';
import { BaseEffect } from './BaseEffect';
import type { CabParams, PedalState } from '../types';
import { createCabinet } from '../utils/cabinet';
import { clamp } from '../utils/db';
import { fadeParam, smoothParam } from '../utils/smoothing';
import { windowTimers, type Timers } from '../utils/timers';

/** 마이크 위치·거리 노브를 마지막으로 돌린 뒤 이만큼 조용해져야 IR 을 새로 만든다. 드래그 중 입력마다 만들지 않기 위해서다(S3.2). */
export const CAB_IR_DEBOUNCE_MS = 120;
/** IR 을 바꿀 때 컨볼버 가지를 0 으로 줄이고(교체) 되살리는 시간(S3.2). 한쪽 방향 길이다. */
export const CAB_IR_SWAP_FADE_SECONDS = 0.02;
/** 페이드 인이 끝난 뒤 한 번 더 기다리는 여유. 타이머 시계와 오디오 시계가 조금 어긋나도 진행 중인 램프를 끊지 않게 한다. */
const FADE_SETTLE_MARGIN_MS = 10;

type CabinetModel = Exclude<CabParams['model'], 'off'>;

/** 컨볼버에 들어갈 IR 의 출처. 같은 값이면 같은 소리다(만든 IR 은 설정으로 정해지는 결정적 값). */
type IrSource =
  | { kind: 'custom'; buffer: AudioBuffer }
  | { kind: 'cabinet'; model: CabinetModel; micPosition: number; distance: number };

function sameSource(a: IrSource | null, b: IrSource | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'custom') return b.kind === 'custom' && a.buffer === b.buffer;
  return b.kind === 'cabinet' && a.model === b.model && a.micPosition === b.micPosition && a.distance === b.distance;
}

/** idle: 교체 없음. fadingOut: 가지를 줄이는 중(끝나면 IR 교체). fadingIn: 교체 직후 되살리는 중. */
type SwapPhase = 'idle' | 'fadingOut' | 'fadingIn';

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
  private customImpulse: AudioBuffer | null = null;
  private currentPedal: PedalState;
  /** 노브가 가리키는 IR. 캐비닛이 꺼져 있으면 null. */
  private wanted: IrSource | null = null;
  /** 지금 컨볼버에 들어 있는 IR(꺼져 있는 동안에도 마지막 것이 남아 있다). */
  private applied: IrSource | null = null;
  private phase: SwapPhase = 'idle';
  private debounceTimer: number | null = null;
  private swapTimer: number | null = null;
  private settleTimer: number | null = null;
  /** 만든 IR 의 켬/끔 음량 보정(선형 배율, S1.4b). 사용자 IR 에는 쓰지 않는다. */
  private cabinetMakeup = 1;

  constructor(
    context: BaseAudioContext,
    pedal: PedalState,
    private readonly timers: Timers = windowTimers,
  ) {
    super(context, pedal);
    this.currentPedal = pedal;

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

  /** ConvolverNode 가 더하는 지연. P-16 이 잰 값이다(params/latency.json). 캐비닛이 꺼져 있으면(IR 없음) 컨볼버를 거치지 않는다. */
  protected override processingLatencySeconds(): number {
    const bypassed = this.customImpulse === null && (this.currentPedal.params as CabParams).model === 'off';
    return bypassed ? 0 : fixedLatencySeconds('convolver', this.context.sampleRate);
  }

  override update(pedal: PedalState): void {
    super.update(pedal);
    this.currentPedal = pedal;
    const params = pedal.params as CabParams;
    const micPosition = finiteParam(params.micPosition, 55, 0, 100);
    const distance = finiteParam(params.distance, 30, 0, 100);

    smoothParam(this.lowCut.frequency, finiteParam(params.lowCut, 85, 40, 200), this.context);
    smoothParam(this.highCut.frequency, finiteParam(params.highCut, 5400, 3000, 12000), this.context);
    smoothParam(this.presence.gain, finiteParam(params.presence, 1.5, -6, 6), this.context);

    this.wanted = this.customImpulse
      ? { kind: 'custom', buffer: this.customImpulse }
      : params.model === 'off'
        ? null
        : { kind: 'cabinet', model: params.model, micPosition, distance };

    if (this.wanted === null) {
      this.switchOff();
      return;
    }
    smoothParam(this.bypassGain.gain, 0, this.context);
    this.reconcile();
  }

  /** 캐비닛 끔: 진행 중인 교체를 접고 컨볼버 가지를 내린 뒤 우회 경로로 흘린다. 컨볼버에는 마지막 IR 이 남는다. */
  private switchOff(): void {
    const midSwap = this.phase !== 'idle';
    this.cancelSwap();
    if (midSwap) {
      // 램프 도중이면 smoothParam 의 cancelScheduledValues 가 값을 램프 앞 값으로 되돌리므로, 지금 값에서 이어서 내린다.
      fadeParam(this.convolvedGain.gain, 0, this.context, CAB_IR_SWAP_FADE_SECONDS);
    } else {
      smoothParam(this.convolvedGain.gain, 0, this.context);
    }
    smoothParam(this.bypassGain.gain, 1, this.context);
  }

  /** 노브가 가리키는 IR 과 컨볼버에 든 IR 을 맞춘다. 교체 중이면 건드리지 않는다(교체가 끝날 때 다시 부른다). */
  private reconcile(): void {
    const wanted = this.wanted;
    if (wanted === null || this.phase !== 'idle') return;

    if (sameSource(this.applied, wanted)) {
      this.clearDebounceTimer();
      smoothParam(this.convolvedGain.gain, this.cabinetMakeup, this.context);
      return;
    }
    this.clearDebounceTimer();

    if (!this.convolver.buffer) {
      // 처음 넣는 IR: 아직 이 컨볼버를 지나간 소리가 없으니 페이드 없이 바로 넣는다.
      this.load(wanted);
      smoothParam(this.convolvedGain.gain, this.cabinetMakeup, this.context);
      return;
    }

    // 같은 캐비닛에서 마이크 위치·거리만 돌리는 중이면 손이 멈출 때까지 기다린다. 모델이나 사용자 IR 을 고른 것은 바로 시작한다.
    const applied = this.applied;
    const knobOnly = applied?.kind === 'cabinet' && wanted.kind === 'cabinet' && applied.model === wanted.model;
    if (knobOnly) {
      this.debounceTimer = this.timers.setTimeout(() => {
        this.debounceTimer = null;
        this.beginFade();
      }, CAB_IR_DEBOUNCE_MS);
    } else {
      this.beginFade();
    }
  }

  private beginFade(): void {
    this.phase = 'fadingOut';
    fadeParam(this.convolvedGain.gain, 0, this.context, CAB_IR_SWAP_FADE_SECONDS);
    this.swapTimer = this.timers.setTimeout(() => this.completeSwap(), CAB_IR_SWAP_FADE_SECONDS * 1000);
  }

  private completeSwap(): void {
    this.swapTimer = null;
    // 기다리는 동안 노브가 더 움직였을 수 있으니 항상 가장 새로운 값으로 만든다.
    const wanted = this.wanted;
    if (wanted === null) {
      this.phase = 'idle';
      return;
    }
    this.load(wanted);
    this.phase = 'fadingIn';
    fadeParam(this.convolvedGain.gain, this.cabinetMakeup, this.context, CAB_IR_SWAP_FADE_SECONDS);
    this.settleTimer = this.timers.setTimeout(() => {
      this.settleTimer = null;
      this.phase = 'idle';
      this.reconcile();
    }, CAB_IR_SWAP_FADE_SECONDS * 1000 + FADE_SETTLE_MARGIN_MS);
  }

  /** 컨볼버 버퍼를 바꾸는 유일한 자리. normalize 는 버퍼를 넣기 전에 정해야 적용된다. */
  private load(source: IrSource): void {
    if (source.kind === 'custom') {
      this.convolver.normalize = true;
      this.convolver.buffer = source.buffer;
      this.cabinetMakeup = 1;
    } else {
      this.convolver.normalize = false;
      const cabinet = createCabinet(this.context, source.model, source.micPosition, source.distance);
      this.convolver.buffer = cabinet.impulse;
      this.cabinetMakeup = 10 ** (cabinet.makeupDb / 20);
    }
    this.applied = source;
  }

  private cancelSwap(): void {
    this.clearDebounceTimer();
    if (this.swapTimer !== null) this.timers.clearTimeout(this.swapTimer);
    if (this.settleTimer !== null) this.timers.clearTimeout(this.settleTimer);
    this.swapTimer = null;
    this.settleTimer = null;
    this.phase = 'idle';
  }

  private clearDebounceTimer(): void {
    if (this.debounceTimer === null) return;
    this.timers.clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
  }

  setCustomImpulse(buffer: AudioBuffer | null): void {
    this.customImpulse = buffer;
    this.update(this.currentPedal);
  }

  override dispose(): void {
    this.cancelSwap();
    this.lowCut.disconnect();
    this.convolver.disconnect();
    this.convolver.buffer = null;
    this.customImpulse = null;
    this.convolvedGain.disconnect();
    this.bypassGain.disconnect();
    this.highCut.disconnect();
    this.presence.disconnect();
    super.dispose();
  }
}
