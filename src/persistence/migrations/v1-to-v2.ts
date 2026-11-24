// v1 → v2 변환(S2.4, 설계서 4.7절 M1~M7). 저장소를 모르는 순수 함수만 둔다.
//
// 규칙이 적용되는 곳
//   M1 active = enabled && !bypassed ........ mergeStoredPedals(legacy/boardV1)
//   M2 꺼진 페달의 Mix 0 → 기본 Mix .......... mergeStoredPedals(같은 곳, M3 다음)
//   M3 파라미터를 4.9 스키마 범위로 clamp ..... mergeStoredPedals(같은 곳)
//   M4 MIDI 매핑 …:enabled·…:bypass → …:active .. 해당 없음 — v1 의 MIDI 매핑은 페달 id → 스위치 번호(CC·노트)이고
//                                           `…:enabled`·`…:bypass` 같은 이름의 키가 없다(기록 L-102)
//   M5 팩토리 프리셋과 똑같은 사본 ............ schema.findFactoryCopies (알아보기만 하고 지우지 않는다)
//   M6 trimDb 가 없으면 0 ................... clampTrimDb
//   M7 모르는 필드는 `_extra` ................ 이 파일의 collect…Extras
//
// v1 을 읽는 코드(legacy/)를 그대로 쓰므로, 변환한 뒤의 메모리 값은 v1 을 옛 방식으로 읽은 값과 같아야 한다.
// `verifyConversion` 이 그것을 매번 확인한다 — 다르면 v2 를 쓰지 않고 v1 으로 계속 동작한다.
import type { Preset } from '../../audio/types';
import { clampTrimDb } from '../../audio/offline/loudnessSpec';
import { clonePedals, initialPedals } from '../../presets/initialPedals';
import { mergeStoredPedals, migrateStoredState, normalizeStoredState, type StoredState } from '../legacy/boardV1';
import { parsePresetJson } from '../legacy/presetsV1';
import {
  boardToStateV2,
  buildPresetsStoreV2,
  collectExtra,
  isRecord,
  isSameValue,
  KNOWN_V1_PEDAL_KEYS,
  KNOWN_V1_PRESET_KEYS,
  KNOWN_V1_PRESET_PEDAL_KEYS,
  KNOWN_V1_STATE_KEYS,
  normalizeMs,
  presetFromV2,
  presetToV2,
  stateV2ToBoard,
  type BoardSnapshot,
  type PresetsStoreV2,
  type StateExtras,
  type StateV2,
  type UnknownFields,
} from '../schema';

/** v1 작업 상태를 옛 읽기 코드로 읽은 결과. `json` 은 모르는 필드(M7)를 찾으려고 함께 들고 다니는 원본이다. */
export interface BoardV1Read {
  stored: StoredState;
  json: unknown;
}

/** v1 사용자 프리셋을 옛 읽기 코드로 읽은 결과 */
export interface PresetsV1Read {
  presets: Preset[];
  json: unknown;
}

/**
 * v1 작업 상태 원문을 읽는다. 옛 스토어가 `SafeStorage.read` 에 넘기던 해석과 같다:
 * 읽지 못하는 값(깨졌거나 더 새로운 버전)은 던지고, SafeStorage 가 원문을 보관한 뒤 기본값으로 시작한다.
 */
export function readBoardV1(raw: string): BoardV1Read {
  const json: unknown = JSON.parse(raw);
  return { stored: migrateStoredState(normalizeStoredState(json)), json };
}

/** v1 사용자 프리셋 원문을 읽는다(옛 `parsePresetJson` 그대로). */
export function readPresetsV1(raw: string): PresetsV1Read {
  const presets = parsePresetJson(raw);
  return { presets, json: JSON.parse(raw) as unknown };
}

/** v1 에서 읽어 메모리 모양으로 만든 보드. v1 작업 상태가 없으면 null(= 기본 보드). */
export function boardFromV1(read: BoardV1Read | null): BoardSnapshot | null {
  if (!read) return null;
  return { pedals: mergeStoredPedals(read.stored.pedals), trimDb: clampTrimDb(read.stored.presetTrimDb) };
}

export interface ConvertedV1 {
  /** v1 을 옛 방식으로 읽은 메모리 값. 변환이 맞는지 견주는 기준이다. */
  board: BoardSnapshot | null;
  userPresets: Preset[];
  /** v2 로 옮긴 결과 */
  state: StateV2;
  presetsStore: PresetsStoreV2;
}

function collectBoardExtras(json: unknown): StateExtras {
  const pedals: Record<string, UnknownFields> = {};
  const list: unknown[] = Array.isArray(json) ? json : isRecord(json) && Array.isArray(json.pedals) ? json.pedals : [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const extra = collectExtra(entry, KNOWN_V1_PEDAL_KEYS);
    if (extra) pedals[entry.id] = extra;
  }
  const state = isRecord(json) ? collectExtra(json, KNOWN_V1_STATE_KEYS) : undefined;
  return state ? { state, pedals } : { pedals };
}

function collectPresetExtras(rawPreset: unknown): { extra?: UnknownFields; pedalExtras: Record<string, UnknownFields> } {
  const pedalExtras: Record<string, UnknownFields> = {};
  if (!isRecord(rawPreset)) return { pedalExtras };
  const list: unknown[] = Array.isArray(rawPreset.pedals) ? rawPreset.pedals : [];
  for (const entry of list) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const extra = collectExtra(entry, KNOWN_V1_PRESET_PEDAL_KEYS);
    if (extra) pedalExtras[entry.id] = extra;
  }
  const extra = collectExtra(rawPreset, KNOWN_V1_PRESET_KEYS);
  return extra ? { extra, pedalExtras } : { pedalExtras };
}

/** v1 에서 읽은 두 가지(작업 상태, 사용자 프리셋)를 v2 로 옮긴다. 둘 다 없을 수 있다. 저장소를 건드리지 않는다. */
export function convertV1ToV2(boardRead: BoardV1Read | null, presetsRead: PresetsV1Read | null): ConvertedV1 {
  const board = boardFromV1(boardRead);
  const state = boardToStateV2(
    board?.pedals ?? clonePedals(initialPedals),
    board?.trimDb ?? 0,
    boardRead ? collectBoardExtras(boardRead.json) : undefined,
  );

  const userPresets = presetsRead?.presets ?? [];
  const rawList: unknown[] = presetsRead
    ? Array.isArray(presetsRead.json)
      ? presetsRead.json
      : isRecord(presetsRead.json) && Array.isArray(presetsRead.json.presets)
        ? presetsRead.json.presets
        : []
    : [];
  const presetsV2 = userPresets.map((preset, index) => {
    const { extra, pedalExtras } = collectPresetExtras(rawList[index]);
    return presetToV2(preset, { ...(extra ? { _extra: extra } : {}), pedalExtras });
  });

  return { board, userPresets, state, presetsStore: buildPresetsStoreV2(presetsV2) };
}

/**
 * 변환한 v2 를 메모리로 되읽은 값이 v1 을 옛 방식으로 읽은 값과 같은지 본다(두 번째 규칙: 변환은 소리를 바꾸지 않는다).
 * 같으면 null, 다르면 어디가 다른지 한 줄을 돌려 준다.
 */
export function verifyConversion(converted: ConvertedV1): string | null {
  const back = stateV2ToBoard(converted.state);
  const expected: BoardSnapshot = converted.board ?? { pedals: clonePedals(initialPedals), trimDb: 0 };
  if (!isSameValue(back.pedals, expected.pedals)) return '작업 상태의 페달이 v1 을 읽은 값과 다릅니다';
  if (back.trimDb !== expected.trimDb) return '작업 상태의 음량 보정이 v1 을 읽은 값과 다릅니다';

  if (converted.presetsStore.presets.length !== converted.userPresets.length) return '프리셋 개수가 다릅니다';
  for (let index = 0; index < converted.userPresets.length; index += 1) {
    const source = converted.userPresets[index];
    const restored = presetFromV2(converted.presetsStore.presets[index]);
    if (!isSameValue(restored, { ...source, updatedAt: normalizeMs(source.updatedAt) })) {
      return `프리셋 '${source.name}' 이(가) v1 을 읽은 값과 다릅니다`;
    }
  }
  return null;
}
