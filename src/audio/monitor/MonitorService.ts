// 워클릿이 보낸 측정·가드 메시지를 받아 화면이 읽을 값으로 옮기는 서비스(설계서 4.3절, S1.5).
//   · level-meter#in / #out → 입력·출력 레벨(최대 30 Hz). 입력 쪽 채널별 RMS 는 InputStage 의 자동 채널 판정에도 넘긴다.
//   · output-guard → 하울링 의심(로그용)·차단. 차단 알림이 오면 정지 절차(AudioSession.stop('howl'))를 부르도록 훅을 호출한다.
//   · limiter → 최근 100 ms 의 최대 이득 감소량.
//   · 입력 레벨 경고(설계서 4.12, S2.5) → level-meter#in 의 선택 채널 원신호를 LevelWarningJudge 에 넣어 '신호 없음 · 작음 · 큼'을 판정한다.
//     판정은 이 서비스가 하고 화면은 결과(monitorStore.inputWarning)만 읽는다. 어느 탭이 열려 있는지와 상관없다.
// 이 클래스는 화면 그리기와 무관하다. 메시지는 오디오 시계로 오고, 미터 탭이 숨겨져 있어도·문서가 숨겨져도 그대로 받는다(C1).
// 저장소(zustand)를 직접 부르지 않고 MonitorSink 로 내보낸다. 그래서 audio/ 층이 store/ 층을 모른 채 Node 시험이 가짜 sink 로 확인할 수 있다.
import type { GuardCmd, GuardMode, LevelMsg } from '../engine/guardSpec';
import { applyLevel, channelPair, SILENT_TAP, type ChannelSelection, type TapState } from './levelReading';
import { LevelWarningJudge, type InputLevelWarning } from './levelWarning';

export interface GuardStatus {
  /** 엔진이 가드에 지시한 모드. device 일 때만 하울링을 판정한다. */
  mode: GuardMode;
  /** 판정 진행 중인 후보(약 0.25초마다 갱신). 로그·디버그용이다. 후보가 끊겨도 지워지지 않으니 `at` 으로 오래된 값을 거른다. */
  suspect: { freqHz: number; heldMs: number; at: number } | null;
  /** 차단이 일어났다면 그 주파수와 오디오 시계. 세션이 끝나 detach 될 때 지워진다. */
  cut: { freqHz: number; frame: number } | null;
}

export interface MonitorSink {
  setInput(tap: TapState): void;
  setOutput(tap: TapState): void;
  setLimiterGr(grDb: number): void;
  setGuard(patch: Partial<GuardStatus>): void;
  /** 입력 레벨 경고가 바뀔 때만 부른다(30 Hz 로 부르지 않는다). 경고가 없으면 null. */
  setInputWarning(warning: InputLevelWarning | null): void;
  /** 세션이 끝났을 때 모두 처음 상태로 */
  reset(): void;
}

export interface MonitorHooks {
  /** 입력 탭의 측정마다(약 30 Hz). 채널별 RMS(dBFS, 모노 소스의 2번은 무음)와 그 측정이 끝난 오디오 시계(초). */
  onInputLevels?: (rmsDb: [number, number], timeSeconds: number) => void;
  /** 입력 막대에 쓸 채널. 측정마다 불러 InputStage 의 선택이 바뀐 것을 곧바로 따른다. 없으면 모두. */
  inputSelection?: () => ChannelSelection;
  /** 가드가 차단을 마쳤다는 보고(무음 처리는 이미 끝났다). 세션당 한 번만 부른다. */
  onHowlCut?: (freqHz: number) => void;
  /**
   * 입력 레벨 경고(4.12)를 판정할 때인가. 장치(마이크·인터페이스) 입력이 열려 있을 때만 true 다. 측정마다 불러 바뀐 것을 곧바로 따른다.
   * 파일 재생은 false: 경고의 안내('인터페이스 게인')가 파일에는 맞지 않고, 음원 파일은 0 dBFS 근처까지 가도 깨진 것이 아니다.
   * 없으면 판정하지 않는다.
   */
  inputJudging?: () => boolean;
}

export interface MonitorNodes {
  inputTap?: AudioWorkletNode | null;
  outputTap?: AudioWorkletNode | null;
  guard?: AudioWorkletNode | null;
  limiter?: AudioWorkletNode | null;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNumberArray(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(isFiniteNumber);
}

export class MonitorService {
  private readonly sink: MonitorSink;
  private readonly now: () => number;
  private hooks: MonitorHooks = {};
  private nodes: AudioWorkletNode[] = [];
  private guard: AudioWorkletNode | null = null;
  private sampleRate = 48000;
  private input: TapState = SILENT_TAP;
  private output: TapState = SILENT_TAP;
  private cutNotified = false;
  private readonly levelWarning = new LevelWarningJudge();
  private inputWarning: InputLevelWarning | null = null;

  constructor(sink: MonitorSink, now: () => number = () => performance.now()) {
    this.sink = sink;
    this.now = now;
  }

  /**
   * 워클릿 포트에 수신기를 건다. 메시지는 `port.onmessage =` 로 받는다(테스트가 포트의 onmessage 를 바로 불러 시뮬레이션할 수 있다).
   * 이미 붙어 있으면 먼저 떼고 다시 붙인다.
   */
  attach(nodes: MonitorNodes, hooks: MonitorHooks, sampleRate: number): void {
    this.detach();
    this.hooks = hooks;
    this.sampleRate = sampleRate > 0 ? sampleRate : 48000;
    this.guard = nodes.guard ?? null;
    for (const node of [nodes.inputTap, nodes.outputTap, nodes.guard, nodes.limiter]) {
      if (!node) continue;
      node.port.onmessage = (event: MessageEvent) => this.handleMessage(event.data);
      this.nodes.push(node);
    }
  }

  /** 가드에 판정 모드를 지시한다. device 만 하울링을 판정하고, file(마이크 없음)·off(사용자가 껐다)는 판정하지 않는다. 리미터는 항상 돈다. */
  setGuardMode(mode: GuardMode): void {
    this.sink.setGuard({ mode });
    const command: GuardCmd = { type: 'arm', mode };
    this.guard?.port.postMessage(command);
  }

  /** 가드의 무음과 판정 상태를 비운다(새 세션). 새로 만든 그래프에서는 부를 필요가 없다. */
  resetGuard(): void {
    this.cutNotified = false;
    this.sink.setGuard({ suspect: null, cut: null });
    const command: GuardCmd = { type: 'reset' };
    this.guard?.port.postMessage(command);
  }

  /** 수신기를 떼고 포트를 닫는다. 화면에 남은 값도 비운다. */
  detach(): void {
    for (const node of this.nodes) {
      try {
        node.port.onmessage = null;
        node.port.close();
      } catch {
        // 이미 닫힌 포트다.
      }
    }
    const hadNodes = this.nodes.length > 0;
    this.nodes = [];
    this.guard = null;
    this.hooks = {};
    this.input = SILENT_TAP;
    this.output = SILENT_TAP;
    this.cutNotified = false;
    this.levelWarning.reset();
    this.inputWarning = null;
    if (hadNodes) this.sink.reset();
  }

  /** 워클릿이 보낸 메시지 하나를 처리한다. 모양이 맞지 않으면 무시한다. */
  handleMessage(data: unknown): void {
    if (typeof data !== 'object' || data === null) return;
    const message = data as { type?: unknown } & Record<string, unknown>;
    switch (message.type) {
      case 'level':
        this.onLevel(message as unknown as LevelMsg);
        return;
      case 'howl-suspect':
        if (isFiniteNumber(message.freqHz) && isFiniteNumber(message.heldMs)) {
          this.sink.setGuard({ suspect: { freqHz: message.freqHz, heldMs: message.heldMs, at: this.now() } });
        }
        return;
      case 'howl-cut':
        if (isFiniteNumber(message.freqHz) && !this.cutNotified) {
          this.cutNotified = true;
          this.sink.setGuard({ cut: { freqHz: message.freqHz, frame: isFiniteNumber(message.frame) ? message.frame : 0 } });
          this.hooks.onHowlCut?.(message.freqHz);
        }
        return;
      case 'limiter':
        if (isFiniteNumber(message.maxGrDb)) this.sink.setLimiterGr(Math.max(0, message.maxGrDb));
        return;
    }
  }

  /** 선택 채널의 원신호 피크로 입력 레벨 경고를 판정하고, 바뀌었을 때만 sink 에 알린다. */
  private judgeInputLevel(timeSeconds: number): void {
    const judging = this.hooks.inputJudging?.() ?? false;
    const warning = this.levelWarning.update(timeSeconds, this.input.peakDb, judging);
    if (warning === this.inputWarning) return;
    this.inputWarning = warning;
    this.sink.setInputWarning(warning);
  }

  private onLevel(message: LevelMsg): void {
    if (!isNumberArray(message.rmsDb) || !isNumberArray(message.peakDb) || !isFiniteNumber(message.frame)) return;
    if (message.tap === 'in') {
      this.input = applyLevel(this.input, message, this.hooks.inputSelection?.() ?? 'all', this.now());
      this.sink.setInput(this.input);
      this.hooks.onInputLevels?.(channelPair(message.rmsDb), message.frame / this.sampleRate);
      this.judgeInputLevel(message.frame / this.sampleRate);
    } else if (message.tap === 'out') {
      this.output = applyLevel(this.output, message, 'all', this.now());
      this.sink.setOutput(this.output);
    }
  }
}
