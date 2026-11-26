// 입력 레벨 경고 판정(설계서 4.12 표, S2.5, R2-8).
//
// level-meter#in 이 약 30 Hz 로 알리는 '선택 채널 원신호의 피크(dBFS)'를 시간 순서대로 받아,
// 지금 알려야 할 경고를 하나(신호 없음 · 너무 작음 · 너무 큼) 또는 없음으로 돌려준다.
//   · 화면·탭·DOM 과 무관한 순수 계산이다. 시간은 오디오 시계(초)로 받으므로 미터 탭이 숨겨져 있어도, 문서가 숨겨져 타이머가
//     늦게 깨어나도 같은 입력에는 같은 결과가 나온다(C1). 부르는 쪽은 MonitorService 한 곳이다.
//   · 띄울 때와 지울 때의 기준이 다르다(히스테리시스, 4.12 원칙 3). 순간값 하나로 깜박이지 않는다.
//   · 판정하지 않는 때는 부르는 쪽이 `judging=false` 로 알린다: 파일 재생·세션 정지(= 부르지 않거나 false), 연결 직후 1초(= 아래에서 버림).
// 표의 수치는 초기값이고 실제 기타로 조정한다(설계서 6.5). 조정할 때는 LEVEL_WARNING_SPEC 의 값만 바꾼다.

/** 화면에 알릴 경고. 없으면 null 이다. 우선순위는 high > silent > low 이다. */
export type InputLevelWarning = 'silent' | 'low' | 'high';

export const LEVEL_WARNING_SPEC = {
  /** 판정을 시작한 뒤 이 시간(초)의 측정은 버린다. 장치가 막 열릴 때의 0 · 잡음 · 튀는 값을 경고로 읽지 않는다. 설계서 4.12: 연결 직후 1초. */
  graceSeconds: 1,

  /** 신호 없음: 이 시간(초) 동안 피크가 계속 silentBelowDb 미만이면 띄운다. */
  silentSeconds: 5,
  silentBelowDb: -70,
  /** 신호 없음 해제: 피크가 이 값 이상. 띄울 때(−70)보다 10 dB 높아서 잡음 바닥 근처에서 깜박이지 않는다. */
  silentClearDb: -60,

  /** 연주가 있었다고 보는 피크의 하한. 이보다 작은 소리는 연주가 아니라 잡음이다. */
  playingDb: -60,
  /** 너무 작음: 최근 이 시간(초)의 최대 피크가 lowBelowDb 미만이고 연주(playingDb 이상)가 있었으면 띄운다. */
  lowWindowSeconds: 3,
  lowBelowDb: -36,
  /** 너무 작음 해제: 최근 3초 최대 피크가 이 값 이상. */
  lowClearDb: -30,
  /**
   * 설계서 표에 없는 보강(REFACTOR_LOG L-119). 창 안의 최대 피크가 이 시간(초)보다 오래됐으면 이번 측정으로는 '작음'을 새로 띄우거나 지우지 않는다.
   * 한 번 크게 친 뒤 소리가 줄어드는 동안, 창이 그 첫 소리를 지나면 창의 최대값은 줄어드는 꼬리의 값이 된다. 표를 글자 그대로 읽으면
   * 그 꼬리가 −36 dBFS 를 지나는 때 '입력이 작습니다'가 뜬다(연주를 멈췄을 뿐인데). 지금 연주의 크기를 재는 것이 목적이므로
   * 창의 앞쪽(가장 오래된 1초)에 있는 최대값은 지금 연주가 아니라 지나간 소리의 여운으로 보고 판단을 미룬다. 이미 떠 있는 경고는 그대로 둔다.
   */
  lowFreshSeconds: 2,

  /** 너무 큼: 피크가 이 값 이상이면 띄운다(인터페이스 단계에서 깨짐). */
  highDb: -0.5,
  /** 너무 큼 해제: 마지막으로 highDb 이상이었던 때로부터 이 시간(초) 동안 깨짐이 없었다. */
  highClearSeconds: 3,
} as const;

interface PeakSample {
  time: number;
  db: number;
}

export class LevelWarningJudge {
  /** 판정을 시작한 오디오 시계(초). 아직 시작하지 않았으면 null. */
  private startTime: number | null = null;
  private lastTime = -Infinity;
  /** 최근 lowWindowSeconds 안의 피크. 앞이 최대인 단조 큐라서 최대값을 바로 읽는다. 같은 값이 여럿이면 가장 최근 것이 남는다. */
  private recentPeaks: PeakSample[] = [];
  /** 마지막으로 피크가 silentBelowDb 이상이었던 시각. 신호 없음은 여기서부터 silentSeconds 가 지난 것이다. */
  private lastAudibleTime = 0;
  private lastHotTime = -Infinity;
  private silent = false;
  private low = false;
  private high = false;

  /** 처음 상태로 돌린다(세션이 끝났거나 판정을 멈출 때). */
  reset(): void {
    this.startTime = null;
    this.lastTime = -Infinity;
    this.recentPeaks = [];
    this.lastAudibleTime = 0;
    this.lastHotTime = -Infinity;
    this.silent = false;
    this.low = false;
    this.high = false;
  }

  /**
   * 새 측정 하나를 넣고 지금 알릴 경고를 돌려준다.
   * @param timeSeconds 측정이 끝난 오디오 시계(초). 측정은 시간 순서로 넣는다.
   * @param peakDb 선택한 채널 중 가장 큰 피크(dBFS). 입력 트림 앞의 원신호다.
   * @param judging 지금 판정해야 하는가(장치 입력이 열려 있다). false 면 상태를 비우고 null.
   */
  update(timeSeconds: number, peakDb: number, judging: boolean): InputLevelWarning | null {
    if (!judging) {
      this.reset();
      return null;
    }
    if (!Number.isFinite(timeSeconds) || !Number.isFinite(peakDb)) return this.current();
    // 시계가 거꾸로 갔다면 새 세션이다(컨텍스트를 다시 만들었다). 이전 세션의 창을 끌고 가지 않는다.
    if (timeSeconds < this.lastTime) this.reset();
    this.lastTime = timeSeconds;

    if (this.startTime === null) this.startTime = timeSeconds;
    const judgedFrom = this.startTime + LEVEL_WARNING_SPEC.graceSeconds;
    if (timeSeconds < judgedFrom) return null;
    // 판정할 첫 측정: 무음 구간은 여기서부터 센다(연결 직후 1초의 0 은 '신호 없음' 5초에 넣지 않는다).
    if (this.recentPeaks.length === 0 && this.lastAudibleTime < judgedFrom) this.lastAudibleTime = judgedFrom;

    this.pushPeak(timeSeconds, peakDb);
    this.judgeHigh(timeSeconds, peakDb);
    this.judgeSilent(timeSeconds, peakDb);
    this.judgeLow(timeSeconds, judgedFrom);
    return this.current();
  }

  private current(): InputLevelWarning | null {
    return this.high ? 'high' : this.silent ? 'silent' : this.low ? 'low' : null;
  }

  private pushPeak(time: number, db: number): void {
    while (this.recentPeaks.length > 0 && this.recentPeaks[this.recentPeaks.length - 1].db <= db) this.recentPeaks.pop();
    this.recentPeaks.push({ time, db });
    while (this.recentPeaks.length > 0 && this.recentPeaks[0].time <= time - LEVEL_WARNING_SPEC.lowWindowSeconds) this.recentPeaks.shift();
  }

  private judgeHigh(time: number, peakDb: number): void {
    if (peakDb >= LEVEL_WARNING_SPEC.highDb) {
      this.high = true;
      this.lastHotTime = time;
      // 깨질 만큼 큰 소리는 작지도 조용하지도 않다. 아래 두 판정이 다시 세운다.
      this.low = false;
      this.silent = false;
    } else if (this.high && time - this.lastHotTime >= LEVEL_WARNING_SPEC.highClearSeconds) {
      this.high = false;
    }
  }

  private judgeSilent(time: number, peakDb: number): void {
    if (peakDb >= LEVEL_WARNING_SPEC.silentBelowDb) this.lastAudibleTime = time;
    if (this.silent) {
      if (peakDb >= LEVEL_WARNING_SPEC.silentClearDb) this.silent = false;
    } else if (time - this.lastAudibleTime >= LEVEL_WARNING_SPEC.silentSeconds) {
      this.silent = true;
      // 소리가 없는데 '작다'를 같이 남기지 않는다. 신호가 돌아오면 '작음'을 새로 판단한다.
      this.low = false;
    }
  }

  private judgeLow(time: number, judgedFrom: number): void {
    // 창이 다 차기 전에는 '최근 3초의 최대 피크'를 말할 수 없다.
    if (time - judgedFrom < LEVEL_WARNING_SPEC.lowWindowSeconds) return;
    const top = this.recentPeaks[0];
    if (!top || top.db < LEVEL_WARNING_SPEC.playingDb) return;
    // 창의 최대값이 오래된 것이면 지금 연주의 크기가 아니라 줄어드는 소리의 꼬리다. 새로 띄우지도 지우지도 않는다.
    if (time - top.time > LEVEL_WARNING_SPEC.lowFreshSeconds) return;
    if (!this.low) {
      if (top.db < LEVEL_WARNING_SPEC.lowBelowDb && !this.silent && !this.high) this.low = true;
    } else if (top.db >= LEVEL_WARNING_SPEC.lowClearDb) {
      this.low = false;
    }
  }
}
