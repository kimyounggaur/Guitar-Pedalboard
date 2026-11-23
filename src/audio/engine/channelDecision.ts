// 입력 채널 자동 판정(설계서 4.4절, S1.3).
//
// 신호가 300 ms 이상 들어온 뒤 한쪽 채널이 15 dB 이상 크면 그 채널만 쓰고, 비슷하면 두 채널을 합친 채로 둔다.
// Web Audio 와 무관한 순수 계산이라 Node 시험이 그대로 부른다. 레벨을 어디서 재는지(S1.3 은 InputStage 안의
// AnalyserNode, S1.5 부터는 level-meter 워클릿)와 상관없이 같은 규칙이 쓰이도록 한 곳에 둔다.

export type ChannelDecision = 'sum' | 'ch1' | 'ch2';

/** 신호가 이만큼(초) 들어와야 판정한다. */
export const DECISION_SIGNAL_SECONDS = 0.3;
/** 한쪽이 이만큼(dB) 이상 크면 그 채널만 쓴다. */
export const DECISION_DIFFERENCE_DB = 15;
/** 두 채널 중 큰 쪽 RMS 가 이 값(dBFS) 이상일 때만 '신호가 들어왔다'고 센다. 장치 잡음 바닥보다 충분히 위다. */
export const SIGNAL_GATE_DB = -50;
/** 측정 간격이 이보다 벌어져도 이만큼만 센다(탭이 멈췄다 돌아온 경우 등 한 번의 측정이 판정을 끝내지 못하게). */
export const MAX_STEP_SECONDS = 0.25;

const SILENT_DB = -120;
/** 시각을 더하다 생기는 부동소수 오차(0.299999…)가 경계에서 판정을 한 번 늦추지 않게 하는 여유. */
const TIME_EPSILON_SECONDS = 1e-6;

function sanitizeDb(value: number): number {
  return Number.isFinite(value) ? Math.max(SILENT_DB, value) : SILENT_DB;
}

export class ChannelDecider {
  private signalSeconds = 0;
  private readonly energy: [number, number] = [0, 0];
  private lastTime: number | null = null;
  private decided: ChannelDecision | null = null;

  /** 이미 판정이 났으면 그 결과, 아니면 null. */
  get decision(): ChannelDecision | null {
    return this.decided;
  }

  /** 신호가 들어온 시간(초). 화면 표시·시험용. */
  get accumulatedSignalSeconds(): number {
    return this.signalSeconds;
  }

  /**
   * 한 번 잰 채널별 RMS(dBFS)를 넣는다. 판정이 나는 바로 그 호출에서만 결과를 돌려주고, 그 뒤로는 null 이다
   * (판정은 세션마다 한 번). `timeSeconds` 는 단조 증가하는 시각(오디오 시계)이다.
   */
  push(timeSeconds: number, rmsDb: readonly [number, number]): ChannelDecision | null {
    if (this.decided !== null) return null;

    const left = sanitizeDb(rmsDb[0]);
    const right = sanitizeDb(rmsDb[1]);
    const previous = this.lastTime;
    if (previous !== null && timeSeconds < previous) return null; // 시계가 거꾸로 가는 측정은 건너뛴다.
    this.lastTime = timeSeconds;
    if (previous === null) return null;

    const step = Math.min(Math.max(timeSeconds - previous, 0), MAX_STEP_SECONDS);
    if (step <= 0 || Math.max(left, right) < SIGNAL_GATE_DB) return null;

    this.signalSeconds += step;
    this.energy[0] += 10 ** (left / 10) * step;
    this.energy[1] += 10 ** (right / 10) * step;
    if (this.signalSeconds < DECISION_SIGNAL_SECONDS - TIME_EPSILON_SECONDS) return null;

    const differenceDb = 10 * Math.log10(this.energy[0] / this.energy[1]);
    if (differenceDb >= DECISION_DIFFERENCE_DB) this.decided = 'ch1';
    else if (differenceDb <= -DECISION_DIFFERENCE_DB) this.decided = 'ch2';
    else this.decided = 'sum';
    return this.decided;
  }

  /** 세션이 바뀔 때(다시 연결) 처음부터 다시 잰다. */
  reset(): void {
    this.signalSeconds = 0;
    this.energy[0] = 0;
    this.energy[1] = 0;
    this.lastTime = null;
    this.decided = null;
  }
}

/** 판정 결과를 화면에 보이는 한 줄로 바꾼다(설계서 4.4절). 판정 전에는 기다리는 중이라는 안내다. */
export function describeDecision(decision: ChannelDecision | 'pending'): string {
  switch (decision) {
    case 'ch1':
      return '1번 입력에서만 소리가 들어와 1번 입력을 씁니다';
    case 'ch2':
      return '2번 입력에서만 소리가 들어와 2번 입력을 씁니다';
    case 'sum':
      return '양쪽 입력에 비슷한 소리가 들어와 합쳐서 씁니다';
    case 'pending':
      return '기타 소리가 들어오면 어느 입력을 쓸지 자동으로 정합니다';
  }
}
