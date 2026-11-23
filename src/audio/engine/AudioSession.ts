// 오디오 세션의 상태 기계와 '하나뿐인 정리 절차'(설계서 4.2절, REFACTOR_LOG L-15).
//
// 연결 해제·Panic·Esc·하울링 차단·입력 장치 분리·시작 실패가 모두 stop(reason) 하나를 지난다.
// 정지 이유마다 다른 정리 코드를 두면 어느 경로에서는 마이크나 엔진이 켜진 채 남는다(보고서 R1-3).
//
// 이 파일은 브라우저·Web Audio 에 직접 의존하지 않는다. 실제 일은 SessionPorts 가 하고,
// 여기서는 순서와 예외 처리, 동시에 불린 정지의 합치기, 상태 전이만 맡는다. 그래서 호출 기록만으로 순서를 시험할 수 있다.

export type SessionState = 'idle' | 'starting' | 'running' | 'stopping' | 'error';

export type SessionSource =
  | { kind: 'device'; deviceId?: string }
  | { kind: 'file'; file: File };

export type StopReason =
  | 'user-disconnect' // '연결 해제' 버튼, 음원 파일 재생이 끝남
  | 'panic' // Panic 버튼, Esc
  | 'howl' // 출력 가드가 하울링을 차단함
  | 'device-lost' // 입력 장치가 빠짐
  | 'error'; // 시작 실패, 오류 경계, 엔진 예외

/** 이유별 안내 문구에 필요한 보조 정보. 아직 모르면 비워 둔다. */
export interface StopDetail {
  /** 하울링으로 정지했을 때 감지한 주파수(Hz). 입력 쪽 감지기(S1.5)가 들어오면 채운다. */
  howlFrequencyHz?: number;
}

/** 정리 절차의 단계. 순서가 곧 실행 순서다. */
export const TEARDOWN_STEPS = [
  'silence-output', // ① 출력을 약 10 ms 안에 무음으로
  'stop-input', // ② 입력 트랙 stop — 마이크 표시등이 바로 꺼진다
  'finalize-recording', // ③ 녹음 중이면 마감을 기다려 파일을 남긴다(최대 2초)
  'pause-playback', // ④ 파일 모드면 pause(File 객체는 버리지 않는다)
  'release-graph', // ⑤ 워클릿 포트 닫기, 노드 disconnect
  'close-context', // ⑥ await context.close()
  'advance-generation', // ⑦ 세대 번호 증가 — 늦게 도착한 비동기 결과를 무시
  'notify', // ⑧ 이유별 안내
] as const;
export type TeardownStep = (typeof TEARDOWN_STEPS)[number];

export interface StopResult {
  reason: StopReason;
  /** 정지할 때 녹음 중이었고 파일이 만들어졌으면 true. 파일은 녹음 저장소에 남아 정지 뒤에도 내려받을 수 있다. */
  recordingSaved: boolean;
  /** 예외가 난 단계. 한 단계가 실패해도 나머지 단계는 끝까지 진행한다. 비어 있으면 정상이다. */
  failedSteps: TeardownStep[];
}

export interface SessionPorts {
  /** 입력을 열고 오디오 그래프를 만든다. 실패하면 던진다. */
  start(source: SessionSource): Promise<void>;
  /** 아직 끝나지 않은 start 를 무효로 만든다(세대 번호 증가). 정지 절차의 맨 앞에서 부른다. */
  invalidatePendingStart(): void;
  /** ① 출력 이득을 약 10 ms 램프로 0 으로 만들고, 램프가 끝날 때까지 기다린다. */
  silenceOutput(): Promise<void> | void;
  /** ② 입력 스트림의 모든 트랙을 stop 한다. */
  stopInput(): void;
  /** ③ 녹음 중이면 마감을 기다린다. 파일을 만들었으면 true, 녹음이 없었으면 false. */
  finalizeRecording(): Promise<boolean>;
  /** ④ 파일 모드의 재생을 멈춘다. */
  pausePlayback(): void;
  /** ⑤ 워클릿 포트를 닫고 노드를 끊는다. */
  releaseGraph(): void;
  /** ⑥ AudioContext 를 닫고, 닫힐 때까지 기다린다. */
  closeContext(): Promise<void>;
  /** ⑦ 세대 번호를 올린다. */
  advanceGeneration(): void;
  /** ⑧ 이유에 맞는 안내를 띄운다. */
  notify(result: StopResult, detail: StopDetail): void;
}

export interface AudioSessionOptions {
  /** ③ 녹음 마감을 기다리는 최대 시간. 설계서는 2초. */
  finalizeTimeoutMs?: number;
}

export const DEFAULT_FINALIZE_TIMEOUT_MS = 2000;

/** start() 의 결과. 시작하는 도중에 stop 이 불려 취소되면 'cancelled' 다(오류가 아니다). */
export type StartOutcome = 'running' | 'cancelled';

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => resolve(fallback), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export class AudioSession {
  private current: SessionState = 'idle';
  private stopping: Promise<StopResult> | null = null;
  /** 시작·정지를 부를 때마다 올라간다. 이 번호가 바뀐 시작은 결과를 버리고 'cancelled' 로 끝난다. */
  private startToken = 0;
  private readonly listeners = new Set<(state: SessionState) => void>();
  private readonly finalizeTimeoutMs: number;

  constructor(private readonly ports: SessionPorts, options: AudioSessionOptions = {}) {
    this.finalizeTimeoutMs = options.finalizeTimeoutMs ?? DEFAULT_FINALIZE_TIMEOUT_MS;
  }

  get state(): SessionState {
    return this.current;
  }

  /** 상태가 바뀔 때마다 부른다. 돌려받은 함수로 구독을 끊는다. */
  subscribe(listener: (state: SessionState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 입력을 열고 시작한다. idle·error 에서 시작하고, running 에서 부르면 다른 입력으로 바꾸는 재시작이다
   * (ports.start 가 이전 컨텍스트를 닫고 새로 만든다 — 컨텍스트는 한 번에 하나).
   * 정지 중이면 그 정지가 끝나기를 기다린 뒤 시작한다. 시작은 나중에 부른 쪽이 이긴다:
   * 아직 끝나지 않은 이전 시작은 결과를 버리고 'cancelled' 로 끝난다(오류가 아니다).
   */
  start(source: SessionSource): Promise<StartOutcome> {
    const token = (this.startToken += 1);
    return this.runStart(source, token);
  }

  /**
   * 모든 종료가 이 함수 하나를 지난다. 이미 정지 중이면 그 정지의 결과를 같이 기다린다.
   * 아무것도 열려 있지 않아도(idle) 안전하게 정리 절차를 돌고, 안내는 실제로 정지할 것이 있었을 때만 띄운다.
   * 대기 중이거나 진행 중인 시작은 이미 정지 중일 때 불러도 취소된다.
   */
  stop(reason: StopReason, detail: StopDetail = {}): Promise<StopResult> {
    this.startToken += 1;
    if (this.stopping) return this.stopping;
    const wasActive = this.current !== 'idle';
    const run = this.teardown(reason, detail, wasActive).finally(() => { this.stopping = null; });
    this.stopping = run;
    return run;
  }

  private async runStart(source: SessionSource, token: number): Promise<StartOutcome> {
    if (this.stopping) await this.stopping;
    if (token !== this.startToken) return 'cancelled'; // 기다리는 동안 정지나 더 새로운 시작이 불렸다
    this.setState('starting');
    try {
      await this.ports.start(source);
    } catch (error) {
      if (token !== this.startToken) return 'cancelled'; // 취소된 시작이 던진 오류는 오류가 아니다
      await this.stop('error'); // 실패한 시작도 같은 정리 절차를 지난다
      throw error;
    }
    if (token !== this.startToken) return 'cancelled';
    this.setState('running');
    return 'running';
  }

  private async teardown(reason: StopReason, detail: StopDetail, wasActive: boolean): Promise<StopResult> {
    this.setState('stopping');

    const failedSteps: TeardownStep[] = [];
    let recordingSaved = false;
    const run = async (step: TeardownStep, action: () => Promise<void> | void): Promise<void> => {
      try {
        await action();
      } catch {
        failedSteps.push(step);
      }
    };

    // 사전 처리(단계 번호 없음): 시작이 아직 끝나지 않았다면 그 요청부터 무효로 만든다.
    // getUserMedia 가 늦게 돌아와도 입력이 켜지지 않는다. 실패해도 정리는 계속한다.
    try {
      this.ports.invalidatePendingStart();
    } catch {
      // 아래 ⑦ 단계가 세대 번호를 다시 올린다.
    }

    await run('silence-output', () => this.ports.silenceOutput());
    await run('stop-input', () => this.ports.stopInput());
    await run('finalize-recording', async () => {
      recordingSaved = await withTimeout(this.ports.finalizeRecording(), this.finalizeTimeoutMs, false);
    });
    await run('pause-playback', () => this.ports.pausePlayback());
    await run('release-graph', () => this.ports.releaseGraph());
    await run('close-context', () => this.ports.closeContext());
    await run('advance-generation', () => this.ports.advanceGeneration());

    const result: StopResult = { reason, recordingSaved, failedSteps: [...failedSteps] };
    this.setState(failedSteps.length > 0 ? 'error' : 'idle');
    if (wasActive) {
      try {
        this.ports.notify(result, detail);
      } catch {
        result.failedSteps.push('notify');
      }
    }
    return result;
  }

  private setState(next: SessionState): void {
    if (this.current === next) return;
    this.current = next;
    this.listeners.forEach((listener) => listener(next));
  }
}
