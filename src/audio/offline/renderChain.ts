// 실제 이펙트 클래스와 워클릿으로 신호 체인을 OfflineAudioContext 에서 렌더한다.
// 그래프 모양은 AudioEngine 과 같다:
//   입력 → (장치 입력이면 채널 선택) → inputGain → 이펙트 체인(페달 순서) → masterGain → howlGuard → limiter → 출력
// 오디오 프로브(src/audio/testing)가 쓰고, 나중에 '음량 맞추기'(프리셋 trim 계산)도 같은 코드를 쓴다.
import type { EffectNodeWrapper, PedalParamValue, PedalState } from '../types';
import { dbToGain } from '../utils/db';
import { ImpulseCache } from '../utils/impulseCache';
import { createOfflineEffect } from './effectFactory';
import { registerWorklets } from './workletModules';

export type InputChannelMode = '1' | '2' | 'stereo';

export interface PedalPatch {
  enabled?: boolean;
  bypassed?: boolean;
  params?: Record<string, PedalParamValue>;
}

export interface ChainHandle {
  context: OfflineAudioContext;
  effects: ReadonlyMap<string, EffectNodeWrapper>;
  /** 렌더 중에 페달 상태를 바꾼다(AudioEngine.setPedalParam 과 같은 경로: effect.update). */
  patchPedal(id: string, patch: PedalPatch): void;
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
  /** 'device' 는 마이크 입력(채널 선택 적용), 'file' 은 파일 재생(그대로 통과). 기본 'device'. */
  source?: 'device' | 'file';
  /** 장치 입력의 채널 선택. 엔진 기본값은 '1'(왼쪽 채널을 양쪽으로). */
  inputChannelMode?: InputChannelMode;
  /** 마지막 리미터를 넣을지. 기본 true(엔진과 같다). */
  limiter?: boolean;
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
  /** 전체 출력 [왼쪽, 오른쪽](앞 무음·꼬리 포함). */
  output: Float32Array[];
  /** 앞 무음을 붙인 입력. 채널 수는 options.input 과 같다. */
  input: Float32Array[];
  /** startRendering() 이 걸린 시간(ms). CPU 사용량의 대용 지표다. */
  renderMilliseconds: number;
  /** 워클릿 등록·이펙트 생성에 걸린 시간(ms). */
  setupMilliseconds: number;
}

const RENDER_QUANTUM = 128;
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
    source = 'device',
    inputChannelMode = '1',
    limiter = true,
    events = [],
  } = options;

  const setupStartedAt = performance.now();
  const signalFrames = input[0]?.length ?? 0;
  if (input.length < 1 || input.length > 2 || input.some((channel) => channel.length !== signalFrames)) {
    throw new Error('입력은 길이가 같은 1~2개 채널이어야 합니다.');
  }

  const leadFrames = Math.round(leadSeconds * sampleRate);
  const totalFrames = leadFrames + signalFrames + Math.round(tailSeconds * sampleRate);
  const context = new OfflineAudioContext({ numberOfChannels: 2, length: totalFrames, sampleRate });
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
  const masterGain = context.createGain();
  masterGain.gain.value = masterVolume;
  const howlGuard = new AudioWorkletNode(context, 'howl-guard', { outputChannelCount: [2] });
  const peakLimiter = limiter
    ? new AudioWorkletNode(context, 'peak-limiter-processor', { outputChannelCount: [2] })
    : null;

  // AudioEngine.connectInput 과 같은 입력 연결.
  if (source === 'file' || inputChannelMode === 'stereo') {
    sourceNode.connect(inputGain);
  } else {
    const splitter = context.createChannelSplitter(2);
    sourceNode.connect(splitter);
    splitter.connect(inputGain, inputChannelMode === '1' ? 0 : 1);
  }
  inputGain.connect(chainInput);

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
    previous.connect(masterGain);
    masterGain.connect(howlGuard);
    if (peakLimiter) {
      howlGuard.connect(peakLimiter);
      peakLimiter.connect(context.destination);
    } else {
      howlGuard.connect(context.destination);
    }

    // 켜진 리버브가 있을 때만 임펄스 적용을 기다린다(꺼진 리버브는 소리에 끼어들지 않는다).
    if (livePedals.some((pedal) => pedal.type === 'reverb' && pedal.enabled && !pedal.bypassed)) {
      await new Promise((resolve) => window.setTimeout(resolve, REVERB_SETTLE_MS));
    }

    const handle: ChainHandle = {
      context,
      effects,
      patchPedal(id, patch) {
        const pedal = livePedals.find((candidate) => candidate.id === id);
        const effect = effects.get(id);
        if (!pedal || !effect) throw new Error(`알 수 없는 페달입니다: ${id}`);
        if (patch.enabled !== undefined) pedal.enabled = patch.enabled;
        if (patch.bypassed !== undefined) pedal.bypassed = patch.bypassed;
        if (patch.params) pedal.params = { ...pedal.params, ...patch.params } as PedalState['params'];
        effect.update(pedal);
      },
    };

    options.onBuilt?.(handle);

    // suspend 는 렌더 퀀텀(128샘플) 경계에서만 되고, 같은 시각에 두 번 걸 수 없다.
    const usedFrames = new Set<number>();
    for (const event of [...events].sort((a, b) => a.atSeconds - b.atSeconds)) {
      let frame = Math.max(
        RENDER_QUANTUM,
        Math.round((leadFrames + event.atSeconds * sampleRate) / RENDER_QUANTUM) * RENDER_QUANTUM,
      );
      while (usedFrames.has(frame)) frame += RENDER_QUANTUM;
      usedFrames.add(frame);
      context.suspend(frame / sampleRate).then(() => {
        event.run(handle);
        return context.resume();
      }, () => undefined);
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
      output: [rendered.getChannelData(0).slice(), rendered.getChannelData(1).slice()],
      input: paddedInput,
      renderMilliseconds,
      setupMilliseconds,
    };
  } finally {
    effects.forEach((effect) => effect.dispose());
    if (ownsImpulseCache) impulseCache.dispose();
  }
}
