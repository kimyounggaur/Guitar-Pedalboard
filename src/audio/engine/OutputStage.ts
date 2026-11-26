// 마지막 출력 단계(설계서 4.3·4.4·S1.4a·S1.5). 체인 끝 → 프리셋 음량 보정(trim) → 마스터 게인 → 출력 가드 → 리미터 → (출력 레벨 미터) → [스피커, 녹음].
// 체인 끝은 `presetTrim` 으로 들어오고 이 단계의 출력은 `output` 이다(출력 레벨 미터가 있으면 그 노드, 없으면 리미터). 스피커·파형 분석·녹음은 모두
// 같은 `output` 에서 갈라지므로 화면에서 보는 소리, 스피커로 나가는 소리, 녹음 파일이 같은 피크 제한을 지난다.
// presetTrim(S1.4c, GS-2)은 프리셋마다 정해진 고정 이득이다. 마스터 볼륨(사용자가 움직이는 값)과 따로 두어,
// 프리셋을 바꿔도 사용자가 정한 마스터 볼륨은 그대로이고 trim 은 노브를 돌려도 그대로이다.
// 가드(output-guard 워클릿, S1.5)는 마스터 게인 뒤 입력 0 으로 들어온다. 하울링 판정에 쓰는 분석 소리는 입력 1 로 따로 들어오며 이 클래스가 잇지 않는다.
// 리미터는 소리를 룩어헤드(1 ms)만큼 늦춘다. 이 고정 지연은 limiterLookaheadFrames() 로 읽는다.
import { LIMITER_PROCESSOR_NAME, limiterLookaheadFrames } from './limiterSpec';

export { LIMITER_PROCESSOR_NAME, limiterLookaheadFrames };

export interface OutputStageOptions {
  /** 마스터 게인과 리미터 사이에 끼울 노드(출력 가드, 입력 0 으로 연결). 없으면 바로 잇는다. */
  guard?: AudioNode | null;
  /** 리미터 바로 뒤에 끼울 통과형 노드(level-meter#out). 있으면 이 노드가 `output` 이 된다. */
  levelMeter?: AudioNode | null;
}

export class OutputStage {
  /** 체인 끝이 연결되는 프리셋 음량 보정(trim). 기본 이득 1(= 0 dB). */
  readonly presetTrim: GainNode;
  /** 마스터 게인. presetTrim 의 출력을 받아 가드(또는 리미터)로 보낸다. */
  readonly input: GainNode;
  /** 리미터. 포트로 최근 100 ms 의 최대 이득 감소량을 알린다(`limiter` 메시지). */
  readonly limiter: AudioWorkletNode;
  /** 이 단계의 출력(리미터 뒤). 스피커·녹음·파형 분석이 여기서 갈라진다. */
  readonly output: AudioNode;

  private readonly guard: AudioNode | null;
  private readonly levelMeter: AudioNode | null;

  /** `limiter-processor` 워클릿이 `context` 에 등록되어 있어야 한다(AudioEngine.loadWorklets, registerWorklets). */
  constructor(context: BaseAudioContext, options: OutputStageOptions = {}) {
    this.presetTrim = context.createGain();
    this.input = context.createGain();
    this.presetTrim.connect(this.input);
    this.limiter = new AudioWorkletNode(context, LIMITER_PROCESSOR_NAME, { outputChannelCount: [2] });
    this.guard = options.guard ?? null;
    this.levelMeter = options.levelMeter ?? null;
    if (this.guard) {
      this.input.connect(this.guard);
      this.guard.connect(this.limiter);
    } else {
      this.input.connect(this.limiter);
    }
    if (this.levelMeter) this.limiter.connect(this.levelMeter);
    this.output = this.levelMeter ?? this.limiter;
  }

  /** 이 단계가 만든 연결을 모두 끊는다. 가드·미터 노드 자체는 만든 쪽이 정리한다. */
  dispose(): void {
    for (const node of [this.presetTrim, this.input, this.limiter]) {
      try {
        node.disconnect();
      } catch {
        // 이미 끊긴 노드다.
      }
    }
    try {
      this.guard?.disconnect(this.limiter);
    } catch {
      // 이미 끊긴 노드다.
    }
    try {
      this.levelMeter?.disconnect();
    } catch {
      // 이미 끊긴 노드다.
    }
  }
}
