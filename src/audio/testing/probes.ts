// 오디오 렌더 프로브 정의(설계서 6.2절). 실제 이펙트 클래스와 워클릿을 OfflineAudioContext 에서 돌려 소리를 숫자로 잰다.
// 각 프로브는 평평한 metrics(점으로 이은 키 → 숫자·문자·불리언·null)를 돌려주고, scripts/audio-render-probe.mjs 가
// docs/baseline/audio-probe.json 과 tolerances.json 의 허용 오차로 비교한다.
// 측정만 한다. 목표값(설계서의 '목표' 열)을 넘는지 판정하는 일은 각 Step 의 수용 기준이 맡는다.
import type { MonitorMsg } from '../engine/guardSpec';
import { CompressorEffect } from '../nodes/CompressorEffect';
import {
  achievableTargetDbfs,
  isHeadroomLimited,
  limiterReductionDb,
  PRESET_TARGET_OFFSETS_DB,
  PRESET_TARGET_RMS_DBFS,
  targetRmsDbfsFor,
} from '../offline/loudnessSpec';
import { computeTrimForChain, QUICK_MEASURE_SECONDS } from '../offline/measureLoudness';
import { registerWorklets } from '../offline/workletModules';
import {
  renderChain,
  type ChainEvent,
  type InputChannelMode,
  type OfflineRender,
  type RenderChainOptions,
} from '../offline/renderChain';
import type { PedalParamValue, PedalParams, PedalState, PedalType } from '../types';
import type { ImpulseCache } from '../utils/impulseCache';
import { clonePedals, initialPedals } from '../../store/pedalStore';
import { defaultPresets } from '../../store/presetStore';
import * as m from './measure';
import * as signals from './signals';

export type MetricValue = number | string | boolean | null;
export type Metrics = Record<string, MetricValue>;

export interface ProbeOutput {
  metrics: Metrics;
  /** 사람이 읽을 참고(비교 대상 아님). */
  notes?: string[];
}

export interface NodeCounter {
  count: number;
}

export type ChainRequest = Omit<RenderChainOptions, 'sampleRate' | 'impulseCache'>;

export interface ProbeContext {
  sampleRate: number;
  nodeCounter: NodeCounter;
  render(request: ChainRequest): Promise<OfflineRender>;
  /** 이펙트 체인 없이 워클릿만 따로 돌릴 때(튜너) 쓰는 컨텍스트. 워클릿은 이미 등록돼 있다. */
  createBareContext(seconds: number): Promise<OfflineAudioContext>;
}

export interface ProbeDefinition {
  id: string;
  title: string;
  /** 무엇을 어떻게 재는지. 기준선 문서와 실행 요약에 쓴다. */
  describe: string;
  /** 설계서가 이 프로브로 판정하라고 한 Step. */
  steps: string;
  run(context: ProbeContext): Promise<ProbeOutput>;
}

// ---------------------------------------------------------------------------------------------
// 공통 도우미
// ---------------------------------------------------------------------------------------------
function pedal(
  id: string,
  params: Record<string, PedalParamValue> = {},
  state: { enabled?: boolean; bypassed?: boolean } = {},
): PedalState {
  const base = initialPedals.find((candidate) => candidate.id === id);
  if (!base) throw new Error(`알 수 없는 페달 id: ${id}`);
  return {
    ...base,
    enabled: state.enabled ?? true,
    bypassed: state.bypassed ?? false,
    params: { ...base.params, ...params } as PedalParams,
  };
}

/** 15개 페달을 모두 켜고 params 를 손본다. */
function allPedalsOn(adjust: (pedalState: PedalState) => Record<string, PedalParamValue> = () => ({})): PedalState[] {
  return clonePedals(initialPedals).map((pedalState) => ({
    ...pedalState,
    enabled: true,
    bypassed: false,
    params: { ...pedalState.params, ...adjust(pedalState) } as PedalParams,
  }));
}

function allPedalsBypassed(): PedalState[] {
  return clonePedals(initialPedals).map((pedalState) => ({ ...pedalState, enabled: true, bypassed: true }));
}

function metrics(values: Record<string, MetricValue>): Metrics {
  const result: Metrics = {};
  for (const [key, value] of Object.entries(values)) {
    result[key] = typeof value === 'number' ? m.round(value, 3) : value;
  }
  return result;
}

function seconds(render: OfflineRender, value: number): number {
  return render.leadFrames + Math.round(value * render.sampleRate);
}

/** 신호 구간(앞 무음 제외)의 스테레오 RMS dBFS. skipSeconds 만큼은 건너뛴다. */
function bodyLevelDb(render: OfflineRender, skipSeconds = 0, untilSeconds?: number): number {
  const end = untilSeconds === undefined ? render.leadFrames + render.signalFrames : seconds(render, untilSeconds);
  return m.stereoRmsDb(render.output, seconds(render, skipSeconds), end);
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 두 렌더의 차이 신호 RMS ÷ 첫 번째 RMS (dB). −200 이면 완전히 같다. 앞 무음은 제외한다. */
function residualDb(a: OfflineRender, b: OfflineRender): number {
  let residual = 0;
  let reference = 0;
  for (let channel = 0; channel < 2; channel += 1) {
    for (let i = a.leadFrames; i < a.output[channel].length; i += 1) {
      const difference = a.output[channel][i] - b.output[channel][i];
      residual += difference * difference;
      reference += a.output[channel][i] * a.output[channel][i];
    }
  }
  return m.dbOf(Math.sqrt(residual / Math.max(reference, 1e-20)));
}

/** 꺼진 페달은 신호를 그대로 통과시키므로 빼도 소리가 같다. 렌더 시간을 줄이는 데 쓴다(P-05 가 같음을 매번 확인한다). */
function activePedals(pedals: PedalState[]): PedalState[] {
  return pedals.filter((candidate) => candidate.enabled && !candidate.bypassed);
}

const delayMs = (milliseconds: number) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds));

// ---------------------------------------------------------------------------------------------
// P-01 / P-02 — Crunch 의 포락선 추종
// ---------------------------------------------------------------------------------------------
const p01: ProbeDefinition = {
  id: 'P-01',
  title: 'Crunch 무연주 잡음 대 연주음',
  describe:
    'Crunch 한 개만 켜고 REF-NOISE(−90 dBFS, 4초)와 REF-PC 를 각각 통과시켜 출력 RMS 를 잰다. 잡음은 처음 1초를 건너뛴다. difference = 연주음 − 잡음(dB).',
  steps: 'S1.1',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const quiet = await ctx.render({ input: [signals.refNoise(rate, 4, -90)], pedals: [pedal('crunch')] });
    const played = await ctx.render({ input: [signals.refPc(rate)], pedals: [pedal('crunch')] });
    const noiseOutDb = bodyLevelDb(quiet, 1);
    const playedOutDb = bodyLevelDb(played);
    return {
      metrics: metrics({
        noiseInDb: -90,
        noiseOutDb,
        noiseGainDb: noiseOutDb + 90,
        playedOutDb,
        differenceDb: playedOutDb - noiseOutDb,
      }),
    };
  },
};

const p02: ProbeDefinition = {
  id: 'P-02',
  title: 'Crunch 감쇠 추종',
  describe:
    'REF-DECAY(110 Hz, 4초 동안 55 dB 감쇠)를 Crunch 로 보내 처음 0.05~0.25초와 마지막 3.8~4.0초의 RMS 차(입력 대 출력)를 잰다.',
  steps: 'S1.1',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const input = signals.refDecay(rate);
    const render = await ctx.render({ input: [input], pedals: [pedal('crunch')] });
    const windowDrop = (channels: m.Samples[], offset: number): number =>
      m.stereoRmsDb(channels, offset + Math.round(0.05 * rate), offset + Math.round(0.25 * rate))
      - m.stereoRmsDb(channels, offset + Math.round(3.8 * rate), offset + Math.round(4.0 * rate));
    const inputDropDb = windowDrop([input], 0);
    const outputDropDb = windowDrop(render.output, render.leadFrames);
    return { metrics: metrics({ inputDropDb, outputDropDb, followRatio: outputDropDb / inputDropDb }) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-03 — 최악 조합의 출력 피크
// ---------------------------------------------------------------------------------------------
const p03: ProbeDefinition = {
  id: 'P-03',
  title: '최악 조합 출력 피크',
  describe:
    'REF-PC 를 15개 페달을 모두 켜고 Level 200%, Graphic EQ 전 밴드 +12 dB 로 통과시킨 출력의 샘플 피크, 그리고 앱 기본 구성에서 Cab 만 끈 출력의 샘플 피크. 마지막 리미터가 있을 때와 없을 때를 모두 잰다.',
  steps: 'S1.4a',
  async run(ctx) {
    const build = () =>
      allPedalsOn((pedalState): Record<string, PedalParamValue> =>
        pedalState.type === 'graphicEQ'
          ? { level: 200, band100: 12, band200: 12, band400: 12, band800: 12, band1600: 12, band3200: 12, band6400: 12 }
          : { level: 200 },
      );
    const input = signals.refPc(ctx.sampleRate);
    const limited = await ctx.render({ input: [input], pedals: build() });
    const raw = await ctx.render({ input: [input], pedals: build(), limiter: false });
    // 앱 기본 구성(initialPedals)에서 Cab 만 끈 경우. Cab 을 끄면 소리가 커져(R1-5) 리미터가 없을 때 깨졌다.
    const defaultCabOff = (): PedalState[] =>
      clonePedals(initialPedals).map((pedalState) => (pedalState.id === 'cab' ? { ...pedalState, bypassed: true } : pedalState));
    const cabOffLimited = await ctx.render({ input: [input], pedals: defaultCabOff() });
    const cabOffRaw = await ctx.render({ input: [input], pedals: defaultCabOff(), limiter: false });
    const peak = (render: OfflineRender) => Math.max(m.peakDb(render.output[0]), m.peakDb(render.output[1]));
    return {
      metrics: metrics({
        inputPeakDb: m.peakDb(input),
        peakWithLimiterDb: peak(limited),
        peakWithoutLimiterDb: peak(raw),
        rmsWithLimiterDb: bodyLevelDb(limited),
        defaultCabOffPeakDb: peak(cabOffLimited),
        defaultCabOffPeakWithoutLimiterDb: peak(cabOffRaw),
      }),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// P-04 — Cab 켬/끔 음량 차
// ---------------------------------------------------------------------------------------------
const CAB_MODELS = ['v30-4x12', 'greenback-4x12', 'blue-1x12', 'jensen-1x12', 'tweed-1x10'] as const;

const p04: ProbeDefinition = {
  id: 'P-04',
  title: 'Cab 켬/끔 음량 차',
  describe:
    'REF-PC 앞 4초를 Cab 하나만 두고 바이패스(끔)와 각 모델·마이크 위치(0·55·100)로 켠 출력의 RMS 차(켬 − 끔, dB)를 잰다.',
  steps: 'S1.4b',
  async run(ctx) {
    const input = signals.refPc(ctx.sampleRate, 4);
    const off = await ctx.render({ input: [input], pedals: [pedal('cab', {}, { bypassed: true })] });
    const offDb = bodyLevelDb(off);
    const values: Record<string, MetricValue> = { offDb };
    let largest = 0;
    for (const model of CAB_MODELS) {
      for (const mic of [0, 55, 100]) {
        const on = await ctx.render({ input: [input], pedals: [pedal('cab', { model, micPosition: mic })] });
        const difference = bodyLevelDb(on) - offDb;
        values[`diffDb.${model}.${mic}`] = difference;
        largest = Math.max(largest, Math.abs(difference));
      }
    }
    values.maxAbsDiffDb = largest;
    values.defaultDiffDb = values['diffDb.v30-4x12.55'];
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-05 — 프리셋 40개 출력 RMS (S1.4c: 팩토리 음량 보정을 적용한 소리를 판정한다)
// ---------------------------------------------------------------------------------------------
/** 드라이브 계열: 이 페달이 하나라도 켜져 있으면 '드라이브 프리셋', 없으면 '클린 프리셋'으로 본다. */
const DRIVE_FAMILY: ReadonlySet<PedalType> = new Set<PedalType>(['drive', 'crunch', 'fuzz']);

interface PresetLevel {
  id: string;
  name: string;
  levelDb: number;
  isDrive: boolean;
}

/** 클린 프리셋과 드라이브 프리셋 사이를 오갈 때 소리 크기가 얼마나 달라지는지(설계서 S1.4c 수용 기준, 표준 목표를 쓰는 프리셋만). */
function switchingSpread(levels: PresetLevel[]): { maxDiffDb: number; cleanCount: number; driveCount: number; top: string[] } {
  const clean = levels.filter((level) => !level.isDrive);
  const drive = levels.filter((level) => level.isDrive);
  const pairs: { a: PresetLevel; b: PresetLevel; diff: number }[] = [];
  for (const a of clean) for (const b of drive) pairs.push({ a, b, diff: Math.abs(a.levelDb - b.levelDb) });
  pairs.sort((x, y) => y.diff - x.diff);
  return {
    maxDiffDb: pairs[0]?.diff ?? 0,
    cleanCount: clean.length,
    driveCount: drive.length,
    top: pairs.slice(0, 5).map(({ a, b, diff }) => `${a.name}(클린) ↔ ${b.name}(드라이브): ${m.round(diff, 2)} dB`),
  };
}

const p05: ProbeDefinition = {
  id: 'P-05',
  title: '프리셋 출력 RMS',
  describe:
    '공장 프리셋마다 REF-PC(8초)를 두 번 렌더한다. ① 보정 없이·리미터 없이(rawDb: 계산 스크립트가 쓰는 원래 음량) ② 앱이 실제로 내보내는 소리(팩토리 음량 보정 + 리미터, preset 키). ' +
    '② 가 프리셋마다 목표(표준 −20 dBFS, D6 예외 프리셋은 따로) ± 2 안인지(deviationDb), 리미터가 눌러야 하는 양(limiterReductionDb)과 클린↔드라이브 전환의 음량 차를 본다. ' +
    '순간 피크가 커서 목표까지 올리면 리미터가 1 dB 넘게 눌러야 하는 프리셋은 피크가 0 dBFS 에 닿는 곳(achievableTargetDb)까지만 올리므로, deviationDb 는 그 도달 가능한 목표에서 잰다(offTargetDb 는 표준 목표에서 잰 참고값). ' +
    "'음량 맞추기' 버튼이 쓰는 빠른 렌더(quick.seconds 초)가 8초 렌더와 얼마나 다른지(quickMeasureErrorDb)도 잰다. 시간을 줄이려고 꺼진 페달은 체인에서 뺀다(꺼진 페달이 소리를 바꾸지 않음은 첫 프리셋을 15개 전체로 한 번 더 렌더해 bypassTransparent 로 확인한다).",
  steps: 'S1.4c, S3.8',
  async run(ctx) {
    const input = signals.refPc(ctx.sampleRate);
    const values: Record<string, MetricValue> = {};
    const levels: number[] = [];
    const rawLevels: number[] = [];
    const deviations: number[] = [];
    const offTargets: number[] = [];
    const headroomLimitedIds: string[] = [];
    const reductions: number[] = [];
    const quickErrors: number[] = [];
    const quickPeakErrors: number[] = [];
    const standard: PresetLevel[] = [];
    const levelById = new Map<string, number>();
    let firstFinal: OfflineRender | null = null;
    for (const preset of defaultPresets) {
      const pedals = activePedals(clonePedals(preset.pedals));
      const trimDb = preset.trimDb ?? 0;
      // ① 보정도 리미터도 없는 원래 음량. 보정값은 이 값에서 계산한다.
      const raw = await ctx.render({ input: [input], pedals, limiter: false, presetTrimDb: 0 });
      const rawDb = bodyLevelDb(raw);
      const rawPeakDb = Math.max(m.peakDb(raw.output[0]), m.peakDb(raw.output[1]));
      // ② 사용자가 듣는 소리: 팩토리 보정과 마스터 리미터를 모두 거친다.
      const final = await ctx.render({ input: [input], pedals, presetTrimDb: trimDb });
      firstFinal ??= final;
      const level = bodyLevelDb(final);
      const target = targetRmsDbfsFor(preset.id);
      // 피크 여유(GS-7) 때문에 목표까지 못 올린 프리셋은 도달 가능한 목표에서 어긋남을 본다.
      const achievable = achievableTargetDbfs(rawDb, rawPeakDb, target);
      const deviation = level - achievable;
      // 리미터는 천장을 넘는 피크만 천장까지 내린다. 보정을 거친 원래 피크가 천장을 얼마나 넘는지가 필요한 감소량이다.
      const reduction = limiterReductionDb(rawPeakDb + trimDb);
      values[`preset.${preset.id}`] = level;
      values[`rawDb.${preset.id}`] = rawDb;
      values[`rawPeakDb.${preset.id}`] = rawPeakDb;
      values[`trimDb.${preset.id}`] = trimDb;
      values[`deviationDb.${preset.id}`] = deviation;
      values[`offTargetDb.${preset.id}`] = level - target;
      values[`achievableTargetDb.${preset.id}`] = achievable;
      values[`headroomLimited.${preset.id}`] = isHeadroomLimited(rawDb, rawPeakDb, target);
      values[`peakDb.${preset.id}`] = Math.max(m.peakDb(final.output[0]), m.peakDb(final.output[1]));
      values[`limiterReductionDb.${preset.id}`] = reduction;
      levels.push(level);
      rawLevels.push(rawDb);
      deviations.push(deviation);
      offTargets.push(level - target);
      if (isHeadroomLimited(rawDb, rawPeakDb, target)) headroomLimitedIds.push(preset.id);
      reductions.push(reduction);
      levelById.set(preset.id, level);
      if (!(preset.id in PRESET_TARGET_OFFSETS_DB)) {
        standard.push({ id: preset.id, name: preset.name, levelDb: level, isDrive: pedals.some((candidate) => DRIVE_FAMILY.has(candidate.type)) });
      }
      // '음량 맞추기' 버튼과 같은 코드(computeTrimForChain)로 빠른 렌더를 하고, 8초 렌더와 얼마나 다른지 본다.
      const quick = await computeTrimForChain(pedals, { sampleRate: ctx.sampleRate });
      const quickError = quick.loudness.rmsDb - rawDb;
      values[`quickMeasureErrorDb.${preset.id}`] = quickError;
      quickErrors.push(quickError);
      // 피크 여유 판정도 빠른 렌더로 한다. 8초 렌더의 피크보다 낮게 재면 리미터가 그만큼 더 누른다.
      const quickPeakError = quick.loudness.peakDb - rawPeakDb;
      values[`quickPeakErrorDb.${preset.id}`] = quickPeakError;
      quickPeakErrors.push(quickPeakError);
    }
    const first = defaultPresets[0];
    const fullChain = await ctx.render({ input: [input], pedals: clonePedals(first.pedals), presetTrimDb: first.trimDb ?? 0 });
    const transparencyDb = firstFinal ? residualDb(fullChain, firstFinal) : 0;
    values.bypassNullDb = transparencyDb;
    values.bypassTransparent = transparencyDb < -90;
    values.count = levels.length;
    values.minDb = Math.min(...levels);
    values.maxDb = Math.max(...levels);
    values.medianDb = m.median(levels);
    values.spreadDb = Math.max(...levels) - Math.min(...levels);
    values.targetDb = PRESET_TARGET_RMS_DBFS;
    values.maxAbsDeviationDb = Math.max(...deviations.map(Math.abs));
    values.maxAbsOffTargetDb = Math.max(...offTargets.map(Math.abs));
    values.headroomLimitedCount = headroomLimitedIds.length;
    values.rawMinDb = Math.min(...rawLevels);
    values.rawMaxDb = Math.max(...rawLevels);
    values.rawMedianDb = m.median(rawLevels);
    values.rawSpreadDb = Math.max(...rawLevels) - Math.min(...rawLevels);
    values.maxLimiterReductionDb = Math.max(...reductions);
    values['quick.seconds'] = QUICK_MEASURE_SECONDS;
    values['quick.maxAbsErrorDb'] = Math.max(...quickErrors.map(Math.abs));
    values['quick.maxPeakUnderestimateDb'] = Math.max(0, ...quickPeakErrors.map((error) => -error));
    const switching = switchingSpread(standard);
    values['cleanDrive.maxDiffDb'] = switching.maxDiffDb;
    values['cleanDrive.cleanCount'] = switching.cleanCount;
    values['cleanDrive.driveCount'] = switching.driveCount;
    // 설계서가 따로 적어 둔 전환(Headphone Safe Start ↔ Texas Push). D6 예외라 위 판정에는 넣지 않고 숫자만 남긴다.
    const safeStart = levelById.get('factory-headphone-safe-start');
    const texasPush = levelById.get('factory-texas-push');
    if (safeStart !== undefined && texasPush !== undefined) values['switch.headphoneSafeToTexasPushDb'] = texasPush - safeStart;
    return {
      metrics: metrics(values),
      notes: [
        `피크 여유(GS-7) 때문에 평균 목표에 못 미치는 프리셋 ${headroomLimitedIds.length}개: ${headroomLimitedIds.map((id) => id.replace(/^factory-/, '')).join(', ') || '없음'}`,
        '클린↔드라이브 전환이 가장 큰 5쌍(D6 예외 프리셋 제외):',
        ...switching.top,
      ],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// P-06 — 한쪽 채널 입력
// ---------------------------------------------------------------------------------------------
/** 신호가 시작하고 이만큼 지나면 자동 판정(300 ms + 측정 간격)과 20 ms 전환이 모두 끝나 있다. 판정 뒤 구간만 잰다. */
const P06_SETTLED_SECONDS = 1;
/** 판정이 나기 전 구간(판정은 신호가 300 ms 쌓여야 나온다). 이때는 양쪽을 0.5 씩 합쳐 쓴다. */
const P06_PENDING_SECONDS = 0.25;

interface ChannelCaseOptions {
  /** 자동 판정이면 기대하는 판정. 수동 모드는 판정을 보지 않는다. */
  expectedDecision?: 'sum' | 'ch1' | 'ch2';
}

async function measureChannelCase(
  ctx: ProbeContext,
  name: string,
  input: Float32Array[],
  mode: InputChannelMode,
  reference: { settledDb: number; pendingDb: number },
  values: Record<string, MetricValue>,
  options: ChannelCaseOptions = {},
): Promise<void> {
  const captured: { decidedAtSeconds: number | null; decision: string } = { decidedAtSeconds: null, decision: 'pending' };
  const render = await ctx.render({
    input,
    pedals: [],
    inputChannelMode: mode,
    onBuilt(handle) {
      // 판정은 렌더를 멈춘 시각(context.currentTime)에 난다. 신호가 시작한 뒤 몇 초 만인지 기록한다.
      handle.inputStage.onDecision(() => {
        captured.decidedAtSeconds = handle.context.currentTime;
      });
    },
    afterRender(handle) {
      captured.decision = handle.inputStage.decision;
    },
  });
  const from = seconds(render, P06_SETTLED_SECONDS);
  const to = render.leadFrames + render.signalFrames;
  const left = m.rmsDb(render.output[0], from, to);
  const right = m.rmsDb(render.output[1], from, to);
  values[`${name}.leftDb`] = left;
  values[`${name}.rightDb`] = right;
  values[`${name}.lrDiffDb`] = Math.abs(left - right);
  values[`${name}.lossDb`] = reference.settledDb - bodyLevelDb(render, P06_SETTLED_SECONDS);
  if (options.expectedDecision === undefined) return;
  values[`${name}.decision`] = captured.decision;
  values[`${name}.decisionOk`] = captured.decision === options.expectedDecision ? 1 : 0;
  values[`${name}.decisionSeconds`] =
    captured.decidedAtSeconds === null ? null : captured.decidedAtSeconds - render.leadFrames / render.sampleRate;
  values[`${name}.pendingLossDb`] = reference.pendingDb - bodyLevelDb(render, 0, P06_PENDING_SECONDS);
}

const p06: ProbeDefinition = {
  id: 'P-06',
  title: '한쪽 채널 입력',
  describe:
    '이펙트 없이(빈 체인) REF-PC 를 2채널 입력의 왼쪽만·오른쪽만·양쪽 같은 소리로 넣고, 자동 판정이 끝난 뒤(신호 시작 1초 이후)의 좌우 레벨 차와 모노 입력 기준 출력 대비 손실을 잰다. 판정 결과와 걸린 시간, 판정 전 구간의 손실도 같이 남긴다. 수동 모드(1번·2번·스테레오)는 왼쪽만 넣은 신호로 참고용으로 잰다.',
  steps: 'S1.3',
  async run(ctx) {
    const pc = signals.refPc(ctx.sampleRate);
    // 모노 입력은 채널 선택 없이 그대로 지나간다. 이 출력이 "손실 없음"의 기준이다.
    const monoReference = await ctx.render({ input: [pc], pedals: [] });
    const reference = {
      settledDb: bodyLevelDb(monoReference, P06_SETTLED_SECONDS),
      pendingDb: bodyLevelDb(monoReference, 0, P06_PENDING_SECONDS),
    };
    const values: Record<string, MetricValue> = { referenceDb: reference.settledDb };
    await measureChannelCase(ctx, 'auto.left', signals.leftOnly(pc), 'auto', reference, values, { expectedDecision: 'ch1' });
    await measureChannelCase(ctx, 'auto.right', signals.rightOnly(pc), 'auto', reference, values, { expectedDecision: 'ch2' });
    await measureChannelCase(ctx, 'auto.both', [pc, pc.slice()], 'auto', reference, values, { expectedDecision: 'sum' });
    const manualModes: InputChannelMode[] = ['ch1', 'ch2', 'stereo'];
    for (const mode of manualModes) {
      await measureChannelCase(ctx, `manual.${mode}`, signals.leftOnly(pc), mode, reference, values);
    }
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-07 — 하울링 판정 매트릭스(S1.5)
// ---------------------------------------------------------------------------------------------
/**
 * 렌더가 끝난 직후에도 워클릿 포트 메시지가 조금 늦게 도착한다. 끝 쪽 메시지를 놓치지 않도록,
 * 메시지 수가 이 간격(ms)을 연달아 세 번 지켜볼 동안 늘지 않을 때까지 기다린다(최대 MONITOR_FLUSH_MAX_MS).
 */
const MONITOR_FLUSH_POLL_MS = 20;
const MONITOR_FLUSH_MAX_MS = 1000;

type CutMessage = Extract<MonitorMsg, { type: 'howl-cut' }>;
type SuspectMessage = Extract<MonitorMsg, { type: 'howl-suspect' }>;

interface GuardRender {
  render: OfflineRender;
  messages: MonitorMsg[];
}

/** 렌더하고 가드·미터·리미터가 보낸 메시지를 모두 모아 돌려준다. */
async function renderWithMonitor(ctx: ProbeContext, request: ChainRequest): Promise<GuardRender> {
  let messages: MonitorMsg[] = [];
  const render = await ctx.render({
    ...request,
    async afterRender(handle) {
      let stable = 0;
      let seen = -1;
      for (let waited = 0; stable < 3 && waited < MONITOR_FLUSH_MAX_MS; waited += MONITOR_FLUSH_POLL_MS) {
        await new Promise((resolve) => setTimeout(resolve, MONITOR_FLUSH_POLL_MS));
        stable = handle.monitorMessages.length === seen ? stable + 1 : 0;
        seen = handle.monitorMessages.length;
      }
      messages = [...handle.monitorMessages];
    },
  });
  return { render, messages };
}

interface HowlCase {
  name: string;
  samples: (sampleRate: number) => Float32Array;
  /** 입력 이득(dB). H-4 의 '입력 한계 +20 dB 상당'은 신호가 아니라 이 설정으로 준다. */
  inputGainDb?: number;
  /** 하울링이어야 하는 신호인가(H) 아니면 오차단을 시험하는 신호인가(G). */
  howl: boolean;
  /** H 는 앱 기본 구성(보고서 재현 조건), G 는 판정이 체인과 무관하므로 빈 체인(60초 렌더 시간을 아낀다). */
  pedals: () => PedalState[];
}

const P07_CASES: HowlCase[] = [
  { name: 'H-1', samples: signals.howl1, howl: true, pedals: () => clonePedals(initialPedals) },
  { name: 'H-2', samples: signals.howl2, howl: true, pedals: () => clonePedals(initialPedals) },
  { name: 'H-3', samples: signals.howl3, howl: true, pedals: () => clonePedals(initialPedals) },
  { name: 'H-4', samples: signals.howl4, inputGainDb: 20, howl: true, pedals: () => clonePedals(initialPedals) },
  { name: 'G-1', samples: (rate) => signals.sustainLead(rate), howl: false, pedals: () => [] },
  { name: 'G-2', samples: (rate) => signals.strumming(rate), howl: false, pedals: () => [] },
  { name: 'G-3', samples: (rate) => signals.noiseFloor(rate), howl: false, pedals: () => [] },
];

/** 한 신호를 가드에 넣고 차단 여부·시각·무음 유지를 values 에 기록한다. 돌려주는 값은 무음 완료 시각(차단이 없으면 null). */
function recordGuardResult(values: Record<string, MetricValue>, name: string, result: GuardRender): number | null {
  const { render, messages } = result;
  const cuts = messages.filter((message): message is CutMessage => message.type === 'howl-cut');
  const suspects = messages.filter((message): message is SuspectMessage => message.type === 'howl-suspect');
  values[`${name}.cutCount`] = cuts.length;
  values[`${name}.suspectCount`] = suspects.length;
  values[`${name}.maxSuspectMs`] = suspects.reduce((longest, suspect) => Math.max(longest, suspect.heldMs), 0);
  const rate = render.sampleRate;
  const length = render.output[0].length;
  values[`${name}.tailRmsDb`] = m.stereoRmsDb(render.output, Math.max(0, length - rate), length);
  if (cuts.length === 0) {
    values[`${name}.mutedSeconds`] = null;
    values[`${name}.cutHz`] = null;
    values[`${name}.silentAfterCut`] = null;
    return null;
  }
  const cut = cuts[0];
  // frame 은 10 ms 램프가 끝나 출력이 완전히 0 이 된 양자의 끝 오디오 시계다. 신호가 시작한 때부터 잰다.
  const mutedSeconds = (cut.frame - render.leadFrames) / rate;
  values[`${name}.mutedSeconds`] = mutedSeconds;
  values[`${name}.cutHz`] = cut.freqHz;
  const leftover = Math.max(...render.output.map((channel) => m.peakLinear(channel, cut.frame, channel.length)));
  values[`${name}.silentAfterCut`] = leftover === 0 ? 1 : 0;
  return mutedSeconds;
}

const p07: ProbeDefinition = {
  id: 'P-07',
  title: '하울링 판정 매트릭스',
  describe:
    '설계서 부록 A 의 시험 신호를 장치 모드 가드(output-guard)에 넣고 차단 여부·무음 완료 시각(신호 시작부터)·차단 주파수·차단 뒤 출력이 완전히 0 인지를 잰다. H-1~H-3 는 앱 기본 구성에, H-4 는 입력 이득 +20 dB(보고서 재현 조건)로 넣는다. G-1~G-3(60초)은 빈 체인으로 오차단 여부만 본다(판정은 체인 앞에서 하므로 체인과 무관하다). 파일 모드와 보호 끔에서는 H-1 이 차단되지 않는지도 본다. 판정은 출력 레벨을 보지 않는다(D9).',
  steps: 'S1.5',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const values: Record<string, MetricValue> = {};
    const howlMuted: number[] = [];
    let hits = 0;
    let falseCuts = 0;
    let silentFailures = 0;
    for (const item of P07_CASES) {
      const result = await renderWithMonitor(ctx, {
        input: [item.samples(rate)],
        pedals: item.pedals(),
        inputGainDb: item.inputGainDb ?? 0,
        guardMode: 'device',
      });
      const muted = recordGuardResult(values, item.name, result);
      if (item.howl) {
        if (muted !== null) {
          hits += 1;
          howlMuted.push(muted);
          if (values[`${item.name}.silentAfterCut`] !== 1) silentFailures += 1;
        }
      } else if (muted !== null) {
        falseCuts += 1;
      }
    }
    values.hits = hits;
    values.maxMutedSeconds = howlMuted.length > 0 ? Math.max(...howlMuted) : null;
    values.minMutedSeconds = howlMuted.length > 0 ? Math.min(...howlMuted) : null;
    values.falseCuts = falseCuts;
    values.silentFailures = silentFailures;

    // 판정이 꺼지는 두 경우: 파일 재생(마이크가 없으면 되먹임도 없다)과 사용자가 보호를 끈 경우. 소리는 그대로 나와야 한다.
    const h1 = signals.howl1(rate);
    const fileMode = await renderWithMonitor(ctx, { input: [h1], pedals: [], source: 'file', guardMode: 'device' });
    recordGuardResult(values, 'fileMode.H-1', fileMode);
    const protectionOff = await renderWithMonitor(ctx, { input: [h1], pedals: [], source: 'device', guardMode: 'off' });
    recordGuardResult(values, 'protectionOff.H-1', protectionOff);
    values.disabledModeCuts = Number(values['fileMode.H-1.cutCount']) + Number(values['protectionOff.H-1.cutCount']);
    values.disabledModeSoundDb = Math.min(Number(values['fileMode.H-1.tailRmsDb']), Number(values['protectionOff.H-1.tailRmsDb']));
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-08 — Compressor Mix 리플
// ---------------------------------------------------------------------------------------------
const p08: ProbeDefinition = {
  id: 'P-08',
  title: 'Compressor Mix 리플',
  describe:
    'REF-NOISE(−20 dBFS, 20초)를 Compressor 하나로 통과시켜 0.1~1 kHz 를 1/12 옥타브 대역으로 나눈 이득(출력/입력 전력비)의 최대−최소 ÷ 2(± 리플)를 Mix 75%·45%에서 잰다.',
  steps: 'S3.6',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const noise = signals.refNoise(rate, 20, -20);
    const centers = m.octaveCenters(100, 1000, 12);
    const values: Record<string, MetricValue> = {};
    for (const mix of [75, 45]) {
      const render = await ctx.render({ input: [noise], pedals: [pedal('compressor', { mix })] });
      const spectra = m.welchSpectra(render.input[0], render.output[0], rate, {
        fftSize: 8192,
        start: seconds(render, 1),
        end: render.leadFrames + render.signalFrames,
      });
      const gains = m.bandGainDb(spectra, centers, 1 / 12);
      values[`mix${mix}.rippleDb`] = (Math.max(...gains) - Math.min(...gains)) / 2;
      values[`mix${mix}.minDb`] = Math.min(...gains);
      values[`mix${mix}.maxDb`] = Math.max(...gains);
    }
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-09 — Cab 좌우 음량 차
// ---------------------------------------------------------------------------------------------
const p09: ProbeDefinition = {
  id: 'P-09',
  title: 'Cab 좌우 음량 차',
  describe:
    'REF-SINES(80 Hz~5 kHz, 1/3옥타브 18음)를 Cab 하나로 통과시켜 음마다 가운데 0.37초의 왼쪽·오른쪽 진폭 차(dB)를 잰다.',
  steps: 'S3.2',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const { samples, tones } = signals.refSines(rate);
    const render = await ctx.render({ input: [samples], pedals: [pedal('cab')] });
    const values: Record<string, MetricValue> = {};
    let largest = 0;
    for (const tone of tones) {
      const start = seconds(render, tone.startSeconds + 0.1);
      const left = m.dbOf(m.toneAmplitude(render.output[0], rate, tone.frequency, start, 16384));
      const right = m.dbOf(m.toneAmplitude(render.output[1], rate, tone.frequency, start, 16384));
      values[`lrDiffDb.${Math.round(tone.frequency)}`] = left - right;
      largest = Math.max(largest, Math.abs(left - right));
    }
    values.maxAbsLrDiffDb = largest;
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-10 — Tape 음정 흔들림
// ---------------------------------------------------------------------------------------------
const p10: ProbeDefinition = {
  id: 'P-10',
  title: 'Tape 음정 흔들림',
  describe:
    '1 kHz 사인 0.7초(−18 dBFS)를 Delay Tape(800 ms, 피드백 0, Mix 100%)로 보내 원음과 겹치지 않는 메아리 구간(0.85~1.45초)의 주기별 순간 주파수 최소·최대를 잰다.',
  steps: 'S3.3',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const burst = signals.refSine(rate, 0.7, 1000, -18);
    const input = new Float32Array(Math.round(rate * 2.2));
    input.set(burst);
    const render = await ctx.render({
      input: [input],
      pedals: [pedal('delay', { mode: 'tape', timeMs: 800, feedback: 0, mix: 100, sync: false })],
    });
    const { frequencies } = m.cycleFrequencies(render.output[0], rate, seconds(render, 0.85), seconds(render, 1.45));
    const usable = frequencies.filter((frequency) => frequency > 500 && frequency < 2000);
    const minHz = Math.min(...usable);
    const maxHz = Math.max(...usable);
    return {
      metrics: metrics({
        cycles: usable.length,
        minHz,
        maxHz,
        deviationPercent: (Math.max(Math.abs(minHz - 1000), Math.abs(maxHz - 1000)) / 1000) * 100,
      }),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// P-11 / P-12 — Flanger 노치, Phaser 리플
// ---------------------------------------------------------------------------------------------
function describeNotches(notches: m.Notch[]): { first: number | null; spacing: number | null } {
  if (notches.length === 0) return { first: null, spacing: null };
  const spacing = notches.length >= 3 ? (notches[2].frequency - notches[0].frequency) / 2 : null;
  return { first: notches[0].frequency, spacing };
}

const p11: ProbeDefinition = {
  id: 'P-11',
  title: 'Flanger 노치',
  describe:
    'REF-NOISE(−20 dBFS)를 Flanger 하나로 통과시켜 전달함수(H1)의 노치를 찾는다. static: 지연 2 ms 고정(LFO 깊이 0)에서 첫 노치와 간격(피드백 0·Mix 50% 와 기본값 두 가지). sweep: 기본값으로 LFO 한 주기(4초) 동안 첫 노치가 움직이는 범위.',
  steps: 'S3.4',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const noise = signals.refNoise(rate, 10, -20);
    const values: Record<string, MetricValue> = {};

    const variants: Array<[string, Record<string, PedalParamValue>, number]> = [
      ['comb', { mix: 50, depth: 0, manual: 2, feedback: 0 }, 3],
      ['default', { depth: 0, manual: 2 }, 2],
    ];
    for (const [name, params, prominence] of variants) {
      const render = await ctx.render({ input: [noise], pedals: [pedal('flanger', params)] });
      const spectra = m.welchSpectra(render.input[0], render.output[0], rate, {
        fftSize: 8192,
        start: seconds(render, 1),
        end: render.leadFrames + render.signalFrames,
      });
      const notches = m.findNotches(spectra.frequencies, m.h1MagnitudeDb(spectra), {
        fMin: 60,
        fMax: 2000,
        minProminenceDb: prominence,
      });
      const { first, spacing } = describeNotches(notches);
      values[`static.${name}.firstNotchHz`] = first;
      values[`static.${name}.notchSpacingHz`] = spacing;
      values[`static.${name}.impliedDelayMs`] = first === null ? null : 500 / first;
      values[`static.${name}.notchCount`] = notches.length;
    }

    // LFO 한 주기(0.25 Hz → 4초) 동안 첫 노치의 위치. 프레임마다 4개 구간의 H1 을 평균한다.
    const sweepNoise = signals.refNoise(rate, 4.6, -20);
    const sweep = await ctx.render({ input: [sweepNoise], pedals: [pedal('flanger')] });
    const found: number[] = [];
    for (let center = 0.3; center <= 4.3; center += 0.2) {
      const start = seconds(sweep, center) - 3584;
      const spectra = m.welchSpectra(sweep.input[0], sweep.output[0], rate, {
        fftSize: 4096,
        hop: 1024,
        start,
        end: start + 4096 + 3 * 1024,
      });
      const first = m.findNotches(spectra.frequencies, m.h1MagnitudeDb(spectra), {
        fMin: 100,
        fMax: 1000,
        minProminenceDb: 1.5,
      })[0];
      if (first) found.push(first.frequency);
    }
    values['sweep.frames'] = found.length;
    values['sweep.minHz'] = found.length > 0 ? Math.min(...found) : null;
    values['sweep.maxHz'] = found.length > 0 ? Math.max(...found) : null;
    return { metrics: metrics(values) };
  },
};

const p12: ProbeDefinition = {
  id: 'P-12',
  title: 'Phaser 리플',
  describe:
    'REF-NOISE(−20 dBFS)를 Phaser(6단, 피드백 90%, 깊이 0 = 노치 고정, Mix 50%)로 통과시켜 전달함수를 잰다. combRippleDb: 1.5~9 kHz 에서 ±1.5 kHz 이동 평균을 뺀 나머지의 최대−최소(넓은 설계상의 노치·공진은 빠지고 좁은 간격의 빗살만 남는다). highBandRippleDb: 4~10 kHz 원시 최대−최소.',
  steps: 'S3.4',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const noise = signals.refNoise(rate, 10, -20);
    const render = await ctx.render({
      input: [noise],
      pedals: [pedal('phaser', { mix: 50, depth: 0, feedback: 90, stages: 6 })],
    });
    const spectra = m.welchSpectra(render.input[0], render.output[0], rate, {
      fftSize: 8192,
      start: seconds(render, 1),
      end: render.leadFrames + render.signalFrames,
    });
    const magnitude = m.h1MagnitudeDb(spectra);
    const inBand = (low: number, high: number): number[] => {
      const picked: number[] = [];
      spectra.frequencies.forEach((frequency, index) => {
        if (frequency >= low && frequency <= high) picked.push(magnitude[index]);
      });
      return picked;
    };
    const high = inBand(4000, 10000);
    const all = inBand(100, 10000);
    const notches = m.findNotches(spectra.frequencies, magnitude, { fMin: 100, fMax: 10000, minProminenceDb: 3, smoothBins: 1 });
    return {
      metrics: metrics({
        combRippleDb: m.detrendedRippleDb(spectra.frequencies, magnitude, 1500, 9000, 1500),
        highBandRippleDb: Math.max(...high) - Math.min(...high),
        maxDb: Math.max(...all),
        minDb: Math.min(...all),
        notchCount: notches.length,
      }),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// P-13 / P-14 — 노브에 따른 THD
// ---------------------------------------------------------------------------------------------
const KNOB_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];

async function thdAtKnobs(
  ctx: ProbeContext,
  build: (knob: number) => PedalState,
): Promise<number[]> {
  const rate = ctx.sampleRate;
  const input = signals.refSine(rate, 3, 220, -18);
  const result: number[] = [];
  for (const knob of KNOB_STEPS) {
    const render = await ctx.render({ input: [input], pedals: [build(knob)] });
    result.push(m.thdPercent(render.output[0], rate, 220, seconds(render, 1), 32768));
  }
  return result;
}

const p13: ProbeDefinition = {
  id: 'P-13',
  title: 'Drive Distortion THD-노브 곡선',
  describe:
    'REF-SINE 220 Hz(−18 dBFS)를 Drive(Mix 100%)로 통과시켜 drive 노브 0~100(10 단위)의 THD(2~10배음, %)를 Distortion·Overdrive 모드에서 잰다.',
  steps: 'S3.5',
  async run(ctx) {
    const distortion = await thdAtKnobs(ctx, (knob) => pedal('drive', { mode: 'distortion', drive: knob, mix: 100 }));
    const overdrive = await thdAtKnobs(ctx, (knob) => pedal('drive', { mode: 'overdrive', drive: knob, mix: 100 }));
    const values: Record<string, MetricValue> = {};
    KNOB_STEPS.forEach((knob, index) => {
      values[`distortion.${knob}`] = distortion[index];
      values[`overdrive.${knob}`] = overdrive[index];
    });
    values['distortion.monotonic'] = distortion.every((value, index) => index === 0 || value >= distortion[index - 1] - 0.05);
    values['distortion.at30MinusOverdriveAt30'] = distortion[3] - overdrive[3];
    return { metrics: metrics(values) };
  },
};

const p14: ProbeDefinition = {
  id: 'P-14',
  title: 'Crunch THD-노브 곡선',
  describe: 'REF-SINE 220 Hz(−18 dBFS)를 Crunch(Mix 100%)로 통과시켜 gain 노브 0~100(10 단위)의 THD(%)를 잰다.',
  steps: 'S3.5',
  async run(ctx) {
    const thd = await thdAtKnobs(ctx, (knob) => pedal('crunch', { gain: knob, mix: 100 }));
    const values: Record<string, MetricValue> = {};
    KNOB_STEPS.forEach((knob, index) => {
      values[`gain.${knob}`] = thd[index];
    });
    let smallestStep = Number.POSITIVE_INFINITY;
    for (let index = 1; index < thd.length; index += 1) smallestStep = Math.min(smallestStep, thd[index] - thd[index - 1]);
    values.smallestStepPercent = smallestStep;
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-15 — Delay·Reverb 원음 레벨
// ---------------------------------------------------------------------------------------------
const p15: ProbeDefinition = {
  id: 'P-15',
  title: 'Delay·Reverb 원음 레벨',
  describe:
    'Mix 30%에서 원음(직접음)의 변화. REF-IMPULSE(0.1초 위치)의 직접음 피크를 해당 페달을 바이패스했을 때와 견준다. Delay 는 REF-PC 첫 0.25초(첫 메아리 전) RMS 로도 잰다.',
  steps: 'S3.1',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const position = Math.round(rate * 0.1);
    const impulse = signals.refImpulse(rate, 2, position);
    const values: Record<string, MetricValue> = {};
    for (const type of ['delay', 'reverb'] as const) {
      const bypass = await ctx.render({ input: [impulse], pedals: [pedal(type, { mix: 30 }, { bypassed: true })] });
      const active = await ctx.render({ input: [impulse], pedals: [pedal(type, { mix: 30 })] });
      const from = bypass.leadFrames + position - 2;
      const to = bypass.leadFrames + position + Math.round(rate * 0.01);
      values[`${type}.dryChangeDb`] = m.dbOf(m.peakLinear(active.output[0], from, to)) - m.dbOf(m.peakLinear(bypass.output[0], from, to));
    }
    const pc = signals.refPc(rate, 2);
    const bypassPc = await ctx.render({ input: [pc], pedals: [pedal('delay', { mix: 30 }, { bypassed: true })] });
    const activePc = await ctx.render({ input: [pc], pedals: [pedal('delay', { mix: 30 })] });
    values['delay.pcDryChangeDb'] = bodyLevelDb(activePc, 0, 0.25) - bodyLevelDb(bypassPc, 0, 0.25);
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-16 — 처리 지연
// ---------------------------------------------------------------------------------------------
const p16: ProbeDefinition = {
  id: 'P-16',
  title: '처리 지연',
  describe:
    '구성마다 REF-NOISE(−20 dBFS) 입력과 왼쪽 출력의 상호상관 최댓값 위치를 지연(ms)으로 읽는다(동적 처리는 단일 임펄스에 반응하지 않아 임펄스 대신 잡음을 쓴다). 기본 구성은 REF-IMPULSE 의 첫 반응 시각(최대 피크의 10% 이상)도 잰다. 마스터 리미터의 룩어헤드 1 ms 가 모든 값에 더해진다(S1.4a 부터).',
  steps: 'S3.6, S3.7',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const noise = signals.refNoise(rate, 1.5, -20);
    const defaults = clonePedals(initialPedals).filter((candidate) => candidate.enabled && !candidate.bypassed);
    const configurations: Array<[string, PedalState[]]> = [
      ['empty', []],
      ['noiseGate', [pedal('noise-gate')]],
      ['compressor', [pedal('compressor')]],
      ['drive', [pedal('drive')]],
      ['crunch', [pedal('crunch')]],
      ['fuzz', [pedal('fuzz')]],
      ['graphicEq', [pedal('graphic-eq')]],
      ['eq', [pedal('eq')]],
      ['cab', [pedal('cab')]],
      ['default', defaults],
    ];
    const values: Record<string, MetricValue> = {};
    for (const [name, pedals] of configurations) {
      // 앱이 실제로 내는 지연을 재므로 리미터의 고정 지연(1 ms)을 걷어 내지 않는다.
      const render = await ctx.render({
        input: [noise],
        pedals: pedals.map((candidate) => ({ ...candidate })),
        alignOutput: false,
      });
      const { lagSamples, coefficient } = m.crossCorrelationLag(
        render.input[0],
        render.output[0],
        Math.round(rate * 0.02),
        seconds(render, 0.3),
        seconds(render, 1.3),
      );
      values[`latencyMs.${name}`] = (lagSamples / rate) * 1000;
      values[`correlation.${name}`] = coefficient;
    }
    const position = Math.round(rate * 0.1);
    const impulse = await ctx.render({
      input: [signals.refImpulse(rate, 1, position)],
      pedals: clonePedals(initialPedals).filter((candidate) => candidate.enabled && !candidate.bypassed),
      alignOutput: false,
    });
    const channel = impulse.output[0];
    const impulseAt = impulse.leadFrames + position;
    const offset = mean(Array.from(channel.subarray(impulseAt - Math.round(rate * 0.05), impulseAt - 50)));
    const centered = channel.map((sample) => sample - offset);
    const peak = m.peakLinear(centered, impulseAt - 4, centered.length);
    const onset = m.firstIndexAtOrAbove(centered, peak * 0.1, impulseAt - 4);
    values['impulseOnsetMs.default'] = onset < 0 ? null : ((onset - impulseAt) / rate) * 1000;
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-17 — 렌더 시간(CPU 대용 지표)
// ---------------------------------------------------------------------------------------------
const p17: ProbeDefinition = {
  id: 'P-17',
  title: '렌더 시간(CPU 대용 지표)',
  describe:
    'REF-PC 6초를 구성마다 5번(구성을 돌려가며) 렌더해 가장 빠른 시간을 쓴다. cpuShare = 렌더 시간 ÷ 오디오 길이. 시간 자체(time.*)는 기계마다 달라 비교하지 않고, 비율(ratio.*)만 기준선과 견준다. 처음 다섯 구성은 레벨 미터·출력 가드를 뺀 그래프(S1.5 이전 모양)로 재서 예전 기준선과 이어지고, 미터 둘과 장치 모드 가드(하울링 판정)를 넣은 빈 체인(emptyMonitored)과 15개를 모두 켠 체인(allOnMonitored)의 시간 차이를 따로 잰다. monitorOverheadOverPedals = 가드·미터가 더한 시간 ÷ 15개 페달이 쓰는 시간(설계서 S1.5 수용 기준 ≤ 5%).',
  steps: 'S1.5, S3.4, S4.2',
  async run(ctx) {
    const input = signals.refPc(ctx.sampleRate, 6);
    // 처음 다섯 구성은 S1.5 이전과 같은 그래프(monitoring: false)로 잰다. 기준선 값이 의미를 바꾸지 않는다.
    const configurations: Array<[string, () => ChainRequest]> = [
      ['empty', () => ({ input: [input], pedals: [], monitoring: false })],
      ['allOff', () => ({ input: [input], pedals: allPedalsBypassed(), monitoring: false })],
      ['allOn', () => ({ input: [input], pedals: allPedalsOn(), monitoring: false })],
      ['phaserOff', () => ({ input: [input], pedals: [pedal('phaser', {}, { bypassed: true })], monitoring: false })],
      ['phaserOn', () => ({ input: [input], pedals: [pedal('phaser')], monitoring: false })],
      // 레벨 미터 둘 + 출력 가드(장치 모드: 하울링 판정이 FFT 를 돌린다)
      ['emptyMonitored', () => ({ input: [input], pedals: [], monitoring: true, guardMode: 'device' })],
      ['allOnMonitored', () => ({ input: [input], pedals: allPedalsOn(), monitoring: true, guardMode: 'device' })],
    ];
    // 구성을 돌려가며(라운드마다 모든 구성을 한 번씩) 잰다. 한 구성을 몰아서 재면 그 시간대의 기계 잡음(다른 프로세스·클럭)이 한 구성에만 실려
    // 구성 사이 비율이 흔들린다. 라운드를 섞으면 모든 구성이 조용한 순간을 한 번은 만나고, 구성마다 가장 빠른 값이 그 순간의 값이 된다.
    const ATTEMPTS = 5;
    const best: Record<string, number> = Object.fromEntries(configurations.map(([name]) => [name, Number.POSITIVE_INFINITY]));
    let audioSeconds = 0;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      for (const [name, build] of configurations) {
        const render = await ctx.render(build());
        best[name] = Math.min(best[name], render.renderMilliseconds);
        audioSeconds = (render.leadFrames + render.signalFrames) / render.sampleRate;
      }
    }
    const values: Record<string, MetricValue> = {};
    for (const [name, milliseconds] of Object.entries(best)) {
      values[`time.${name}Ms`] = milliseconds;
      values[`cpuShare.${name}`] = milliseconds / (audioSeconds * 1000);
    }
    values['ratio.allOffOverAllOn'] = best.allOff / best.allOn;
    values['ratio.phaserOffContribution'] = (best.phaserOff - best.empty) / best.allOn;
    values['ratio.phaserOnContribution'] = (best.phaserOn - best.empty) / best.allOn;
    // 가드·미터가 더한 시간을 15개 페달이 쓰는 시간(켠 체인 − 빈 체인)으로 나눈다. 두 가지 체인에서 각각 잰다.
    values['ratio.monitorOverheadOverPedals'] = (best.emptyMonitored - best.empty) / (best.allOn - best.empty);
    values['ratio.monitorOverheadInAllOn'] = (best.allOnMonitored - best.allOn) / (best.allOn - best.empty);
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-18 — 꺼진 페달을 켰을 때의 변화
// ---------------------------------------------------------------------------------------------
const p18: ProbeDefinition = {
  id: 'P-18',
  title: '꺼진 페달을 켰을 때의 변화',
  describe:
    '공장 프리셋마다 꺼진 페달을 (그 페달의 저장된 값 그대로) 혼자 켜 REF-PC 2초를 통과시키고, 원음(빈 체인)과 견준다. 변화 = RMS 차 ≥ 0.5 dB 또는 1/3옥타브 대역 전력의 평균 절대 차 ≥ 1 dB. 같은 값의 페달은 한 번만 렌더한다.',
  steps: 'S2.1',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const input = signals.refPc(rate, 2);
    const centers = m.octaveCenters(100, 8000, 3);
    const analyse = (render: OfflineRender) => {
      const spectra = m.welchSpectra(render.output[0], render.output[0], rate, {
        fftSize: 4096,
        start: render.leadFrames,
        end: render.leadFrames + render.signalFrames,
      });
      return { level: bodyLevelDb(render), bands: m.bandPowerDb(spectra, centers, 1 / 3) };
    };
    const original = analyse(await ctx.render({ input: [input], pedals: [] }));
    const verdicts = new Map<string, boolean>();
    let tested = 0;
    const unchanged: string[] = [];
    for (const preset of defaultPresets) {
      for (const candidate of preset.pedals) {
        if (candidate.enabled && !candidate.bypassed) continue;
        const key = JSON.stringify([candidate.type, candidate.params]);
        let changed = verdicts.get(key);
        if (changed === undefined) {
          const turned = analyse(await ctx.render({ input: [input], pedals: [{ ...candidate, enabled: true, bypassed: false }] }));
          const levelChange = Math.abs(turned.level - original.level);
          const spectralChange = mean(turned.bands.map((band, index) => Math.abs(band - original.bands[index])));
          changed = levelChange >= 0.5 || spectralChange >= 1;
          verdicts.set(key, changed);
        }
        tested += 1;
        if (!changed) unchanged.push(`${preset.id}:${candidate.id}`);
      }
    }
    return {
      metrics: metrics({
        presets: defaultPresets.length,
        tested,
        distinctRendered: verdicts.size,
        unchangedCount: unchanged.length,
      }),
      notes: unchanged.length > 0 ? [`변화 없음: ${unchanged.join(', ')}`] : [],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// P-20 — Reverb Decay 변환
// ---------------------------------------------------------------------------------------------
const p20: ProbeDefinition = {
  id: 'P-20',
  title: 'Reverb Decay 변환',
  describe:
    'Decay 가 6초를 넘는 공장 프리셋의 Reverb 를 저장값 그대로와 decay 6.0 으로 바꾼 것으로 REF-PC 3초를 렌더해, 두 출력의 차(널 테스트)가 출력 대비 몇 dB 인지 잰다. −200 은 완전히 같다는 뜻이다.',
  steps: 'S2.2',
  async run(ctx) {
    const input = signals.refPc(ctx.sampleRate, 3);
    const values: Record<string, MetricValue> = {};
    let maxDecay = 0;
    for (const preset of defaultPresets) {
      const reverb = preset.pedals.find((candidate) => candidate.type === 'reverb');
      if (!reverb) continue;
      const decay = Number(reverb.params.decay);
      maxDecay = Math.max(maxDecay, decay);
      if (decay <= 6) continue;
      const render = (value: number) =>
        ctx.render({
          input: [input],
          pedals: [{ ...reverb, enabled: true, bypassed: false, params: { ...reverb.params, decay: value } as PedalParams }],
        });
      const stored = await render(decay);
      const converted = await render(6);
      values[`nullDb.${preset.id}`] = residualDb(stored, converted);
      values[`storedDecay.${preset.id}`] = decay;
    }
    values.maxStoredDecay = maxDecay;
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-21 — GR 표시
// ---------------------------------------------------------------------------------------------
const p21: ProbeDefinition = {
  id: 'P-21',
  title: 'Compressor GR 표시',
  describe:
    'Compressor(기본값)의 Gain Reduction 표시값(getGainReduction)을 무음 2초와 −10 dBFS 220 Hz 지속음 3초 뒤에 읽는다. 지속음은 Mix 100%의 입출력 레벨 차도 함께 적는다.',
  steps: 'S2.2, S3.6',
  async run(ctx) {
    const rate = ctx.sampleRate;
    let displayed = 0;
    const read = async (input: Float32Array, mix?: number) => {
      let value = Number.NaN;
      const render = await ctx.render({
        input: [input],
        pedals: [pedal('compressor', mix === undefined ? {} : { mix })],
        afterRender: async (handle) => {
          await delayMs(150);
          const effect = handle.effects.get('compressor');
          if (effect instanceof CompressorEffect) value = effect.getGainReduction();
        },
      });
      displayed = value;
      return render;
    };
    await read(new Float32Array(rate * 2));
    const silenceDb = displayed;
    const tone = signals.refSine(rate, 3, 220, -10);
    await read(tone);
    const toneDb = displayed;
    const full = await read(tone, 100);
    return {
      metrics: metrics({
        displayedSilenceDb: silenceDb,
        displayedToneDb: toneDb,
        toneLevelChangeDb: bodyLevelDb(full, 1) - m.rmsDb(tone, rate, tone.length),
      }),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// P-22 — 튜너 정확도(회귀)
// ---------------------------------------------------------------------------------------------
const TUNER_NOTES: Array<[string, number]> = [
  ['E2', 82.41],
  ['A2', 110],
  ['D3', 146.83],
  ['G3', 196],
  ['B3', 246.94],
  ['E4', 329.63],
  ['B1', 61.74],
  ['C2', 65.41],
];

const p22: ProbeDefinition = {
  id: 'P-22',
  title: '튜너 정확도',
  describe:
    'tuner-processor 워클릿에 뜯은 현 소리(3초)를 넣고, 앞 40%를 버린 판독값의 중앙값이 기대 주파수와 몇 센트 다른지 잰다. 개방현 6개와 B1·C2 이다. 판독이 없으면 null.',
  steps: 'S2.12',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const values: Record<string, MetricValue> = {};
    let worst = 0;
    for (const [name, expected] of TUNER_NOTES) {
      const context = await ctx.createBareContext(3);
      const note = signals.pluckedNote(rate, expected, 3);
      const buffer = context.createBuffer(1, note.length, rate);
      buffer.copyToChannel(note as Float32Array<ArrayBuffer>, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const tuner = new AudioWorkletNode(context, 'tuner-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 0,
        channelCountMode: 'max',
        channelInterpretation: 'discrete',
      });
      const readings: number[] = [];
      tuner.port.onmessage = (event: MessageEvent<{ type?: string; sessionId?: number; frequency?: number | null }>) => {
        const message = event.data;
        if (message.type === 'pitch' && message.sessionId === 1 && typeof message.frequency === 'number') {
          readings.push(message.frequency);
        }
      };
      source.connect(tuner);
      source.start(0);
      // 오프라인 렌더는 쉬지 않고 달리므로, 첫 퀀텀에서 멈춘 사이에 깨움 메시지를 보내 워클릿이 받게 한다.
      const woken = context.suspend(256 / rate).then(async () => {
        tuner.port.postMessage({ type: 'wake', sessionId: 1 });
        await delayMs(80);
        await context.resume();
      });
      await Promise.all([context.startRendering(), woken]);
      await delayMs(150);
      tuner.port.onmessage = null;
      const stable = readings.slice(Math.floor(readings.length * 0.4));
      if (stable.length === 0) {
        values[`detectedHz.${name}`] = null;
        values[`cents.${name}`] = null;
        continue;
      }
      const detected = m.median(stable);
      const cents = 1200 * Math.log2(detected / expected);
      values[`detectedHz.${name}`] = detected;
      values[`cents.${name}`] = cents;
      if (!name.startsWith('B1') && !name.startsWith('C2')) worst = Math.max(worst, Math.abs(cents));
    }
    values.maxAbsCentsOpenStrings = worst;
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-23 — 바이패스 클릭·노드 생성(회귀)
// ---------------------------------------------------------------------------------------------
const p23: ProbeDefinition = {
  id: 'P-23',
  title: '바이패스 클릭·노드 생성',
  describe:
    '기본 구성에 REF-PC 7초를 넣고 1초·3초·5초에 페달을 켜고 끈다(Drive 끔 → 켬, Compressor 끔). 토글 시각 주변 22 ms 의 최대 표본 간 변화가 앞(22 ms)·뒤(22 ms)보다 몇 dB 큰지(clickRatioDb)와 토글 중 새로 만든 오디오 노드 수를 적는다.',
  steps: '모든 Phase',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const toggles: Array<{ at: number; id: string; bypassed: boolean }> = [
      { at: 1, id: 'drive', bypassed: true },
      { at: 3, id: 'drive', bypassed: false },
      { at: 5, id: 'compressor', bypassed: true },
    ];
    const created: number[] = [];
    const events: ChainEvent[] = toggles.map((toggle) => ({
      atSeconds: toggle.at,
      run(handle) {
        const before = ctx.nodeCounter.count;
        handle.patchPedal(toggle.id, { bypassed: toggle.bypassed });
        created.push(ctx.nodeCounter.count - before);
      },
    }));
    const render = await ctx.render({
      input: [signals.refPc(rate, 7)],
      pedals: clonePedals(initialPedals),
      events,
    });
    const values: Record<string, MetricValue> = {};
    let worst = Number.NEGATIVE_INFINITY;
    toggles.forEach((toggle, index) => {
      const frame = Math.round((render.leadFrames + toggle.at * rate) / 128) * 128;
      const window = Math.round(rate * 0.022);
      const channel = render.output[0];
      const near = m.maxStep(channel, frame - Math.round(rate * 0.002), frame - Math.round(rate * 0.002) + window);
      const before = m.maxStep(channel, frame - Math.round(rate * 0.024), frame - Math.round(rate * 0.002));
      const after = m.maxStep(channel, frame + Math.round(rate * 0.03), frame + Math.round(rate * 0.03) + window);
      const ratio = m.dbOf(near) - m.dbOf(Math.max(before, after));
      values[`clickRatioDb.${index + 1}.${toggle.id}`] = ratio;
      values[`nodesCreated.${index + 1}.${toggle.id}`] = created[index] ?? null;
      worst = Math.max(worst, ratio);
    });
    values.maxClickRatioDb = worst;
    values.totalNodesCreated = created.reduce((sum, count) => sum + count, 0);
    return { metrics: metrics(values) };
  },
};

export const probes: ProbeDefinition[] = [
  p01, p02, p03, p04, p05, p06, p07, p08, p09, p10, p11, p12, p13, p14, p15, p16, p17, p18, p20, p21, p22, p23,
];

// ---------------------------------------------------------------------------------------------
// 실행 환경
// ---------------------------------------------------------------------------------------------
export function createProbeContext(sampleRate: number, impulseCache: ImpulseCache, nodeCounter: NodeCounter): ProbeContext {
  return {
    sampleRate,
    nodeCounter,
    render: (request) => renderChain({ ...request, sampleRate, impulseCache }),
    async createBareContext(durationSeconds) {
      const context = new OfflineAudioContext({
        numberOfChannels: 1,
        length: Math.round(durationSeconds * sampleRate),
        sampleRate,
      });
      await registerWorklets(context);
      return context;
    },
  };
}
