// level-meter·output-guard 노드를 만드는 한 곳(설계서 4.3절). AudioEngine 과 오프라인 렌더(renderChain)가 같은 옵션으로 만들도록 모았다.
// 두 워클릿이 `context` 에 등록되어 있어야 한다(AudioEngine.loadWorklets, offline/workletModules.registerWorklets).
import { LEVEL_METER_PROCESSOR_NAME, OUTPUT_GUARD_PROCESSOR_NAME, type GuardMode, type LevelTap } from './guardSpec';

/**
 * 통과형 레벨 미터. 소리는 그대로 지나가고(채널 수도 입력을 따른다) 채널별 피크·RMS 가 포트로 나온다.
 * 'in' 은 소스 바로 뒤(InputStage 앞), 'out' 은 리미터 바로 뒤에 둔다.
 */
export function createLevelMeter(context: BaseAudioContext, tap: LevelTap): AudioWorkletNode {
  return new AudioWorkletNode(context, LEVEL_METER_PROCESSOR_NAME, {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    processorOptions: { tap },
  });
}

/**
 * 출력 가드. 입력 0 = 프로그램(마스터 게인 뒤), 입력 1 = 하울링 분석 전용(inputTrim 뒤, 장치 모드만). 출력은 항상 2채널이다.
 * 두 입력은 모두 2채널로 맞춘다(모노는 양쪽에 같은 소리). `mode` 가 'device' 면 첫 렌더 양자부터 판정하고, 아니면 꺼진 채 시작한다.
 * 만든 뒤에는 `arm` 메시지로 바꾼다. 오프라인 렌더도 같은 방식이라 메시지 도착 시각에 결과가 달라지지 않는다.
 */
export function createOutputGuard(context: BaseAudioContext, mode: GuardMode = 'off'): AudioWorkletNode {
  return new AudioWorkletNode(context, OUTPUT_GUARD_PROCESSOR_NAME, {
    numberOfInputs: 2,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    channelCount: 2,
    channelCountMode: 'explicit',
    processorOptions: { mode },
  });
}

/** 가드의 분석 전용 입력 번호 */
export const GUARD_ANALYSIS_INPUT = 1;
