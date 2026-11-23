// 마지막 출력 단계(설계서 4.4·S1.4a). 체인 끝 → 마스터 게인 → (가드) → 리미터 → [스피커, 출력 미터, 녹음].
// 마스터 게인이 이 단계의 입력이고 리미터 출력이 이 단계의 출력이다. 스피커·미터·녹음은 모두 같은 `output` 에서 갈라지므로
// 화면에서 보는 소리, 스피커로 나가는 소리, 녹음 파일이 같은 피크 제한을 지난다.
// 가드(하울링 차단 워클릿)는 S1.5 에서 입력 쪽으로 옮겨질 때까지 마스터 게인과 리미터 사이에 둔다.
// 리미터는 소리를 룩어헤드(1 ms)만큼 늦춘다. 이 고정 지연은 limiterLookaheadFrames() 로 읽는다.
import { LIMITER_PROCESSOR_NAME, limiterLookaheadFrames } from './limiterSpec';

export { LIMITER_PROCESSOR_NAME, limiterLookaheadFrames };

export interface OutputStageOptions {
  /** 마스터 게인과 리미터 사이에 끼울 노드(출력 쪽 하울링 가드). 없으면 바로 잇는다. */
  guard?: AudioNode | null;
}

export class OutputStage {
  /** 체인 끝이 연결되는 마스터 게인 */
  readonly input: GainNode;
  /** 리미터 출력. 스피커·출력 미터·녹음이 여기서 갈라진다. */
  readonly output: AudioWorkletNode;

  private readonly guard: AudioNode | null;

  /** `limiter-processor` 워클릿이 `context` 에 등록되어 있어야 한다(AudioEngine.loadWorklets, registerWorklets). */
  constructor(context: BaseAudioContext, options: OutputStageOptions = {}) {
    this.input = context.createGain();
    this.output = new AudioWorkletNode(context, LIMITER_PROCESSOR_NAME, { outputChannelCount: [2] });
    this.guard = options.guard ?? null;
    if (this.guard) {
      this.input.connect(this.guard);
      this.guard.connect(this.output);
    } else {
      this.input.connect(this.output);
    }
  }

  /** 이 단계가 만든 연결을 모두 끊는다. 가드 노드 자체는 만든 쪽이 정리한다. */
  dispose(): void {
    for (const node of [this.input, this.output]) {
      try {
        node.disconnect();
      } catch {
        // 이미 끊긴 노드다.
      }
    }
    try {
      this.guard?.disconnect(this.output);
    } catch {
      // 이미 끊긴 노드다.
    }
  }
}
