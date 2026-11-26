// 출력 가드 워클릿(S1.5, 설계서 4.3 · 부록 B · 결정 D9). 하울링 판정과 안전 무음을 오디오 스레드 안에서 한다.
//   · 입력 0: 프로그램(체인 → presetTrim → masterGain). 그대로 내보낸다. 차단되면 10 ms 램프로 무음이 된다.
//   · 입력 1: 분석 전용(inputTrim 뒤, 장치 모드만). 두 채널을 모노로 섞어 HowlDetector 에 넣는다. 소리에는 섞지 않는다.
//   · 출력 0: 항상 2채널. 다음 단계는 limiter.
// 판정은 화면 그리기·탭·문서 가시성과 무관하게 오디오 시계로 돈다(C1). 판정 수치는 guardSpec.ts(부록 B)에 있고 여기서 바꾸지 않는다.
// 이 파일은 설계서 4.1절 규칙 6 에 따라 별도 TS 파일이다. 앱 코드는 import 하지 않고 `?worker&url` 주소로 불러온다.
import {
  HOWL_MUTE_RAMP_SECONDS,
  OUTPUT_GUARD_PROCESSOR_NAME,
  type GuardCmd,
  type GuardMode,
  type GuardMsg,
} from '../engine/guardSpec';
import { HowlDetector, type HowlEvent } from '../monitor/howlDetector';

/** 한 번의 process 에서 모노 분석 입력을 담는 버퍼 크기(렌더 양자는 128 이다. 더 커져도 아래에서 늘린다). */
const DEFAULT_QUANTUM = 128;

class OutputGuardProcessor extends AudioWorkletProcessor {
  private readonly detector = new HowlDetector(sampleRate);
  /** 무음 램프 길이(샘플). 48 kHz 에서 480. */
  private readonly rampFrames = Math.max(1, Math.round(sampleRate * HOWL_MUTE_RAMP_SECONDS));
  private mono = new Float32Array(DEFAULT_QUANTUM);

  /** 판정을 켰는가. 만들 때 mode 가 'device' 이거나 arm 'device' 를 받았을 때만 켜진다(기본 꺼짐). */
  private armed = false;
  /** 프로그램에 곱하는 이득. 1 → 0 으로 내려가는 동안 램프다. */
  private gain = 1;
  /** 차단이 판정되어 램프를 시작해야 한다(또는 진행 중이다). reset 전까지 풀리지 않는다. */
  private cutting = false;
  /** 무음 완료를 아직 알리지 않았다. */
  private cutUnreported = false;
  private cutFreqHz = 0;
  /** 이번 양자에서 판정기가 알린 '의심 중' 소식. process 끝에서 frame 을 붙여 보낸다. */
  private pendingSuspect: Extract<HowlEvent, { type: 'suspect' }> | null = null;

  constructor(options?: { processorOptions?: unknown }) {
    super(options);
    // 처음 모드는 만들 때 정한다(processorOptions.mode). 첫 렌더 양자부터 정해진 상태로 돌아 메시지 도착 시각에 기대지 않는다.
    this.armed = (options?.processorOptions as { mode?: GuardMode } | undefined)?.mode === 'device';
    this.detector.onEvent = (event) => this.onDetectorEvent(event);
    this.port.onmessage = (event: MessageEvent<GuardCmd>) => this.onCommand(event.data);
  }

  private onCommand(command: GuardCmd | undefined): void {
    if (!command) return;
    if (command.type === 'arm') {
      const next = command.mode === 'device';
      // 꺼져 있다가 켤 때는 이전 입력 이력으로 판정하지 않도록 비운다. 이미 무음인 상태는 reset 전까지 그대로다.
      if (next && !this.armed) this.detector.reset();
      this.armed = next;
    } else if (command.type === 'reset') {
      this.detector.reset();
      this.gain = 1;
      this.cutting = false;
      this.cutUnreported = false;
      this.cutFreqHz = 0;
    }
  }

  private onDetectorEvent(event: HowlEvent): void {
    // 이 안에서는 포트에 바로 보내지 않고 표시만 한다(process 끝에서 frame 과 함께 보낸다).
    if (event.type === 'cut') {
      this.cutting = true;
      this.cutUnreported = true;
      this.cutFreqHz = event.freqHz;
    } else {
      this.pendingSuspect = event;
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const program = inputs[0] ?? [];
    const analysis = inputs[1] ?? [];
    const output = outputs[0] ?? [];
    const frames = output[0]?.length ?? DEFAULT_QUANTUM;

    // 1) 분석: 장치 모드에서만, 아직 차단하지 않았을 때만.
    if (this.armed && !this.cutting) this.analyze(analysis, frames);

    // 2) 통과 + 무음 램프. 차단이 판정된 양자의 첫 샘플부터 내린다(판정 → 무음까지 한 양자도 지나지 않는다).
    const left = program[0];
    const right = program[1] ?? left;
    if (!this.cutting && this.gain === 1) {
      for (let c = 0; c < output.length; c += 1) {
        const source = c === 0 ? left : right;
        if (source) output[c].set(source);
        else output[c].fill(0);
      }
    } else {
      this.writeRamped(output, left, right, frames);
    }

    // 3) 알림: 메시지에는 이 양자가 끝난 오디오 시계를 싣는다.
    if (this.pendingSuspect) {
      const suspect = this.pendingSuspect;
      this.pendingSuspect = null;
      this.post({ type: 'howl-suspect', freqHz: suspect.freqHz, heldMs: suspect.heldMs, frame: currentFrame + frames });
    }
    if (this.cutUnreported && this.gain === 0) {
      this.cutUnreported = false;
      this.post({ type: 'howl-cut', freqHz: this.cutFreqHz, frame: currentFrame + frames });
    }
    return true;
  }

  /** 입력 1 의 두 채널을 모노로 섞어 판정기에 넣는다. 연결이 없으면(빈 배열) 무음을 넣어 시간만 흘려보낸다. */
  private analyze(analysis: Float32Array[], frames: number): void {
    if (this.mono.length < frames) this.mono = new Float32Array(frames);
    const a = analysis[0];
    const b = analysis[1] ?? a;
    const mono = this.mono;
    if (a && b) {
      for (let i = 0; i < frames; i += 1) mono[i] = (a[i] + b[i]) * 0.5;
    } else {
      mono.fill(0, 0, frames);
    }
    this.detector.push(mono, frames);
  }

  private writeRamped(output: Float32Array[], left: Float32Array | undefined, right: Float32Array | undefined, frames: number): void {
    const step = 1 / this.rampFrames;
    let gain = this.gain;
    for (let i = 0; i < frames; i += 1) {
      if (this.cutting && gain > 0) gain = gain > step ? gain - step : 0;
      if (left && output[0]) output[0][i] = left[i] * gain;
      else if (output[0]) output[0][i] = 0;
      if (output[1]) output[1][i] = right ? right[i] * gain : 0;
    }
    this.gain = gain;
  }

  private post(message: GuardMsg): void {
    this.port.postMessage(message);
  }
}

registerProcessor(OUTPUT_GUARD_PROCESSOR_NAME, OutputGuardProcessor);
