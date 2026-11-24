// 앱을 열 때 저장 형식을 정한다(S2.4, 설계서 4.7절 '변환 절차').
//
//   1. `guitar-pedalboard:schema` 를 읽는다.
//   2. 2 이면 v2 키(`v2:state`, `v2:presets`)를 읽는다. — 평소의 길
//   3. 없으면 v1 키를 읽어 메모리에서 v2 로 변환하고, v2 키 두 개를 쓴다. 둘 다 성공한 뒤에만 `schema` 를 2 로 쓴다.
//      쓰기가 실패하면 이번 방문은 메모리의 v2 로 동작하고 다음 방문에 다시 시도한다(schema 가 없으므로 같은 길을 다시 탄다).
//   4. v1 키는 지우지도, 다시 쓰지도 않는다(백업). 구버전 탭이 v1 키를 다시 쓰면 다른 탭이 그것을 알아챈다(app/crossTabNotice).
//   5. 변환은 멱등이다: v1 키가 그대로이므로 몇 번을 돌려도 같은 v2 가 나온다.
//
// 변환이 틀릴 수 있는 경우에는 v2 를 쓰지 않는다. 변환한 v2 를 되읽은 값이 v1 을 옛 방식으로 읽은 값과 다르거나 변환이 던지면
// '옛 방식'(legacy) 모드로 열린다: v1 키를 읽고, 이후 저장도 v1 키에 옛 모양으로 한다. 앱은 v1 데이터로 계속 동작하고,
// v1 키는 그대로 남으므로 다음 방문에 다시 변환을 시도한다(S2.4 '주의': 변환에 실패하면 앱은 v1 데이터로 계속 동작해야 한다).
//
// 이 파일은 토스트·React 에 기대지 않는다. 쓸 저장소를 받는다(앱은 공용 `safeStorage`, 시험은 가짜 저장소).
import type { Preset } from '../audio/types';
import { STORAGE_KEYS } from './keys';
import type { SafeStorage } from './SafeStorage';
import {
  boardFromV1,
  convertV1ToV2,
  readBoardV1,
  readPresetsV1,
  verifyConversion,
  type BoardV1Read,
  type ConvertedV1,
  type PresetsV1Read,
} from './migrations/v1-to-v2';
import {
  parsePresetsStoreV2,
  parseStateV2,
  presetFromV2,
  SCHEMA_V2,
  stateV2ToBoard,
  type BoardSnapshot,
  type PresetsStoreV2,
  type StateV2,
} from './schema';

/**
 * v2        평소: 이미 v2 였다
 * converted 이번 방문에 v1 에서 v2 로 옮겼다
 * fresh     옮길 것이 없다(처음 쓰거나, v1 값이 깨져 보관됐다) — v2 로 시작한다고만 표시했다
 * legacy    옛 방식: v1 키를 읽고 쓴다(변환이 틀렸거나, 더 새로운 저장 형식이 있다)
 */
export type BootOutcome = 'v2' | 'converted' | 'fresh' | 'legacy';

export interface BootResult {
  outcome: BootOutcome;
  /** 이번 방문에 읽고 쓰는 키의 종류. `legacy` 만 v1 키다. */
  mode: 'v2' | 'legacy';
  /** 시작 때 읽은 보드(메모리 모양). null 이면 기본 보드로 시작한다. */
  board: BoardSnapshot | null;
  /** 시작 때 읽은 사용자 프리셋(메모리 모양) */
  userPresets: Preset[];
  /** 읽은(또는 옮긴) v2 원본. 다시 저장할 때 만든 시각과 모르는 필드(M7)를 돌려 쓰는 데 쓴다. */
  loadedState: StateV2 | null;
  loadedPresets: PresetsStoreV2 | null;
  /** `legacy` 가 된 이유(콘솔·시험용) */
  reason?: string;
}

export interface BootstrapOptions {
  /** 시험용: 변환 함수를 바꿔 끼운다(변환이 틀렸을 때 옛 방식으로 열리는지 본다). */
  convert?: typeof convertV1ToV2;
}

/** `schema` 키의 값. 2 이상의 정수만 받는다. 그 밖의 값은 깨진 값이다(SafeStorage 가 원문을 보관하고 v1 에서 다시 옮긴다). */
function parseSchemaValue(raw: string): number {
  const value = Number(raw.trim());
  if (!Number.isInteger(value) || value < SCHEMA_V2) throw new Error(`알 수 없는 저장 형식 값입니다: ${raw.slice(0, 20)}`);
  return value;
}

function legacyResult(boardRead: BoardV1Read | null, presetsRead: PresetsV1Read | null, reason: string): BootResult {
  return {
    outcome: 'legacy',
    mode: 'legacy',
    board: boardFromV1(boardRead),
    userPresets: presetsRead?.presets ?? [],
    loadedState: null,
    loadedPresets: null,
    reason,
  };
}

function loadLegacy(storage: SafeStorage, reason: string): BootResult {
  const boardRead = storage.read<BoardV1Read | null>(STORAGE_KEYS.v1Pedals, readBoardV1, null);
  const presetsRead = storage.read<PresetsV1Read | null>(STORAGE_KEYS.v1Presets, readPresetsV1, null);
  return legacyResult(boardRead, presetsRead, reason);
}

function loadV2(storage: SafeStorage): BootResult {
  // 읽지 못하는 값은 SafeStorage 가 원문을 보관하고 한 번 알린 뒤 기본값(null)을 돌려 준다.
  const state = storage.read<StateV2 | null>(STORAGE_KEYS.v2State, parseStateV2, null);
  const presets = storage.read<PresetsStoreV2 | null>(STORAGE_KEYS.v2Presets, parsePresetsStoreV2, null);
  return {
    outcome: 'v2',
    mode: 'v2',
    board: state ? stateV2ToBoard(state) : null,
    userPresets: presets ? presets.presets.map(presetFromV2) : [],
    loadedState: state,
    loadedPresets: presets,
  };
}

function convertFromV1(storage: SafeStorage, options: BootstrapOptions): BootResult {
  // v1 값은 옛 스토어가 읽던 방식 그대로 읽는다. 깨진 값은 여기서 보관되고 그 부분만 기본값이 된다.
  const boardRead = storage.read<BoardV1Read | null>(STORAGE_KEYS.v1Pedals, readBoardV1, null);
  const presetsRead = storage.read<PresetsV1Read | null>(STORAGE_KEYS.v1Presets, readPresetsV1, null);

  if (!boardRead && !presetsRead) {
    // 옮길 것이 없다. 이 표시가 없으면 다음 방문에 v2 로 저장한 값을 v1 에서 온 것으로 착각해 덮어쓴다.
    storage.setRaw(STORAGE_KEYS.schema, String(SCHEMA_V2));
    return { outcome: 'fresh', mode: 'v2', board: null, userPresets: [], loadedState: null, loadedPresets: null };
  }

  let converted: ConvertedV1;
  try {
    converted = (options.convert ?? convertV1ToV2)(boardRead, presetsRead);
    const problem = verifyConversion(converted);
    if (problem) throw new Error(problem);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`저장 형식 v2 변환을 건너뛰고 v1 데이터로 계속합니다: ${reason}`);
    return legacyResult(boardRead, presetsRead, reason);
  }

  // 두 키를 모두 쓴 뒤에만 schema 를 쓴다. 하나라도 실패하면 schema 가 없으므로 다음 방문에 v1 에서 다시 옮긴다.
  const stateWrite = storage.set(STORAGE_KEYS.v2State, converted.state);
  const presetsWrite = storage.set(STORAGE_KEYS.v2Presets, converted.presetsStore);
  if (stateWrite.ok && presetsWrite.ok) storage.setRaw(STORAGE_KEYS.schema, String(SCHEMA_V2));

  return {
    outcome: 'converted',
    mode: 'v2',
    board: converted.board,
    userPresets: converted.userPresets,
    loadedState: converted.state,
    loadedPresets: converted.presetsStore,
  };
}

/** 앱을 열 때 한 번 부른다. 던지지 않는다: 어떤 이유로든 실패하면 옛 방식으로 연다. */
export function runBootstrap(storage: SafeStorage, options: BootstrapOptions = {}): BootResult {
  try {
    const schema = storage.read<number | null>(STORAGE_KEYS.schema, parseSchemaValue, null);
    if (schema === SCHEMA_V2) return loadV2(storage);
    // 더 새로운 앱이 쓴 저장 형식이다. 그 앱의 v2 이후 키를 덮어쓰지 않도록 건드리지 않고, 이 앱은 v1 키로 연다.
    if (schema !== null) return loadLegacy(storage, `더 새로운 저장 형식(schema ${schema})이 있어 v1 키로 엽니다`);
    return convertFromV1(storage, options);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`저장 형식을 정하지 못해 v1 키로 엽니다: ${reason}`);
    return loadLegacy(storage, reason);
  }
}
