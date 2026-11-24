// E-08 스위치 통합(S2.4, 설계서 R2-4) — '켜짐'은 하나뿐이고, 화면의 LED 가 켜진 페달 수는 실제로 켜진(active) 이펙트 수와 같다.
//   옛 앱은 On/Off 와 Bypass 가 따로 있어서, 처음 열면 LED 15개가 켜져 있는데 실제로 켜진 이펙트는 5개였다.
//   · 페달 카드마다 발스위치는 하나(`효과`)이고 'Bypass' 는 화면 어디에도 없다. LED 모양(is-on·밝기)과 aria-pressed·ON/OFF 글자가 같다.
//   · 처음 연 화면: LED 5개(Noise Gate·Compressor·Drive·EQ·Cab) = 켜진 이펙트 5개 = 기타를 연결한 뒤 미터의 '이펙트 5개'.
//   · 스위치·단축키·프리셋이 같은 길로 켜고 끄므로, 어느 길로 바꿔도 LED·미터·저장된 상태가 함께 바뀐다.
//   · 옛 저장본 6종(픽스처 01~06)을 열면 LED 수 = 저장돼 있던 '켜진 페달' 수이고, 옛 v1 키는 그대로 남으며(스위치로 바꿔도, 노브를 돌려도), 새로고침해도 v2 에서 읽는다.
//   · 옛 사용자 프리셋(픽스처 02)의 enabled/bypassed 조합은 켜짐 하나로 합쳐져 불러와지고, 프리셋을 더 가져와도 옛 v1 프리셋 키는 그대로다.
//   · 저장 형식이 더 새로운 앱이 쓴 저장소(schema 3)는 옛 방식 모드로 v1 에서 읽는다 — 변환하지 못해도 앱은 v1 데이터로 동작한다.
// 소리가 같은지(v1 → v2)는 오디오 프로브 P-19 가 잰다. 이 시험은 화면과 저장소를 잰다. 기준선(e2e.json)에는 기록하지 않는 단언 시험이다.
import type { Locator, Page } from '@playwright/test';
import { PEDAL_COUNT, connectGuitar, openApp, pedalCards, pedalSwitches } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import {
  DEFAULT_ACTIVE_NAMES,
  PEDALS,
  SCHEMA_KEY,
  STATE_KEY,
  PRESETS_KEY,
  V1_PEDALS_KEY,
  V1_PRESETS_KEY,
  activeIdsOf,
  inBoardOrder,
  loadV1Fixture,
  pedalGroup,
  readLocal,
  readStoredBoard,
  readStoredPresetNames,
  seedStorage,
  sortedIdsOf,
  stompOf,
  storedParam,
  type V1Fixture,
} from '../helpers/storage';

/** 화면의 15개 카드를 한 번에 읽은 모양 */
interface BoardView {
  names: string[];
  switchCounts: number[];
  /** `aria-pressed` */
  pressed: boolean[];
  /** 클래스 `is-on` */
  isOn: boolean[];
  /** 스위치 안의 ON/OFF 글자 */
  onOffText: string[];
  /** 카드의 흐린 표시(`is-bypassed`) */
  dimmed: boolean[];
}

async function readBoard(page: Page): Promise<BoardView> {
  return page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll('.pedal-board .pedal-card'));
    const switchOf = (card: Element): Element | null => card.querySelector('.stomp-toggle-switch');
    return {
      names: cards.map((card) => (card.getAttribute('aria-label') ?? '').replace(/ 이펙터$/, '')),
      switchCounts: cards.map((card) => card.querySelectorAll('.stomp-toggle-switch').length),
      pressed: cards.map((card) => switchOf(card)?.getAttribute('aria-pressed') === 'true'),
      isOn: cards.map((card) => switchOf(card)?.classList.contains('is-on') ?? false),
      onOffText: cards.map((card) => card.querySelector('.stomp-toggle-switch output')?.textContent ?? ''),
      dimmed: cards.map((card) => card.classList.contains('is-bypassed')),
    };
  });
}

/** 한 스위치의 LED 가 화면에서 어떻게 보이는지 */
interface LedLook {
  pressed: boolean;
  /** 계산된 배경색 `rgb(r, g, b)` */
  background: string;
  boxShadow: string;
}

async function readLeds(page: Page): Promise<LedLook[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll('.pedal-board .pedal-card .stomp-toggle-switch')).map((button) => {
      const led = button.querySelector('.stomp-toggle-led');
      const style = led ? window.getComputedStyle(led) : null;
      return {
        pressed: button.getAttribute('aria-pressed') === 'true',
        background: style?.backgroundColor ?? '',
        boxShadow: style?.boxShadow ?? '',
      };
    }),
  );
}

/** `rgb(r, g, b)` / `rgba(r, g, b, a)` 의 r+g+b */
function brightness(color: string): number {
  const channels = (color.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);
  return channels.reduce((sum, value) => sum + value, 0);
}

/**
 * 화면이 스스로 맞는지 본다: 카드 15개, 카드마다 발스위치 하나, LED 모양·aria-pressed·ON/OFF 글자·흐린 카드가 모두 같은 말을 한다.
 * 켜진 페달 이름을 돌려준다(보드 순서).
 */
function litNamesOf(view: BoardView): string[] {
  expect(view.names, '페달 카드는 15개').toHaveLength(PEDAL_COUNT);
  expect(view.switchCounts, '카드마다 켜고 끄는 발스위치는 하나뿐').toEqual(view.names.map(() => 1));
  expect(view.isOn, 'LED 모양(is-on)과 aria-pressed 가 같다').toEqual(view.pressed);
  expect(view.onOffText, '스위치 글자(ON/OFF)와 aria-pressed 가 같다').toEqual(view.pressed.map((on) => (on ? 'ON' : 'OFF')));
  expect(view.dimmed, '꺼진 카드만 흐리게 보인다').toEqual(view.pressed.map((on) => !on));
  return view.names.filter((_, index) => view.pressed[index]);
}

/**
 * 켜진 LED 는 모두 꺼진 LED 보다 밝고(색), 빛 번짐(box-shadow)이 다르다.
 * LED 색은 CSS 전환(transition)으로 바뀌므로 방금 켜고 끈 직후에는 중간 색이 읽힌다 — 전환이 끝나 값이 가라앉을 때까지 되풀이해서 본다.
 */
async function expectLedsLookLit(page: Page): Promise<void> {
  await expect(async () => {
    const leds = await readLeds(page);
    const lit = leds.filter((led) => led.pressed);
    const unlit = leds.filter((led) => !led.pressed);
    expect(lit.length, '켜진 LED 가 있어야 비교할 수 있다').toBeGreaterThan(0);
    expect(unlit.length, '꺼진 LED 가 있어야 비교할 수 있다').toBeGreaterThan(0);
    const dimmestLit = Math.min(...lit.map((led) => brightness(led.background)));
    const brightestUnlit = Math.max(...unlit.map((led) => brightness(led.background)));
    expect(dimmestLit, '켜진 LED 는 꺼진 LED 보다 밝다').toBeGreaterThan(brightestUnlit);
    const unlitShadows = new Set(unlit.map((led) => led.boxShadow));
    for (const on of lit) expect(unlitShadows.has(on.boxShadow), '켜진 LED 만 빛이 번진다').toBe(false);
  }).toPass({ timeout: 5_000 });
}

/** 화면에서 켜진 페달 이름(보드 순서)을 읽고 화면 자체의 일관성도 확인한다 */
async function litOnScreen(page: Page): Promise<string[]> {
  return litNamesOf(await readBoard(page));
}

/** 화면에서 켜진 페달이 정확히 `expected` 가 될 때까지 기다린다(상태 갱신 → 다시 그리기 사이의 틈) */
async function expectLit(page: Page, expected: readonly string[], message?: string): Promise<void> {
  await expect.poll(async () => inBoardOrder(await litOnScreen(page)), { message: message ?? `켜진 LED = ${expected.join('·')}` }).toEqual(inBoardOrder(expected));
}

/** 저장된 v2 작업 상태의 켜진 페달이 `expected` 가 될 때까지 기다린다(상태가 바뀐 뒤 저장소에 써지기까지의 틈) */
async function expectStoredActive(page: Page, expected: readonly string[], message?: string): Promise<void> {
  await expect
    .poll(
      async () => {
        const board = await readStoredBoard(page);
        return board ? activeIdsOf(board) : null;
      },
      { message: message ?? `저장된 active = ${expected.join('·')}` },
    )
    .toEqual(sortedIdsOf(expected));
}

/** 기타를 연결한 뒤 미터가 알려 주는 이펙트 수 */
const meterEffectCount = (page: Page): Locator => page.locator('.performance-status > span').first().locator('output');

/**
 * 노브를 돌린 뒤 지연 저장(마지막 변경 300 ms 뒤 한 번)이 모두 끝나도록 더 주는 시간.
 * '다른 키에는 쓰지 않았다'는 쓴 것이 없음을 보이는 일이라 시간을 정해 두고 기다린다.
 */
const DEBOUNCED_SAVE_SETTLE_MS = 500;

/** Drive 의 'Drive' 노브. 스위치와 달리 바로 쓰지 않고 300 ms 뒤에 한 번 쓰는 길을 지난다. */
const driveKnob = (page: Page): Locator => pedalGroup(page, 'Drive').getByRole('slider', { name: 'Drive', exact: true });

/**
 * Drive 노브를 지금과 다른 값으로 돌리고, v2 작업 상태에 새 값이 써질 때까지 기다린 뒤 지연 저장이 끝날 시간을 더 준다.
 * 돌린 값을 돌려준다.
 */
async function turnDriveKnob(page: Page): Promise<number> {
  const knob = driveKnob(page);
  const next = Number(await knob.inputValue()) === 61 ? 62 : 61;
  await knob.fill(String(next));
  await expect(knob).toHaveValue(String(next));
  await expect
    .poll(async () => storedParam(await readStoredBoard(page), 'drive', 'drive'), { message: `노브를 ${next} 로 돌린 뒤 저장된 Drive 값` })
    .toBe(next);
  await page.waitForTimeout(DEBOUNCED_SAVE_SETTLE_MS);
  return next;
}

test.describe('E-08 스위치 통합 — LED = 켜진 이펙트', () => {
  test('E-08 처음 연 화면: 발스위치는 카드마다 하나이고 LED 가 켜진 페달은 기본 5개', async ({ page }) => {
    await openApp(page);

    const lit = await litOnScreen(page);
    expect(inBoardOrder(lit), '처음 열면 켜져 있는 이펙트').toEqual(inBoardOrder(DEFAULT_ACTIVE_NAMES));
    expect(lit, 'LED 가 켜진 페달 수').toHaveLength(5);
    await expect(pedalSwitches(page), '스위치는 페달 수만큼(Bypass 스위치가 따로 없다)').toHaveCount(PEDAL_COUNT);
    // 'Bypass' 토글은 화면에서 지워졌다(글자도 버튼도 없다).
    await expect(page.locator('.pedal-board').getByText(/bypass|바이패스/i)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /bypass|바이패스/i })).toHaveCount(0);
    await expectLedsLookLit(page);

    // 처음 열면 v2 로 연다: 저장 형식 버전만 쓰고 옛 v1 키는 만들지 않는다.
    expect(await readLocal(page, SCHEMA_KEY), '저장 형식 버전').toBe('2');
    expect(await readLocal(page, V1_PEDALS_KEY), 'v1 작업 상태 키는 만들지 않는다').toBeNull();
    expect(await readLocal(page, V1_PRESETS_KEY), 'v1 프리셋 키는 만들지 않는다').toBeNull();

    // 노브를 돌려도(300 ms 뒤 한 번 쓰는 길) v2 작업 상태에만 쓰고 v1 키는 만들지 않는다.
    await turnDriveKnob(page);
    expect(await readLocal(page, V1_PEDALS_KEY), '노브를 돌린 뒤에도 v1 작업 상태 키는 만들지 않는다').toBeNull();
    expect(await readLocal(page, V1_PRESETS_KEY), '노브를 돌린 뒤에도 v1 프리셋 키는 만들지 않는다').toBeNull();
  });

  test('E-08 기타를 연결하면 미터의 이펙트 수 = LED 수이고, 스위치·단축키·프리셋으로 바꿔도 셋이 같이 움직인다', async ({ page }) => {
    await openApp(page);
    await connectGuitar(page);

    // 연결 뒤 미터가 세는 값은 앱 안의 켜짐 상태이고, LED 는 화면 표시다 — 둘이 같아야 한다.
    await expect(meterEffectCount(page), '연결 직후 미터').toHaveText('5개');
    await expectLit(page, DEFAULT_ACTIVE_NAMES);

    // ① 스위치: Drive 를 끄고 Delay·Reverb 를 켠다.
    await stompOf(page, 'Drive').click();
    await stompOf(page, 'Delay').click();
    await stompOf(page, 'Reverb').click();
    const afterSwitches = ['Noise Gate', 'Compressor', 'EQ', 'Cab', 'Delay', 'Reverb'];
    await expectLit(page, afterSwitches, '스위치로 바꾼 뒤 LED');
    await expect(meterEffectCount(page), '스위치로 바꾼 뒤 미터').toHaveText('6개');
    await expectStoredActive(page, afterSwitches, '스위치로 바꾼 뒤 저장된 상태');

    // ② 단축키: 4 = 네 번째 페달(Drive) 다시 켜기, Y = 열다섯 번째 페달(Reverb) 끄기. 포커스를 컨트롤에서 빼야 단축키가 듣는다.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Digit4');
    await page.keyboard.press('KeyY');
    const afterKeys = ['Noise Gate', 'Compressor', 'Drive', 'EQ', 'Cab', 'Delay'];
    await expectLit(page, afterKeys, '단축키로 바꾼 뒤 LED');
    await expect(meterEffectCount(page), '단축키로 바꾼 뒤 미터').toHaveText('6개');
    await expectStoredActive(page, afterKeys, '단축키로 바꾼 뒤 저장된 상태');

    // ③ 프리셋: 공장 프리셋을 불러오면 그 프리셋이 정한 켜짐으로 바뀌고, 그때도 셋이 같다.
    const beforePreset = inBoardOrder(await litOnScreen(page));
    await page.locator('.preset-load-button', { hasText: 'Ambient Delay' }).first().click();
    await expect.poll(async () => inBoardOrder(await litOnScreen(page)), { message: '프리셋을 불러오면 켜진 페달이 바뀐다' }).not.toEqual(beforePreset);
    const afterPreset = await litOnScreen(page);
    expect(afterPreset.length, '프리셋의 켜진 이펙트가 하나 이상').toBeGreaterThan(0);
    await expect(meterEffectCount(page), '프리셋을 불러온 뒤 미터').toHaveText(`${afterPreset.length}개`);
    await expectStoredActive(page, afterPreset, '프리셋을 불러온 뒤 저장된 상태');
    await expectLedsLookLit(page);
  });
});

/** 옛 저장본(v1 픽스처) 6종: 열었을 때 켜져 있어야 하는 페달 */
const FIXTURES: ReadonlyArray<{
  file: string;
  active: readonly string[];
  /** 옛 v1 데이터가 있어 앱을 열 때 v2 로 변환해 쓰는가(03 은 깨져 있어 변환할 것이 없다) */
  converts: boolean;
}> = [
  { file: '01-default.json', active: DEFAULT_ACTIVE_NAMES, converts: true },
  // enabled/bypassed 네 가지 조합(payload 10): Noise Gate 만 켜짐, Compressor 는 Bypass, Drive·EQ 는 꺼짐 + Cab 켜짐
  { file: '02-user-presets-switch-combos.json', active: ['Noise Gate', 'Cab'], converts: true },
  { file: '03-corrupt-json.json', active: DEFAULT_ACTIVE_NAMES, converts: false },
  { file: '04-disabled-pedal-mix0.json', active: DEFAULT_ACTIVE_NAMES, converts: true },
  { file: '05-reverb-decay-7.5.json', active: [...DEFAULT_ACTIVE_NAMES, 'Reverb'], converts: true },
  { file: '06-midi-bypass-mapping.json', active: DEFAULT_ACTIVE_NAMES, converts: true },
];

/**
 * v1 백업 키가 픽스처에 적힌 글자 그대로인지(앱이 v2 모드에서는 v1 키를 다시 쓰지 않는다).
 * 깨진 픽스처(`corrupt`)는 읽을 때 사본(`<키>:corrupt-<시각>`)으로 옮겨지고 원래 키가 비워진다 — 그 뒤로 그 키에 다시 쓰는 일이 없어야 한다.
 */
async function expectV1BackupUntouched(page: Page, fixture: V1Fixture, when: string, corrupt = false): Promise<void> {
  for (const key of [V1_PEDALS_KEY, V1_PRESETS_KEY]) {
    const original = fixture.storage[key];
    if (original === undefined) continue;
    const message = corrupt ? `${when}: 깨진 ${key} 는 사본으로 옮겨진 뒤 다시 쓰이지 않는다` : `${when}: ${key} 는 옛 값 그대로`;
    expect(await readLocal(page, key), message).toBe(corrupt ? null : original);
  }
}

/** `<키>:corrupt-<시각>` 사본들의 값 */
async function readCorruptCopies(page: Page, key: string): Promise<string[]> {
  return page.evaluate((storageKey) => {
    const copies: string[] = [];
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const name = window.localStorage.key(index);
      if (name !== null && name.startsWith(`${storageKey}:corrupt-`)) copies.push(window.localStorage.getItem(name) ?? '');
    }
    return copies;
  }, key);
}

test.describe('E-08 옛 저장본(v1 픽스처)을 열 때', () => {
  for (const spec of FIXTURES) {
    test(`E-08 ${spec.file}: LED 수 = 저장돼 있던 켜진 페달 수이고 v1 키는 그대로, 새로고침해도 v2 에서 읽는다`, async ({ page }) => {
      const fixture = loadV1Fixture(spec.file);
      await seedStorage(page, fixture.storage);
      await openApp(page);

      // ① 화면: 옛 저장본이 가리키던 켜짐이 그대로 LED 에 보인다.
      await expectLit(page, spec.active, '열자마자 LED');
      await expectLedsLookLit(page);

      // ② 저장소: 변환이 끝나 있다(저장 형식 버전 2, v2 상태의 active 가 화면과 같다). 03 은 변환할 것이 없어 버전만 쓴다.
      expect(await readLocal(page, SCHEMA_KEY), '저장 형식 버전').toBe('2');
      if (spec.converts) {
        const board = await readStoredBoard(page);
        if (board === null) throw new Error('앱을 열면 v2 작업 상태가 써져 있어야 한다');
        expect(board.schemaVersion).toBe(2);
        expect(activeIdsOf(board), '변환한 v2 의 active = 화면의 LED').toEqual(sortedIdsOf(spec.active));
        expect(await readLocal(page, PRESETS_KEY), '변환한 v2 사용자 프리셋').not.toBeNull();
      } else {
        expect(await readStoredBoard(page), '깨진 저장본은 바꿀 때까지 v2 상태를 쓰지 않는다').toBeNull();
        // 깨진 값은 지워지지 않는다: 원래 키에서 사본으로 옮겨져 글자 그대로 남는다.
        for (const key of [V1_PEDALS_KEY, V1_PRESETS_KEY]) {
          expect(await readCorruptCopies(page, key), `깨진 ${key} 는 사본에 글자 그대로 보관된다`).toEqual([fixture.storage[key]]);
        }
      }
      await expectV1BackupUntouched(page, fixture, '열자마자', !spec.converts);

      // ③ 하나 끈다: LED·저장된 v2 상태가 함께 바뀌고, v1 백업은 여전히 그대로다.
      const target = spec.active[0];
      const afterOff = spec.active.filter((name) => name !== target);
      await stompOf(page, target).click();
      await expectLit(page, afterOff, `${target} 를 끈 뒤 LED`);
      await expectStoredActive(page, afterOff, `${target} 를 끈 뒤 저장된 상태`);
      await expectV1BackupUntouched(page, fixture, '하나 끈 뒤', !spec.converts);

      // ④ 노브를 돌린다: 스위치와 달리 300 ms 뒤에 한 번 쓰는 길이다. v2 상태에 써지고, v1 백업은 이 길로도 건드리지 않는다.
      const turned = await turnDriveKnob(page);
      await expectV1BackupUntouched(page, fixture, '노브를 돌린 뒤', !spec.converts);

      // ⑤ 새로고침: 방금 끈 상태·돌린 노브로 열린다 — 옛 v1 백업이 아니라 v2 에서 읽는다는 뜻이다(v1 에는 아직 켜져 있고 노브도 옛 값이다).
      await page.reload();
      await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
      await expectLit(page, afterOff, '새로고침한 뒤 LED');
      await expect(driveKnob(page), '새로고침한 뒤 Drive 노브').toHaveValue(String(turned));
      await expectV1BackupUntouched(page, fixture, '새로고침한 뒤', !spec.converts);
    });
  }
});

test.describe('E-08 옛 사용자 프리셋(픽스처 02)', () => {
  test('E-08 프리셋에 저장돼 있던 enabled/bypassed 조합은 켜짐 하나로 불러와지고, 프리셋을 더 가져와도 v1 프리셋 키는 그대로다', async ({ page }) => {
    const fixture = loadV1Fixture('02-user-presets-switch-combos.json');
    await seedStorage(page, fixture.storage);
    await openApp(page);

    // 옛 사용자 프리셋 둘이 목록에 있고, 변환한 v2 프리셋 키에도 같은 이름으로 들어 있다.
    const comboA = page.locator('.preset-load-button', { hasText: 'Switch Combos A' });
    const comboB = page.locator('.preset-load-button', { hasText: 'Switch Combos B' });
    await expect(comboA, '옛 사용자 프리셋 A').toHaveCount(1);
    await expect(comboB, '옛 사용자 프리셋 B').toHaveCount(1);
    expect([...((await readStoredPresetNames(page)) ?? [])].sort(), '변환한 v2 사용자 프리셋').toEqual(['Switch Combos A', 'Switch Combos B']);

    // 옛 프리셋 A: Noise Gate·Cab 은 enabled && !bypassed, Compressor 는 Bypass(enabled 만), Drive 는 enabled:false → 켜진 것은 둘.
    await comboA.click();
    await expectLit(page, ['Noise Gate', 'Cab'], '프리셋 A 를 불러온 뒤 LED');
    await expectStoredActive(page, ['Noise Gate', 'Cab'], '프리셋 A 를 불러온 뒤 저장된 상태');
    // 옛 프리셋 B: 거기에 Drive(enabled && !bypassed)가 더 켜져 있다.
    await comboB.click();
    await expectLit(page, ['Noise Gate', 'Drive', 'Cab'], '프리셋 B 를 불러온 뒤 LED');
    await expectStoredActive(page, ['Noise Gate', 'Drive', 'Cab'], '프리셋 B 를 불러온 뒤 저장된 상태');
    await expectLedsLookLit(page);
    await expectV1BackupUntouched(page, fixture, '프리셋을 불러온 뒤');

    // 프리셋을 하나 더 가져온다: v2 프리셋 키만 늘어나고 v1 프리셋 키는 옛 글자 그대로다.
    const imported = { version: 11, presets: [{ id: 'e08-imported', name: 'E08 가져온 프리셋', updatedAt: 1, pedals: [] }] };
    await page.getByLabel('가져올 프리셋 JSON').fill(JSON.stringify(imported));
    await page.getByRole('button', { name: '붙여넣은 JSON 가져오기' }).click();
    await expect(page.locator('.preset-message')).toContainText('1개의 프리셋을 가져왔습니다');
    await expect
      .poll(async () => [...((await readStoredPresetNames(page)) ?? [])].sort(), { message: '가져온 뒤 v2 사용자 프리셋' })
      .toEqual(['E08 가져온 프리셋', 'Switch Combos A', 'Switch Combos B']);
    await expectV1BackupUntouched(page, fixture, '프리셋을 가져온 뒤');

    // 새로고침: 가져온 프리셋도 v2 에서 읽혀 목록에 있다.
    await page.reload();
    await expect(page.locator('.preset-load-button', { hasText: 'E08 가져온 프리셋' }), '새로고침한 뒤 가져온 프리셋').toHaveCount(1);
    await expect(page.locator('.preset-load-button', { hasText: 'Switch Combos B' })).toHaveCount(1);
    await expectV1BackupUntouched(page, fixture, '새로고침한 뒤');
  });
});

test.describe('E-08 변환하지 못하는 저장소', () => {
  test('E-08 저장 형식이 더 새로운 앱(schema 3)이 쓴 저장소는 옛 방식 모드로 v1 에서 읽고, v1 키에 쓰며, LED 수가 맞다', async ({ page }) => {
    const fixture = loadV1Fixture('02-user-presets-switch-combos.json');
    await seedStorage(page, { ...fixture.storage, [SCHEMA_KEY]: '3' });
    await openApp(page);

    // 앱은 v1 데이터로 동작한다: 켜진 페달이 픽스처 02 가 말하는 둘이다.
    await expectLit(page, ['Noise Gate', 'Cab'], '옛 방식 모드로 열자마자 LED');
    expect(await readLocal(page, SCHEMA_KEY), '더 새로운 버전의 표시는 건드리지 않는다').toBe('3');
    expect(await readLocal(page, STATE_KEY), 'v2 상태 키는 만들지 않는다').toBeNull();
    expect(await readLocal(page, PRESETS_KEY), 'v2 프리셋 키는 만들지 않는다').toBeNull();

    // 바꾸면 v1 키에 쓴다(옛 앱이 그대로 읽을 수 있는 모양: version 11, 꺼짐 = bypassed).
    await stompOf(page, 'Noise Gate').click();
    await expectLit(page, ['Cab'], 'Noise Gate 를 끈 뒤 LED');
    await expect
      .poll(async () => {
        const raw = await readLocal(page, V1_PEDALS_KEY);
        if (raw === null) return null;
        const parsed = JSON.parse(raw) as { version?: number; pedals?: Array<{ id: string; enabled: boolean; bypassed: boolean }> };
        const gate = parsed.pedals?.find((pedal) => pedal.id === 'noise-gate');
        return { version: parsed.version, enabled: gate?.enabled, bypassed: gate?.bypassed };
      })
      .toEqual({ version: 11, enabled: true, bypassed: true });
    expect(await readLocal(page, STATE_KEY), '옛 방식 모드는 v2 상태 키에 쓰지 않는다').toBeNull();
    expect(await readLocal(page, SCHEMA_KEY)).toBe('3');
  });

  test('E-08 옛 방식 모드에서도 켜진 LED 수만큼이 켜진 이펙트다(기본값)', async ({ page }) => {
    // 저장된 v1 데이터가 없는 채로 schema 3 이면 기본 보드로 열린다. 처음 화면과 같은 5개다.
    await seedStorage(page, { [SCHEMA_KEY]: '3' });
    await openApp(page);
    await expectLit(page, DEFAULT_ACTIVE_NAMES, '옛 방식 모드 기본 보드의 LED');
    await connectGuitar(page);
    await expect(meterEffectCount(page), '옛 방식 모드의 미터').toHaveText('5개');
  });
});

// 페달 id 표는 기본 보드와 같아야 한다 — 표가 어긋나면 위 시험들이 엉뚱한 id 를 견주므로 한 번 확인한다.
test('E-08 시험 도우미의 페달 표가 화면의 기본 보드와 같다', async ({ page }) => {
  await openApp(page);
  const view = await readBoard(page);
  expect(view.names, '화면의 카드 이름·순서').toEqual(PEDALS.map((pedal) => pedal.name));
});
