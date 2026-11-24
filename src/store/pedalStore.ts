import { create } from 'zustand';
import { safeStorage, STORAGE_KEYS } from '../persistence';
import type { PedalParamValue, PedalParams, PedalState, PedalType } from '../audio/types';
import { clampTrimDb, roundTrimDb } from '../audio/offline/loudnessSpec';
import { restoreMixOfOffPedals } from '../presets/normalize';

export const SCHEMA_VERSION = 11;

export type StoredPedal = {
  id: string;
  enabled: boolean;
  bypassed: boolean;
  params: Record<string, PedalParamValue>;
};

export type StoredState = {
  version: number;
  pedals: StoredPedal[];
  /**
   * 지금 프리셋의 음량 보정(dB, S1.4c). 0 이면 쓰지 않는다 — 없으면 0 으로 읽는다(M6).
   * 선택 필드라서 스키마 버전은 올리지 않았다: 이전 버전은 이 필드를 몰라서 무시하고, 이전 저장본에는 없어서 0 이 된다.
   */
  presetTrimDb?: number;
};

export const initialPedals: PedalState[] = [
  {
    id: 'noise-gate',
    type: 'noiseGate',
    name: 'Noise Gate',
    enabled: true,
    bypassed: false,
    color: '#3f8f85',
    params: {
      mix: 100,
      level: 100,
      thresholdDb: -54,
      reductionDb: -80,
      attackMs: 6,
      holdMs: 70,
      releaseMs: 180,
      hysteresisDb: 4,
    },
  },
  {
    id: 'compressor',
    type: 'compressor',
    name: 'Compressor',
    enabled: true,
    bypassed: false,
    color: '#b48a3c',
    params: {
      mix: 75,
      level: 100,
      threshold: -24,
      ratio: 4,
      attack: 0.006,
      release: 0.18,
      knee: 18,
      sustain: 35,
    },
  },
  {
    id: 'auto-wah',
    type: 'autoWah',
    name: 'Auto Wah',
    enabled: true,
    bypassed: true,
    color: '#6fa83f',
    params: {
      mix: 100,
      level: 100,
      sensitivity: 55,
      range: 60,
      resonance: 45,
      mode: 'auto',
      manual: 50,
    },
  },
  {
    id: 'drive',
    type: 'drive',
    name: 'Drive',
    enabled: true,
    bypassed: false,
    color: '#bd5d45',
    params: {
      mix: 88,
      level: 95,
      mode: 'overdrive',
      drive: 42,
      tone: 55,
      bias: 0.08,
    },
  },
  {
    id: 'crunch',
    type: 'crunch',
    name: 'Crunch',
    enabled: true,
    bypassed: true,
    color: '#b9231f',
    params: {
      mix: 85,
      level: 90,
      volume: 80,
      gain: 55,
      tone: 55,
      presence: 45,
      lowCut: 80,
      mode: 'crunch',
    },
  },
  {
    id: 'fuzz',
    type: 'fuzz',
    name: 'Fuzz',
    enabled: true,
    bypassed: true,
    color: '#9fa8aa',
    params: {
      mix: 90,
      level: 90,
      fuzz: 60,
      tone: 55,
      mode: 'classic',
      bias: 50,
      gate: 15,
      lowCut: 70,
    },
  },
  {
    id: 'graphic-eq',
    type: 'graphicEQ',
    name: 'Graphic EQ',
    enabled: true,
    bypassed: true,
    color: '#4a5b7a',
    params: {
      mix: 100,
      level: 100,
      band100: 0,
      band200: 0,
      band400: 0,
      band800: 0,
      band1600: 0,
      band3200: 0,
      band6400: 0,
    },
  },
  {
    id: 'eq',
    type: 'eq',
    name: 'EQ',
    enabled: true,
    bypassed: false,
    color: '#526fb3',
    params: {
      mix: 100,
      level: 100,
      lowCut: 70,
      bassGain: 1.5,
      midFreq: 800,
      midGain: -0.5,
      midQ: 0.9,
      trebleGain: 1.8,
      presenceGain: 1,
    },
  },
  {
    id: 'cab',
    type: 'cab',
    name: 'Cab',
    enabled: true,
    bypassed: false,
    color: '#7a6a55',
    params: {
      mix: 100,
      level: 100,
      model: 'v30-4x12',
      micPosition: 55,
      distance: 30,
      lowCut: 85,
      highCut: 5400,
      presence: 1.5,
    },
  },
  {
    id: 'chorus',
    type: 'chorus',
    name: 'Chorus',
    enabled: true,
    bypassed: true,
    color: '#4d8fa8',
    params: {
      mix: 35,
      level: 100,
      rate: 0.8,
      depth: 45,
      voices: 3,
      spread: 60,
      tone: 60,
    },
  },
  {
    id: 'flanger',
    type: 'flanger',
    name: 'Flanger',
    enabled: true,
    bypassed: true,
    color: '#5f7fbf',
    params: {
      mix: 35,
      level: 100,
      rate: 0.25,
      depth: 55,
      feedback: 60,
      manual: 2,
    },
  },
  {
    id: 'phaser',
    type: 'phaser',
    name: 'Phaser',
    enabled: true,
    bypassed: true,
    color: '#8b5fbf',
    params: {
      mix: 45,
      level: 100,
      rate: 0.5,
      depth: 70,
      stages: 6,
      feedback: 40,
    },
  },
  {
    id: 'tremolo',
    type: 'tremolo',
    name: 'Tremolo',
    enabled: true,
    bypassed: true,
    color: '#c98a3f',
    params: {
      mix: 100,
      level: 100,
      rate: 5,
      depth: 50,
      shape: 'sine',
      sync: false,
      bpm: 120,
      division: '1/8',
    },
  },
  {
    id: 'delay',
    type: 'delay',
    name: 'Delay',
    enabled: true,
    bypassed: true,
    color: '#6a7d4f',
    params: {
      mix: 30,
      level: 100,
      mode: 'digital',
      timeMs: 280,
      feedback: 0.34,
      tone: 60,
      sync: false,
      bpm: 120,
      division: '1/4',
      trails: true,
    },
  },
  {
    id: 'reverb',
    type: 'reverb',
    name: 'Reverb',
    enabled: true,
    bypassed: true,
    color: '#8b6f9f',
    params: {
      mix: 25,
      level: 100,
      mode: 'hall',
      decay: 1.8,
      preDelay: 24,
      lowCut: 120,
      highCut: 7200,
      trails: true,
    },
  },
];

export function clonePedals(pedals: PedalState[]): PedalState[] {
  return pedals.map(clonePedal);
}

function clonePedal(pedal: PedalState): PedalState {
  return {
    ...pedal,
    params: { ...pedal.params } as PedalParams,
  };
}

function stripBypassParams(params: Record<string, PedalParamValue>): Record<string, PedalParamValue> {
  const nextParams = { ...params };
  delete nextParams.bypass;
  delete nextParams.bypassed;
  return nextParams;
}

function toStoredPedals(pedals: PedalState[]): StoredPedal[] {
  return pedals.map((pedal) => ({
    id: pedal.id,
    enabled: pedal.enabled,
    bypassed: pedal.bypassed,
    params: stripBypassParams(pedal.params),
  }));
}

/** 저장본을 만든다. 음량 보정이 0 이면 필드를 쓰지 않아, 보정이 없는 저장본은 이전 버전과 똑같은 모양이다. */
function buildStoredState(pedals: PedalState[], presetTrimDb: number): StoredState {
  const storedState: StoredState = {
    version: SCHEMA_VERSION,
    pedals: toStoredPedals(pedals),
  };
  const trimDb = clampTrimDb(presetTrimDb);
  if (trimDb !== 0) storedState.presetTrimDb = trimDb;
  return storedState;
}

/** 지금 쓴다(밀려 있던 지연 저장은 SafeStorage 가 이 값으로 대신한다). 실패는 SafeStorage 가 한 번 알리고 메모리에 유지한다. */
function savePedals(pedals: PedalState[], presetTrimDb: number): void {
  safeStorage.set(STORAGE_KEYS.pedals, buildStoredState(pedals, presetTrimDb));
}

/** 노브를 돌리는 동안에는 쓰지 않고 마지막 변경 300 ms 뒤에 한 번 쓴다. 페이지가 가려지거나 닫히면 SafeStorage 가 바로 쓴다. */
function schedulePedalSave(pedals: PedalState[], presetTrimDb: number): void {
  safeStorage.setDebounced(STORAGE_KEYS.pedals, () => buildStoredState(pedals, presetTrimDb), 300);
}

function isParamValue(value: unknown): value is PedalParamValue {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
}

function sanitizeParams(value: unknown): Record<string, PedalParamValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value).filter((entry): entry is [string, PedalParamValue] => isParamValue(entry[1])),
  );
}

function toStoredPedal(value: unknown): StoredPedal | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.id !== 'string') return null;

  const params = sanitizeParams(candidate.params);
  const defaultPedal = initialPedals.find((pedal) => pedal.id === candidate.id);
  const legacyBypass = params.bypassed ?? params.bypass;

  return {
    id: candidate.id,
    enabled:
      typeof candidate.enabled === 'boolean' ? candidate.enabled : (defaultPedal?.enabled ?? true),
    bypassed:
      typeof candidate.bypassed === 'boolean'
        ? candidate.bypassed
        : typeof legacyBypass === 'boolean'
          ? legacyBypass
          : (defaultPedal?.bypassed ?? false),
    params,
  };
}

function normalizeStoredState(value: unknown): StoredState {
  const candidate = value as { version?: unknown; pedals?: unknown };
  const version = Array.isArray(value)
    ? 1
    : typeof candidate?.version === 'number'
      ? candidate.version
      : 1;
  const rawPedals = Array.isArray(value) ? value : candidate?.pedals;

  if (!Number.isInteger(version) || version < 1 || !Array.isArray(rawPedals)) {
    throw new Error('저장된 페달 데이터 형식이 올바르지 않습니다.');
  }

  const state: StoredState = {
    version,
    pedals: rawPedals.map(toStoredPedal).filter((pedal): pedal is StoredPedal => pedal !== null),
  };
  // 음량 보정은 숫자일 때만 받는다(M6: 없거나 이상한 값이면 0 = 필드 없음).
  const trimDb = Array.isArray(value) ? 0 : clampTrimDb((candidate as { presetTrimDb?: unknown })?.presetTrimDb);
  if (trimDb !== 0) state.presetTrimDb = trimDb;
  return state;
}

function normalizePercent(value: PedalParamValue | undefined, fallback: number): number {
  return typeof value === 'number' ? (value <= 2 ? Math.round(value * 100) : value) : fallback;
}

function migrateLegacyParams(
  type: PedalType,
  defaultParams: PedalParams,
  storedParams: Record<string, PedalParamValue>,
): Record<string, PedalParamValue> {
  const params: Record<string, PedalParamValue> = {
    ...defaultParams,
    ...storedParams,
    mix: normalizePercent(storedParams.mix, Number(defaultParams.mix)),
    level: normalizePercent(storedParams.level, Number(defaultParams.level)),
  };

  if (type === 'noiseGate') {
    params.thresholdDb =
      typeof storedParams.thresholdDb === 'number'
        ? storedParams.thresholdDb
        : (storedParams.threshold as number) ?? params.thresholdDb;
    params.releaseMs =
      typeof storedParams.releaseMs === 'number'
        ? storedParams.releaseMs
        : typeof storedParams.release === 'number'
          ? Math.round(storedParams.release * 1000)
          : params.releaseMs;
    delete params.threshold;
    delete params.release;
  }

  if (type === 'drive') {
    params.drive = normalizePercent(storedParams.drive, Number(params.drive));
    params.tone = normalizePercent(storedParams.tone, Number(params.tone));
  }

  if (type === 'crunch') {
    params.volume = normalizePercent(storedParams.volume, Number(params.volume));
    params.gain = normalizePercent(storedParams.gain, Number(params.gain));
    params.tone = normalizePercent(storedParams.tone, Number(params.tone));
    params.presence = normalizePercent(storedParams.presence, Number(params.presence));
  }

  if (type === 'fuzz') {
    params.fuzz = normalizePercent(storedParams.fuzz, Number(params.fuzz));
    params.tone = normalizePercent(storedParams.tone, Number(params.tone));
    params.bias = normalizePercent(storedParams.bias, Number(params.bias));
    params.gate = normalizePercent(storedParams.gate, Number(params.gate));
  }

  if (type === 'eq') {
    params.bassGain =
      typeof storedParams.bassGain === 'number'
        ? storedParams.bassGain
        : (storedParams.low as number) ?? params.bassGain;
    params.midGain =
      typeof storedParams.midGain === 'number'
        ? storedParams.midGain
        : (storedParams.mid as number) ?? params.midGain;
    params.trebleGain =
      typeof storedParams.trebleGain === 'number'
        ? storedParams.trebleGain
        : (storedParams.high as number) ?? params.trebleGain;
    delete params.low;
    delete params.mid;
    delete params.high;
  }

  if (type === 'delay') {
    params.timeMs =
      typeof storedParams.timeMs === 'number'
        ? storedParams.timeMs
        : typeof storedParams.time === 'number'
          ? Math.round(storedParams.time * 1000)
          : params.timeMs;
    params.tone = normalizePercent(storedParams.tone, Number(params.tone));
    delete params.time;
  }

  if (type === 'reverb') {
    params.highCut =
      typeof storedParams.highCut === 'number'
        ? storedParams.highCut
        : typeof storedParams.tone === 'number'
          ? 1000 + normalizePercent(storedParams.tone, 60) * 110
          : params.highCut;
    delete params.tone;
  }

  return stripBypassParams(params);
}

function insertDefaultCab(pedals: StoredPedal[]): StoredPedal[] {
  const nextPedals = pedals.map((pedal) => ({
    ...pedal,
    params: { ...pedal.params },
  }));

  if (nextPedals.some((pedal) => pedal.id === 'cab')) return nextPedals;

  const cab = initialPedals.find((pedal) => pedal.id === 'cab');
  if (!cab) throw new Error('Cab 기본값을 찾을 수 없습니다.');

  const storedCab = toStoredPedals([cab])[0];
  const eqIndex = nextPedals.findIndex((pedal) => pedal.id === 'eq');
  const delayIndex = nextPedals.findIndex((pedal) => pedal.id === 'delay');
  const reverbIndex = nextPedals.findIndex((pedal) => pedal.id === 'reverb');
  const insertIndex =
    eqIndex >= 0
      ? eqIndex + 1
      : delayIndex >= 0
        ? delayIndex
        : reverbIndex >= 0
          ? reverbIndex
          : nextPedals.length;

  nextPedals.splice(insertIndex, 0, storedCab);
  return nextPedals;
}

function addTrailsDefaults(pedals: StoredPedal[]): StoredPedal[] {
  return pedals.map((pedal) => {
    if (pedal.id !== 'delay' && pedal.id !== 'reverb') {
      return { ...pedal, params: { ...pedal.params } };
    }

    return {
      ...pedal,
      params: {
        ...pedal.params,
        trails: typeof pedal.params.trails === 'boolean' ? pedal.params.trails : true,
      },
    };
  });
}

function insertDefaultChorus(pedals: StoredPedal[]): StoredPedal[] {
  const nextPedals = pedals.map((pedal) => ({
    ...pedal,
    params: { ...pedal.params },
  }));

  if (nextPedals.some((pedal) => pedal.id === 'chorus')) return nextPedals;

  const chorus = initialPedals.find((pedal) => pedal.id === 'chorus');
  if (!chorus) throw new Error('Chorus 기본값을 찾을 수 없습니다.');

  const storedChorus = toStoredPedals([chorus])[0];
  const cabIndex = nextPedals.findIndex((pedal) => pedal.id === 'cab');
  const delayIndex = nextPedals.findIndex((pedal) => pedal.id === 'delay');
  const reverbIndex = nextPedals.findIndex((pedal) => pedal.id === 'reverb');
  const insertIndex =
    cabIndex >= 0 && (delayIndex < 0 || cabIndex < delayIndex)
      ? cabIndex + 1
      : delayIndex >= 0
        ? delayIndex
        : cabIndex >= 0
          ? cabIndex + 1
          : reverbIndex >= 0
            ? reverbIndex
            : nextPedals.length;

  nextPedals.splice(insertIndex, 0, storedChorus);
  return nextPedals;
}

function insertDefaultFlanger(pedals: StoredPedal[]): StoredPedal[] {
  const nextPedals = pedals.map((pedal) => ({
    ...pedal,
    params: { ...pedal.params },
  }));

  if (nextPedals.some((pedal) => pedal.id === 'flanger')) return nextPedals;

  const flanger = initialPedals.find((pedal) => pedal.id === 'flanger');
  if (!flanger) throw new Error('Flanger 기본값을 찾을 수 없습니다.');

  const storedFlanger = toStoredPedals([flanger])[0];
  const chorusIndex = nextPedals.findIndex((pedal) => pedal.id === 'chorus');
  const cabIndex = nextPedals.findIndex((pedal) => pedal.id === 'cab');
  const delayIndex = nextPedals.findIndex((pedal) => pedal.id === 'delay');
  const reverbIndex = nextPedals.findIndex((pedal) => pedal.id === 'reverb');
  const insertIndex =
    chorusIndex >= 0 && (delayIndex < 0 || chorusIndex < delayIndex)
      ? chorusIndex + 1
      : delayIndex >= 0
        ? delayIndex
        : chorusIndex >= 0
          ? chorusIndex + 1
          : cabIndex >= 0
            ? cabIndex + 1
            : reverbIndex >= 0
              ? reverbIndex
              : nextPedals.length;

  nextPedals.splice(insertIndex, 0, storedFlanger);
  return nextPedals;
}

function insertDefaultPhaser(pedals: StoredPedal[]): StoredPedal[] {
  const nextPedals = pedals.map((pedal) => ({
    ...pedal,
    params: { ...pedal.params },
  }));

  if (nextPedals.some((pedal) => pedal.id === 'phaser')) return nextPedals;

  const phaser = initialPedals.find((pedal) => pedal.id === 'phaser');
  if (!phaser) throw new Error('Phaser 기본값을 찾을 수 없습니다.');

  const storedPhaser = toStoredPedals([phaser])[0];
  const flangerIndex = nextPedals.findIndex((pedal) => pedal.id === 'flanger');
  const chorusIndex = nextPedals.findIndex((pedal) => pedal.id === 'chorus');
  const cabIndex = nextPedals.findIndex((pedal) => pedal.id === 'cab');
  const delayIndex = nextPedals.findIndex((pedal) => pedal.id === 'delay');
  const reverbIndex = nextPedals.findIndex((pedal) => pedal.id === 'reverb');
  const preferredIndex =
    flangerIndex >= 0
      ? flangerIndex
      : chorusIndex >= 0
        ? chorusIndex
        : cabIndex;
  const insertIndex =
    preferredIndex >= 0 && (delayIndex < 0 || preferredIndex < delayIndex)
      ? preferredIndex + 1
      : delayIndex >= 0
        ? delayIndex
        : preferredIndex >= 0
          ? preferredIndex + 1
          : reverbIndex >= 0
            ? reverbIndex
            : nextPedals.length;

  nextPedals.splice(insertIndex, 0, storedPhaser);
  return nextPedals;
}

function insertDefaultTremolo(pedals: StoredPedal[]): StoredPedal[] {
  const nextPedals = pedals.map((pedal) => ({
    ...pedal,
    params: { ...pedal.params },
  }));

  if (nextPedals.some((pedal) => pedal.id === 'tremolo')) return nextPedals;

  const tremolo = initialPedals.find((pedal) => pedal.id === 'tremolo');
  if (!tremolo) throw new Error('Tremolo 기본값을 찾을 수 없습니다.');

  const storedTremolo = toStoredPedals([tremolo])[0];
  const phaserIndex = nextPedals.findIndex((pedal) => pedal.id === 'phaser');
  const flangerIndex = nextPedals.findIndex((pedal) => pedal.id === 'flanger');
  const chorusIndex = nextPedals.findIndex((pedal) => pedal.id === 'chorus');
  const cabIndex = nextPedals.findIndex((pedal) => pedal.id === 'cab');
  const delayIndex = nextPedals.findIndex((pedal) => pedal.id === 'delay');
  const reverbIndex = nextPedals.findIndex((pedal) => pedal.id === 'reverb');
  const preferredIndex =
    phaserIndex >= 0
      ? phaserIndex
      : flangerIndex >= 0
        ? flangerIndex
        : chorusIndex >= 0
          ? chorusIndex
          : cabIndex;
  const insertIndex =
    preferredIndex >= 0 && (delayIndex < 0 || preferredIndex < delayIndex)
      ? preferredIndex + 1
      : delayIndex >= 0
        ? delayIndex
        : preferredIndex >= 0
          ? preferredIndex + 1
          : reverbIndex >= 0
            ? reverbIndex
            : nextPedals.length;

  nextPedals.splice(insertIndex, 0, storedTremolo);
  return nextPedals;
}

function insertDefaultAutoWah(pedals: StoredPedal[]): StoredPedal[] {
  const nextPedals = pedals.map((pedal) => ({
    ...pedal,
    params: { ...pedal.params },
  }));

  if (nextPedals.some((pedal) => pedal.id === 'auto-wah')) return nextPedals;

  const autoWah = initialPedals.find((pedal) => pedal.id === 'auto-wah');
  if (!autoWah) throw new Error('Auto Wah 기본값을 찾을 수 없습니다.');

  const storedAutoWah = toStoredPedals([autoWah])[0];
  const compressorIndex = nextPedals.findIndex((pedal) => pedal.id === 'compressor');
  const driveIndex = nextPedals.findIndex((pedal) => pedal.id === 'drive');
  const noiseGateIndex = nextPedals.findIndex((pedal) => pedal.id === 'noise-gate');
  const insertIndex =
    compressorIndex >= 0 && (driveIndex < 0 || compressorIndex < driveIndex)
      ? compressorIndex + 1
      : driveIndex >= 0
        ? driveIndex
        : compressorIndex >= 0
          ? compressorIndex + 1
          : noiseGateIndex >= 0
            ? noiseGateIndex + 1
            : 0;

  nextPedals.splice(insertIndex, 0, storedAutoWah);
  return nextPedals;
}

function insertDefaultGraphicEQ(pedals: StoredPedal[]): StoredPedal[] {
  const nextPedals = pedals.map((pedal) => ({
    ...pedal,
    params: { ...pedal.params },
  }));

  if (nextPedals.some((pedal) => pedal.id === 'graphic-eq')) return nextPedals;

  const graphicEQ = initialPedals.find((pedal) => pedal.id === 'graphic-eq');
  if (!graphicEQ) throw new Error('Graphic EQ 기본값을 찾을 수 없습니다.');

  const storedGraphicEQ = toStoredPedals([graphicEQ])[0];
  const fuzzIndex = nextPedals.findIndex((pedal) => pedal.id === 'fuzz');
  const eqIndex = nextPedals.findIndex((pedal) => pedal.id === 'eq');
  const cabIndex = nextPedals.findIndex((pedal) => pedal.id === 'cab');
  const chorusIndex = nextPedals.findIndex((pedal) => pedal.id === 'chorus');
  const flangerIndex = nextPedals.findIndex((pedal) => pedal.id === 'flanger');
  const phaserIndex = nextPedals.findIndex((pedal) => pedal.id === 'phaser');
  const tremoloIndex = nextPedals.findIndex((pedal) => pedal.id === 'tremolo');
  const delayIndex = nextPedals.findIndex((pedal) => pedal.id === 'delay');
  const reverbIndex = nextPedals.findIndex((pedal) => pedal.id === 'reverb');
  const insertIndex =
    fuzzIndex >= 0 && (eqIndex < 0 || fuzzIndex < eqIndex)
      ? fuzzIndex + 1
      : eqIndex >= 0
        ? eqIndex
        : cabIndex >= 0
          ? cabIndex
          : chorusIndex >= 0
            ? chorusIndex
            : flangerIndex >= 0
              ? flangerIndex
              : phaserIndex >= 0
                ? phaserIndex
                : tremoloIndex >= 0
                  ? tremoloIndex
                  : delayIndex >= 0
                    ? delayIndex
                    : reverbIndex >= 0
                      ? reverbIndex
                      : nextPedals.length;

  nextPedals.splice(insertIndex, 0, storedGraphicEQ);
  return nextPedals;
}

export const migrations: Record<number, (state: StoredState) => StoredState> = {
  1: (state) => ({
    version: 2,
    pedals: state.pedals.map((storedPedal) => {
      const defaultPedal = initialPedals.find((pedal) => pedal.id === storedPedal.id);
      if (!defaultPedal) {
        return { ...storedPedal, params: stripBypassParams(storedPedal.params) };
      }

      return {
        ...storedPedal,
        params: migrateLegacyParams(defaultPedal.type, defaultPedal.params, storedPedal.params),
      };
    }),
  }),
  2: (state) => ({
    version: 3,
    pedals: insertDefaultCab(state.pedals),
  }),
  3: (state) => ({
    version: 4,
    pedals: addTrailsDefaults(state.pedals),
  }),
  4: (state) => ({
    version: 5,
    pedals: insertDefaultChorus(state.pedals),
  }),
  5: (state) => ({
    version: 6,
    pedals: insertDefaultFlanger(state.pedals),
  }),
  6: (state) => ({
    version: 7,
    pedals: insertDefaultPhaser(state.pedals),
  }),
  7: (state) => ({
    version: 8,
    pedals: insertDefaultTremolo(state.pedals),
  }),
  8: (state) => ({
    version: 9,
    pedals: insertDefaultAutoWah(state.pedals),
  }),
  9: (state) => ({
    version: 10,
    pedals: insertDefaultGraphicEQ(state.pedals),
  }),
  10: (state) => ({
    version: 11,
    // Preserve the old audible state for every combination of the two switches.
    pedals: state.pedals.map((pedal) => ({
      ...pedal,
      enabled: true,
      bypassed: !pedal.enabled || pedal.bypassed,
    })),
  }),
};

export function migrateStoredState(input: StoredState): StoredState {
  if (input.version > SCHEMA_VERSION) {
    throw new Error(`지원하지 않는 페달 스키마 버전입니다: ${input.version}`);
  }

  let state: StoredState = {
    version: input.version,
    pedals: input.pedals.map((pedal) => ({ ...pedal, params: { ...pedal.params } })),
  };

  while (state.version < SCHEMA_VERSION) {
    const migration = migrations[state.version];
    if (!migration) throw new Error(`누락된 페달 마이그레이션입니다: ${state.version}`);
    const nextState = migration(state);
    if (nextState.version !== state.version + 1) {
      throw new Error(`잘못된 페달 마이그레이션 버전입니다: ${state.version}`);
    }
    state = nextState;
  }

  // 마이그레이션 함수는 페달만 다시 만든다. 페달과 무관한 음량 보정은 그대로 이어 붙인다.
  const trimDb = clampTrimDb(input.presetTrimDb);
  return trimDb === 0 ? state : { ...state, presetTrimDb: trimDb };
}

function readStoredState(): StoredState | null {
  // 읽지 못하는 값(깨졌거나 더 새로운 버전)은 SafeStorage 가 보관해 두고 한 번 알린 뒤 null 을 돌려 준다 — 기본값으로 시작한다.
  return safeStorage.read<StoredState | null>(
    STORAGE_KEYS.pedals,
    (raw) => migrateStoredState(normalizeStoredState(JSON.parse(raw))),
    null,
  );
}

function mergeStoredPedals(storedPedals: StoredPedal[] | null): PedalState[] {
  if (!storedPedals) return clonePedals(initialPedals);

  const defaultsById = new Map(initialPedals.map((pedal) => [pedal.id, pedal]));
  const usedIds = new Set<string>();
  const restored: PedalState[] = [];

  storedPedals.forEach((storedPedal) => {
    const defaultPedal = defaultsById.get(storedPedal.id);
    if (!defaultPedal || usedIds.has(storedPedal.id)) return;

    usedIds.add(storedPedal.id);
    restored.push(
      clonePedal({
        ...defaultPedal,
        enabled: storedPedal.enabled,
        bypassed: storedPedal.bypassed,
        params: {
          ...defaultPedal.params,
          ...stripBypassParams(storedPedal.params),
        } as PedalParams,
      }),
    );
  });

  initialPedals.forEach((pedal) => {
    if (!usedIds.has(pedal.id)) {
      restored.push(clonePedal(pedal));
    }
  });

  // M2(S2.1): 꺼져 있고 Mix 가 0 인 페달은 기본 Mix 로 되돌린다. 저장소에서 읽은 작업 상태와 프리셋(저장·가져오기)이 모두 여기를 지난다.
  return restoreMixOfOffPedals(restored, (pedalId) => {
    const mix = defaultsById.get(pedalId)?.params.mix;
    return typeof mix === 'number' ? mix : undefined;
  });
}

export function migratePedalCollection(value: unknown, version = 1): PedalState[] {
  const pedals = Array.isArray(value) ? value : [];
  const normalized = normalizeStoredState({ version, pedals });
  return mergeStoredPedals(migrateStoredState(normalized).pedals);
}

function movePedal(pedals: PedalState[], oldIndex: number, newIndex: number): PedalState[] {
  if (
    oldIndex === newIndex ||
    oldIndex < 0 ||
    newIndex < 0 ||
    oldIndex >= pedals.length ||
    newIndex >= pedals.length
  ) {
    return clonePedals(pedals);
  }

  const nextPedals = clonePedals(pedals);
  const [movedPedal] = nextPedals.splice(oldIndex, 1);
  nextPedals.splice(newIndex, 0, movedPedal);
  return nextPedals;
}

interface PedalStore {
  pedals: PedalState[];
  /** 지금 프리셋의 음량 보정(dB). 프리셋을 불러올 때 따라 들어오고, 페달 상태와 함께 저장된다. 기본 0. */
  presetTrimDb: number;
  activePedalId: string | null;
  draggingPedalId: string | null;
  reorderPedals: (oldIndex: number, newIndex: number) => void;
  togglePedal: (id: string) => void;
  setPedalBypass: (id: string, bypassed: boolean) => void;
  updatePedalParam: (id: string, paramName: string, value: PedalParamValue) => void;
  setActivePedal: (id: string | null) => void;
  setDraggingPedal: (id: string | null) => void;
  loadPedalsFromStorage: () => void;
  savePedalsToStorage: () => void;
  resetPedalOrder: () => void;
  /** 페달 전체를 바꾼다. `presetTrimDb` 를 주면 음량 보정도 같이 바꾸고, 안 주면 지금 값을 그대로 둔다. */
  setPedals: (pedals: PedalState[], presetTrimDb?: number) => void;
  /** 음량 보정만 바꾼다('음량 맞추기'). 0.1 dB 단위·±24 dB 로 정리하고 바로 저장한다. */
  setPresetTrimDb: (presetTrimDb: number) => void;
  updatePedal: (pedal: PedalState) => void;
}

const restoredState = readStoredState();

export const usePedalStore = create<PedalStore>((set, get) => ({
  pedals: mergeStoredPedals(restoredState?.pedals ?? null),
  presetTrimDb: clampTrimDb(restoredState?.presetTrimDb),
  activePedalId: null,
  draggingPedalId: null,

  reorderPedals: (oldIndex, newIndex) =>
    set((state) => {
      const pedals = movePedal(state.pedals, oldIndex, newIndex);
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

  togglePedal: (id) =>
    set((state) => {
      const pedals = state.pedals.map((pedal) =>
        pedal.id === id ? { ...clonePedal(pedal), enabled: true, bypassed: pedal.enabled && !pedal.bypassed } : clonePedal(pedal),
      );
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

  setPedalBypass: (id, bypassed) =>
    set((state) => {
      const pedals = state.pedals.map((pedal) =>
        pedal.id === id ? clonePedal({ ...pedal, enabled: true, bypassed }) : clonePedal(pedal),
      );
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

  updatePedalParam: (id, paramName, value) =>
    set((state) => {
      const pedals = state.pedals.map((pedal) => {
        if (pedal.id !== id) return pedal;
        if (paramName === 'bypass' || paramName === 'bypassed') return pedal;

        const nextValue =
          pedal.type === 'delay' && paramName === 'feedback' && typeof value === 'number'
            ? Math.min(0.95, Math.max(0, value))
            : value;

        return clonePedal({
          ...pedal,
          params: {
            ...pedal.params,
            [paramName]: nextValue,
          } as PedalParams,
        });
      });

      schedulePedalSave(pedals, state.presetTrimDb);
      return { pedals };
    }),

  setActivePedal: (id) => set({ activePedalId: id }),

  setDraggingPedal: (id) => set({ draggingPedalId: id }),

  loadPedalsFromStorage: () => {
    const stored = readStoredState();
    set({
      pedals: mergeStoredPedals(stored?.pedals ?? null),
      presetTrimDb: clampTrimDb(stored?.presetTrimDb),
    });
  },

  savePedalsToStorage: () => savePedals(get().pedals, get().presetTrimDb),

  resetPedalOrder: () => {
    const pedals = clonePedals(initialPedals);
    // 초기 보드는 보정 없이(0 dB) 시작한다.
    savePedals(pedals, 0);
    set({
      pedals,
      presetTrimDb: 0,
      activePedalId: null,
      draggingPedalId: null,
    });
  },

  setPedals: (pedals, presetTrimDb) => {
    const nextPedals = clonePedals(pedals);
    const nextTrimDb = presetTrimDb === undefined ? get().presetTrimDb : clampTrimDb(presetTrimDb);
    savePedals(nextPedals, nextTrimDb);
    set({ pedals: nextPedals, presetTrimDb: nextTrimDb });
  },

  setPresetTrimDb: (presetTrimDb) => {
    const nextTrimDb = roundTrimDb(clampTrimDb(presetTrimDb));
    // 대기 중이던 페달 저장도 이 시점의 페달로 함께 쓴다(저장본에서 페달과 보정이 어긋나지 않게).
    savePedals(get().pedals, nextTrimDb);
    set({ presetTrimDb: nextTrimDb });
  },

  updatePedal: (pedal) =>
    set((state) => {
      const nextPedal = clonePedal(pedal);
      const pedals = state.pedals.map((current) =>
        current.id === pedal.id ? nextPedal : clonePedal(current),
      );
      savePedals(pedals, state.presetTrimDb);
      return { pedals };
    }),

}));
