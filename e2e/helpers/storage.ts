// 저장소(localStorage) 시험 도우미(S2.4) — 저장 키 이름, 옛 저장본(v1 픽스처) 불러오기, 저장된 v2 작업 상태 읽기.
// 키 이름은 일부러 `src/persistence/keys.ts` 에서 가져오지 않고 글자 그대로 적었다. 저장소에 실제로 보이는 이름이 약속이라서,
// 앱 코드의 상수가 바뀌면 이 시험이 실패해야 한다(e2e 프로젝트는 앱 소스를 import 하지 않는다 — tsconfig.e2e.json).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { fixturesDir } from './env';
import { pedalRegionName } from './ko-names';

/** 저장 형식 버전(문자열 `2`). 변환이 끝난 뒤 맨 마지막에 쓴다. */
export const SCHEMA_KEY = 'guitar-pedalboard:schema';
/** v2 작업 상태 */
export const STATE_KEY = 'guitar-pedalboard:v2:state';
/** v2 사용자 프리셋 */
export const PRESETS_KEY = 'guitar-pedalboard:v2:presets';
/** v1 작업 상태 — v2 로 옮긴 뒤에는 읽지도 쓰지도 않는 백업 */
export const V1_PEDALS_KEY = 'guitar-pedalboard:pedals';
/** v1 사용자 프리셋(접두사가 다른 옛 이름) — 같은 백업 */
export const V1_PRESETS_KEY = 'web-guitar-pedalboard-presets';

/** 기본 보드의 페달: 화면에 보이는 이름 → 저장된 id. 보드 순서(기본)대로 적었다. */
export const PEDALS = [
  { name: 'Noise Gate', id: 'noise-gate' },
  { name: 'Compressor', id: 'compressor' },
  { name: 'Auto Wah', id: 'auto-wah' },
  { name: 'Drive', id: 'drive' },
  { name: 'Crunch', id: 'crunch' },
  { name: 'Fuzz', id: 'fuzz' },
  { name: 'Graphic EQ', id: 'graphic-eq' },
  { name: 'EQ', id: 'eq' },
  { name: 'Cab', id: 'cab' },
  { name: 'Chorus', id: 'chorus' },
  { name: 'Flanger', id: 'flanger' },
  { name: 'Phaser', id: 'phaser' },
  { name: 'Tremolo', id: 'tremolo' },
  { name: 'Delay', id: 'delay' },
  { name: 'Reverb', id: 'reverb' },
] as const;

/** 처음 열면 켜져 있는 이펙트(설계서 4.7·S2.4: 기본 5개) */
export const DEFAULT_ACTIVE_NAMES: readonly string[] = ['Noise Gate', 'Compressor', 'Drive', 'EQ', 'Cab'];

export function idOfPedal(name: string): string {
  const found = PEDALS.find((pedal) => pedal.name === name);
  if (!found) throw new Error(`알 수 없는 페달 이름: ${name}`);
  return found.id;
}

/** 이름 목록을 기본 보드 순서로 정렬한 새 배열(순서와 상관없이 같은 집합인지 견주려고) */
export function inBoardOrder(names: readonly string[]): string[] {
  return PEDALS.map((pedal) => pedal.name as string).filter((name) => names.includes(name));
}

/** 페달 카드(`<section aria-label>` = region, 이름은 '<이름> 이펙터') */
export const pedalGroup = (page: Page, name: string): Locator => page.getByRole('region', { name: pedalRegionName(name), exact: true });
/** 카드 안의 켜고 끄는 발스위치 */
export const stompOf = (page: Page, name: string): Locator => pedalGroup(page, name).locator('.stomp-toggle-switch');
/** 알림(토스트) — 같은 key 는 한 장만 뜬다 */
export const toastOf = (page: Page, key: string): Locator => page.locator(`.toast[data-toast-key="${key}"]`);

export interface V1Fixture {
  name: string;
  storage: Record<string, string>;
}

/** `e2e/fixtures/storage-v1/<file>` — 저장 형식을 바꾸기 전 앱(2a5ab81)이 쓴 localStorage 상태를 그대로 담은 파일 */
export function loadV1Fixture(file: string): V1Fixture {
  return JSON.parse(readFileSync(join(fixturesDir, 'storage-v1', file), 'utf8')) as V1Fixture;
}

/**
 * 페이지가 뜨기 전에 저장소를 이 상태로 만든다. 새로고침할 때 덮어쓰지 않도록 sessionStorage 로 한 번만 넣는다
 * (픽스처 README 의 방법). 이 페이지에만 건다 — 같은 컨텍스트에 새로 연 다른 탭(`context.newPage()`)에는 영향이 없다.
 */
export async function seedStorage(page: Page, storage: Record<string, string>): Promise<void> {
  await page.addInitScript((entries) => {
    if (window.sessionStorage.getItem('__fixture-loaded')) return;
    window.sessionStorage.setItem('__fixture-loaded', '1');
    window.localStorage.clear();
    for (const [key, value] of Object.entries(entries)) window.localStorage.setItem(key, value);
  }, storage);
}

export async function readLocal(page: Page, key: string): Promise<string | null> {
  return page.evaluate((storageKey) => window.localStorage.getItem(storageKey), key);
}

export interface StoredBoardV2 {
  schemaVersion: number;
  chain: string[];
  pedals: Record<string, { id: string; type: string; active: boolean; params: Record<string, unknown> }>;
  trimDb: number;
}

/** 저장된 v2 작업 상태. 아직 쓰지 않았으면 null */
export async function readStoredBoard(page: Page): Promise<StoredBoardV2 | null> {
  const raw = await readLocal(page, STATE_KEY);
  return raw === null ? null : (JSON.parse(raw) as StoredBoardV2);
}

/** 저장된 v2 사용자 프리셋의 이름들(저장된 순서). 아직 쓰지 않았으면 null */
export async function readStoredPresetNames(page: Page): Promise<string[] | null> {
  const raw = await readLocal(page, PRESETS_KEY);
  if (raw === null) return null;
  const parsed = JSON.parse(raw) as { presets?: Array<{ name?: unknown }> };
  return (parsed.presets ?? []).map((preset) => String(preset.name));
}

/** 저장된 v2 작업 상태에서 켜진(`active`) 페달의 id 를 사전순으로 */
export function activeIdsOf(board: StoredBoardV2): string[] {
  return Object.values(board.pedals)
    .filter((pedal) => pedal.active === true)
    .map((pedal) => pedal.id)
    .sort();
}

/** 저장된 v2 작업 상태에서 한 페달의 한 값(`params`). 상태가 없거나 그 페달·값이 없으면 undefined */
export function storedParam(board: StoredBoardV2 | null, pedalId: string, param: string): unknown {
  const pedals: Record<string, StoredBoardV2['pedals'][string] | undefined> = board?.pedals ?? {};
  return pedals[pedalId]?.params[param];
}

/** 페달 이름 목록 → 사전순 id 목록(저장된 값과 견주는 용도) */
export function sortedIdsOf(names: readonly string[]): string[] {
  return names.map(idOfPedal).sort();
}
