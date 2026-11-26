// 내보내기·가져오기 파일 형식 v2(S2.7, 설계서 4.7절 '내보내기 파일 형식 v2').
//
// 이 파일은 저장소·스토어·화면을 모른다. 프리셋 목록과 파일 문자열 사이의 변환, 그리고 '무엇을 가져오고 무엇을 건너뛸지'의
// 계산만 한다. 실제로 저장하는 일은 `presetStore.ts` 가 한다.
//
// 가져오기가 받는 파일: v2 파일(`format: 'guitar-pedalboard-presets'`), 그리고 예전 앱이 내보낸 v1(배열 또는 `{version, presets}`).
// 받은 항목은 아래 순서로 가른다(항목마다 한 번씩).
//   1. 팩토리 프리셋이면 제외한다 — `origin: 'factory'`, `factory-` 로 시작하는 id, 또는 지금 앱의 팩토리 프리셋과 이름·내용이 같은 것.
//   2. 내 프리셋 중 id 가 같고 내용도 같으면 조용히 건너뛴다. id 가 달라도 이름·내용이 똑같으면 같다.
//   3. id 가 같거나 이름이 같은데 내용이 다르면 '충돌'이다 — 덮어쓰기 / 사본으로 추가 / 건너뛰기를 사용자가 고른다.
//   4. 그 밖에는 그대로 추가한다.
import type { Preset } from '../audio/types';
import { parsePresetJson } from './legacy/presetsV1';
import {
  SCHEMA_V2,
  isRecord,
  normalizeMs,
  presetContentKey,
  presetFromV2,
  presetToV2,
  toPresetV2,
  type PresetCarry,
  type PresetV2,
} from './schema';
import { ko } from '../i18n/ko';

export const EXPORT_FORMAT = 'guitar-pedalboard-presets' as const;
/** 앱이 팩토리 프리셋에만 쓰는 id 머리말. 사용자 프리셋의 id 는 이 머리말을 쓰지 않는다. */
export const FACTORY_ID_PREFIX = 'factory-';

export interface ExportFileV2 {
  format: typeof EXPORT_FORMAT;
  schemaVersion: typeof SCHEMA_V2;
  appVersion: string;
  /** ISO 8601 */
  exportedAt: string;
  /** `origin === 'user'` 만 들어간다 */
  presets: PresetV2[];
}

export interface BuildExportOptions {
  appVersion: string;
  /** 내보내는 시각(밀리초) */
  exportedAt: number;
  /** 프리셋의 만든 시각·모르는 필드를 돌려 쓰는 길. 없으면 만든 시각 = 고친 시각이다. */
  carryOf?: (id: string) => PresetCarry | undefined;
}

/** 내 프리셋으로 내보내기 파일을 만든다. 팩토리 항목은 부르는 쪽이 미리 뺀다(여기서도 한 번 더 거른다). */
export function buildExportFile(userPresets: readonly Preset[], options: BuildExportOptions): ExportFileV2 {
  return {
    format: EXPORT_FORMAT,
    schemaVersion: SCHEMA_V2,
    appVersion: options.appVersion,
    exportedAt: new Date(normalizeMs(options.exportedAt)).toISOString(),
    presets: userPresets
      .filter((preset) => !preset.id.startsWith(FACTORY_ID_PREFIX))
      .map((preset) => presetToV2(preset, options.carryOf?.(preset.id))),
  };
}

export function serializeExportFile(file: ExportFileV2): string {
  return JSON.stringify(file, null, 2);
}

export interface ImportCandidate {
  preset: Preset;
  origin: 'factory' | 'user';
}

export interface ParsedImportFile {
  source: 'v1' | 'v2';
  candidates: ImportCandidate[];
}

/**
 * 가져올 파일 문자열을 읽는다. 모양이 틀리면 사용자에게 보일 한국어 메시지로 던진다.
 * v1 은 옛 파서(`parsePresetJson`)를 그대로 쓴다 — 켜짐 합치기(M1)·범위 맞추기(M3)·음량 보정(M6)이 같은 규칙으로 적용된다.
 */
export function parseImportFile(text: string): ParsedImportFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(ko.importFile.unreadable);
  }

  // v2 파일은 `format` 이나 `schemaVersion` 을 가진 객체다. v1 객체는 `version` 만 가진다.
  if (isRecord(parsed) && (parsed.format !== undefined || parsed.schemaVersion !== undefined)) {
    if (parsed.format !== EXPORT_FORMAT) throw new Error(ko.importFile.notOurs);
    if (parsed.schemaVersion !== SCHEMA_V2) {
      throw new Error(ko.importFile.unsupportedVersion(String(parsed.schemaVersion)));
    }
    if (!Array.isArray(parsed.presets)) throw new Error(ko.importFile.badFormat);
    const candidates = parsed.presets.map((entry): ImportCandidate => {
      let preset: PresetV2;
      try {
        preset = toPresetV2(entry);
      } catch {
        throw new Error(ko.importFile.badEntry);
      }
      return { preset: presetFromV2(preset), origin: preset.origin };
    });
    return { source: 'v2', candidates };
  }

  const presets = parsePresetJson(text);
  return {
    source: 'v1',
    // v1 파일에는 origin 이 없다. 팩토리 항목은 `planImport` 가 `factory-` id 로 가른다(L-143).
    candidates: presets.map((preset) => ({ preset, origin: 'user' as const })),
  };
}

export type ImportConflictReason = 'id' | 'name';

export interface ImportConflict {
  incoming: Preset;
  existing: Preset;
  reason: ImportConflictReason;
}

export interface ImportPlan {
  source: 'v1' | 'v2';
  /** 충돌 없이 그대로 추가할 것 */
  add: Preset[];
  /** 사용자가 고를 것 */
  conflicts: ImportConflict[];
  /** 이미 있는 것과 똑같아서 조용히 건너뛴 수 */
  identical: number;
  /** 팩토리 프리셋이라 제외한 수 */
  factory: number;
}

/**
 * 파일의 항목을 가른다. 아무것도 바꾸지 않는다(저장은 `applyImport`).
 * @param existingUser 지금 내 프리셋
 * @param factoryPresets 지금 앱의 팩토리 프리셋(코드에 있는 것)
 */
export function planImport(
  file: ParsedImportFile,
  existingUser: readonly Preset[],
  factoryPresets: readonly Preset[],
): ImportPlan {
  const factoryKeys = new Set(factoryPresets.map(presetContentKey));
  const byId = new Map(existingUser.map((preset) => [preset.id, preset]));
  const byKey = new Map(existingUser.map((preset) => [presetContentKey(preset), preset]));
  const byName = new Map<string, Preset>();
  for (const preset of existingUser) if (!byName.has(preset.name.trim())) byName.set(preset.name.trim(), preset);

  // 파일 안에서 id 가 겹치면 뒤의 것이 이긴다(옛 가져오기가 이름이 겹치면 뒤의 것을 쓰던 것과 같은 방향).
  const lastIndexOfId = new Map<string, number>();
  file.candidates.forEach((candidate, index) => lastIndexOfId.set(candidate.preset.id, index));

  const plan: ImportPlan = { source: file.source, add: [], conflicts: [], identical: 0, factory: 0 };

  file.candidates.forEach((candidate, index) => {
    const { preset } = candidate;
    if (lastIndexOfId.get(preset.id) !== index) {
      plan.identical += 1;
      return;
    }
    if (candidate.origin === 'factory' || preset.id.startsWith(FACTORY_ID_PREFIX) || factoryKeys.has(presetContentKey(preset))) {
      plan.factory += 1;
      return;
    }

    const key = presetContentKey(preset);
    const sameId = byId.get(preset.id);
    if (sameId) {
      if (presetContentKey(sameId) === key) plan.identical += 1;
      else plan.conflicts.push({ incoming: preset, existing: sameId, reason: 'id' });
      return;
    }
    if (byKey.has(key)) {
      plan.identical += 1;
      return;
    }
    const sameName = byName.get(preset.name.trim());
    if (sameName) {
      plan.conflicts.push({ incoming: preset, existing: sameName, reason: 'name' });
      return;
    }
    plan.add.push(preset);
  });

  return plan;
}

export type ConflictResolution = 'overwrite' | 'copy' | 'skip';

export interface ApplyImportOptions {
  now: number;
  createId: () => string;
}

export interface ImportResult {
  /** 가져온 뒤의 내 프리셋 전체 */
  next: Preset[];
  /** 새로 생기거나 바뀐 수 */
  imported: number;
  /** 건너뛴 수: 똑같은 것 + 팩토리 + 사용자가 건너뛰기를 고른 것 */
  skipped: number;
}

/** 사본의 이름: '이름 (가져옴)', 그것도 있으면 '이름 (가져옴 2)'… */
export function uniqueCopyName(name: string, takenNames: ReadonlySet<string>): string {
  const base = name.trim() || 'Imported Preset';
  let candidate = `${base} (가져옴)`;
  for (let n = 2; takenNames.has(candidate); n += 1) candidate = `${base} (가져옴 ${n})`;
  return candidate;
}

/**
 * 계획과 사용자의 선택으로 가져온 뒤의 목록을 만든다. 선택이 없는 충돌은 '건너뛰기'로 본다(아무것도 지우지 않는 쪽).
 * 덮어쓰기는 기존 프리셋의 id 를 그대로 둔다 — 즐겨찾기·최근 목록이 id 로 가리키고 있기 때문이다.
 */
export function applyImport(
  plan: ImportPlan,
  existingUser: readonly Preset[],
  resolutions: readonly ConflictResolution[],
  options: ApplyImportOptions,
): ImportResult {
  const next = [...existingUser];
  let imported = 0;
  let skipped = plan.identical + plan.factory;

  for (const preset of plan.add) {
    next.push({ ...preset, updatedAt: options.now });
    imported += 1;
  }

  plan.conflicts.forEach((conflict, index) => {
    const resolution = resolutions[index] ?? 'skip';
    if (resolution === 'skip') {
      skipped += 1;
      return;
    }
    if (resolution === 'overwrite') {
      const at = next.findIndex((preset) => preset.id === conflict.existing.id);
      const replaced: Preset = { ...conflict.incoming, id: conflict.existing.id, updatedAt: options.now };
      if (at >= 0) next[at] = replaced;
      else next.push(replaced);
      imported += 1;
      return;
    }
    const taken = new Set(next.map((preset) => preset.name));
    next.push({
      ...conflict.incoming,
      id: options.createId(),
      name: uniqueCopyName(conflict.incoming.name, taken),
      updatedAt: options.now,
    });
    imported += 1;
  });

  return { next, imported, skipped };
}

/** 결과 한 줄: 'N개 가져옴 · M개 건너뜀' */
export function formatImportSummary(result: Pick<ImportResult, 'imported' | 'skipped'>): string {
  return ko.importFile.summary(result.imported, result.skipped);
}
