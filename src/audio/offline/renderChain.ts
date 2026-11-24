// 실제 이펙트 클래스와 워클릿으로 신호 체인을 OfflineAudioContext 에서 렌더한다.
// 그래프 모양은 AudioEngine 과 같다(설계서 4.3절):
//   입력 → level-meter#in → InputStage(장치 입력이면 채널 선택·자동 판정) → inputGain(→ output-guard 입력 1) → 이펙트 체인(페달 순서)
//        → OutputStage(presetTrim → masterGain → output-guard 입력 0 → limiter → level-meter#out) → 출력
// `monitoring: false` 면 레벨 미터와 출력 가드를 모두 뺀 그래프(S1.5 이전과 같은 모양)로 렌더한다. P-17 이 두 모양의 렌더 시간 차이를 잰다.
// 오디오 프로브(src/audio/testing)가 쓰고, 나중에 '음량 맞추기'(프리셋 trim 계산)도 같은 코드를 쓴다.
import type { EffectNodeWrapper, PedalParamValue, PedalState } from '../types';
import type { GuardMode, MonitorMsg } from '../engine/guardSpec';
import { InputStage, type InputChannelMode } from '../engine/InputStage';
import { createLevelMeter, createOutputGuard, GUARD_ANALYSIS_INPUT } from '../engine/monitorNodes';
import { limiterLookaheadFrames, OutputStage } from '../engine/OutputStage';
import { dbToGain } from '../utils/db';
import { ImpulseCache } from '../utils/impulseCache';
import { clampTrimDb } from './loudnessSpec';
import { createOfflineEffect } from './effectFactory';
import { registerWorklets } from './workletModules';

export type { InputChannelMode };

export interface PedalPatch {
  active?: boolean;
  params?: Record<string, PedalParamValue>;
}

export interface ChainHandle {
  context: OfflineAudioContext;
  effects: ReadonlyMap<string, EffectNodeWrapper>;
  /** 입력 처리기. 판정 결과(`decision`)를 렌더 뒤에 읽을 수 있다. */
  inputStage: InputStage;
  /** 렌더 중에 페달 상태를 바꾼다(AudioEngine.setPedalParam 과 같은 경로: effect.update). */
  patchPedal(id: string, patch: PedalPatch): void;
  /**
   * 레벨 미터·출력 가드·리미터가 포트로 보낸 메시지(도착 순서). `monitoring: false` 면 비어 있다.
   * 포트 메시지는 렌더가 끝난 직후에도 조금 늦게 도착할 수 있으므로, 끝 쪽 메시지가 필요하면 `afterRender` 에서 잠깐(수십 ms) 기다린 뒤 읽는다.
   */
  readonly monitorMessages: readonly MonitorMsg[];
}

export interface ChainEvent {
  /** 입력 신호가 시작된 뒤 몇 초에 실행할지(렌더 퀀텀 128샘플 단위로 올림된다). */
  atSeconds: number;
  run(handle: ChainHandle): void;
}

export interface RenderChainOptions {
  sampleRate: number;
  /** 입력 신호. 1채널(모노) 또는 2채널. */
  input: Float32Array[];
  pedals: PedalState[];
  /** 신호 앞에 붙이는 무음(초). 파라미터 스무딩·워클릿이 자리잡을 시간이다. 기본 0.5. */
  leadSeconds?: number;
  /** 신호가 끝난 뒤 더 렌더하는 시간(초). 딜레이·리버브 꼬리를 볼 때 쓴다. 기본 0. */
  tailSeconds?: number;
  /** 입력 이득(dB). 엔진 기본 0. */
  inputGainDb?: number;
  /** 마스터 볼륨(0~1). 엔진 기본 0.9. */
  masterVolume?: number;
  /** 프리셋 음량 보정(dB, S1.4c). 체인 끝과 마스터 게인 사이에 들어간다. 엔진 기본 0(= 보정 없음). */
  presetTrimDb?: number;
  /** 'device' 는 마이크 입력(채널 선택 적용), 'file' 은 파일 재생(그대로 통과). 기본 'device'. */
  source?: 'device' | 'file';
  /** 장치 입력의 채널 선택. 엔진 기본값과 같은 'auto'(2채널이면 신호를 보고 판정한다). */
  inputChannelMode?: InputChannelMode;
  /** 마지막 리미터를 넣을지. 기본 true(엔진과 같다). */
  limiter?: boolean;
  /** 레벨 미터(in·out)와 출력 가드를 그래프에 넣을지. 기본 true(엔진과 같다). false 는 S1.5 이전 모양이다. */
  monitoring?: boolean;
  /**
   * 출력 가드의 판정 모드. 기본 'off'(소리를 건드리지 않는다 — 일정한 음을 길게 내는 시험 신호가 하울링으로 차단되면 다른 측정이 무너진다).
   * 'device' 는 입력 1(분석)을 켜고, 'file' 은 끈다. 하울링 시험(P-07)과 오버헤드 측정(P-17)만 'device' 를 쓴다.
   */
  guardMode?: GuardMode;
  /**
   * 리미터가 소리를 늦추는 고정 지연(룩어헤드 1 ms)을 출력에서 걷어 낼지. 기본 true.
   * 입력과 출력을 같은 시각으로 맞춰 비교하는 측정(전달함수·클릭 창·RMS 창)은 이 지연이 끼면 어긋나므로 걷어 낸다.
   * 실제 처리 지연을 재는 측정(P-16)만 false 로 두어 리미터의 지연까지 읽는다.
   */
  alignOutput?: boolean;
  events?: ChainEvent[];
  /** 여러 번 렌더하는 시험이 임펄스 응답 생성 비용을 나누도록 밖에서 만든 캐시를 넘길 수 있다. 넘기면 여기서 닫지 않는다. */
  impulseCache?: ImpulseCache;
  /** 그래프를 만든 직후, 렌더를 시작하기 전에 불린다(노드 생성 수 세기 같은 계측용). */
  onBuilt?(handle: ChainHandle): void;
  /** 렌더가 끝난 직후, 이펙트를 정리하기 전에 불린다(워클릿이 보낸 값 읽기 같은 용도). */
  afterRender?(handle: ChainHandle): void | Promise<void>;
}

export interface OfflineRender {
  sampleRate: number;
  /** 입력 신호가 시작하는 샘플 번호(앞에 붙인 무음 길이). */
  leadFrames: number;
  /** 입력 신호의 길이(샘플). */
  signalFrames: number;
  /** 전체 출력 [왼쪽, 오른쪽](앞 무음·꼬리 포함). 입력과 같은 길이다. */
  output: Float32Array[];
  /** 출력에 남아 있는 리미터의 고정 지연(샘플). alignOutput 이 true 면 걷어 냈으므로 0. */
  outputDelayFrames: number;
  /** 앞 무음을 붙인 입력. 채널 수는 options.input 과 같다. */
  input: Float32Array[];
  /** startRendering() 이 걸린 시간(ms). CPU 사용량의 대용 지표다. */
  renderMilliseconds: number;
  /** 워클릿 등록·이펙트 생성에 걸린 시간(ms). */
  setupMilliseconds: number;
}

const RENDER_QUANTUM = 128;
/**
 * 2채널 장치 입력의 자동 판정에 채널별 RMS 를 넘기는 간격과 창. 실시간은 level-meter#in 이 포트로 알려 주는데, 포트 메시지는 렌더와
 * 같은 시각에 도착하지 않아 오프라인에서는 판정 시각이 흔들린다. 그래서 렌더 도중 일정 간격으로 멈춰 입력 샘플에서 직접 재서 넘긴다
 * (S1.5 이전의 InputStage.measure() 와 같은 창·같은 식이라 판정 결과가 그대로다. REFACTOR_LOG L-46).
 */
const CHANNEL_LEVEL_INTERVAL_MS = 50;
const CHANNEL_LEVEL_WINDOW_SAMPLES = 2048;
const SILENT_DB = -120;

/** `channel` 의 [end − 창, end) 구간 RMS(dBFS). 끝난 뒤나 시작 전은 무음으로 센다. */
function windowRmsDb(channel: Float32Array, end: number): number {
  const stop = Math.min(end, channel.length);
  let sum = 0;
  for (let i = Math.max(0, end - CHANNEL_LEVEL_WINDOW_SAMPLES); i < stop; i += 1) sum += channel[i] * channel[i];
  const rms = Math.sqrt(sum / CHANNEL_LEVEL_WINDOW_SAMPLES);
  return rms > 1e-6 ? 20 * Math.log10(rms) : SILENT_DB;
}
/**
 * 캐시에 있는 임펄스를 ReverbEffect 가 컨볼버에 적용하는 데는 8 ms 타이머가 한 번 돈다.
 * 임펄스를 미리 요청해 두므로 이 시간만 기다리면 된다.
 */
const REVERB_SETTLE_MS = 40;

export async function renderChain(options: RenderChainOptions): Promise<OfflineRender> {
  const {
    sampleRate,
    input,
    pedals,
    leadSeconds = 0.5,
    tailSeconds = 0,
    inputGainDb = 0,
    masterVolume = 0.9,
    presetTrimDb = 0,
    source = 'device',
    inputChannelMode = 'auto',
    limiter = true,
    monitoring = true,
    guardMode = 'off',
    alignOutput = true,
    events = [],
  } = options;

  const setupStartedAt = performance.now();
  const signalFrames = input[0]?.length ?? 0;
  if (input.length < 1 || input.length > 2 || input.some((channel) => channel.length !== signalFrames)) {
    throw new Error('입력은 길이가 같은 1~2개 채널이어야 합니다.');
  }

  const leadFrames = Math.round(leadSeconds * sampleRate);
  const totalFrames = leadFrames + signalFrames + Math.round(tailSeconds * sampleRate);
  // 리미터가 있으면 소리가 룩어헤드만큼 늦게 나온다. 걷어 낼 때는 그만큼 더 렌더한 뒤 앞을 잘라 같은 길이로 맞춘다.
  const limiterDelayFrames = limiter ? limiterLookaheadFrames(sampleRate) : 0;
  const trimFrames = alignOutput ? limiterDelayFrames : 0;
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: totalFrames + trimFrames, sampleRate });
  await registerWorklets(context);

  const paddedInput = input.map((channel) => {
    const padded = new Float32Array(leadFrames + channel.length);
    padded.set(channel, leadFrames);
    return padded;
  });
  const buffer = context.createBuffer(paddedInput.length, leadFrames + signalFrames, sampleRate);
  paddedInput.forEach((channel, index) => buffer.copyToChannel(channel as Float32Array<ArrayBuffer>, index));
  const sourceNode = context.createBufferSource();
  sourceNode.buffer = buffer;

  const inputGain = context.createGain();
  inputGain.gain.value = dbToGain(inputGainDb);
  const chainInput = context.createGain();
  const monitorMessages: MonitorMsg[] = [];
  // 수신기를 건 포트는 닫기 전에는 가비지 수집되지 않는다(수신기가 있는 포트는 메시지가 더 올 수 있으니 살아 있다고 본다).
  // 닫지 않으면 컨텍스트마다 워클릿 모듈 9개와 렌더 버퍼가 통째로 남아, 렌더를 수백 번 되풀이하는 프로브가 6 GB 에서 죽는다(REFACTOR_LOG L-47).
  // 그래서 건 포트를 모아 두었다가 끝에서 모두 닫는다.
  const observedNodes: AudioWorkletNode[] = [];
  const collect = (node: AudioWorkletNode | null): void => {
    if (!node) return;
    node.port.onmessage = (event: MessageEvent<MonitorMsg>) => monitorMessages.push(event.data);
    observedNodes.push(node);
  };
  const inputTap = monitoring ? createLevelMeter(context, 'in') : null;
  const outputTap = monitoring ? createLevelMeter(context, 'out') : null;
  const guard = monitoring ? createOutputGuard(context, source === 'device' ? guardMode : 'file') : null;
  [inputTap, outputTap, guard].forEach(collect);
  // AudioEngine 과 같은 출력 단계(마스터 게인 → 가드 → 리미터 → 출력 미터). 리미터를 끄는 렌더(limiter: false)는 리미터만 빠진다.
  const outputStage = limiter ? new OutputStage(context, { guard, levelMeter: outputTap }) : null;
  // 리미터 메시지(최대 이득 감소)도 모니터링 그래프에서만 모은다. `monitoring: false` 의 `monitorMessages` 는 비어 있어야 한다.
  if (outputStage && monitoring) collect(outputStage.limiter);
  const masterGain = outputStage?.input ?? context.createGain();
  masterGain.gain.value = masterVolume;
  // 체인 끝이 들어가는 프리셋 음량 보정. 리미터를 끈 렌더도 같은 자리에 같은 노드를 둔다.
  const presetTrim = outputStage?.presetTrim ?? context.createGain();
  if (!outputStage) presetTrim.connect(masterGain);
  presetTrim.gain.value = dbToGain(clampTrimDb(presetTrimDb));

  // AudioEngine.createInputStage 와 같은 입력 처리. 판정에 쓰는 레벨 측정은 아래에서 렌더 도중 일정 간격으로 넘긴다.
  if (inputTap) sourceNode.connect(inputTap);
  const inputStage = new InputStage(context, inputTap ?? sourceNode, paddedInput.length, {
    mode: inputChannelMode,
    passthrough: source === 'file',
  });
  inputStage.output.connect(inputGain);
  inputGain.connect(chainInput);
  // 하울링 분석은 장치 입력일 때만 한다(AudioEngine 과 같다).
  if (guard && source === 'device') inputGain.connect(guard, 0, GUARD_ANALYSIS_INPUT);

  const ownsImpulseCache = options.impulseCache === undefined;
  const impulseCache = options.impulseCache ?? new ImpulseCache(context);
  const livePedals = pedals.map((pedal) => ({ ...pedal, params: { ...pedal.params } }) as PedalState);
  const effects = new Map<string, EffectNodeWrapper>();

  try {
    // 리버브 임펄스를 미리 만들어 두면 생성 직후 짧은 대기만으로 적용된다.
    await Promise.all(
      livePedals
        .filter((pedal) => pedal.type === 'reverb')
        .map((pedal) => {
          const params = pedal.params as { mode: Parameters<ImpulseCache['describe']>[0]; decay: number };
          return impulseCache.request(impulseCache.describe(params.mode, params.decay));
        }),
    );

    let previous: AudioNode = chainInput;
    for (const pedal of livePedals) {
      const effect = createOfflineEffect(context, pedal, impulseCache);
      effects.set(pedal.id, effect);
      previous.connect(effect.input);
      previous = effect.output;
    }
    previous.connect(presetTrim);
    if (outputStage) {
      outputStage.output.connect(context.destination);
    } else {
      // 리미터 없는 렌더: 마스터 게인 → (가드) → (출력 미터) → 출력
      let tail: AudioNode = masterGain;
      if (guard) {
        tail.connect(guard);
        tail = guard;
      }
      if (outputTap) {
        tail.connect(outputTap);
        tail = outputTap;
      }
      tail.connect(context.destination);
    }

    // 켜진 리버브가 있을 때만 임펄스 적용을 기다린다(꺼진 리버브는 소리에 끼어들지 않는다).
    if (livePedals.some((pedal) => pedal.type === 'reverb' && pedal.active)) {
      await new Promise((resolve) => window.setTimeout(resolve, REVERB_SETTLE_MS));
    }

    const handle: ChainHandle = {
      context,
      effects,
      inputStage,
      patchPedal(id, patch) {
        const pedal = livePedals.find((candidate) => candidate.id === id);
        const effect = effects.get(id);
        if (!pedal || !effect) throw new Error(`알 수 없는 페달입니다: ${id}`);
        if (patch.active !== undefined) pedal.active = patch.active;
        if (patch.params) pedal.params = { ...pedal.params, ...patch.params } as PedalState['params'];
        effect.update(pedal);
      },
      monitorMessages,
    };

    options.onBuilt?.(handle);

    // suspend 는 렌더 퀀텀(128샘플) 경계에서만 되고, 같은 시각에 두 번 걸 수 없다.
    const usedFrames = new Set<number>();
    const scheduleSuspend = (requestedFrame: number, run: (frame: number) => void): void => {
      let frame = Math.max(RENDER_QUANTUM, Math.round(requestedFrame / RENDER_QUANTUM) * RENDER_QUANTUM);
      while (usedFrames.has(frame)) frame += RENDER_QUANTUM;
      usedFrames.add(frame);
      context.suspend(frame / sampleRate).then(() => {
        run(frame);
        return context.resume();
      }, () => undefined);
    };
    for (const event of [...events].sort((a, b) => a.atSeconds - b.atSeconds)) {
      scheduleSuspend(leadFrames + event.atSeconds * sampleRate, () => event.run(handle));
    }
    // 2채널 장치 입력은 실시간처럼 일정 간격으로 채널별 레벨을 넘겨 자동 판정을 진행한다(위 CHANNEL_LEVEL_* 설명).
    if (inputStage.selectable) {
      const stepFrames = Math.round((sampleRate * CHANNEL_LEVEL_INTERVAL_MS) / 1000);
      for (let frame = stepFrames; frame < totalFrames; frame += stepFrames) {
        scheduleSuspend(frame, (suspendedAt) => {
          const left = windowRmsDb(paddedInput[0], suspendedAt);
          const right = paddedInput[1] ? windowRmsDb(paddedInput[1], suspendedAt) : SILENT_DB;
          inputStage.onChannelLevels([left, right], suspendedAt / sampleRate);
        });
      }
    }

    sourceNode.start(0);
    const startedAt = performance.now();
    const setupMilliseconds = startedAt - setupStartedAt;
    const rendered = await context.startRendering();
    const renderMilliseconds = performance.now() - startedAt;
    await options.afterRender?.(handle);

    return {
      sampleRate,
      leadFrames,
      signalFrames,
      output: [
        rendered.getChannelData(0).slice(trimFrames, trimFrames + totalFrames),
        rendered.getChannelData(1).slice(trimFrames, trimFrames + totalFrames),
      ],
      outputDelayFrames: limiterDelayFrames - trimFrames,
      input: paddedInput,
      renderMilliseconds,
      setupMilliseconds,
    };
  } finally {
    // 포트를 닫아야 이 컨텍스트와 워클릿 영역이 수집된다. `afterRender` 가 이미 끝난 뒤라 메시지는 모두 읽혔다.
    for (const node of observedNodes) {
      node.port.onmessage = null;
      node.port.close();
    }
    inputStage.dispose();
    effects.forEach((effect) => effect.dispose());
    if (ownsImpulseCache) impulseCache.dispose();
  }
}
