// 작업 상태(페달 보드)와 사용자 프리셋을 읽고 쓰는 곳(S2.4). 스토어는 저장 키·형식을 몰라도 되고 이 파일의 함수만 쓴다.
//
// 어느 키에 어떤 모양으로 쓰는지는 앱을 열 때 정해진다(persistence/bootstrap):
//   v2 모드     `v2:state`·`v2:presets` 에 v2 모양(켜짐 = active)으로 읽고 쓴다.
//   legacy 모드  변환이 틀렸을 때만. v1 키에 옛 모양(enabled·bypassed)으로 읽고 쓴다 — 앱은 v1 데이터로 계속 동작한다.
// 어느 모드에서도 v1 키를 v2 값으로 덮어쓰지 않는다.
import type { PedalState, Preset } from '../audio/types';
import { safeStorage, STORAGE_KEYS } from './index';
import { runBootstrap, type BootResult } from './bootstrap';
import { buildStoredState } from './legacy/boardV1';
import { serializePresetPayload } from './legacy/presetsV1';
import { boardFromV1, readBoardV1, readPresetsV1, type BoardV1Read, type PresetsV1Read } from './migrations/v1-to-v2';
import {
  boardToStateV2,
  buildPresetsStoreV2,
  carryOfPreset,
  extrasOfState,
  parsePresetsStoreV2,
  parseStateV2,
  presetFromV2,
  presetToV2,
  stateV2ToBoard,
  type BoardSnapshot,
  type PresetCarry,
  type PresetsStoreV2,
  type StateExtras,
  type StateV2,
} from './schema';

let boot: BootResult | undefined;
/** 읽을 때 만난 모르는 필드(M7). 다시 저장할 때 그대로 돌려 쓴다. */
let stateExtras: StateExtras = { pedals: {} };
let listExtra: Pick<PresetsStoreV2, '_extra'> | undefined;
let presetCarry = new Map<string, PresetCarry>();

function rememberState(state: StateV2 | null): void {
  stateExtras = extrasOfState(state);
}

function rememberPresets(store: PresetsStoreV2 | null): void {
  listExtra = store?._extra ? { _extra: store._extra } : undefined;
  presetCarry = new Map((store?.presets ?? []).map((preset) => [preset.id, carryOfPreset(preset)]));
}

/** 앱을 연 결과. 처음 부를 때 한 번만 저장 형식을 정하고(필요하면 v1 에서 v2 로 옮기고), 이후에는 같은 결과를 돌려 준다. */
export function getBoot(): BootResult {
  if (!boot) {
    boot = runBootstrap(safeStorage);
    rememberState(boot.loadedState);
    rememberPresets(boot.loadedPresets);
  }
  return boot;
}

/** 저장소에서 보드를 다시 읽는다. 없거나 읽지 못하면 null(기본 보드). */
export function readBoard(): BoardSnapshot | null {
  if (getBoot().mode === 'legacy') {
    return boardFromV1(safeStorage.read<BoardV1Read | null>(STORAGE_KEYS.v1Pedals, readBoardV1, null));
  }
  const state = safeStorage.read<StateV2 | null>(STORAGE_KEYS.v2State, parseStateV2, null);
  rememberState(state);
  return state ? stateV2ToBoard(state) : null;
}

/** 지금 쓴다(밀려 있던 지연 저장은 SafeStorage 가 이 값으로 대신한다). 실패는 SafeStorage 가 한 번 알리고 메모리에 유지한다. */
export function writeBoard(pedals: PedalState[], trimDb: number): void {
  if (getBoot().mode === 'legacy') safeStorage.set(STORAGE_KEYS.v1Pedals, buildStoredState(pedals, trimDb));
  else safeStorage.set(STORAGE_KEYS.v2State, boardToStateV2(pedals, trimDb, stateExtras));
}

/** 노브를 돌리는 동안에는 쓰지 않고 마지막 변경 `ms` 뒤에 한 번 쓴다. 페이지가 가려지거나 닫히면 SafeStorage 가 바로 쓴다. */
export function writeBoardDebounced(pedals: PedalState[], trimDb: number, ms = 300): void {
  if (getBoot().mode === 'legacy') {
    safeStorage.setDebounced(STORAGE_KEYS.v1Pedals, () => buildStoredState(pedals, trimDb), ms);
  } else {
    safeStorage.setDebounced(STORAGE_KEYS.v2State, () => boardToStateV2(pedals, trimDb, stateExtras), ms);
  }
}

/** 저장소에서 사용자 프리셋을 다시 읽는다. 읽지 못하면 빈 목록(원문은 SafeStorage 가 보관한다). */
export function readUserPresets(): Preset[] {
  if (getBoot().mode === 'legacy') {
    return safeStorage.read<PresetsV1Read | null>(STORAGE_KEYS.v1Presets, readPresetsV1, null)?.presets ?? [];
  }
  const store = safeStorage.read<PresetsStoreV2 | null>(STORAGE_KEYS.v2Presets, parsePresetsStoreV2, null);
  rememberPresets(store);
  return store ? store.presets.map(presetFromV2) : [];
}

/** 사용자 프리셋 목록 전체를 쓴다. 팩토리 프리셋은 코드에 있으므로 넘기지 않는다. */
export function writeUserPresets(presets: Preset[]): void {
  if (getBoot().mode === 'legacy') {
    safeStorage.setRaw(STORAGE_KEYS.v1Presets, serializePresetPayload(presets));
    return;
  }
  const records = presets.map((preset) => presetToV2(preset, presetCarry.get(preset.id)));
  // 이번에 쓴 값의 만든 시각이 다음 저장에서도 이어지도록 새 목록으로 바꿔 둔다.
  presetCarry = new Map(records.map((record) => [record.id, carryOfPreset(record)]));
  safeStorage.set(STORAGE_KEYS.v2Presets, buildPresetsStoreV2(records, listExtra));
}
