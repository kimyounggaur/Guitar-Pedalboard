// S2.4 두 탭 — 옛 버전 탭이 v1 키를 다시 쓰면 새 버전 탭이 알려 준다(설계서 4.7 변환 절차 6번).
//   수용 기준: "v1 키가 남아 있고, 구버전 탭이 v1 키를 쓰면 안내가 뜬다".
//   옛 앱은 v1 키(`guitar-pedalboard:pedals`·`web-guitar-pedalboard-presets`)에 쓴다. 새 버전은 v1 키를 백업으로만 두고 v2 키에 쓰므로,
//   v1 키에 값이 쓰였다 = 같은 브라우저에서 옛 버전이 열려 있다는 뜻이다. 그 탭이 쓴 것은 새 버전이 읽지 않으니 연주 기록이 갈라진다.
//   · v1 키에 값을 쓰면(두 키 모두) 다른 새 버전 탭에 경고 알림 한 장이 뜬다(문구는 설계서 그대로, 직접 닫기 전까지 남는 경고).
//   · 새 버전 탭끼리 주고받는 v2 키 쓰기(스위치는 바로, 노브는 300 ms 뒤 한 번), v1 키 삭제, 저장소 비우기에는 뜨지 않는다.
//   · 닫은 뒤 5분 안에 다시 써도 다시 뜨지 않는다.
//   · 옛 방식 모드(schema 가 더 새로운 저장소)로 연 탭은 스스로 v1 키에 쓰므로 알리지 않는다.
// 옛 버전 탭은 같은 키에 값을 쓰는 것으로 흉내 낸다 — 옛 앱이 하는 일이 그것뿐이다. 실제 옛 빌드로 여는 것은 '사람 확인 필요'다.
import type { BrowserContext, Page } from '@playwright/test';
import { openApp } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { SCHEMA_KEY, STATE_KEY, V1_PEDALS_KEY, V1_PRESETS_KEY, loadV1Fixture, pedalGroup, seedStorage, stompOf, toastOf } from '../helpers/storage';

const TOAST_KEY = 'storage:old-version-tab';
/** 설계서 4.7 변환 절차 6번의 문구 그대로 */
const MESSAGE = '다른 탭에서 이전 버전이 열려 있습니다. 그 탭을 닫고 새로고침해 주세요.';
/** 옛 앱이 쓰는 모양의 작업 상태(내용은 중요하지 않다 — 새 버전은 읽지 않는다) */
const OLD_VERSION_PAYLOAD = '{"version":11,"pedals":[]}';

async function openTab(context: BrowserContext): Promise<Page> {
  const page = await context.newPage();
  await openApp(page);
  return page;
}

interface StorageEventLog {
  key: string | null;
  hasValue: boolean;
}

/**
 * 이 탭이 받는 `storage` 이벤트를 기록한다. 앱의 수신기가 이미 달린 뒤에 달기 때문에, 기록에 이벤트가 보이면 앱의 처리도 끝났다
 * (같은 이벤트를 같은 차례에 순서대로 처리한다). '알림이 뜨지 않았다'를 시간 기다림 없이 확인하려는 장치다.
 */
async function watchStorageEvents(page: Page): Promise<void> {
  await page.evaluate(() => {
    const log: StorageEventLog[] = [];
    (window as unknown as { __storageLog: StorageEventLog[] }).__storageLog = log;
    window.addEventListener('storage', (event) => {
      log.push({ key: event.key, hasValue: event.newValue !== null });
    });
  });
}

async function storageEventsSeen(page: Page): Promise<StorageEventLog[]> {
  return page.evaluate(() => (window as unknown as { __storageLog?: StorageEventLog[] }).__storageLog ?? []);
}

/** `key`(없으면 null = 저장소 비움)에 대해 지금까지 받은 이벤트 수 */
async function countStorageEvents(page: Page, key: string | null, hasValue: boolean): Promise<number> {
  return (await storageEventsSeen(page)).filter((event) => event.key === key && event.hasValue === hasValue).length;
}

/** `key`(없으면 null = 저장소 비움)에 대한 이벤트가 `count` 번 올 때까지 기다린다 */
async function waitForStorageEvents(page: Page, key: string | null, hasValue: boolean, count = 1): Promise<void> {
  await expect
    .poll(() => countStorageEvents(page, key, hasValue), { message: `storage 이벤트(${key ?? 'clear'}, 값 ${hasValue ? '있음' : '없음'}) ${count}번` })
    .toBeGreaterThanOrEqual(count);
}

/** 이벤트를 받은 뒤 알림이 그려질 시간을 조금 준다(알림이 안 뜬다는 것을 확인할 때만 쓴다) */
const settle = (page: Page): Promise<void> => page.waitForTimeout(300);

const writeKey = (page: Page, key: string, value: string): Promise<void> =>
  page.evaluate(([storageKey, storageValue]) => window.localStorage.setItem(storageKey, storageValue), [key, value] as const);

test.describe('S2.4 두 탭 — 옛 버전 탭이 v1 키를 쓰면 알린다', () => {
  for (const key of [V1_PEDALS_KEY, V1_PRESETS_KEY]) {
    test(`S2.4 다른 탭이 ${key} 에 값을 쓰면 경고 알림이 한 장 뜬다`, async ({ context }) => {
      const tabA = await openTab(context);
      const tabB = await openTab(context);
      await expect(toastOf(tabA, TOAST_KEY), '쓰기 전에는 알림이 없다').toHaveCount(0);

      await writeKey(tabB, key, OLD_VERSION_PAYLOAD);

      const toast = toastOf(tabA, TOAST_KEY);
      await expect(toast, '다른 탭의 v1 키 쓰기 → 경고 알림').toBeVisible();
      await expect(toast).toHaveAttribute('data-toast-kind', 'warning');
      await expect(toast).toHaveAttribute('role', 'alert');
      await expect(toast.locator('.toast-message'), '설계서 문구 그대로').toHaveText(MESSAGE);
      await expect(toastOf(tabA, TOAST_KEY), '같은 알림은 한 장만').toHaveCount(1);
      // 쓴 탭은 이벤트를 받지 않으므로 알림이 없다.
      await expect(toastOf(tabB, TOAST_KEY)).toHaveCount(0);

      // 알림이 떠 있어도 앱은 그대로 쓸 수 있다.
      const drive = stompOf(tabA, 'Drive');
      await expect(drive).toHaveAttribute('aria-pressed', 'true');
      await drive.click();
      await expect(drive).toHaveAttribute('aria-pressed', 'false');
    });
  }

  test('S2.4 새 버전 탭끼리의 v2 키 쓰기(스위치·노브)·v1 키 삭제·저장소 비우기에는 경고하지 않는다', async ({ context }) => {
    const tabA = await context.newPage();
    // 옛 저장본이 있던 사용자: 변환한 뒤에도 v1 키가 남아 있다(지워질 키가 있어야 '삭제' 이벤트가 온다).
    await seedStorage(tabA, loadV1Fixture('01-default.json').storage);
    await openApp(tabA);
    const tabB = await openTab(context);
    await watchStorageEvents(tabA);

    // 새 버전 탭 B 가 실제로 페달을 켜고 끈다 → v2 작업 상태 키에 쓴다(스위치는 바로 쓴다).
    await stompOf(tabB, 'Drive').click();
    await waitForStorageEvents(tabA, STATE_KEY, true);
    await settle(tabA);
    // 노브도 돌린다 → 300 ms 뒤 한 번 쓰는 다른 길도 v2 작업 상태 키에만 쓴다(v1 키에 쓰면 탭 A 가 경고를 띄운다).
    const stateWritesBeforeKnob = await countStorageEvents(tabA, STATE_KEY, true);
    await pedalGroup(tabB, 'Drive').getByRole('slider', { name: 'Drive', exact: true }).fill('61');
    await waitForStorageEvents(tabA, STATE_KEY, true, stateWritesBeforeKnob + 1);
    // v1 키가 지워진다(브라우저의 사이트 데이터 정리 등) — 쓰기가 아니라 삭제다.
    await tabB.evaluate((storageKey) => window.localStorage.removeItem(storageKey), V1_PEDALS_KEY);
    await waitForStorageEvents(tabA, V1_PEDALS_KEY, false);
    // 저장소를 통째로 비운다 — 이벤트의 key 가 null 이다.
    await tabB.evaluate(() => window.localStorage.clear());
    await waitForStorageEvents(tabA, null, false);

    await settle(tabA);
    await expect(toastOf(tabA, TOAST_KEY), '새 버전 탭의 스위치·노브·v1 키 삭제·저장소 비우기 모두 경고하지 않는다').toHaveCount(0);
  });

  test('S2.4 경고를 닫은 뒤 다시 v1 키를 써도 5분 안에는 다시 뜨지 않는다', async ({ context }) => {
    const tabA = await openTab(context);
    const tabB = await openTab(context);
    await watchStorageEvents(tabA);

    await writeKey(tabB, V1_PEDALS_KEY, OLD_VERSION_PAYLOAD);
    const toast = toastOf(tabA, TOAST_KEY);
    await expect(toast).toBeVisible();
    await toast.locator('.toast-close').click();
    await expect(toast, '닫으면 사라진다').toHaveCount(0);

    // 옛 버전 탭은 계속 쓴다(연주 중 페달을 만질 때마다). 다른 키로도 쓰고 같은 키도 다시 쓴다.
    await writeKey(tabB, V1_PRESETS_KEY, OLD_VERSION_PAYLOAD);
    await writeKey(tabB, V1_PEDALS_KEY, '{"version":11,"pedals":[{"id":"drive"}]}');
    await waitForStorageEvents(tabA, V1_PEDALS_KEY, true, 2);
    await waitForStorageEvents(tabA, V1_PRESETS_KEY, true, 1);
    await settle(tabA);
    await expect(toastOf(tabA, TOAST_KEY), '5분 안에는 다시 뜨지 않는다').toHaveCount(0);
  });

  test('S2.4 옛 방식 모드(더 새로운 저장 형식)로 연 탭은 스스로 v1 키에 쓰므로 알리지 않는다', async ({ context }) => {
    const tabA = await context.newPage();
    await seedStorage(tabA, { [SCHEMA_KEY]: '3' });
    await openApp(tabA);
    const tabB = await openTab(context);
    await watchStorageEvents(tabA);

    // 같은 옛 방식 모드의 탭 B 가 페달을 끄면 v1 작업 상태 키에 쓴다.
    await stompOf(tabB, 'Drive').click();
    await waitForStorageEvents(tabA, V1_PEDALS_KEY, true);
    await settle(tabA);
    await expect(toastOf(tabA, TOAST_KEY), '옛 방식 모드는 v1 키 쓰기를 정상으로 본다').toHaveCount(0);
  });
});
