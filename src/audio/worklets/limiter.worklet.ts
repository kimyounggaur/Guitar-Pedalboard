// 마스터 리미터(S1.4a, 설계서 GS-6). 앱의 마지막 출력 단계에서 샘플 피크를 −1 dBFS 로 막는다.
//   · 천장 −1 dBFS, 룩어헤드 1 ms(소리를 1 ms 늦추는 동안 그 사이의 피크를 미리 본다), 즉시 어택, 릴리즈 시상수 80 ms
//   · 좌우를 같은 이득으로 묶는다(스테레오 이미지를 흔들지 않는다)
//   · 이득을 곱한 뒤 천장으로 한 번 더 자른다(수치 오차 대비 안전망)
//   · 숫자가 아닌 샘플(NaN·Infinity)은 무음으로 바꾼다
// 화면에 내놓는 값은 없다. 톤을 만드는 도구가 아니라 보호 장치다. 값은 limiterSpec.ts 에 있다.
//
// 이 파일은 설계서 4.1절 규칙 6 에 따라 처음부터 별도 TS 파일이다. 앱은 `?worker&url` 로 이 파일의 주소를 얻어
// `audioWorklet.addModule()` 로 불러온다(urls.ts → AudioEngine.loadWorklets, 오프라인 렌더의 registerWorklets).
// 앱 코드는 이 파일을 import 하지 않는다(registerProcessor 는 오디오 스레드에서만 있다).
import {
  LIMITER_CEILING_DB,
  LIMITER_PROCESSOR_NAME,
  LIMITER_RELEASE_SECONDS,
  limiterLookaheadFrames,
} from '../engine/limiterSpec';

function finiteOrZero(value: number | undefined): number {
  return value !== undefined && Number.isFinite(value) ? value : 0;
}

class LimiterProcessor extends AudioWorkletProcessor {
  /** 천장(선형). −1 dBFS ≈ 0.8913 */
  private readonly ceiling = 10 ** (LIMITER_CEILING_DB / 20);
  /** 룩어헤드이자 소리를 늦추는 길이(샘플) */
  private readonly lookahead = limiterLookaheadFrames(sampleRate);
  private readonly release = Math.exp(-1 / (sampleRate * LIMITER_RELEASE_SECONDS));
  private readonly lineLeft = new Float32Array(this.lookahead);
  private readonly lineRight = new Float32Array(this.lookahead);
  /** 최근 (룩어헤드 + 1)개 입력 표본의 좌우 큰 쪽 절댓값. 지금 내보내는 표본(룩어헤드 전 입력)도 창 안에 있다. */
  private readonly peaks = new Float32Array(this.lookahead + 1);
  private lineIndex = 0;
  private peakIndex = 0;
  private gain = 1;

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const frames = output[0]?.length ?? 0;
    const left = input[0];
    const right = input[1] ?? left;

    for (let i = 0; i < frames; i += 1) {
      const sampleLeft = finiteOrZero(left?.[i]);
      const sampleRight = finiteOrZero(right?.[i]);

      this.peaks[this.peakIndex] = Math.max(Math.abs(sampleLeft), Math.abs(sampleRight));
      this.peakIndex = (this.peakIndex + 1) % this.peaks.length;
      let windowPeak = 0;
      for (let k = 0; k < this.peaks.length; k += 1) {
        if (this.peaks[k] > windowPeak) windowPeak = this.peaks[k];
      }

      // 즉시 어택(필요한 이득으로 바로 내려간다), 릴리즈는 1 로 지수 복귀.
      const target = windowPeak > this.ceiling ? this.ceiling / windowPeak : 1;
      this.gain = target < this.gain ? target : target + (this.gain - target) * this.release;

      const delayedLeft = this.lineLeft[this.lineIndex];
      const delayedRight = this.lineRight[this.lineIndex];
      this.lineLeft[this.lineIndex] = sampleLeft;
      this.lineRight[this.lineIndex] = sampleRight;
      this.lineIndex = (this.lineIndex + 1) % this.lookahead;

      // 마지막 안전망: 이득을 곱한 값도 천장을 넘지 못한다.
      const limitedLeft = delayedLeft * this.gain;
      output[0][i] = Math.max(-this.ceiling, Math.min(this.ceiling, limitedLeft));
      if (output[1]) {
        const limitedRight = delayedRight * this.gain;
        output[1][i] = Math.max(-this.ceiling, Math.min(this.ceiling, limitedRight));
      }
    }
    return true;
  }
}

registerProcessor(LIMITER_PROCESSOR_NAME, LimiterProcessor);
