// E-05 저장소·오류 회귀(S1.7, 정식 시험, 이후 모든 Phase 에서 유지).
// 설계서 4.8절 완료 기준을 브라우저에서 그대로 확인한다.
//   · 저장소가 막혔거나(SecurityError)·가득 찼거나(QuotaExceededError)·값이 깨져 있어도 흰 화면 없이 열리고,
//     효과 스위치(켜기·끄기·Bypass)·노브·프리셋 불러오기가 되며, 알림은 한 번만 뜬다.
//   · 화면을 그리다 예외가 나면 한국어 오류 화면이 뜨고 소리(AudioContext·마이크 트랙)가 멈춘다. '다시 시도'로 돌아오고, 다시 연결도 된다.
//   · 저장된 설정 때문에 시작할 때마다 죽는 상태에서도 '설정을 초기화하고 다시 시작'으로 되돌릴 수 있고, 사용자가 저장한 프리셋은 남는다.
//   · 앱 스크립트 자체를 못 불러와도(흰 화면 대신) 정적 안내가 뜨고 '페이지 다시 불러오기'로 복구된다.
//   · 이벤트·타이머·약속(Promise)에서 난 예외는 화면을 깨지 않고 알림으로 뜬다. 중단된 요청·ResizeObserver 알림은 걸러진다.
//
// 렌더 예외는 앱 데이터를 오염시키지 않고 `Number.prototype.toFixed` 를 시험 쪽에서 던지게 만들어 일으킨다
// (코러스 Rate 의 'n.n Hz' 같은 소수 표시가 그려질 때 예외가 난다). 앱 코드에 시험용 문이 없고, 이후 Step 에서 불러오기 값 검증이
// 강해져도 깨지지 않는다. 이 표시를 쓰는 화면이 모두 사라져 시험이 '예외가 나지 않아' 실패하면, 다른 렌더 경로의 함수를 골라 breakRendering 만 바꾼다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { connectButton, connectGuitar, openApp, PEDAL_COUNT, pedalCards } from '../helpers/app';
import { fixturesDir, repoRoot } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { mockStorage, readAudioTracking, trackAudioContexts } from '../helpers/mocks';

// 서비스 워커가 가운데서 요청을 받아 가면 page.route 가 닿지 않으므로(정적 안내 시험), 이 파일 전체에서 서비스 워커를 쓰지 않는다.
test.use({ serviceWorkers: 'block' });

// S2.4: 사용자 프리셋은 v2 키에 쓴다. 설정 초기화는 이 키와 schema 키를 지우지 않는다(지우면 다음 시작이 옛 v1 백업에서 다시 변환해 프리셋을 옛 값으로 덮어쓴다).
const PRESETS_KEY = 'guitar-pedalboard:v2:presets';
const SCHEMA_KEY = 'guitar-pedalboard:schema';
const STATE_KEY = 'guitar-pedalboard:v2:state';
/** '저장된 설정이 있는 동안 죽는' 상태를 만들 때 쓰는 실제 앱 저장 키(값은 빈 객체 → 앱이 정상으로 읽는다). */
const POISON_KEY = 'guitar-pedalboard:midi';
const KEYS_AT_START = '__e05-keys-at-start';

const appVersion = (JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as { version: string }).version;
const corruptFixture = JSON.parse(readFileSync(join(fixturesDir, 'storage-v1', '03-corrupt-json.json'), 'utf8')) as { storage: Record<string, string> };

const toastOf = (page: Page, key: string): Locator => page.locator(`.toast[data-toast-key="${key}"]`);
const appErrorScreen = (page: Page): Locator => page.locator('main[data-app-error]');
const staticFallback = (page: Page): Locator => page.locator('main[data-static-fallback]');
const pedalGroup = (page: Page, name: string): Locator => page.getByRole('group', { name: `${name} 이펙터`, exact: true });
const stompOf = (page: Page, name: string): Locator => pedalGroup(page, name).locator('.stomp-toggle-switch');
const chorusRate = (page: Page): Locator => pedalGroup(page, 'Chorus').getByRole('slider', { name: 'Rate', exact: true });

/** 페이지에서 처리되지 않은 예외(pageerror)를 모은다. 흰 화면 대신 알림으로 다뤄야 하는 시험은 마지막에 비어 있어야 한다. */
function watchPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

/**
 * 앱이 실제로 쓸 수 있는 상태인지 본다: 오류 화면이 아니고, 효과 스위치(켜기·끄기·Bypass)·노브·프리셋 불러오기가 모두 된다.
 * 저장이 안 되는 환경에서도 화면은 메모리 상태로 동작해야 한다.
 */
async function expectAppUsable(page: Page): Promise<void> {
  await expect(appErrorScreen(page)).toHaveCount(0);
  await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);

  // 효과 스위치: 켜짐 → 꺼짐(Bypass) → 켜짐
  const drive = stompOf(page, 'Drive');
  await expect(drive).toHaveAttribute('aria-pressed', 'true');
  await drive.click();
  await expect(drive).toHaveAttribute('aria-pressed', 'false');
  await drive.click();
  await expect(drive).toHaveAttribute('aria-pressed', 'true');

  // 노브: 돌린 값이 화면에 남는다
  const knob = pedalGroup(page, 'Drive').getByRole('slider', { name: 'Drive', exact: true });
  await knob.fill('61');
  await expect(knob).toHaveValue('61');

  // 프리셋 불러오기: 'Direct Clean' 은 Noise Gate 를 끈다
  const gate = stompOf(page, 'Noise Gate');
  await expect(gate).toHaveAttribute('aria-pressed', 'true');
  await page.locator('.preset-load-button', { hasText: 'Direct Clean' }).click();
  await expect(gate).toHaveAttribute('aria-pressed', 'false');
}

/** Drive 효과 스위치를 한 번 눌러 앞 상태의 반대가 되는지 본다(앞 상태는 프리셋 때문에 켜져 있을 수도, 꺼져 있을 수도 있다). */
async function flipDrive(page: Page): Promise<void> {
  const drive = stompOf(page, 'Drive');
  const before = await drive.getAttribute('aria-pressed');
  await drive.click();
  await expect(drive).toHaveAttribute('aria-pressed', before === 'true' ? 'false' : 'true');
}

/** 이 페이지에서 `Number.prototype.toFixed` 가 던지게 한다. 다음에 소수 표시가 그려질 때 렌더 예외가 난다. */
async function breakRendering(page: Page, message: string): Promise<void> {
  await page.evaluate((text) => {
    const holder = window as unknown as { __e05ToFixed?: typeof Number.prototype.toFixed };
    holder.__e05ToFixed = Number.prototype.toFixed;
    Number.prototype.toFixed = function toFixed(): string {
      throw new Error(text);
    };
  }, message);
}

async function restoreRendering(page: Page): Promise<void> {
  await page.evaluate(() => {
    const holder = window as unknown as { __e05ToFixed?: typeof Number.prototype.toFixed };
    if (holder.__e05ToFixed) Number.prototype.toFixed = holder.__e05ToFixed;
  });
}

/**
 * 코러스 Rate 를 움직여 그 카드를 다시 그리게 한다(소수 표시가 그려진다).
 * 연결해 둔 동안은 미터가 계속 다시 그려져 바로 죽을 수 있다. 그때는 슬라이더가 이미 없으므로 오류 화면이면 그대로 둔다.
 */
async function triggerRender(page: Page): Promise<void> {
  if ((await appErrorScreen(page).count()) > 0) return;
  await chorusRate(page)
    .fill('2', { timeout: 3_000 })
    .catch(async (error: unknown) => {
      if ((await appErrorScreen(page).count()) === 0) throw error;
    });
}

test.describe('E-05 저장소·오류', () => {
  test('E-05 저장소가 막혀 있어도(SecurityError) 흰 화면 없이 열리고 조작이 되며 알림은 한 번만 뜬다', async ({ page }) => {
    const errors = watchPageErrors(page);
    await mockStorage(page, 'blocked');
    await openApp(page);

    const notice = toastOf(page, 'storage:blocked');
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText('브라우저 설정 때문에 설정을 저장할 수 없습니다');

    await expectAppUsable(page);
    // 쓰기를 여러 번 했어도 저장소 알림은 한 장뿐이다.
    await expect(page.locator('.toast[data-toast-key^="storage:"]')).toHaveCount(1);

    // 닫은 뒤에 또 쓰기를 해도 다시 뜨지 않는다(방문 한 번에 종류마다 한 번).
    await notice.getByRole('button', { name: '닫기' }).click();
    await expect(page.locator('.toast[data-toast-key^="storage:"]')).toHaveCount(0);
    await flipDrive(page);
    await expect(page.locator('.toast[data-toast-key^="storage:"]')).toHaveCount(0);

    expect(errors, '처리되지 않은 예외가 없어야 합니다').toEqual([]);
  });

  test('E-05 저장 공간이 가득 차도(QuotaExceededError) 흰 화면 없이 열리고 조작이 되며 알림은 한 번만 뜬다', async ({ page }) => {
    const errors = watchPageErrors(page);
    await mockStorage(page, 'quota');
    await openApp(page);

    await expectAppUsable(page);
    const notice = toastOf(page, 'storage:quota');
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText('저장 공간이 가득 차 설정이 저장되지 않았습니다');
    await expect(page.locator('.toast[data-toast-key^="storage:"]')).toHaveCount(1);

    await notice.getByRole('button', { name: '닫기' }).click();
    await expect(page.locator('.toast[data-toast-key^="storage:"]')).toHaveCount(0);
    await flipDrive(page);
    await expect(page.locator('.toast[data-toast-key^="storage:"]')).toHaveCount(0);

    expect(errors, '처리되지 않은 예외가 없어야 합니다').toEqual([]);
  });

  test('E-05 저장된 값이 깨져 있어도(픽스처 03) 기본값으로 열리고, 깨진 원문은 지우지 않고 보관하며 알림은 한 번', async ({ page }) => {
    const errors = watchPageErrors(page);
    // 새로고침할 때 덮어쓰지 않도록 sessionStorage 로 한 번만 넣는다(픽스처 README 의 방법).
    await page.addInitScript((storage) => {
      if (window.sessionStorage.getItem('__fixture-loaded')) return;
      window.sessionStorage.setItem('__fixture-loaded', '1');
      window.localStorage.clear();
      for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
    }, corruptFixture.storage);
    await openApp(page);

    // 기본값으로 떴다: 켜진 페달 5개(Noise Gate·Compressor·Drive·EQ·Cab)
    await expect(page.locator('.pedal-board .stomp-toggle-switch.is-on')).toHaveCount(5);
    await expect(toastOf(page, 'storage:corrupt')).toHaveCount(1);
    await expect(page.locator('.toast[data-toast-key^="storage:"]')).toHaveCount(1);
    await expect(toastOf(page, 'storage:corrupt')).toContainText('저장된 설정 일부를 읽지 못해 기본값으로 시작합니다');

    // 깨진 세 키(pedals·사용자 프리셋·io)는 원문 그대로 `…:corrupt-<시각>` 로 보관된다.
    const archives = await page.evaluate(() =>
      Object.fromEntries(
        Object.keys(window.localStorage)
          .filter((name) => name.includes(':corrupt-'))
          .map((name) => [name, window.localStorage.getItem(name)]),
      ),
    );
    for (const [key, raw] of Object.entries(corruptFixture.storage)) {
      const names = Object.keys(archives).filter((name) => name.startsWith(`${key}:corrupt-`));
      expect(names, `${key} 의 보관본은 하나`).toHaveLength(1);
      expect(archives[names[0]], `${key} 의 보관본은 깨진 원문 그대로`).toBe(raw);
    }

    await expectAppUsable(page);
    expect(errors, '처리되지 않은 예외가 없어야 합니다').toEqual([]);
  });

  test('E-05 화면을 그리다 예외가 나면 한국어 오류 화면이 뜨고 소리가 멈추며, 정보 복사·다시 시도·다시 연결이 된다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic(undefined, { permissions: ['microphone', 'clipboard-read', 'clipboard-write'], serviceWorkers: 'block' });
    await trackAudioContexts(page);
    await openApp(page);
    await connectGuitar(page);
    const connected = await readAudioTracking(page);
    expect(connected.contexts.map((context) => context.state)).toEqual(['running']);
    expect(connected.inputTracks.map((track) => track.readyState)).toEqual(['live']);

    const message = 'E-05: 시험이 일부러 일으킨 렌더 예외';
    await breakRendering(page, message);
    await triggerRender(page);

    // 한국어 오류 화면이 뜬다. 화면 전체를 대신하고 키보드 포커스를 받는다.
    const screen = appErrorScreen(page);
    await expect(screen).toBeVisible();
    await expect(page.getByRole('heading', { name: '문제가 생겨 화면을 표시하지 못했습니다' })).toBeVisible();
    await expect(screen).toContainText('소리와 마이크 입력은 안전을 위해 멈췄습니다');
    await expect(screen).toContainText('직접 저장한 프리셋은 그대로 남아 있습니다');
    await expect(screen).toBeFocused();
    await expect(page.locator('.pedal-board')).toHaveCount(0);
    for (const name of ['다시 시도', '설정을 초기화하고 다시 시작', '오류 정보 복사']) {
      await expect(screen.getByRole('button', { name })).toBeVisible();
    }

    // 소리가 멈춘다: AudioContext 는 모두 닫히고 마이크 트랙은 모두 끝난다.
    await expect
      .poll(
        async () => {
          const tracking = await readAudioTracking(page);
          return {
            contexts: tracking.contexts.length,
            notClosed: tracking.contexts.filter((context) => context.state !== 'closed').length,
            liveTracks: tracking.inputTracks.filter((track) => track.readyState !== 'ended').length,
          };
        },
        { message: '오류 화면이 뜨면 소리와 마이크가 멈춰야 합니다', timeout: 5_000 },
      )
      .toEqual({ contexts: 1, notClosed: 0, liveTracks: 0 });

    // '오류 정보 복사' 는 오류 이름·메시지·앱 버전·브라우저·시각을 클립보드에 넣는다.
    await screen.getByRole('button', { name: '오류 정보 복사' }).click();
    await expect(screen.getByText('오류 정보를 복사했습니다.')).toBeVisible();
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain('오류 이름: Error');
    expect(copied).toContain(`메시지: ${message}`);
    expect(copied).toContain(`앱 버전: ${appVersion}`);
    expect(copied).toMatch(/브라우저: .*Chrome/);
    expect(copied).toMatch(/시각: \d{4}-\d{2}-\d{2}T/);

    // 원인이 사라진 뒤 '다시 시도' 를 누르면 화면이 돌아온다. 소리는 멈춘 채이므로 다시 연결해야 한다.
    await restoreRendering(page);
    await screen.getByRole('button', { name: '다시 시도' }).click();
    await expect(appErrorScreen(page)).toHaveCount(0);
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await expect(connectButton(page)).toBeVisible();
    expect((await readAudioTracking(page)).contexts, '다시 시도가 저절로 소리를 켜면 안 됩니다').toHaveLength(1);

    await connectGuitar(page);
    const reconnected = await readAudioTracking(page);
    expect(reconnected.contexts.map((context) => context.state)).toEqual(['closed', 'running']);
    expect(reconnected.inputTracks.map((track) => track.readyState)).toEqual(['ended', 'live']);
  });

  test("E-05 저장된 설정 때문에 시작할 때마다 죽어도 '설정을 초기화하고 다시 시작'으로 되돌아오고 내 프리셋은 남는다", async ({ page }) => {
    // 저장된 앱 설정(POISON_KEY)이 있는 동안에만 소수 표시가 예외를 던진다 → '저장 값 때문에 열 때마다 죽는' 상태를 흉내 낸다.
    // 새로 열릴 때마다 그 시작 직전의 저장소 키 목록도 남겨 둔다(초기화가 정말 지웠는지, 앱이 다시 쓰기 전의 상태로 본다).
    await page.addInitScript(
      ({ poisonKey, snapshotKey }) => {
        const original = Number.prototype.toFixed;
        Number.prototype.toFixed = function toFixed(this: number, digits?: number): string {
          if (window.localStorage.getItem(poisonKey) !== null) throw new Error('E-05: 저장된 설정 때문에 일으킨 렌더 예외');
          return original.call(this, digits);
        };
        try {
          window.sessionStorage.setItem(snapshotKey, JSON.stringify(Object.keys(window.localStorage)));
        } catch {
          // 저장소를 못 읽는 환경이면 목록을 남기지 못한다(이 시험은 그런 환경이 아니다).
        }
      },
      { poisonKey: POISON_KEY, snapshotKey: KEYS_AT_START },
    );
    await openApp(page);

    // 사용자가 직접 한 일: 내 프리셋 하나를 가져오고, Drive 를 끈다(페달 상태가 저장된다).
    const mine = { version: 11, presets: [{ id: 'e05-mine', name: 'E05 내 프리셋', updatedAt: 1, pedals: [] }] };
    await page.getByLabel('가져올 프리셋 JSON').fill(JSON.stringify(mine));
    await page.getByRole('button', { name: '붙여넣은 JSON 가져오기' }).click();
    await expect(page.locator('.preset-message')).toContainText('1개의 프리셋을 가져왔습니다');
    await stompOf(page, 'Drive').click();
    await expect(stompOf(page, 'Drive')).toHaveAttribute('aria-pressed', 'false');
    const saved = await page.evaluate(
      ({ stateKey, presetsKey }) => ({ pedals: window.localStorage.getItem(stateKey), presets: window.localStorage.getItem(presetsKey) }),
      { stateKey: STATE_KEY, presetsKey: PRESETS_KEY },
    );
    expect(saved.pedals, '페달 상태가 저장되어 있어야 합니다').not.toBeNull();
    expect(saved.presets).toContain('E05 내 프리셋');

    // 저장된 설정이 생기고(독) 다음 렌더에서 죽는다. 새로고침해도 같은 이유로 계속 죽는다.
    await page.evaluate((key) => window.localStorage.setItem(key, '{}'), POISON_KEY);
    await triggerRender(page);
    await expect(appErrorScreen(page)).toBeVisible();
    await page.reload();
    await expect(appErrorScreen(page)).toBeVisible();
    await expect(pedalCards(page)).toHaveCount(0);

    // 초기화는 두 번 묻는다. 취소하면 아무것도 지우지 않는다.
    const askButton = page.getByRole('button', { name: '설정을 초기화하고 다시 시작' });
    await expect(askButton).toHaveAttribute('aria-expanded', 'false');
    await askButton.click();
    await expect(askButton).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('heading', { name: '설정을 초기화할까요?' })).toBeVisible();
    await page.getByRole('button', { name: '취소', exact: true }).click();
    await expect(page.getByRole('heading', { name: '설정을 초기화할까요?' })).toHaveCount(0);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), POISON_KEY), '취소하면 설정이 그대로여야 합니다').toBe('{}');

    // 확인하면 앱 설정(guitar-pedalboard:*)이 지워지고 다시 시작해 정상으로 열린다.
    await askButton.click();
    await page.getByRole('button', { name: '초기화하고 다시 시작', exact: true }).click();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await expect(appErrorScreen(page)).toHaveCount(0);

    // 앱이 다시 쓰기 전(초기화 직후 열릴 때)의 목록: 앱 설정은 없고, 내 프리셋은 남아 있다.
    const keysAtStart = JSON.parse((await page.evaluate((key) => window.sessionStorage.getItem(key), KEYS_AT_START)) ?? '[]') as string[];
    expect(
      keysAtStart.filter((name) => name.startsWith('guitar-pedalboard:') && name !== SCHEMA_KEY && name !== PRESETS_KEY),
      '초기화가 프리셋과 저장 형식 표시(schema)를 뺀 앱 설정을 모두 지워야 합니다',
    ).toEqual([]);
    expect(keysAtStart, '내 프리셋은 남아야 합니다').toContain(PRESETS_KEY);
    expect(keysAtStart, 'schema 도 남아야 합니다(없으면 다음 시작이 옛 백업으로 프리셋을 덮어씁니다)').toContain(SCHEMA_KEY);
    expect(await page.evaluate((key) => window.localStorage.getItem(key), PRESETS_KEY)).toContain('E05 내 프리셋');
    // 페달은 기본값으로 돌아왔다(Drive 가 다시 켜져 있다).
    await expect(stompOf(page, 'Drive')).toHaveAttribute('aria-pressed', 'true');
  });

  test('E-05 앱 스크립트를 불러오지 못해도 흰 화면 대신 안내가 뜨고, 다시 불러오기로 복구된다', async ({ page }) => {
    const scripts = '**/assets/index-*.js';
    await page.route(scripts, (route) => route.abort());
    await page.goto('./');

    const fallback = staticFallback(page);
    await expect(fallback).toBeVisible();
    await expect(fallback.getByRole('heading', { name: '앱을 시작하지 못했습니다' })).toBeVisible();
    await expect(fallback.getByRole('button', { name: '페이지 다시 불러오기' })).toBeVisible();
    await expect(pedalCards(page)).toHaveCount(0);

    await page.unroute(scripts);
    await fallback.getByRole('button', { name: '페이지 다시 불러오기' }).click();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await expect(staticFallback(page)).toHaveCount(0);
  });

  test('E-05 이벤트·타이머·약속에서 난 예외는 화면을 깨지 않고 알림으로 뜨며, 무해한 오류는 걸러진다', async ({ page }) => {
    await openApp(page);
    const notice = toastOf(page, 'app:unexpected-error');

    // 걸러지는 것: 중단(AbortError)된 약속, ResizeObserver 알림. 알림이 뜨지 않는다.
    await page.evaluate(() => {
      void Promise.reject(new DOMException('중단됨', 'AbortError'));
      window.dispatchEvent(new ErrorEvent('error', { message: 'ResizeObserver loop completed with undelivered notifications.' }));
    });
    await page.waitForTimeout(500);
    await expect(notice).toHaveCount(0);

    // 타이머 안의 예외는 오류 화면이 아니라 알림이다.
    await page.evaluate(() => {
      setTimeout(() => {
        throw new Error('E-05 타이머 예외');
      }, 0);
    });
    await expect(notice).toHaveCount(1);
    await expect(notice).toContainText('예기치 못한 오류가 생겼습니다');
    await expect(notice.getByRole('button', { name: '오류 정보 복사' })).toBeVisible();

    // 같은 종류는 한 장으로 합쳐진다. 처리되지 않은 약속 거부도 같은 알림이다.
    await page.evaluate(() => {
      void Promise.reject(new Error('E-05 약속 예외'));
    });
    await page.waitForTimeout(300);
    await expect(notice).toHaveCount(1);

    // 앱은 멀쩡하다.
    await expect(appErrorScreen(page)).toHaveCount(0);
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await expectAppUsable(page);
  });
});
