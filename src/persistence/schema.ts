// 저장 형식 v2(S2.4, 설계서 4.7절): 타입, 읽을 때의 검증, 메모리 모양(PedalState·Preset)과의 변환.
//
// v1 과 달라진 점
//   - 켜짐은 `active` 하나다(옛 `enabled` + `bypassed` → M1). LED 도, 소리도 이 값이다.
//   - 페달 순서(`chain`)와 페달별 값(`pedals`)을 따로 둔다. 이름·색은 앱 코드의 기본 페달에서 가져오므로 적지 않는다.
//   - 모르는 필드는 버리지 않고 `_extra` 에 둔다(M7). 다시 저장할 때도 그대로 돌려 쓴다.
//
// 이 파일은 저장소·스토어·오디오를 모른다. JSON 문자열(또는 파싱한 값)과 메모리 값 사이의 변환만 한다.
import type { PedalParamValue, PedalParams, PedalState, PedalType, Preset } from '../audio/types';
import { clampTrimDb } from '../audio/offline/loudnessSpec';
import { mergeStoredPedals, type StoredPedal } from './legacy/boardV1';

export const SCHEMA_V2 = 2 as const;

/** 앱이 모르는 필드(M7). 값은 JSON 으로 읽은 그대로다. */
export type UnknownFields = Record<string, unknown>;

export interface PedalStateV2 {
  id: string;
  type: PedalType;
  /** 소리에 걸리는가 = LED. 옛 `enabled && !bypassed`(M1) */
  active: boolean;
  /** 노브 값. 읽을 때 4.9 스키마 범위로 맞춘다(M3) */
  params: PedalParams;
  _extra?: UnknownFields;
}

/** `guitar-pedalboard:v2:state` — 지금 만지고 있는 보드 */
export interface StateV2 {
  schemaVersion: typeof SCHEMA_V2;
  /** 페달 순서(id) */
  chain: string[];
  pedals: Record<string, PedalStateV2>;
  /** 지금 프리셋의 음량 보정(dB). 없으면 0(M6) */
  trimDb: number;
  _extra?: UnknownFields;
}

export interface PresetV2 {
  schemaVersion: typeof SCHEMA_V2;
  id: string;
  name: string;
  /** 저장소에는 'user' 만 들어간다(팩토리는 코드에 있다). 'factory' 는 S2.7 의 내보내기·가져오기가 쓴다. */
  origin: 'factory' | 'user';
  chain: string[];
  pedals: Record<string, PedalStateV2>;
  trimDb: number;
  /** ISO 8601. v1 프리셋에는 만든 시각이 없으므로 `updatedAt` 과 같게 둔다. */
  createdAt: string;
  updatedAt: string;
  // 아래 넷은 v1 프리셋이 가지고 있던 표시용 필드다. 설계서 4.7절의 타입에는 없지만 값을 잃지 않으려고 그대로 옮긴다(기록 L-101).
  libraryId?: string;
  libraryName?: string;
  description?: string;
  tags?: string[];
  _extra?: UnknownFields;
}

/** `guitar-pedalboard:v2:presets` — 사용자 프리셋 목록 */
export interface PresetsStoreV2 {
  schemaVersion: typeof SCHEMA_V2;
  presets: PresetV2[];
  _extra?: UnknownFields;
}

/** 메모리의 보드: 스토어가 쓰는 모양 */
export interface BoardSnapshot {
  pedals: PedalState[];
  trimDb: number;
}

/** 다시 저장할 때 돌려 쓸 `_extra` 모음 */
export interface StateExtras {
  state?: UnknownFields;
  pedals: Record<string, UnknownFields>;
}

const KNOWN_STATE_KEYS = ['schemaVersion', 'chain', 'pedals', 'trimDb'] as const;
const KNOWN_PEDAL_KEYS = ['id', 'type', 'active', 'params'] as const;
const KNOWN_PRESET_KEYS = [
  'schemaVersion', 'id', 'name', 'origin', 'chain', 'pedals', 'trimDb', 'createdAt', 'updatedAt',
  'libraryId', 'libraryName', 'description', 'tags',
] as const;
const KNOWN_PRESETS_STORE_KEYS = ['schemaVersion', 'presets'] as const;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isParamValue(value: unknown): value is PedalParamValue {
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean';
}

function readParams(value: unknown): Record<string, PedalParamValue> {
  if (!isRecord(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, PedalParamValue] => isParamValue(entry[1])));
}

/**
 * 모르는 필드(M7)를 모은다: 아는 키를 뺀 나머지 + 이미 적혀 있던 `_extra`.
 * 비어 있으면 undefined 라서 저장본에 `_extra` 가 쓸데없이 생기지 않는다.
 */
export function collectExtra(record: Record<string, unknown>, knownKeys: readonly string[]): UnknownFields | undefined {
  const rest: UnknownFields = {};
  for (const [key, value] of Object.entries(record)) {
    if (key === '_extra' || knownKeys.includes(key)) continue;
    rest[key] = value;
  }
  const merged = { ...(isRecord(record._extra) ? record._extra : {}), ...rest };
  return Object.keys(merged).length > 0 ? merged : undefined;
}

/** v1 에서 모르는 필드를 모을 때 쓰는, v1 이 아는 키 */
export const KNOWN_V1_STATE_KEYS = ['version', 'pedals', 'presetTrimDb'] as const;
export const KNOWN_V1_PEDAL_KEYS = ['id', 'enabled', 'bypassed', 'params'] as const;
/** 프리셋 파일·v1 프리셋 저장본의 페달은 이름·종류·색도 함께 적혀 있다. */
export const KNOWN_V1_PRESET_PEDAL_KEYS = ['id', 'type', 'name', 'enabled', 'bypassed', 'color', 'params'] as const;
export const KNOWN_V1_PRESET_KEYS = [
  'id', 'name', 'libraryId', 'libraryName', 'description', 'tags', 'pedals', 'trimDb', 'updatedAt',
] as const;

// ---------------------------------------------------------------------------------------------
// 읽기: JSON → v2 타입. 모양이 틀리면 던진다(SafeStorage 가 원문을 보관하고 기본값으로 시작한다).
// ---------------------------------------------------------------------------------------------

function toPedalStateV2(value: unknown): PedalStateV2 | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.type !== 'string' || typeof value.active !== 'boolean') return null;
  const pedal: PedalStateV2 = {
    id: value.id,
    type: value.type as PedalType,
    active: value.active,
    params: readParams(value.params) as PedalParams,
  };
  const extra = collectExtra(value, KNOWN_PEDAL_KEYS);
  if (extra) pedal._extra = extra;
  return pedal;
}

function toPedalMap(value: unknown): Record<string, PedalStateV2> {
  if (!isRecord(value)) throw new Error('저장된 페달 목록 형식이 올바르지 않습니다.');
  const pedals: Record<string, PedalStateV2> = {};
  for (const [key, entry] of Object.entries(value)) {
    // `__proto__` 키에 대입하면 객체의 원형이 바뀐다. 페달 id 로 쓰일 수 없는 이름이므로 건너뛴다.
    if (key === '__proto__') continue;
    const pedal = toPedalStateV2(entry);
    if (pedal && pedal.id === key) pedals[key] = pedal;
  }
  return pedals;
}

function toChain(value: unknown, pedals: Record<string, PedalStateV2>): string[] {
  if (!Array.isArray(value)) throw new Error('저장된 페달 순서 형식이 올바르지 않습니다.');
  const chain: string[] = [];
  const seen = new Set<string>();
  for (const id of value) {
    if (typeof id === 'string' && Object.hasOwn(pedals, id) && !seen.has(id)) {
      seen.add(id);
      chain.push(id);
    }
  }
  // 순서에 빠진 페달은 맨 뒤에 붙인다(손으로 고친 파일에서도 페달이 사라지지 않게).
  for (const id of Object.keys(pedals)) if (!seen.has(id)) chain.push(id);
  return chain;
}

export function toStateV2(value: unknown): StateV2 {
  if (!isRecord(value)) throw new Error('저장된 작업 상태 형식이 올바르지 않습니다.');
  if (value.schemaVersion !== SCHEMA_V2) throw new Error(`지원하지 않는 작업 상태 버전입니다: ${String(value.schemaVersion)}`);
  const pedals = toPedalMap(value.pedals);
  const state: StateV2 = {
    schemaVersion: SCHEMA_V2,
    chain: toChain(value.chain, pedals),
    pedals,
    trimDb: clampTrimDb(value.trimDb),
  };
  const extra = collectExtra(value, KNOWN_STATE_KEYS);
  if (extra) state._extra = extra;
  return state;
}

export function parseStateV2(raw: string): StateV2 {
  return toStateV2(JSON.parse(raw));
}

function toIso(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? value : fallback;
}

export function toPresetV2(value: unknown): PresetV2 {
  if (!isRecord(value)) throw new Error('저장된 프리셋 형식이 올바르지 않습니다.');
  if (value.schemaVersion !== SCHEMA_V2) throw new Error(`지원하지 않는 프리셋 버전입니다: ${String(value.schemaVersion)}`);
  if (typeof value.id !== 'string' || typeof value.name !== 'string') throw new Error('저장된 프리셋 항목이 올바르지 않습니다.');
  const pedals = toPedalMap(value.pedals);
  const epoch = new Date(0).toISOString();
  const updatedAt = toIso(value.updatedAt, epoch);
  const preset: PresetV2 = {
    schemaVersion: SCHEMA_V2,
    id: value.id,
    name: value.name,
    origin: value.origin === 'factory' ? 'factory' : 'user',
    chain: toChain(value.chain, pedals),
    pedals,
    trimDb: clampTrimDb(value.trimDb),
    createdAt: toIso(value.createdAt, updatedAt),
    updatedAt,
  };
  if (typeof value.libraryId === 'string') preset.libraryId = value.libraryId;
  if (typeof value.libraryName === 'string') preset.libraryName = value.libraryName;
  if (typeof value.description === 'string') preset.description = value.description;
  if (Array.isArray(value.tags)) preset.tags = value.tags.filter((tag): tag is string => typeof tag === 'string');
  const extra = collectExtra(value, KNOWN_PRESET_KEYS);
  if (extra) preset._extra = extra;
  return preset;
}

export function toPresetsStoreV2(value: unknown): PresetsStoreV2 {
  if (!isRecord(value) || !Array.isArray(value.presets)) throw new Error('저장된 프리셋 목록 형식이 올바르지 않습니다.');
  if (value.schemaVersion !== SCHEMA_V2) throw new Error(`지원하지 않는 프리셋 목록 버전입니다: ${String(value.schemaVersion)}`);
  const store: PresetsStoreV2 = { schemaVersion: SCHEMA_V2, presets: value.presets.map(toPresetV2) };
  const extra = collectExtra(value, KNOWN_PRESETS_STORE_KEYS);
  if (extra) store._extra = extra;
  return store;
}

export function parsePresetsStoreV2(raw: string): PresetsStoreV2 {
  return toPresetsStoreV2(JSON.parse(raw));
}

// ---------------------------------------------------------------------------------------------
// 메모리 ↔ v2
// ---------------------------------------------------------------------------------------------

/**
 * v2 의 페달들을 메모리의 페달 15개로 만든다. 기본 채우기·스키마 범위 맞추기(M3)·꺼진 페달의 Mix 되살리기(M2)는
 * v1 을 읽을 때 쓰던 `mergeStoredPedals` 를 그대로 쓴다 — 어느 쪽 저장본에서 열어도 같은 규칙이 같은 순서로 적용된다.
 */
function pedalsFromRecords(chain: readonly string[], pedals: Record<string, PedalStateV2>): PedalState[] {
  const stored: StoredPedal[] = [];
  for (const id of chain) {
    const pedal = pedals[id];
    if (!pedal) continue;
    stored.push({ id: pedal.id, enabled: true, bypassed: !pedal.active, params: { ...pedal.params } as Record<string, PedalParamValue> });
  }
  return mergeStoredPedals(stored);
}

export function stateV2ToBoard(state: StateV2): BoardSnapshot {
  return { pedals: pedalsFromRecords(state.chain, state.pedals), trimDb: clampTrimDb(state.trimDb) };
}

export function extrasOfState(state: StateV2 | null | undefined): StateExtras {
  const pedals: Record<string, UnknownFields> = {};
  if (state) {
    for (const [id, pedal] of Object.entries(state.pedals)) {
      if (pedal._extra) pedals[id] = pedal._extra;
    }
  }
  return state?._extra ? { state: state._extra, pedals } : { pedals };
}

function recordsFromPedals(pedals: PedalState[], extras: Record<string, UnknownFields> | undefined): Record<string, PedalStateV2> {
  const records: Record<string, PedalStateV2> = {};
  for (const pedal of pedals) {
    const record: PedalStateV2 = { id: pedal.id, type: pedal.type, active: pedal.active, params: { ...pedal.params } as PedalParams };
    const extra = extras?.[pedal.id];
    if (extra) record._extra = extra;
    records[pedal.id] = record;
  }
  return records;
}

export function boardToStateV2(pedals: PedalState[], trimDb: number, extras?: StateExtras): StateV2 {
  const state: StateV2 = {
    schemaVersion: SCHEMA_V2,
    chain: pedals.map((pedal) => pedal.id),
    pedals: recordsFromPedals(pedals, extras?.pedals),
    trimDb: clampTrimDb(trimDb),
  };
  if (extras?.state) state._extra = extras.state;
  return state;
}

/** `Date` 가 다룰 수 있는 정수 밀리초로 맞춘다. 저장(ISO 8601)했다 읽어도 같은 값이 되도록 양쪽이 이 함수를 지난다. */
export function normalizeMs(value: number): number {
  const limit = 8.64e15;
  if (!Number.isFinite(value)) return 0;
  return Math.min(limit, Math.max(-limit, Math.trunc(value)));
}

/** 다시 저장할 때 돌려 쓰는, 프리셋에 딸린 값: 만든 시각과 모르는 필드 */
export interface PresetCarry {
  createdAt?: string;
  _extra?: UnknownFields;
  /** 페달별 모르는 필드 */
  pedalExtras?: Record<string, UnknownFields>;
}

export function presetToV2(preset: Preset, carry?: PresetCarry): PresetV2 {
  const updatedAt = new Date(normalizeMs(preset.updatedAt)).toISOString();
  const v2: PresetV2 = {
    schemaVersion: SCHEMA_V2,
    id: preset.id,
    name: preset.name,
    origin: 'user',
    chain: preset.pedals.map((pedal) => pedal.id),
    pedals: recordsFromPedals(preset.pedals, carry?.pedalExtras),
    trimDb: clampTrimDb(preset.trimDb),
    createdAt: carry?.createdAt ?? updatedAt,
    updatedAt,
  };
  if (preset.libraryId !== undefined) v2.libraryId = preset.libraryId;
  if (preset.libraryName !== undefined) v2.libraryName = preset.libraryName;
  if (preset.description !== undefined) v2.description = preset.description;
  if (preset.tags !== undefined) v2.tags = [...preset.tags];
  if (carry?._extra) v2._extra = carry._extra;
  return v2;
}

export function presetFromV2(preset: PresetV2): Preset {
  const { pedals, trimDb } = stateV2ToBoard({ schemaVersion: SCHEMA_V2, chain: preset.chain, pedals: preset.pedals, trimDb: preset.trimDb });
  const memory: Preset = {
    id: preset.id,
    name: preset.name,
    pedals,
    ...(trimDb !== 0 ? { trimDb } : {}),
    updatedAt: Date.parse(preset.updatedAt),
  };
  if (preset.libraryId !== undefined) memory.libraryId = preset.libraryId;
  if (preset.libraryName !== undefined) memory.libraryName = preset.libraryName;
  if (preset.description !== undefined) memory.description = preset.description;
  if (preset.tags !== undefined) memory.tags = [...preset.tags];
  return memory;
}

/** 프리셋 목록 저장본을 만든다. 목록의 모르는 필드(`_extra`)는 `previous` 에서 이어 받는다. */
export function buildPresetsStoreV2(presets: PresetV2[], previous?: Pick<PresetsStoreV2, '_extra'>): PresetsStoreV2 {
  const store: PresetsStoreV2 = { schemaVersion: SCHEMA_V2, presets };
  if (previous?._extra) store._extra = previous._extra;
  return store;
}

/** 저장한 프리셋에서 다음 저장에 돌려 쓸 값(만든 시각, 모르는 필드)을 뽑는다. */
export function carryOfPreset(preset: PresetV2): PresetCarry {
  const carry: PresetCarry = { createdAt: preset.createdAt };
  if (preset._extra) carry._extra = preset._extra;
  const pedalExtras: Record<string, UnknownFields> = {};
  for (const [id, pedal] of Object.entries(preset.pedals)) {
    if (pedal._extra) pedalExtras[id] = pedal._extra;
  }
  if (Object.keys(pedalExtras).length > 0) carry.pedalExtras = pedalExtras;
  return carry;
}

// ---------------------------------------------------------------------------------------------
// M5: 팩토리 프리셋과 똑같은 사본을 알아본다.
// ---------------------------------------------------------------------------------------------

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (isRecord(value)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

/**
 * 이름과 내용이 같은지 보는 열쇠(설계서 M5의 '이름+내용 해시 일치'). id·시각·라이브러리 표시는 보지 않는다.
 * 페달 순서, 켜짐, 모든 노브 값, 음량 보정이 같아야 같은 내용이다.
 */
export function presetContentKey(preset: Pick<Preset, 'name' | 'pedals' | 'trimDb'>): string {
  return JSON.stringify(
    canonicalValue([
      preset.name.trim(),
      clampTrimDb(preset.trimDb),
      preset.pedals.map((pedal) => [pedal.id, pedal.active, pedal.params]),
    ]),
  );
}

/** 사용자 프리셋 중 팩토리와 이름·내용이 똑같은 것의 id 목록 */
export function findFactoryCopies(userPresets: readonly Preset[], factoryPresets: readonly Preset[]): string[] {
  const factoryKeys = new Set(factoryPresets.map(presetContentKey));
  return userPresets.filter((preset) => factoryKeys.has(presetContentKey(preset))).map((preset) => preset.id);
}

/** 값이 같은지(키 순서와 무관) 본다. 변환을 마친 뒤 되읽어 확인하는 데 쓴다. */
export function isSameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(canonicalValue(a)) === JSON.stringify(canonicalValue(b));
}
