// 오디오 렌더 프로브 정의(설계서 6.2절). 실제 이펙트 클래스와 워클릿을 OfflineAudioContext 에서 돌려 소리를 숫자로 잰다.
// 각 프로브는 평평한 metrics(점으로 이은 키 → 숫자·문자·불리언·null)를 돌려주고, scripts/audio-render-probe.mjs 가
// docs/baseline/audio-probe.json 과 tolerances.json 의 허용 오차로 비교한다.
// 측정만 한다. 목표값(설계서의 '목표' 열)을 넘는지 판정하는 일은 각 Step 의 수용 기준이 맡는다.
import type { MonitorMsg } from '../engine/guardSpec';
import { CompressorEffect } from '../nodes/CompressorEffect';
import { mixGains } from '../nodes/mixLaw';
import { getPhaserWetMakeup, PHASER_CENTER_FREQUENCY } from '../nodes/PhaserEffect';
import {
  FUZZ_GATE_ATTACK_MS,
  FUZZ_GATE_HOLD_MS,
  FUZZ_GATE_HYSTERESIS_DB,
  FUZZ_GATE_RELEASE_MS,
  fuzzGateWorkletSettings,
} from '../params/definitions/fuzz';
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
import { runBootstrap } from '../../persistence/bootstrap';
import { createSafeStorage, type StorageBackend } from '../../persistence/SafeStorage';
import { clonePedals, initialPedals } from '../../store/pedalStore';
import { clampPedalsToSchema, isPedalOff, restoreMixOfOffPedals } from '../../presets/normalize';
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
  state: { active?: boolean } = {},
): PedalState {
  const base = initialPedals.find((candidate) => candidate.id === id);
  if (!base) throw new Error(`알 수 없는 페달 id: ${id}`);
  return {
    ...base,
    active: state.active ?? true,
    params: { ...base.params, ...params } as PedalParams,
  };
}

/** 15개 페달을 모두 켜고 params 를 손본다. */
function allPedalsOn(adjust: (pedalState: PedalState) => Record<string, PedalParamValue> = () => ({})): PedalState[] {
  return clonePedals(initialPedals).map((pedalState) => ({
    ...pedalState,
    active: true,
    params: { ...pedalState.params, ...adjust(pedalState) } as PedalParams,
  }));
}

function allPedalsBypassed(): PedalState[] {
  return clonePedals(initialPedals).map((pedalState) => ({ ...pedalState, active: false }));
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
  return pedals.filter((candidate) => candidate.active);
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
      clonePedals(initialPedals).map((pedalState) => (pedalState.id === 'cab' ? { ...pedalState, active: false } : pedalState));
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
    const off = await ctx.render({ input: [input], pedals: [pedal('cab', {}, { active: false })] });
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
// P-26 — Delay 핑퐁 반복음의 시각과 좌우 (S3.3 선택 항목)
// ---------------------------------------------------------------------------------------------
const PINGPONG_TAPS = 4;

const p26: ProbeDefinition = {
  id: 'P-26',
  title: 'Delay 핑퐁 반복음 타이밍',
  describe:
    '단일 임펄스(0.5)를 Delay 핑퐁(Sync 켬, 120 BPM, 1/4 → 500 ms, 피드백 60%, Mix 100%, Tone 100%)에 넣어 원음(0 ms) 뒤 반복음 네 개의 시각(ms)과 어느 쪽 귀에 들리는지를 잰다. ' +
    '첫 반복음 시각(first)은 T/2 = 250 ms 가 기대값(10월 계획서 M-7), 이어지는 반복음은 T 간격으로 왼쪽·오른쪽을 번갈아야 한다(side: −1 왼쪽, +1 오른쪽, 0 같은 크기). '+
    '되먹임 루프를 한 바퀴 돌 때마다 Web Audio 가 렌더 퀀텀 하나(48 kHz 에서 2.67 ms)를 더 늦추므로 셋째 반복음부터 이상값보다 그만큼 뒤에 온다.',
  steps: 'S3.3',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const input = signals.refImpulse(rate, 2.6, 0, 0.5);
    const render = await ctx.render({
      input: [input],
      pedals: [
        pedal('delay', { mode: 'pingpong', sync: true, bpm: 120, division: '1/4', feedback: 0.6, mix: 100, tone: 100 }),
      ],
    });
    const left = render.output[0];
    const right = render.output[1] ?? render.output[0];
    const start = seconds(render, 0.1);
    const end = Math.min(left.length, render.leadFrames + render.signalFrames);
    const envelope = (index: number) => Math.max(Math.abs(left[index]), Math.abs(right[index]));
    let peak = 0;
    for (let i = start; i < end; i += 1) peak = Math.max(peak, envelope(i));
    const threshold = peak * 0.1;
    const window = Math.round(rate * 0.05);
    const gap = Math.round(rate * 0.2);
    const values: Record<string, MetricValue> = {};
    let index = start;
    let found = 0;
    while (index < end && found < PINGPONG_TAPS) {
      if (envelope(index) <= threshold) {
        index += 1;
        continue;
      }
      let best = index;
      let leftEnergy = 0;
      let rightEnergy = 0;
      for (let i = index; i < Math.min(end, index + window); i += 1) {
        if (envelope(i) > envelope(best)) best = i;
        leftEnergy += left[i] * left[i];
        rightEnergy += right[i] * right[i];
      }
      found += 1;
      values[`tap${found}.ms`] = ((best - render.leadFrames) / rate) * 1000;
      const balanceDb = 10 * Math.log10((rightEnergy + 1e-20) / (leftEnergy + 1e-20));
      values[`tap${found}.side`] = balanceDb > 6 ? 1 : balanceDb < -6 ? -1 : 0;
      index += gap;
    }
    for (let tap = found + 1; tap <= PINGPONG_TAPS; tap += 1) {
      values[`tap${tap}.ms`] = null;
      values[`tap${tap}.side`] = null;
    }
    return { metrics: metrics(values) };
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
    'REF-NOISE(−20 dBFS)를 Flanger 하나로 통과시켜 전달함수(H1)의 노치를 찾는다. static: 지연 2 ms 고정(LFO 깊이 0)에서 첫 노치와 간격(피드백 0·Mix 50% 와 기본값 두 가지). sweep: 기본값으로 LFO 한 주기(4초) 동안 첫 노치가 움직이는 범위. sweep.comb: 같은 스윕을 피드백 0·Mix 50%(깊은 노치)로 잰 범위(S3.4 수용 기준은 이쪽).',
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
    // default: 기본값(피드백 60%, Mix 35%) 그대로. 이 값은 노치가 얕고 넓어서(≈ 0.4 dB) 한 칸(≈ 11 Hz) 안팎의 잡음에도 가장 낮은 칸이 옆으로 옮겨 간다 — 44.1 kHz 에서 150.7~452.2 Hz 로 나온 것은 측정이 흔들린 것이다(L-233).
    // comb: 피드백 0·Mix 50% 로 노치를 깊게(−25 dB 이하) 만들어 같은 스윕을 잰다. 지연이 manual ± depth = 1.175~2.825 ms 이면 첫 노치는 177~426 Hz 다.
    const sweepNoise = signals.refNoise(rate, 4.6, -20);
    const sweepVariants: Array<[string, Record<string, PedalParamValue>, number, string]> = [
      ['', {}, 1.5, 'sweep'],
      ['comb', { mix: 50, feedback: 0 }, 3, 'sweep.comb'],
    ];
    for (const [, params, prominence, prefix] of sweepVariants) {
      const sweep = await ctx.render({ input: [sweepNoise], pedals: [pedal('flanger', params)] });
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
          minProminenceDb: prominence,
        })[0];
        if (first) found.push(first.frequency);
      }
      values[`${prefix}.frames`] = found.length;
      values[`${prefix}.minHz`] = found.length > 0 ? Math.min(...found) : null;
      values[`${prefix}.maxHz`] = found.length > 0 ? Math.max(...found) : null;
    }
    return { metrics: metrics(values) };
  },
};

/**
 * Phaser 의 설계한 전달함수(깊이 0 → 단 하나의 1차 올패스 중심 주파수 고정). N 단을 곱하고 직전 샘플 출력을 fb 만큼 되먹이면 W = A/(1 − fb·z⁻¹·A).
 * 체인 전체는 dry·1 + wet·makeup·W(레벨 100% 라 곱하지 않음).
 */
function phaserModelDb(frequency: number, sampleRate: number, stages: number, feedback: number, mix: number): number {
  const tangent = Math.tan((Math.PI * PHASER_CENTER_FREQUENCY) / sampleRate);
  const a = (tangent - 1) / (tangent + 1);
  const w = (2 * Math.PI * frequency) / sampleRate;
  const z1 = { re: Math.cos(w), im: -Math.sin(w) };
  const mul = (x: typeof z1, y: typeof z1): typeof z1 => ({ re: x.re * y.re - x.im * y.im, im: x.re * y.im + x.im * y.re });
  const div = (x: typeof z1, y: typeof z1): typeof z1 => {
    const d = y.re * y.re + y.im * y.im;
    return { re: (x.re * y.re + x.im * y.im) / d, im: (x.im * y.re - x.re * y.im) / d };
  };
  let all = { re: 1, im: 0 };
  const stage = div({ re: a + z1.re, im: z1.im }, { re: 1 + a * z1.re, im: a * z1.im });
  for (let i = 0; i < stages; i += 1) all = mul(all, stage);
  const loop = mul(z1, all);
  const wet = div(all, { re: 1 - feedback * loop.re, im: -feedback * loop.im });
  const gains = mixGains('crossfade', mix, true, false);
  const makeup = getPhaserWetMakeup(feedback);
  const re = gains.dry + gains.wet * makeup * wet.re;
  const im = gains.wet * makeup * wet.im;
  return 20 * Math.log10(Math.hypot(re, im));
}

const p12: ProbeDefinition = {
  id: 'P-12',
  title: 'Phaser 리플',
  describe:
    'REF-NOISE(−20 dBFS)를 Phaser(6단, 피드백 90%, 깊이 0 = 노치 고정, Mix 50%)로 통과시켜 전달함수를 잰다. combRippleDb: 1.5~9 kHz 에서 ±1.5 kHz 이동 평균을 뺀 나머지의 최대−최소(설계한 노치·공진이 이동 평균보다 좁으면 그대로 남는다). modelErrorDb / modelErrorFullDb: 잰 전달함수와 설계한 전달함수(1차 올패스 N 단 + 샘플 단위 피드백의 닫힌 식)의 차이 최댓값(1.5~9 kHz / 0.1~10 kHz) — 설계에 없는 빗살이 얼마나 있는가. highBandRippleDb: 4~10 kHz 원시 최대−최소.',
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
    // 잰 전달함수와 설계한 전달함수(phaserModelDb)의 차이 중 가장 큰 값(dB). 설계한 노치·공진은 둘 다 갖고 있어 빠지고, 설계에 없는 빗살만 남는다.
    const modelError = (low: number, high: number): number => {
      let worst = 0;
      spectra.frequencies.forEach((frequency, index) => {
        if (frequency < low || frequency > high) return;
        worst = Math.max(worst, Math.abs(magnitude[index] - phaserModelDb(frequency, rate, 6, 0.9, 0.5)));
      });
      return worst;
    };
    return {
      metrics: metrics({
        combRippleDb: m.detrendedRippleDb(spectra.frequencies, magnitude, 1500, 9000, 1500),
        modelErrorDb: modelError(1500, 9000),
        modelErrorFullDb: modelError(100, 10000),
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
  levelDb = -18,
): Promise<number[]> {
  const rate = ctx.sampleRate;
  const input = signals.refSine(rate, 3, 220, levelDb);
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
    'REF-SINE 220 Hz(−18 dBFS)를 Drive(Mix 100%, Bias 기본값)로 통과시켜 drive 노브 0~100(10 단위)의 THD(2~10배음, %)를 Distortion·Overdrive 모드에서 잰다. minAheadOfOverdrive 는 노브 10~100 에서 Distortion − Overdrive 의 가장 작은 값, minStepPercent 는 노브를 10 올릴 때 Distortion THD 가 가장 적게(또는 음수로) 늘어난 폭이다.',
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
    // S3.5: 노브 10~100 어디서나 Distortion 이 같은 위치의 Overdrive 이상인지(가장 모자란 자리), 노브를 올릴 때 가장 크게 줄어든 폭.
    values['distortion.minAheadOfOverdrive'] = Math.min(...distortion.slice(1).map((value, index) => value - overdrive[index + 1]));
    values['distortion.minStepPercent'] = Math.min(...distortion.slice(1).map((value, index) => value - distortion[index]));
    return { metrics: metrics(values) };
  },
};

const p14: ProbeDefinition = {
  id: 'P-14',
  title: 'Crunch THD-노브 곡선',
  describe:
    'REF-SINE 220 Hz(−18 dBFS)를 Crunch(Mix 100%)로 통과시켜 gain 노브 0~100(10 단위)의 THD(%)를 잰다. smallestStepPercent 는 노브를 10 올릴 때 THD 가 가장 적게 늘어난 폭이다. normal.* 은 같은 측정을 보통 세기 연주에 가까운 −12 dBFS 로 한 값이다(참고).',
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
    // S3.5: 보통 세기 연주(−12 dBFS 사인)에서도 노브를 따라 THD 가 늘어나는지. 신호가 클수록 THD 는 하드 클립의 한계(약 40%)에 일찍 가까워진다.
    const normal = await thdAtKnobs(ctx, (knob) => pedal('crunch', { gain: knob, mix: 100 }), -12);
    KNOB_STEPS.forEach((knob, index) => {
      values[`normal.gain.${knob}`] = normal[index];
    });
    let smallestNormalStep = Number.POSITIVE_INFINITY;
    for (let index = 1; index < normal.length; index += 1) smallestNormalStep = Math.min(smallestNormalStep, normal[index] - normal[index - 1]);
    values['normal.smallestStepPercent'] = smallestNormalStep;
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
      const bypass = await ctx.render({ input: [impulse], pedals: [pedal(type, { mix: 30 }, { active: false })] });
      const active = await ctx.render({ input: [impulse], pedals: [pedal(type, { mix: 30 })] });
      const from = bypass.leadFrames + position - 2;
      const to = bypass.leadFrames + position + Math.round(rate * 0.01);
      values[`${type}.dryChangeDb`] = m.dbOf(m.peakLinear(active.output[0], from, to)) - m.dbOf(m.peakLinear(bypass.output[0], from, to));
    }
    const pc = signals.refPc(rate, 2);
    const bypassPc = await ctx.render({ input: [pc], pedals: [pedal('delay', { mix: 30 }, { active: false })] });
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
    const defaults = clonePedals(initialPedals).filter((candidate) => candidate.active);
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
      pedals: clonePedals(initialPedals).filter((candidate) => candidate.active),
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
    'REF-PC 6초를 구성마다 5번(라운드마다 모든 구성을 한 번씩) 렌더해 구성별로 가장 빠른 시간을 쓴다. cpuShare = 렌더 시간 ÷ 오디오 길이. 시간 자체(time.*)는 기계마다 달라 비교하지 않고, 비율(ratio.*)만 기준선과 견준다. 처음 다섯 구성은 레벨 미터·출력 가드를 뺀 그래프(S1.5 이전 모양)로 재서 예전 기준선과 이어지고, 미터 둘과 장치 모드 가드(하울링 판정)를 넣은 빈 체인(emptyMonitored)과 15개를 모두 켠 체인(allOnMonitored)을 더해 가드·미터가 늘린 시간을 따로 잰다. monitorOverheadOverPedals = 가드·미터가 더한 시간 ÷ 15개 페달이 쓰는 시간(설계서 S1.5 수용 기준 ≤ 5%)이고, 같은 라운드의 값끼리 나눈 5개 비율의 가운뎃값이다.',
  steps: 'S1.5, S3.4, S4.2',
  async run(ctx) {
    const input = signals.refPc(ctx.sampleRate, 6);
    // 모니터링 없는 다섯 구성은 S1.5 이전과 같은 그래프(monitoring: false)라 기준선이 이어진다. 가드·미터 오버헤드를 재려고 그 옆에 둘을 더 둔다.
    // 라운드 안에서 서로 짝이 되는 구성끼리 붙여 둔다(empty → emptyMonitored → allOn → allOnMonitored): 오버헤드 비율을 라운드마다 따로 계산해
    // 가운뎃값을 쓰기 위해서다. 기계 잡음(다른 프로세스·클럭)은 몇 초씩 이어지므로, 구성마다 가장 빠른 값을 따로 고른 뒤 나누면 시간대가 다른 값끼리
    // 나뉘어 0.025~0.063 으로 흔들렸다. 같은 라운드(약 3초) 안의 값끼리 나누면 잡음이 분자·분모에 같이 실려 상쇄된다.
    const configurations: Array<[string, () => ChainRequest]> = [
      ['empty', () => ({ input: [input], pedals: [], monitoring: false })],
      // 레벨 미터 둘 + 출력 가드(장치 모드: 하울링 판정이 FFT 를 돌린다)
      ['emptyMonitored', () => ({ input: [input], pedals: [], monitoring: true, guardMode: 'device' })],
      ['allOn', () => ({ input: [input], pedals: allPedalsOn(), monitoring: false })],
      ['allOnMonitored', () => ({ input: [input], pedals: allPedalsOn(), monitoring: true, guardMode: 'device' })],
      ['allOff', () => ({ input: [input], pedals: allPedalsBypassed(), monitoring: false })],
      ['phaserOff', () => ({ input: [input], pedals: [pedal('phaser', {}, { active: false })], monitoring: false })],
      ['phaserOn', () => ({ input: [input], pedals: [pedal('phaser')], monitoring: false })],
      // 켠 Phaser 의 비용이 고른 단수에 비례하는가(S3.4): 4단과 12단.
      ['phaserOn4', () => ({ input: [input], pedals: [pedal('phaser', { stages: 4 })], monitoring: false })],
      ['phaserOn12', () => ({ input: [input], pedals: [pedal('phaser', { stages: 12 })], monitoring: false })],
    ];
    const ATTEMPTS = 5;
    const best: Record<string, number> = Object.fromEntries(configurations.map(([name]) => [name, Number.POSITIVE_INFINITY]));
    const overOverPedals: number[] = [];
    const overInAllOn: number[] = [];
    let audioSeconds = 0;
    for (let attempt = 0; attempt < ATTEMPTS; attempt += 1) {
      const round: Record<string, number> = {};
      for (const [name, build] of configurations) {
        const render = await ctx.render(build());
        round[name] = render.renderMilliseconds;
        best[name] = Math.min(best[name], render.renderMilliseconds);
        audioSeconds = (render.leadFrames + render.signalFrames) / render.sampleRate;
      }
      const pedalsMs = round.allOn - round.empty;
      overOverPedals.push((round.emptyMonitored - round.empty) / pedalsMs);
      overInAllOn.push((round.allOnMonitored - round.allOn) / pedalsMs);
    }
    const values: Record<string, MetricValue> = {};
    for (const [name, milliseconds] of Object.entries(best)) {
      values[`time.${name}Ms`] = milliseconds;
      values[`cpuShare.${name}`] = milliseconds / (audioSeconds * 1000);
    }
    values['ratio.allOffOverAllOn'] = best.allOff / best.allOn;
    values['ratio.phaserOffContribution'] = (best.phaserOff - best.empty) / best.allOn;
    values['ratio.phaserOnContribution'] = (best.phaserOn - best.empty) / best.allOn;
    // 켠 Phaser 가 꺼진 Phaser 보다 더 쓰는 시간의 12단 ÷ 4단(참고용). 12단 고정 구조였다면 1 이고, 지금은 단 계산이 싸서(1~2 ns) 샘플마다 드는 고정 비용에 묻혀 1.1~1.4 정도다.
    values['ratio.phaserStages12Over4'] = (best.phaserOn12 - best.phaserOff) / Math.max(1e-6, best.phaserOn4 - best.phaserOff);
    // 가드·미터가 더한 시간을 15개 페달이 쓰는 시간(켠 체인 − 빈 체인)으로 나눈다. 라운드마다 구한 비율의 가운뎃값이다(위 설명).
    // 빈 체인에서 잰 것(OverPedals)과 15개를 켠 체인에서 잰 것(InAllOn) 둘 다 본다. 수용 기준은 앞의 것이다.
    const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
    values['ratio.monitorOverheadOverPedals'] = median(overOverPedals);
    values['ratio.monitorOverheadInAllOn'] = median(overInAllOn);
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-18 — 꺼진 페달을 켰을 때의 변화
// ---------------------------------------------------------------------------------------------
/** 모든 밴드가 0 dB 인 Graphic EQ. 이것은 켜도 소리가 같은 것이 정상이라(변화 없음이 곧 설계) '변화 없음' 불합격에서 뺀다. */
function isFlatGraphicEq(candidate: PedalState): boolean {
  if (candidate.type !== 'graphicEQ') return false;
  const bands = Object.entries(candidate.params).filter(([name]) => /^band\d+$/.test(name));
  return bands.length > 0 && bands.every(([, value]) => value === 0);
}

const p18: ProbeDefinition = {
  id: 'P-18',
  title: '꺼진 페달을 켰을 때의 변화',
  describe:
    '공장 프리셋마다 꺼진 페달을 (그 페달의 저장된 값 그대로) 혼자 켜 REF-PC 2초를 통과시키고, 원음(빈 체인)과 견준다. 변화 = RMS 차 ≥ 0.5 dB 또는 1/3옥타브 대역 전력의 평균 절대 차 ≥ 1 dB. 같은 값의 페달은 한 번만 렌더한다. 변화가 없는 것 중 모든 밴드가 0 dB 인 Graphic EQ 는 설계상 정상이라 따로 센다(unchangedFlatEq). 그 밖에 변화가 없는 페달(unchangedUnexpected)이 있으면 S2.1 의 불합격이다. 이어서 불러온 직후의 소리를 본다: 공장 프리셋마다 꺼진 페달의 Mix 를 모두 0 으로 만든 체인(옛 저장본)과 불러올 때 바로잡은 체인(restoreMixOfOffPedals)을 REF-PC 0.5초로 렌더해 출력 차(널 테스트, −200 은 완전히 같다)의 최악값을 loadNullDb 로 둔다.',
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
    const unexpected: string[] = [];
    let flatGraphicEq = 0;
    for (const preset of defaultPresets) {
      for (const candidate of preset.pedals) {
        if (candidate.active) continue;
        const key = JSON.stringify([candidate.type, candidate.params]);
        let changed = verdicts.get(key);
        if (changed === undefined) {
          const turned = analyse(await ctx.render({ input: [input], pedals: [{ ...candidate, active: true }] }));
          const levelChange = Math.abs(turned.level - original.level);
          const spectralChange = mean(turned.bands.map((band, index) => Math.abs(band - original.bands[index])));
          changed = levelChange >= 0.5 || spectralChange >= 1;
          verdicts.set(key, changed);
        }
        tested += 1;
        if (changed) continue;
        unchanged.push(`${preset.id}:${candidate.id}`);
        if (isFlatGraphicEq(candidate)) flatGraphicEq += 1;
        else unexpected.push(`${preset.id}:${candidate.id}`);
      }
    }

    // 불러온 직후의 소리(S2.1): 옛 저장본(꺼진 페달의 Mix 가 모두 0)과 불러올 때 바로잡은 체인은 같은 소리여야 한다.
    const defaultMix = new Map(initialPedals.map((initial) => [initial.id, Number(initial.params.mix)]));
    const loadInput = signals.refPc(rate, 0.5);
    let loadNullWorst = -200;
    let restoredPedals = 0;
    let untouchedOffPedals = 0;
    for (const preset of defaultPresets) {
      const stored = preset.pedals.map((candidate) =>
        isPedalOff(candidate) ? { ...candidate, params: { ...candidate.params, mix: 0 } as PedalParams } : candidate,
      );
      const loaded = restoreMixOfOffPedals(stored, (pedalId) => defaultMix.get(pedalId));
      stored.forEach((candidate, index) => {
        if (!isPedalOff(candidate)) return;
        if (loaded[index] === candidate) untouchedOffPedals += 1;
        else restoredPedals += 1;
      });
      const before = await ctx.render({ input: [loadInput], pedals: stored });
      const after = await ctx.render({ input: [loadInput], pedals: loaded });
      loadNullWorst = Math.max(loadNullWorst, residualDb(before, after));
    }

    return {
      metrics: metrics({
        presets: defaultPresets.length,
        tested,
        distinctRendered: verdicts.size,
        unchangedCount: unchanged.length,
        unchangedFlatEq: flatGraphicEq,
        unchangedUnexpected: unexpected.length,
        loadRestoredPedals: restoredPedals,
        loadUntouchedOffPedals: untouchedOffPedals,
        loadNullDb: loadNullWorst,
      }),
      notes: [
        ...(unexpected.length > 0 ? [`변화 없음(예상 밖): ${unexpected.join(', ')}`] : []),
        ...(flatGraphicEq > 0 ? [`변화 없음(밴드가 모두 0 dB 인 Graphic EQ, 설계상 정상): ${flatGraphicEq}개`] : []),
      ],
    };
  },
};

// ---------------------------------------------------------------------------------------------
// P-19 — v1 → v2 동일성
// ---------------------------------------------------------------------------------------------
/**
 * v1 저장소 픽스처 6개(e2e/fixtures/storage-v1). 저장 형식을 바꾸기 전 앱이 쓰던 localStorage 를 원문 그대로 고정한 파일이다.
 * 프로브 빌드(`--mode test`)에만 들어간다: 이 파일은 배포용 번들이 불러오지 않는다.
 */
const v1FixtureFiles = import.meta.glob<string>('/e2e/fixtures/storage-v1/*.json', { query: '?raw', import: 'default', eager: true });

interface V1Fixture {
  /** 파일 이름 앞의 두 자리(01~06) */
  id: string;
  /** 앱이 저장하던 localStorage 의 키 → 원문 */
  storage: Record<string, string>;
}

function loadV1Fixtures(): V1Fixture[] {
  return Object.entries(v1FixtureFiles)
    .map(([path, text]) => {
      const file = path.slice(path.lastIndexOf('/') + 1);
      const parsed = JSON.parse(text) as { storage: Record<string, string> };
      return { id: file.slice(0, 2), storage: parsed.storage };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** 시험용 저장소(Map). 앱이 쓰는 SafeStorage 가 그대로 올라앉는다. 브라우저의 localStorage 는 건드리지 않는다. */
function memoryBackend(initial: Record<string, string>): StorageBackend {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    key: (index) => [...values.keys()][index] ?? null,
    get length() {
      return values.size;
    },
  };
}

/**
 * 옛 앱이 소리를 만들던 규칙을 저장된 원문에서 그대로 따라 한다. 변환 코드를 거치지 않으므로 변환이 틀려도 같이 틀릴 수 없다.
 *   켜짐 = enabled 이고 bypassed 가 아님(둘 중 하나만 꺼져도 소리가 꺼진다), 값은 저장된 그대로(범위 맞춤·Mix 복원 전), 순서는 저장된 순서.
 * 읽을 수 없는 값이면 옛 앱은 기본 보드로 시작했다.
 */
function oldSoundChain(storedPedals: unknown): PedalState[] {
  if (!Array.isArray(storedPedals)) return clonePedals(initialPedals);
  const chain: PedalState[] = [];
  for (const stored of storedPedals) {
    if (!isPlainRecord(stored) || typeof stored.id !== 'string') continue;
    const base = initialPedals.find((candidate) => candidate.id === stored.id);
    if (!base) continue;
    const params = isPlainRecord(stored.params) ? stored.params : {};
    chain.push({
      ...base,
      active: stored.enabled === true && stored.bypassed === false,
      params: { ...base.params, ...params } as PedalParams,
    });
  }
  return chain;
}

/** 저장된 JSON 원문을 읽는다. 없거나 깨졌으면 null. */
function parseStoredJson(text: string | undefined): Record<string, unknown> | null {
  if (text === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(text);
    return isPlainRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const activeIdsOf = (pedals: PedalState[]): string => pedals.filter((candidate) => candidate.active).map((candidate) => candidate.id).join(',');

const p19: ProbeDefinition = {
  id: 'P-19',
  title: 'v1 → v2 동일성',
  describe:
    'v1 저장소 픽스처 6개(e2e/fixtures/storage-v1)를 시험용 저장소에 넣고 앱이 여는 절차(runBootstrap)를 두 번 돈다: 첫 방문에 v1 에서 v2 로 옮기고, 다음 방문에 v2 키에서 읽는다. ' +
    '다음 방문에서 읽은 작업 보드와 사용자 프리셋의 소리를, 옛 앱이 같은 저장 원문으로 만들던 소리(켜짐 = enabled 이고 bypassed 가 아님, 값은 저장된 그대로 — 변환 코드를 쓰지 않고 원문에서 직접 만든다)와 REF-PC 1초로 견준다. ' +
    '두 출력의 차(널 테스트)가 출력 대비 몇 dB 인지 적는다(−200 은 완전히 같다). 옛 방식(legacy)으로 열렸다면 변환이 틀린 것이라 소리가 같아 보여도 불합격이다(첫 방문의 legacy 수와 다음 방문이 v2 로 열린 수를 따로 적는다). ' +
    '켜진 페달 목록이 옛 규칙과 다른 보드·프리셋의 수(activeMismatch)와 다음 방문에서 사라진 프리셋 수(presetMissing)도 적는다. 시간을 줄이려고 꺼진 페달은 체인에서 뺀다(꺼진 페달이 소리를 바꾸지 않음은 P-05 가 본다).',
  steps: 'S2.4',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const input = signals.refPc(rate, 1);
    const fixtures = loadV1Fixtures();
    const values: Record<string, MetricValue> = {};
    let worst = -200;
    let boardsChecked = 0;
    let presetsChecked = 0;
    let presetMissing = 0;
    let activeMismatch = 0;
    const visit1: Record<string, number> = { converted: 0, fresh: 0, legacy: 0, v2: 0 };
    let visit2V2 = 0;

    const renderPair = async (oldPedals: PedalState[], newPedals: PedalState[], oldTrimDb: number, newTrimDb: number) => {
      const before = await ctx.render({ input: [input], pedals: activePedals(oldPedals), presetTrimDb: oldTrimDb });
      const after = await ctx.render({ input: [input], pedals: activePedals(newPedals), presetTrimDb: newTrimDb });
      return residualDb(before, after);
    };

    for (const fixture of fixtures) {
      const backend = memoryBackend(fixture.storage);
      const open = () => createSafeStorage({ getBackend: () => backend, notify: () => undefined, subscribeToPageHide: () => undefined });
      const first = runBootstrap(open()); // 첫 방문: v1 키에서 v2 로 옮긴다.
      const second = runBootstrap(open()); // 다음 방문: v2 키에서 읽는다. 소리는 이쪽으로 낸다.
      visit1[first.outcome] += 1;
      if (second.outcome === 'v2') visit2V2 += 1;

      // 작업 보드
      const storedBoard = parseStoredJson(fixture.storage['guitar-pedalboard:pedals']);
      const oldBoard = oldSoundChain(storedBoard?.pedals);
      const oldTrim = typeof storedBoard?.presetTrimDb === 'number' ? storedBoard.presetTrimDb : 0;
      const newBoard = second.board?.pedals ?? clonePedals(initialPedals);
      const boardNull = await renderPair(oldBoard, newBoard, oldTrim, second.board?.trimDb ?? 0);
      values[`nullDb.board.${fixture.id}`] = boardNull;
      values[`activeCount.${fixture.id}`] = newBoard.filter((candidate) => candidate.active).length;
      worst = Math.max(worst, boardNull);
      boardsChecked += 1;
      if (activeIdsOf(oldBoard) !== activeIdsOf(newBoard)) activeMismatch += 1;

      // 사용자 프리셋
      const storedPresets = parseStoredJson(fixture.storage['web-guitar-pedalboard-presets']);
      const storedList = Array.isArray(storedPresets?.presets) ? (storedPresets.presets as unknown[]) : [];
      let presetIndex = 0;
      for (const stored of storedList) {
        if (!isPlainRecord(stored) || typeof stored.id !== 'string') continue;
        presetIndex += 1;
        const migrated = second.userPresets.find((candidate) => candidate.id === stored.id);
        if (!migrated) {
          presetMissing += 1;
          continue;
        }
        const oldPedals = oldSoundChain(stored.pedals);
        const oldPresetTrim = typeof stored.trimDb === 'number' ? stored.trimDb : 0;
        const presetNull = await renderPair(oldPedals, migrated.pedals, oldPresetTrim, migrated.trimDb ?? 0);
        values[`nullDb.preset.${fixture.id}.${presetIndex}`] = presetNull;
        worst = Math.max(worst, presetNull);
        presetsChecked += 1;
        if (activeIdsOf(oldPedals) !== activeIdsOf(migrated.pedals)) activeMismatch += 1;
      }
    }

    return {
      metrics: metrics({
        fixtures: fixtures.length,
        boardsChecked,
        presetsChecked,
        'visit1.converted': visit1.converted,
        'visit1.fresh': visit1.fresh,
        'visit1.legacy': visit1.legacy,
        'visit2.v2': visit2V2,
        presetMissing,
        activeMismatch,
        'nullDb.worst': worst,
        ...values,
      }),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// P-20 — Reverb Decay 변환
// ---------------------------------------------------------------------------------------------
/** S2.2 이전의 공장 프리셋이 저장하던 Decay(초). 지금은 둘 다 6.0 이다. */
const LEGACY_FACTORY_DECAYS: Record<string, number> = { 'factory-ambient-delay': 6.2, 'factory-tape-swell': 7.5 };
/** 예전 저장소가 받을 수 있던 가장 긴 Decay. */
const LEGACY_MAX_DECAY = 10;

const p20: ProbeDefinition = {
  id: 'P-20',
  title: 'Reverb Decay 변환',
  describe:
    '예전에 저장될 수 있던 6초 넘는 Decay(공장 프리셋 6.2·7.5초와 옛 최댓값 10초)로 Reverb 를 REF-PC 3초에 통과시킨 출력과, 불러올 때 범위 맞춤(M3)을 거친 값(6.0)의 출력을 비교한다. 두 출력의 차(널 테스트)가 출력 대비 몇 dB 인지 적는다(−200 은 완전히 같다). 공장 프리셋의 Decay 최댓값도 적는다.',
  steps: 'S2.2',
  async run(ctx) {
    const input = signals.refPc(ctx.sampleRate, 3);
    const values: Record<string, MetricValue> = {};
    const reverbOf = (presetId: string): PedalState => {
      const preset = defaultPresets.find((candidate) => candidate.id === presetId);
      const reverb = preset?.pedals.find((candidate) => candidate.type === 'reverb');
      if (!reverb) throw new Error(`Reverb 가 있는 공장 프리셋을 찾을 수 없습니다: ${presetId}`);
      return reverb;
    };
    const compare = async (key: string, legacy: PedalState): Promise<number> => {
      const stored = { ...legacy, active: true };
      const converted = clampPedalsToSchema([stored])[0];
      const storedRender = await ctx.render({ input: [input], pedals: [stored] });
      const convertedRender = await ctx.render({ input: [input], pedals: [converted] });
      values[`nullDb.${key}`] = residualDb(storedRender, convertedRender);
      return Number(converted.params.decay);
    };

    let worstConvertedError = 0;
    for (const [presetId, legacyDecay] of Object.entries(LEGACY_FACTORY_DECAYS)) {
      const reverb = reverbOf(presetId);
      const legacy = { ...reverb, params: { ...reverb.params, decay: legacyDecay } as PedalParams };
      values[`storedDecay.${presetId}`] = legacyDecay;
      worstConvertedError = Math.max(worstConvertedError, Math.abs((await compare(presetId, legacy)) - 6));
    }
    const base = pedal('reverb', { decay: LEGACY_MAX_DECAY });
    worstConvertedError = Math.max(worstConvertedError, Math.abs((await compare(`decay${LEGACY_MAX_DECAY}`, base)) - 6));

    let maxFactoryDecay = 0;
    for (const preset of defaultPresets) {
      const reverb = preset.pedals.find((candidate) => candidate.type === 'reverb');
      if (reverb) maxFactoryDecay = Math.max(maxFactoryDecay, Number(reverb.params.decay));
    }
    values.convertedDecayError = worstConvertedError;
    values.maxFactoryDecay = maxFactoryDecay;
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
    const toggles: Array<{ at: number; id: string; active: boolean }> = [
      { at: 1, id: 'drive', active: false },
      { at: 3, id: 'drive', active: true },
      { at: 5, id: 'compressor', active: false },
    ];
    const created: number[] = [];
    const events: ChainEvent[] = toggles.map((toggle) => ({
      atSeconds: toggle.at,
      run(handle) {
        const before = ctx.nodeCounter.count;
        handle.patchPedal(toggle.id, { active: toggle.active });
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

// ---------------------------------------------------------------------------------------------
// P-24 — Fuzz Gate(D15)
// ---------------------------------------------------------------------------------------------
const p24: ProbeDefinition = {
  id: 'P-24',
  title: 'Fuzz Gate',
  describe:
    'Fuzz(기본값)에 무연주 잡음(G-3: −70 dBFS RMS 4초)을 넣고 Gate 0 과 Gate 50 의 출력 RMS 를 신호 2초 뒤부터 잰다(Mix 기본 90% 와 100%). reduction = Gate 50 − Gate 0. ' +
    '일정한 −20 dBFS 사인파(220 Hz)에서 Gate 0 과 Gate 1(문턱 −80 dBFS: 열려 있는 게이트)의 출력 레벨 차를 1초 뒤부터 잰다(open.levelDiffDb). ' +
    '체인의 필터는 입력이 1 ppm 만 달라도 −80 dB 쯤의 반올림 잡음 차이를 내므로(S2.2 에서 확인) 체인 출력의 파형 널 테스트는 쓰지 않는다. ' +
    '대신 게이트 워클릿만 따로 돌려, Gate 0 이면 출력이 입력과 한 샘플도 다르지 않은지(gate0.workletDiffSamples), 게이트가 열린 뒤에는 입력이 그대로 지나가는지(open.workletDiffSamples), ' +
    '쉬었다 시작하는 소리에서 게이트가 다시 열려 입력과 같아지기까지 걸리는 시간(open.workletOpenMs)을 적는다. ' +
    '쉬었다 시작하는 음의 처음 10 ms 가 게이트 때문에 얼마나 줄어드는지(onset.lossDb)도 적는다.',
  steps: 'S2.2',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const noise = signals.noiseFloor(rate, 4);
    const noiseLevel = async (gate: number, mix?: number) =>
      bodyLevelDb(
        await ctx.render({ input: [noise], pedals: [pedal('fuzz', { gate, ...(mix === undefined ? {} : { mix }) })] }),
        2,
      );
    const gate0 = await noiseLevel(0);
    const gate50 = await noiseLevel(50);
    const gate0Wet = await noiseLevel(0, 100);
    const gate50Wet = await noiseLevel(50, 100);

    // 열려 있는 게이트(Gate 1 = 문턱 −80 dBFS)가 연주 소리의 크기를 바꾸지 않는지: 레벨 차이만 본다.
    const tone = signals.refSine(rate, 3, 220, -20);
    const renderTone = (gate: number) => ctx.render({ input: [tone], pedals: [pedal('fuzz', { gate })] });
    const levelGate0 = bodyLevelDb(await renderTone(0), 1);
    const levelGate1 = bodyLevelDb(await renderTone(1), 1);

    // 게이트 워클릿만 따로: 0.5초 쉬었다가 220 Hz 사인(−20 dBFS)이 시작한다. 게이트는 쉬는 동안 닫혔다가 소리가 시작하면 열린다.
    const bareGate = async (gate: number) => {
      const seconds = 2.5;
      const length = Math.round(rate * seconds);
      const lead = Math.round((rate * 0.5) / 128) * 128;
      const input = new Float32Array(length);
      for (let i = lead; i < length; i += 1) input[i] = 0.1 * Math.sin((2 * Math.PI * 220 * (i - lead)) / rate);
      const context = await ctx.createBareContext(seconds);
      const buffer = context.createBuffer(1, length, rate);
      buffer.copyToChannel(input, 0);
      const source = context.createBufferSource();
      source.buffer = buffer;
      const node = new AudioWorkletNode(context, 'noise-gate-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        parameterData: {
          ...fuzzGateWorkletSettings(gate),
          attackMs: FUZZ_GATE_ATTACK_MS,
          holdMs: FUZZ_GATE_HOLD_MS,
          releaseMs: FUZZ_GATE_RELEASE_MS,
          hysteresisDb: FUZZ_GATE_HYSTERESIS_DB,
        },
        processorOptions: { startOpen: true, silent: true },
      });
      source.connect(node);
      node.connect(context.destination);
      source.start();
      const output = (await context.startRendering()).getChannelData(0);
      const settledFrom = lead + Math.round(rate * 0.1);
      let different = 0;
      let differentAfterOnset = 0;
      let lastDifferent = -1;
      for (let i = 0; i < length; i += 1) {
        if (output[i] === input[i]) continue;
        different += 1;
        lastDifferent = i;
        if (i >= settledFrom) differentAfterOnset += 1;
      }
      return { different, differentAfterOnset, openMs: lastDifferent < 0 ? 0 : ((lastDifferent - lead) / rate) * 1000 };
    };
    const bareOff = await bareGate(0);
    const bareOn = await bareGate(1);

    const note = signals.pluckedNote(rate, 110, 1.5);
    const renderNote = (gate: number) => ctx.render({ input: [note], pedals: [pedal('fuzz', { gate })] });
    const onsetGate0 = bodyLevelDb(await renderNote(0), 0, 0.01);
    const onsetGate50 = bodyLevelDb(await renderNote(50), 0, 0.01);

    return {
      metrics: metrics({
        'noise.gate0Db': gate0,
        'noise.gate50Db': gate50,
        'noise.reductionDb': gate50 - gate0,
        'noiseMix100.gate0Db': gate0Wet,
        'noiseMix100.gate50Db': gate50Wet,
        'noiseMix100.reductionDb': gate50Wet - gate0Wet,
        'open.levelDiffDb': Math.abs(levelGate1 - levelGate0),
        'gate0.workletDiffSamples': bareOff.different,
        'open.workletDiffSamples': bareOn.differentAfterOnset,
        'open.workletOpenMs': bareOn.openMs,
        'onset.gate0Db': onsetGate0,
        'onset.gate50Db': onsetGate50,
        'onset.lossDb': onsetGate50 - onsetGate0,
      }),
    };
  },
};

// ---------------------------------------------------------------------------------------------
// P-25 — Cab 노브·모델을 바꿀 때 클릭(S3.2)
// ---------------------------------------------------------------------------------------------
const p25: ProbeDefinition = {
  id: 'P-25',
  title: 'Cab 노브·모델을 바꿀 때 클릭',
  describe:
    '기본 Cab 한 개에 일정한 사인파(−12 dBFS, 220 Hz 와 660 Hz)를 7초 넣고 ① 마이크 위치를 한 번 크게 바꾸고(0.8초, 55→85) ② 모델을 바꾸고(2.0초, V30→Blue) ' +
    '③ 마이크 위치를 20 ms 마다 1씩 0.6초 동안 끌고(3.2초부터, 85→55) ④ 거리를 같은 식으로 끈다(5.2초부터, 30→60). 각 동작 앞뒤의 고른 구간(0.3~0.5초)과 동작 구간 전체(1초 안팎)의 출력 1차 차분 최대값을 비교해, ' +
    '동작 구간이 고른 구간(앞·뒤 중 큰 쪽)보다 몇 dB 큰지 clickRatioDb 로 적는다. 소리가 부드럽게 바뀌면 0 dB 근처, IR 이 갑자기 바뀌면 크게 올라간다. 설계서 S3.2 수용 기준은 +6 dB 이하(★).',
  steps: 'S3.2',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const events: ChainEvent[] = [];
    const patch = (at: number, params: Record<string, PedalParamValue>) => {
      events.push({ atSeconds: at, run: (handle) => handle.patchPedal('cab', { params }) });
    };
    patch(0.8, { micPosition: 85 });
    patch(2.0, { model: 'blue-1x12' });
    for (let step = 0; step <= 30; step += 1) patch(3.2 + step * 0.02, { micPosition: 85 - step });
    for (let step = 0; step <= 30; step += 1) patch(5.2 + step * 0.02, { distance: 30 + step });

    // [동작 구간 시작, 끝], [앞 고른 구간], [뒤 고른 구간] (입력이 시작한 뒤 몇 초)
    const actions = [
      { name: 'mic', window: [0.75, 1.5], before: [0.3, 0.7], after: [1.6, 2.0] },
      { name: 'model', window: [1.95, 2.5], before: [1.5, 1.9], after: [2.6, 3.0] },
      { name: 'micDrag', window: [3.15, 4.3], before: [2.6, 3.1], after: [4.4, 4.9] },
      { name: 'distanceDrag', window: [5.15, 6.3], before: [4.4, 5.1], after: [6.4, 6.9] },
    ] as const;

    const values: Record<string, MetricValue> = {};
    let worst = Number.NEGATIVE_INFINITY;
    for (const frequency of [220, 660]) {
      const render = await ctx.render({
        input: [signals.refSine(rate, 7, frequency, -12)],
        pedals: [pedal('cab', { mix: 100 })],
        events,
      });
      const channel = render.output[0];
      const at = (value: number) => seconds(render, value);
      for (const action of actions) {
        const moving = m.maxStep(channel, at(action.window[0]), at(action.window[1]));
        const before = m.maxStep(channel, at(action.before[0]), at(action.before[1]));
        const after = m.maxStep(channel, at(action.after[0]), at(action.after[1]));
        const ratio = m.dbOf(moving) - m.dbOf(Math.max(before, after));
        values[`clickRatioDb.${frequency}.${action.name}`] = ratio;
        worst = Math.max(worst, ratio);
      }
    }
    values.maxClickRatioDb = worst;
    return { metrics: metrics(values) };
  },
};

// ---------------------------------------------------------------------------------------------
// P-27 — Drive Bias 전 범위에서 소리가 사라지지 않는다
// ---------------------------------------------------------------------------------------------
const p27: ProbeDefinition = {
  id: 'P-27',
  title: 'Drive Bias 전 범위 출력',
  describe:
    'Drive(Mix 100%)의 네 모드 × 노브 42·100% × Bias −1·−0.3·0·0.3·1 로 REF-PC(2초) 를 렌더해 신호 구간 RMS(dBFS)를 잰다. minRmsDb 는 그 40개 중 가장 작은 값이고 설계서 S3.5 의 수용 기준은 −30 dBFS 이상이다. 화면 범위(±0.3) 밖의 ±1 은 엔진이 한도로 잘라 ±0.3 과 같아야 한다(clampDiffDb). factoryBiasMaxAbs 는 팩토리 프리셋 Drive 페달의 |Bias| 최댓값이다.',
  steps: 'S3.5',
  async run(ctx) {
    const rate = ctx.sampleRate;
    const input = signals.refPc(rate, 2);
    const values: Record<string, MetricValue> = {};
    let minimum = Number.POSITIVE_INFINITY;
    let clampDiff = 0;
    for (const mode of ['overdrive', 'crunch', 'distortion', 'fuzz'] as const) {
      for (const drive of [42, 100]) {
        const levels: Record<string, number> = {};
        for (const bias of [-1, -0.3, 0, 0.3, 1]) {
          const render = await ctx.render({ input: [input], pedals: [pedal('drive', { mode, drive, bias, mix: 100 })] });
          levels[String(bias)] = bodyLevelDb(render, 0.3);
          minimum = Math.min(minimum, levels[String(bias)]);
        }
        clampDiff = Math.max(clampDiff, Math.abs(levels['1'] - levels['0.3']), Math.abs(levels['-1'] - levels['-0.3']));
        if (drive === 100) {
          for (const bias of [-1, -0.3, 0, 0.3, 1]) values[`rmsDb.${mode}.${bias}`] = levels[String(bias)];
        }
      }
    }
    values.minRmsDb = minimum;
    values.clampDiffDb = clampDiff;
    const driveBiases = defaultPresets.flatMap((preset) =>
      preset.pedals.filter((candidate) => candidate.type === 'drive').map((candidate) => Math.abs((candidate.params as { bias: number }).bias)),
    );
    values.factoryBiasMaxAbs = driveBiases.length === 0 ? 0 : Math.max(...driveBiases);
    return { metrics: metrics(values) };
  },
};

export const probes: ProbeDefinition[] = [
  p01, p02, p03, p04, p05, p06, p07, p08, p09, p10, p11, p12, p13, p14, p15, p16, p17, p18, p19, p20, p21, p22, p23, p24, p25, p26, p27,
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
