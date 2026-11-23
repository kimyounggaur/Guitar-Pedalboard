// 파형 표시 전용 분석 노드. S1.5 부터 레벨(RMS·피크)과 클리핑은 level-meter 워클릿이 오디오 스레드에서 재고
// monitorStore 가 들고 있다. 이 노드는 미터 패널의 파형 그림(rAF 에서 읽는다)만 맡는다.
export class MeterNode {
  readonly input: AnalyserNode;
  private readonly buffer: Float32Array;

  constructor(context: BaseAudioContext) {
    this.input = context.createAnalyser();
    this.input.fftSize = 1024;
    this.input.smoothingTimeConstant = 0.72;
    this.buffer = new Float32Array(this.input.fftSize);
  }

  readWaveform(size = 128): number[] {
    this.input.getFloatTimeDomainData(this.buffer);
    const step = Math.max(1, Math.floor(this.buffer.length / size));
    const waveform: number[] = [];

    for (let i = 0; i < this.buffer.length && waveform.length < size; i += step) {
      waveform.push(Number(this.buffer[i].toFixed(4)));
    }

    return waveform;
  }

  disconnect(): void {
    this.input.disconnect();
  }
}
