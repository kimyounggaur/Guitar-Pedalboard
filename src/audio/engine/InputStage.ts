// 입력 채널 처리(설계서 4.4절, S1.3). 2입력 오디오 인터페이스의 1번 입력에 꽂은 기타가 한쪽에서만 들리는 문제(R1-4)를
// 고치려고 소스와 체인 사이에 둔다. 모드는 자동(기본) / 1번 / 2번 / 스테레오다.
//
//   source ─▶ ChannelSplitter(2) ─ 0 ─▶ gainL ─┐
//                                └ 1 ─▶ gainR ─┴▶ mono(채널 1개로 합침) ─▶ monoGate ─┐
//   source ─────────────────────────────────────────────────────▶ stereoGate ───────┴▶ output ─▶ inputTrim
//
// 설계서는 스테레오 모드에서 소스를 inputTrim 에 바로 잇고 전환 때 8 ms 페이드 뒤 다시 잇는다고 했지만, 두 경로를 계속 이어 둔 채
// 경로 문(monoGate·stereoGate)을 8 ms 로 맞바꾼다. 소리는 같고 그래프를 만지지 않아 전환 중 클릭이나 경주 상태가 없다(REFACTOR_LOG L-22).
// 채널이 하나뿐인 장치(트랙 channelCount 1)와 파일 재생은 소스를 그대로 통과시킨다.
//
// 채널별 레벨은 이 클래스가 재지 않는다(S1.5). 소스 바로 뒤의 level-meter#in 워클릿이 약 30 Hz 로 채널별 RMS 를 알리고,
// MonitorService 가 그 값을 `onChannelLevels` 로 넘기면 자동 판정이 진행된다(설계서 4.3·4.4절, REFACTOR_LOG L-45).
import { rampParam } from '../utils/smoothing';
import type { ChannelSelection } from '../monitor/levelReading';
import { ChannelDecider, type ChannelDecision } from './channelDecision';

export type InputChannelMode = 'auto' | 'ch1' | 'ch2' | 'stereo';
/** 화면에 보이는 자동 판정 상태. 'pending' 은 아직 정하지 못했다는 뜻이다. */
export type InputChannelState = 'pending' | ChannelDecision;

export const INPUT_CHANNEL_MODES: readonly InputChannelMode[] = ['auto', 'ch1', 'ch2', 'stereo'];

/** 모드를 바꾸거나 자동 판정이 날 때 게인을 옮기는 시간(크로스페이드). */
export const CHANNEL_RAMP_SECONDS = 0.02;
/** 모노 ↔ 스테레오 경로를 맞바꾸는 시간. */
export const PATH_FADE_SECONDS = 0.008;
export function isInputChannelMode(value: unknown): value is InputChannelMode {
  return typeof value === 'string' && (INPUT_CHANNEL_MODES as readonly string[]).includes(value);
}

export function isChannelDecision(value: unknown): value is ChannelDecision {
  return value === 'sum' || value === 'ch1' || value === 'ch2';
}

export interface InputStageOptions {
  /** 처음 모드. 기본은 'auto'. */
  mode?: InputChannelMode;
  /**
   * 지난 세션에서 이 장치에 내린 판정. 자동 모드는 이 판정으로 시작한다(없으면 두 채널을 0.5씩 합침).
   * 판정은 이번 세션에서도 한 번 더 하므로, 연결을 바꿔 꽂았다면 곧 따라간다.
   */
  rememberedDecision?: ChannelDecision | null;
  /** 파일 재생처럼 채널 선택이 필요 없는 소스는 그대로 통과시킨다. */
  passthrough?: boolean;
}

export class InputStage {
  /** 입력 트림(inputGain)에 연결할 노드. 모노 경로일 때도 2채널(양쪽에 같은 소리)로 나간다. */
  readonly output: GainNode;
  /** 채널 선택이 의미 있는가. 채널이 하나뿐이거나 파일이면 false → 화면에서 메뉴를 숨긴다. */
  readonly selectable: boolean;

  private readonly context: BaseAudioContext;
  private readonly source: AudioNode;
  private readonly splitter: ChannelSplitterNode | null = null;
  private readonly gainL: GainNode | null = null;
  private readonly gainR: GainNode | null = null;
  private readonly monoGate: GainNode | null = null;
  private readonly stereoGate: GainNode | null = null;
  private readonly decider = new ChannelDecider();
  private readonly listeners = new Set<(decision: ChannelDecision) => void>();
  private currentMode: InputChannelMode;
  private currentState: InputChannelState = 'pending';
  private disposed = false;

  constructor(
    context: BaseAudioContext,
    source: AudioNode,
    channelCount: number,
    options: InputStageOptions = {},
  ) {
    this.context = context;
    this.source = source;
    this.output = context.createGain();
    this.currentMode = options.mode ?? 'auto';
    this.selectable = options.passthrough !== true && channelCount >= 2;

    if (!this.selectable) {
      source.connect(this.output);
      return;
    }

    if (this.currentMode === 'auto' && isChannelDecision(options.rememberedDecision)) {
      this.currentState = options.rememberedDecision;
    }

    this.splitter = context.createChannelSplitter(2);
    this.gainL = context.createGain();
    this.gainR = context.createGain();
    const mono = context.createGain();
    mono.channelCount = 1;
    mono.channelCountMode = 'explicit';
    this.monoGate = context.createGain();
    this.stereoGate = context.createGain();

    const [left, right] = this.targetGains();
    this.gainL.gain.value = left;
    this.gainR.gain.value = right;
    const stereo = this.currentMode === 'stereo';
    this.monoGate.gain.value = stereo ? 0 : 1;
    this.stereoGate.gain.value = stereo ? 1 : 0;

    source.connect(this.splitter);
    this.splitter.connect(this.gainL, 0);
    this.splitter.connect(this.gainR, 1);
    this.gainL.connect(mono);
    this.gainR.connect(mono);
    mono.connect(this.monoGate);
    this.monoGate.connect(this.output);
    source.connect(this.stereoGate);
    this.stereoGate.connect(this.output);
  }

  get mode(): InputChannelMode {
    return this.currentMode;
  }

  /** 화면 표시용 자동 판정 상태. 수동 모드에서도 마지막 자동 판정을 그대로 돌려준다. */
  get decision(): InputChannelState {
    return this.currentState;
  }

  /** 모드를 바꾼다. 게인은 20 ms 램프, 모노 ↔ 스테레오 경로는 8 ms 로 맞바꾼다. */
  setMode(mode: InputChannelMode): void {
    const previous = this.currentMode;
    this.currentMode = mode;
    if (!this.selectable || this.disposed || previous === mode) return;

    if (mode === 'stereo') {
      this.fadePaths(true);
      return;
    }

    const [left, right] = this.targetGains();
    if (previous === 'stereo') {
      // 모노 경로는 닫혀 있으므로 게인을 먼저 맞춰 두고 경로를 연다. 게인이 움직이는 소리는 나지 않는다.
      this.setGainsImmediately(left, right);
      this.fadePaths(false);
    } else {
      this.rampGains(left, right);
    }
  }

  /**
   * 채널별 RMS(dBFS)를 받아 자동 판정을 진행한다. MonitorService 가 level-meter#in 의 측정마다 부른다(약 30 Hz).
   * `timeSeconds` 는 그 측정이 끝난 오디오 시계(초)다. 판정은 세션마다 한 번만 난다.
   */
  onChannelLevels(rmsDb: readonly [number, number], timeSeconds: number = this.context.currentTime): void {
    if (!this.selectable || this.disposed) return;
    const decided = this.decider.push(timeSeconds, rmsDb);
    if (decided !== null) this.applyDecision(decided);
  }

  /**
   * 입력 레벨 막대·클리핑 표시에 쓸 채널. 소리가 실제로 흘러 들어가는 채널만 센다
   * (1번만 쓰는 중에 2번에 잡음이 있어도 막대가 흔들리지 않는다). 선택이 없는 입력(모노·파일)과 합치는 중에는 모두.
   */
  get meteredChannels(): ChannelSelection {
    if (!this.selectable) return 'all';
    const [left, right] = this.targetGains();
    if (left > 0 && right === 0) return 0;
    if (right > 0 && left === 0) return 1;
    return 'all';
  }

  /** 자동 판정이 나면 부른다. 돌려받은 함수로 구독을 끊는다. */
  onDecision(listener: (decision: ChannelDecision) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.listeners.clear();
    const detach = (from: AudioNode, to: AudioNode | null): void => {
      if (!to) return;
      try {
        from.disconnect(to);
      } catch {
        // 이미 끊긴 노드다.
      }
    };
    if (!this.selectable) {
      detach(this.source, this.output);
    } else {
      detach(this.source, this.splitter);
      detach(this.source, this.stereoGate);
      for (const node of [this.splitter, this.gainL, this.gainR, this.monoGate, this.stereoGate]) {
        try {
          node?.disconnect();
        } catch {
          // 이미 끊긴 노드다.
        }
      }
    }
    try {
      this.output.disconnect();
    } catch {
      // 이미 끊긴 노드다.
    }
  }

  private applyDecision(decision: ChannelDecision): void {
    this.currentState = decision;
    if (this.currentMode === 'auto') {
      const [left, right] = this.targetGains();
      this.rampGains(left, right);
    }
    for (const listener of [...this.listeners]) listener(decision);
  }

  /** 지금 모드·판정에서 gainL·gainR 가 가져야 할 값. */
  private targetGains(): [number, number] {
    switch (this.currentMode) {
      case 'ch1':
        return [1, 0];
      case 'ch2':
        return [0, 1];
      case 'auto':
        if (this.currentState === 'ch1') return [1, 0];
        if (this.currentState === 'ch2') return [0, 1];
        return [0.5, 0.5];
      case 'stereo':
        return [0.5, 0.5];
    }
  }

  private rampGains(left: number, right: number): void {
    if (!this.gainL || !this.gainR) return;
    rampParam(this.gainL.gain, left, this.context, CHANNEL_RAMP_SECONDS);
    rampParam(this.gainR.gain, right, this.context, CHANNEL_RAMP_SECONDS);
  }

  private setGainsImmediately(left: number, right: number): void {
    if (!this.gainL || !this.gainR) return;
    const now = this.context.currentTime;
    for (const [param, value] of [[this.gainL.gain, left], [this.gainR.gain, right]] as const) {
      param.cancelScheduledValues(now);
      param.setValueAtTime(value, now);
    }
  }

  private fadePaths(toStereo: boolean): void {
    if (!this.monoGate || !this.stereoGate) return;
    rampParam(this.monoGate.gain, toStereo ? 0 : 1, this.context, PATH_FADE_SECONDS);
    rampParam(this.stereoGate.gain, toStereo ? 1 : 0, this.context, PATH_FADE_SECONDS);
  }
}
