// E-17 입출력 장치(설계서 S2.13, 4.4 DeviceManager, 보고서 R2-15). 실제 Chromium 의 가짜 장치 위에 장치 목록 모의(e2e/helpers/mocks.ts mockDevices)를 얹어
// 장치가 꽂히고 빠지고 이름·id 가 바뀌는 상황을 만든다. 가짜 장치: 입력 default·'Fake Audio Input 1'·'Fake Audio Input 2', 출력 default·'Fake Audio Output 1'·'Fake Audio Output 2'.
//   ① `devicechange` 를 받으면 '새로고침'을 누르지 않아도 1초 안에 장치 목록이 갱신된다(입력·출력 모두). 연달아 오는 신호는 한 번만 읽는다
//   ② 연주 중 고른 입력 장치가 사라지면 세션이 멈추고(device-lost) 안내가 뜨며, 화면이 '연결됨'으로 남지 않고 AudioContext 와 마이크 트랙이 모두 닫힌다. 장치가 돌아오면 다시 골라 둔다
//   ③ Chrome·Edge: 출력 장치를 바꾸면 그 장치로 `setSinkId` 가 불리고(연결 전에 고르면 연결할 때, 연결 중에 고르면 바로) 다음 방문에도 기억된다
//   ④ 저장해 둔 출력 장치가 사라졌으면 연결을 막지 않고 시스템 기본 출력으로 연결하며 안내한다. 이름이 같고 id 만 바뀐 장치는 이름으로 찾는다
//   ⑤ Firefox·Safari(setSinkId 없음): 출력 메뉴를 숨기고 '출력 장치는 시스템 설정에서 바꿔 주세요.' 를 보인다. 연결은 된다
//   ⑥ 고른 입력 장치를 기억한다(다음 방문에도 같은 장치로 연결). 이름이 같고 id 만 바뀌었으면 이름으로 찾고, 없으면 기본 장치로 연결하며 안내한다(되풀이하지 않는다)
//   ⑦ 마이크 권한 전(장치 id·이름이 빈 목록)에는 기억해 둔 장치를 '없다'고 판단해 지우지 않는다
//   ⑧ 휴대폰 화면에서 안내 문구가 가로로 넘치지 않는다
// 문구는 설계서와 앱 카탈로그(src/i18n/ko.ts)가 아니라 이 파일에 따로 적었다 — 카탈로그가 실수로 바뀌면 이 시험이 알아채야 한다.
import type { Page } from '@playwright/test';
import { connectButton, connectGuitar, disconnectButton, horizontalOverflow, openApp, panicButton, setMobileDock } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { mockDevices, readAudioTracking, trackAudioContexts, type DeviceMock } from '../helpers/mocks';

const TEXT = {
  deviceLost: '입력 장치 연결이 끊겼습니다. 장치를 다시 연결한 뒤 연결하기를 누르세요.',
  inputFellBack: '저장된 입력 장치를 찾지 못해 기본 장치로 연결했습니다.',
  outputFellBack: '저장된 출력 장치를 쓸 수 없어 시스템 기본 출력으로 연결했습니다.',
  outputUnsupported: '출력 장치는 시스템 설정에서 바꿔 주세요.',
};

const INPUT_1 = 'Fake Audio Input 1';
const INPUT_2 = 'Fake Audio Input 2';
const OUTPUT_1 = 'Fake Audio Output 1';
const OUTPUT_2 = 'Fake Audio Output 2';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

const inputSelect = (page: Page) => page.locator('#audio-device');
const outputSelect = (page: Page) => page.locator('#audio-output');
const inputOption = (page: Page, label: string) => inputSelect(page).locator('option', { hasText: label });
const outputOption = (page: Page, label: string) => outputSelect(page).locator('option', { hasText: label });
const toast = (page: Page, text: string) => page.locator('.toast', { hasText: text });

/** 장치 목록이 채워질 때까지 기다린 뒤 이름으로 옵션의 value(장치 id)를 읽는다 */
async function deviceId(select: ReturnType<typeof inputSelect>, label: string): Promise<string> {
  const option = select.locator('option', { hasText: label });
  await expect(option).toHaveCount(1);
  const value = await option.getAttribute('value');
  expect(value, `${label} 의 장치 id`).toBeTruthy();
  return value ?? '';
}

async function openAppWithMock(page: Page, options: Parameters<typeof mockDevices>[1] = {}): Promise<DeviceMock> {
  await trackAudioContexts(page);
  const mock = await mockDevices(page, options);
  await openApp(page);
  return mock;
}

const openContexts = async (page: Page): Promise<number> =>
  (await readAudioTracking(page)).contexts.filter((context) => context.state !== 'closed').length;

test.describe('E-17 입출력 장치', () => {
  test('E-17 ① devicechange 를 받으면 새로고침 없이 1초 안에 입력·출력 목록이 바뀐다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    await deviceId(inputSelect(page), INPUT_1);
    await deviceId(outputSelect(page), OUTPUT_1);

    await mock.change({
      added: [
        { kind: 'audioinput', deviceId: 'usb-in', label: 'USB Audio Interface' },
        { kind: 'audiooutput', deviceId: 'usb-out', label: 'USB Audio Interface Out' },
      ],
    });
    await expect(inputOption(page, 'USB Audio Interface')).toHaveCount(1, { timeout: 1000 });
    await expect(outputOption(page, 'USB Audio Interface Out')).toHaveCount(1, { timeout: 1000 });

    await mock.change({ added: [] });
    await expect(inputOption(page, 'USB Audio Interface')).toHaveCount(0, { timeout: 1000 });
    await expect(outputOption(page, 'USB Audio Interface Out')).toHaveCount(0, { timeout: 1000 });
  });

  test('E-17 ① 연달아 오는 devicechange 는 목록을 한 번만 읽는다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    await deviceId(inputSelect(page), INPUT_1);
    await page.waitForTimeout(500); // 처음 읽기가 끝나도록 둔다
    const before = await mock.enumerateCalls();

    await mock.burst(6);
    await expect.poll(() => mock.enumerateCalls(), { timeout: 2000 }).toBeGreaterThan(before);
    await page.waitForTimeout(600);
    const reads = (await mock.enumerateCalls()) - before;
    // 입력 목록과 출력 목록을 한 번씩 읽는 것이 한 번의 갱신이다(둘이 같은 갱신에서 읽힌다).
    expect(reads, '6번 연달아 보낸 신호가 읽은 횟수(갱신 1회 = 2번)').toBeLessThanOrEqual(2);
  });

  test('E-17 ② 연주 중 고른 입력 장치가 사라지면 세션이 멈추고 안내가 뜨며, 돌아오면 다시 골라 둔다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    const id = await deviceId(inputSelect(page), INPUT_1);
    await inputSelect(page).selectOption({ label: INPUT_1 });
    await connectGuitar(page);
    expect(await openContexts(page)).toBe(1);

    await mock.change({ hidden: [id] });
    await expect(connectButton(page)).toBeVisible({ timeout: 1500 });
    await expect(toast(page, TEXT.deviceLost)).toBeVisible();
    await expect(disconnectButton(page)).toHaveCount(0);
    await expect(panicButton(page)).toHaveCount(0);
    await expect.poll(() => openContexts(page), { message: '멈춘 뒤 열려 있는 AudioContext' }).toBe(0);
    const tracking = await readAudioTracking(page);
    expect(tracking.inputTracks.length).toBeGreaterThan(0);
    expect(tracking.inputTracks.every((track) => track.readyState === 'ended')).toBe(true);
    await expect(inputSelect(page)).toHaveValue('');

    // 장치가 다시 꽂히면 기억해 둔 장치를 다시 고른다.
    await mock.change({ hidden: [] });
    await expect(inputSelect(page)).toHaveValue(id, { timeout: 1500 });
  });

  test('E-17 ③ 출력 장치를 고르면 그 장치로 setSinkId 가 불리고 다음 방문에도 기억된다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    const first = await deviceId(outputSelect(page), OUTPUT_1);
    const second = await deviceId(outputSelect(page), OUTPUT_2);

    // 연결 전에 고르면 연결할 때 그 장치로 보낸다.
    await outputSelect(page).selectOption({ label: OUTPUT_1 });
    await connectGuitar(page);
    expect(await mock.sinkCalls()).toContain(first);

    // 연결 중에 바꾸면 바로 그 장치로 보낸다(연결하면 데스크톱 패널이 한 줄로 줄어들므로 '입력 설정'으로 펼친다).
    await page.getByRole('button', { name: '입력 설정', exact: true }).click();
    await outputSelect(page).selectOption({ label: OUTPUT_2 });
    await expect.poll(() => mock.sinkCalls(), { timeout: 1000 }).toContain(second);
    await expect(page.locator('.error-message')).toHaveCount(0);
    await disconnectButton(page).click();

    // 다음 방문: 같은 장치가 골라져 있고 연결하면 그 장치로 보낸다.
    await page.reload();
    await expect(outputSelect(page)).toHaveValue(second);
    await connectGuitar(page);
    expect(await mock.sinkCalls()).toContain(second);
  });

  test('E-17 ④ 저장해 둔 출력 장치가 사라졌으면 시스템 기본 출력으로 연결하고 안내한다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    const id = await deviceId(outputSelect(page), OUTPUT_1);
    await outputSelect(page).selectOption({ label: OUTPUT_1 });

    await mock.set({ hidden: [id] });
    await page.reload();
    await openApp(page);
    await connectButton(page).click();

    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    await expect(toast(page, TEXT.outputFellBack)).toBeVisible();
    await expect(page.locator('.error-message')).toHaveCount(0);
    await expect(outputSelect(page)).toHaveValue('');
  });

  test('E-17 ④ 이름이 같고 id 만 바뀐 출력 장치는 이름으로 찾아 그 장치로 보낸다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    const id = await deviceId(outputSelect(page), OUTPUT_2);
    await outputSelect(page).selectOption({ label: OUTPUT_2 });

    await mock.set({ renamed: { [id]: 'renamed-output' } });
    await page.reload();
    await openApp(page);
    await expect(outputSelect(page)).toHaveValue('renamed-output');
    await connectGuitar(page);
    expect(await mock.sinkCalls()).toContain('renamed-output');
    await expect(toast(page, TEXT.outputFellBack)).toHaveCount(0);
  });

  test('E-17 ⑤ setSinkId 가 없는 브라우저에서는 출력 메뉴를 숨기고 안내하며, 연결은 된다', async ({ page }) => {
    await openAppWithMock(page, { sinkId: false });
    await expect(outputSelect(page)).toHaveCount(0);
    await expect(page.getByText(TEXT.outputUnsupported)).toBeVisible();
    await expect(page.getByText('이 브라우저는 출력 장치 선택을 지원하지 않습니다')).toHaveCount(0);
    await connectGuitar(page);
  });

  test('E-17 ⑥ 고른 입력 장치를 다음 방문에도 기억하고 그 장치로 연결한다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    const id = await deviceId(inputSelect(page), INPUT_2);
    await inputSelect(page).selectOption({ label: INPUT_2 });

    await page.reload();
    await openApp(page);
    await expect(inputSelect(page)).toHaveValue(id);
    await connectButton(page).click();
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    expect(await mock.userMediaRequests()).toEqual([`exact:${id}`]);
    await expect(toast(page, TEXT.inputFellBack)).toHaveCount(0);
  });

  test('E-17 ⑥ 기본 입력 장치를 고르면 기억을 지운다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    await deviceId(inputSelect(page), INPUT_2);
    await inputSelect(page).selectOption({ label: INPUT_2 });
    await inputSelect(page).selectOption({ label: '기본 입력 장치' });

    await page.reload();
    await openApp(page);
    await expect(inputSelect(page)).toHaveValue('');
    await connectButton(page).click();
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    expect(await mock.userMediaRequests()).toEqual(['default']);
    await expect(toast(page, TEXT.inputFellBack)).toHaveCount(0);
  });

  test('E-17 ⑥ 이름이 같고 id 만 바뀐 입력 장치는 이름으로 찾아 연결한다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    const id = await deviceId(inputSelect(page), INPUT_2);
    await inputSelect(page).selectOption({ label: INPUT_2 });

    await mock.set({ renamed: { [id]: 'renamed-input' } });
    await page.reload();
    await openApp(page);
    await expect(inputSelect(page)).toHaveValue('renamed-input');
    await connectButton(page).click();
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    expect(await mock.userMediaRequests()).toEqual(['exact:renamed-input']);
    await expect(toast(page, TEXT.inputFellBack)).toHaveCount(0);
  });

  test('E-17 ⑥ 저장해 둔 입력 장치가 없으면 기본 장치로 연결하고 안내한다(되풀이하지 않는다)', async ({ page }) => {
    const mock = await openAppWithMock(page);
    const id = await deviceId(inputSelect(page), INPUT_2);
    await inputSelect(page).selectOption({ label: INPUT_2 });

    await mock.set({ hidden: [id] });
    await page.reload();
    await openApp(page);
    await expect(inputSelect(page)).toHaveValue('');
    await connectButton(page).click();
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    const notice = toast(page, TEXT.inputFellBack);
    await expect(notice).toBeVisible();
    await expect(page.locator('.error-message')).toHaveCount(0);
    expect(await mock.userMediaRequests()).toEqual(['default']);

    await notice.getByRole('button', { name: '닫기' }).click();
    await expect(notice).toHaveCount(0);
    await disconnectButton(page).click();
    await expect(connectButton(page)).toBeVisible();
    await connectButton(page).click();
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    await expect(toast(page, TEXT.inputFellBack)).toHaveCount(0);

    // 장치가 돌아오면(연결을 끊은 뒤) 기억해 둔 장치를 다시 고른다.
    await disconnectButton(page).click();
    await mock.change({ hidden: [] });
    await expect(inputSelect(page)).toHaveValue(id, { timeout: 1500 });
  });

  test('E-17 ⑦ 마이크 권한 전(id·이름이 빈 목록)에는 기억해 둔 입력 장치를 지우지 않는다', async ({ page }) => {
    const mock = await openAppWithMock(page);
    const id = await deviceId(inputSelect(page), INPUT_2);
    await inputSelect(page).selectOption({ label: INPUT_2 });

    await mock.set({ blank: true });
    await page.reload();
    await openApp(page);
    await expect(inputSelect(page)).toHaveValue(id);
    await expect(inputSelect(page).locator(`option[value="${id}"]`)).toHaveText(INPUT_2);

    await mock.set({ blank: false });
    await connectButton(page).click();
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    expect(await mock.userMediaRequests()).toEqual([`exact:${id}`]);
    await expect(toast(page, TEXT.inputFellBack)).toHaveCount(0);
  });

  test.describe('휴대폰', () => {
    test.use(PHONE);

    test('E-17 ⑧ 휴대폰에서 출력 장치 안내 문구가 가로로 넘치지 않는다', async ({ page }) => {
      await openAppWithMock(page, { sinkId: false });
      await setMobileDock(page, true, 'input');
      await expect(page.getByText(TEXT.outputUnsupported)).toBeVisible();
      expect(await horizontalOverflow(page)).toBe(0);
    });
  });
});
