// v1 저장 형식(`guitar-pedalboard:pedals`, 스키마 1~11)을 읽는 코드(S2.4 선행 이동: `pedalStore.ts` 에서 옮겼다. 내용은 그대로).
// 읽기 전용이다. v1 키는 새 저장 형식으로 옮긴 뒤에도 지우지 않고 백업으로 남긴다.
import type { PedalParamValue, PedalParams, PedalState, PedalType } from '../../audio/types';
import { clampTrimDb } from '../../audio/offline/loudnessSpec';
import { clampPedalsToSchema, restoreMixOfOffPedals } from '../../presets/normalize';
import { clonePedal, clonePedals, initialPedals } from '../../presets/initialPedals';

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

export function stripBypassParams(params: Record<string, PedalParamValue>): Record<string, PedalParamValue> {
  const nextParams = { ...params };
  delete nextParams.bypass;
  delete nextParams.bypassed;
  return nextParams;
}

export function toStoredPedals(pedals: PedalState[]): StoredPedal[] {
  return pedals.map((pedal) => ({
    id: pedal.id,
    enabled: pedal.enabled,
    bypassed: pedal.bypassed,
    params: stripBypassParams(pedal.params),
  }));
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

export function normalizeStoredState(value: unknown): StoredState {
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

export function mergeStoredPedals(storedPedals: StoredPedal[] | null): PedalState[] {
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

  // 저장소에서 읽은 작업 상태와 프리셋(저장·가져오기)이 모두 여기를 지난다.
  // M3(S2.2): 스키마 범위를 벗어난 숫자(예: Reverb Decay 7.5)는 범위 안으로 맞춘다.
  // M2(S2.1): 꺼져 있고 Mix 가 0 인 페달은 기본 Mix 로 되돌린다.
  // 순서는 M3 → M2 다. 꺼진 페달의 Mix 가 범위 밖 음수(−5 등, 손으로 고친 파일)이면 M3 이 0 으로 맞춘 뒤에야 '꺼짐 + Mix 0' 이 되므로 M2 가 뒤에 와야 잡는다(기록 L-91).
  return restoreMixOfOffPedals(clampPedalsToSchema(restored), (pedalId) => {
    const mix = defaultsById.get(pedalId)?.params.mix;
    return typeof mix === 'number' ? mix : undefined;
  });
}

export function migratePedalCollection(value: unknown, version = 1): PedalState[] {
  const pedals = Array.isArray(value) ? value : [];
  const normalized = normalizeStoredState({ version, pedals });
  return mergeStoredPedals(migrateStoredState(normalized).pedals);
}
