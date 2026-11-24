// v1 프리셋 payload(`web-guitar-pedalboard-presets` 와 내보내기 파일)를 읽는 코드(S2.4 선행 이동: `presetStore.ts` 에서 옮겼다. 내용은 그대로).
import type { Preset } from '../../audio/types';
import { clampTrimDb } from '../../audio/offline/loudnessSpec';
import { createId } from '../../presets/createId';
import { migratePedalCollection, type LegacyPedalRecord } from './boardV1';

/** 파일·v1 저장본에 적히는 프리셋. 메모리의 `Preset` 과 페달 모양만 다르다 — 켜짐이 옛 `enabled`·`bypassed` 두 필드로 풀려 있다. */
export type LegacyPreset = Omit<Preset, 'pedals'> & { pedals: LegacyPedalRecord[] };

export type PresetExport = {
  version: number;
  exportedAt?: number;
  presets: LegacyPreset[];
};

function isPreset(value: unknown): value is LegacyPreset {
  const preset = value as LegacyPreset;

  return (
    !!preset &&
    typeof preset.id === 'string' &&
    typeof preset.name === 'string' &&
    typeof preset.updatedAt === 'number' && Number.isFinite(preset.updatedAt) &&
    Array.isArray(preset.pedals)
  );
}

function normalizeImportedPreset(preset: LegacyPreset, version: number): Preset {
  return {
    id: preset.id || createId(),
    name: preset.name.trim() || 'Imported Preset',
    libraryId: typeof preset.libraryId === 'string' ? preset.libraryId : undefined,
    libraryName: typeof preset.libraryName === 'string' ? preset.libraryName : undefined,
    description: typeof preset.description === 'string' ? preset.description : undefined,
    tags: Array.isArray(preset.tags) ? preset.tags.filter((tag) => typeof tag === 'string') : undefined,
    pedals: migratePedalCollection(preset.pedals, version),
    // 음량 보정이 없거나 숫자가 아니면 필드를 두지 않는다(= 0, M6). 이전 버전이 내보낸 파일에는 이 필드가 없다.
    ...normalizeTrimField(preset.trimDb),
    updatedAt: typeof preset.updatedAt === 'number' ? preset.updatedAt : Date.now(),
  };
}

/** 0 이 아닌 음량 보정만 필드로 남긴다. 저장·내보내기·불러오기가 같은 모양을 쓴다. */
export function normalizeTrimField(value: unknown): { trimDb?: number } {
  const trimDb = clampTrimDb(value);
  return trimDb === 0 ? {} : { trimDb };
}

export function parsePresetJson(json: string): Preset[] {
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('JSON 파일을 읽을 수 없습니다. 형식을 확인해 주세요.'); }
  if (!parsed || typeof parsed !== 'object') throw new Error('프리셋 JSON 형식이 올바르지 않습니다.');
  const payload = parsed as Partial<PresetExport>;
  const candidates = Array.isArray(parsed) ? parsed : payload.presets;
  const version = Array.isArray(parsed) ? 1 : typeof payload.version === 'number' ? payload.version : 1;

  if (!Array.isArray(candidates)) {
    throw new Error('프리셋 JSON 형식이 올바르지 않습니다.');
  }

  if (!candidates.every(isPreset)) throw new Error('프리셋 항목이 올바르지 않습니다.');
  return candidates.map((preset) => normalizeImportedPreset(preset, version));
}
