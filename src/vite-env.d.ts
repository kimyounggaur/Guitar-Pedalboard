/// <reference types="vite/client" />

// 오디오 스레드(AudioWorkletGlobalScope)에서만 있는 전역. 별도 TS 워클릿(limiter·level-meter·output-guard)이 쓴다.
declare class AudioWorkletProcessor {
  constructor(options?: { processorOptions?: unknown });
  readonly port: MessagePort;
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: typeof AudioWorkletProcessor,
): void;

declare const sampleRate: number;
/** 지금 처리 중인 렌더 양자의 첫 샘플 번호(컨텍스트 시작부터의 샘플 수). */
declare const currentFrame: number;
