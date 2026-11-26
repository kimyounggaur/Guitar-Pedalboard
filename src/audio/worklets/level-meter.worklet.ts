// 레벨 미터 워클릿(S1.5, 설계서 4.3). 소리는 그대로 통과시키고, 채널별 피크·RMS(dBFS)를 약 30 Hz 로 메인 스레드에 알린다.
//   · 두 곳에 놓는다: level-meter#in(장치·파일 원신호, InputStage 앞) / level-meter#out(리미터 뒤, 출력 장치·녹음으로 가기 직전)
//   · 어느 쪽인지는 processorOptions.tap('in' | 'out')으로 정한다. 메시지 모양은 guardSpec.ts 의 LevelMsg.
//   · 화면 그리기와 무관하게 오디오 시계로 돈다. 미터 탭이 숨겨져 있어도, 문서가 숨겨져도 측정이 이어진다(C1).
// 이 파일은 설계서 4.1절 규칙 6 에 따라 별도 TS 파일이다. 앱 코드는 import 하지 않고 `?worker&url` 주소로 불러온다.
import {
  LEVEL_CLIP_THRESHOLD,
  LEVEL_METER_PROCESSOR_NAME,
  LEVEL_REPORT_HZ,
  LEVEL_SILENT_DB,
  type LevelMsg,
  type LevelTap,
} from '../engine/guardSpec';

/** 메시지에 싣는 최대 채널 수. 입력 인터페이스가 더 많은 채널을 내놓아도 앞의 둘만 잰다(InputStage 의 채널 판정과 같다). */
const MAX_METERED_CHANNELS = 2;

function toDb(value: number, scale: 10 | 20): number {
  if (!(value > 0) || !Number.isFinite(value)) return LEVEL_SILENT_DB;
  return Math.max(LEVEL_SILENT_DB, scale * Math.log10(value));
}

class LevelMeterProcessor extends AudioWorkletProcessor {
  private readonly tap: LevelTap;
  /** 이만큼(샘플) 쌓이면 한 번 보고한다. 렌더 양자(128) 단위로 끊으므로 실제 간격은 이보다 조금 길다. */
  private readonly reportFrames = Math.max(1, Math.round(sampleRate / LEVEL_REPORT_HZ));
  private readonly peak = new Float64Array(MAX_METERED_CHANNELS);
  private readonly sumSquares = new Float64Array(MAX_METERED_CHANNELS);
  private channels = 1;
  private accumulated = 0;
  private clipped = false;

  constructor(options?: { processorOptions?: unknown }) {
    super(options);
    const requested = (options?.processorOptions as { tap?: LevelTap } | undefined)?.tap;
    this.tap = requested === 'out' ? 'out' : 'in';
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const input = inputs[0] ?? [];
    const output = outputs[0] ?? [];
    const frames = output[0]?.length ?? 128;

    // 통과: 출력 채널 수는 입력을 따른다(옵션에서 outputChannelCount 를 주지 않았다). 연결이 없으면 무음이다.
    for (let c = 0; c < output.length; c += 1) {
      const source = input[c] ?? input[0];
      if (source) output[c].set(source);
      else output[c].fill(0);
    }

    // 측정: 연결이 없는 입력(채널 0개)은 무음 한 채널로 본다.
    const metered = Math.min(MAX_METERED_CHANNELS, Math.max(1, input.length));
    this.channels = metered;
    for (let c = 0; c < metered; c += 1) {
      const samples = input[c];
      if (!samples) continue;
      let peak = this.peak[c];
      let sum = this.sumSquares[c];
      for (let i = 0; i < frames; i += 1) {
        const sample = samples[i];
        const magnitude = sample < 0 ? -sample : sample;
        if (magnitude > peak) peak = magnitude;
        sum += sample * sample;
        if (magnitude >= LEVEL_CLIP_THRESHOLD) this.clipped = true;
      }
      this.peak[c] = peak;
      this.sumSquares[c] = sum;
    }
    this.accumulated += frames;

    if (this.accumulated >= this.reportFrames) this.report(currentFrame + frames);
    return true;
  }

  private report(endFrame: number): void {
    const peakDb: number[] = [];
    const rmsDb: number[] = [];
    for (let c = 0; c < this.channels; c += 1) {
      peakDb.push(toDb(this.peak[c], 20));
      rmsDb.push(toDb(this.sumSquares[c] / this.accumulated, 10));
    }
    const message: LevelMsg = { type: 'level', tap: this.tap, peakDb, rmsDb, clipped: this.clipped, frame: endFrame };
    this.port.postMessage(message);

    this.peak.fill(0);
    this.sumSquares.fill(0);
    this.accumulated = 0;
    this.clipped = false;
  }
}

registerProcessor(LEVEL_METER_PROCESSOR_NAME, LevelMeterProcessor);
