// E-13 MIDI 풋스위치(설계서 S2.9, R2-9). Web MIDI 를 모의해서(권한 상태·장치 꽂고 뽑기·메시지) 실제 브라우저에서 수용 기준 5개를 본다.
//   1. 매핑 저장 → 새로고침 → (권한이 허용돼 있으면) 학습 없이 풋스위치가 반응하고 상태가 '매핑됨 · 연결됨'이다.
//   2. 권한이 아직 허용되지 않았으면(prompt) 열 때 권한 창이 저절로 뜨지 않는다. 배너 버튼을 눌렀을 때만 요청한다.
//   3. latch: 127 → 켜짐, 0 → 꺼짐 / toggle: 누를 때마다 전환, 뗌 무시.
//   4. 학습 중 누름 → 뗌이 1초 안에 이어지면 toggle 로 자동 지정, 한 번만 오면 latch.
//   5. 장치를 뺐다 다시 꽂으면 리스너가 저절로 다시 붙는다.
// 값 방향(옛 앱은 127 이 꺼짐이었다)·경계(63/64)·1초 경계·연결 순서의 모든 경우는 Node 시험(test:midi-reconnect)이 본다.
// 여기서는 화면(배너·카드 표시·알림)과 브라우저가 하는 일이다. 실제 풋스위치·실제 권한 창은 사람이 본다(보고서 '사람 확인 필요').
import type { Locator, Page } from '@playwright/test';
import { horizontalOverflow, openApp } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { mockMidi, type MidiMock, type MidiMockOptions } from '../helpers/mocks';
import { pedalGroup, readLocal, seedStorage, stompOf, toastOf } from '../helpers/storage';

const MIDI_KEY = 'guitar-pedalboard:midi';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;
const BANNER_BUTTON = 'MIDI 풋스위치 다시 연결';

/** 저장돼 있던 매핑: Delay = CC 80 토글, Drive = CC 81 래치(방식이 없는 옛 매핑), 둘 다 채널 1 */
const SAVED_MAPPINGS = JSON.stringify({
  delay: { channel: 1, cc: 80, value: 127, mode: 'toggle' },
  drive: { channel: 1, cc: 81, value: 127 },
});

const midiStatus = (page: Page, pedal: string): Locator => pedalGroup(page, pedal).locator('.midi-mapping-status');
const banner = (page: Page): Locator => page.locator('.midi-reconnect-notice');
const bannerButton = (page: Page): Locator => page.getByRole('button', { name: BANNER_BUTTON });
const modeButton = (page: Page, pedal: string): Locator => pedalGroup(page, pedal).getByRole('button', { name: /^방식:/ });

async function isOn(page: Page, pedal: string): Promise<boolean> {
  return (await stompOf(page, pedal).getAttribute('aria-pressed')) === 'true';
}

async function expectOn(page: Page, pedal: string, on: boolean): Promise<void> {
  await expect(stompOf(page, pedal)).toHaveAttribute('aria-pressed', String(on));
}

async function storedMapping(page: Page, pedalId: string): Promise<Record<string, unknown> | undefined> {
  const raw = await readLocal(page, MIDI_KEY);
  return raw === null ? undefined : (JSON.parse(raw) as Record<string, Record<string, unknown>>)[pedalId];
}

/** 모의를 걸고 저장된 매핑을 심은 채 앱을 연다. */
async function openWithMidi(page: Page, options: MidiMockOptions, seed: boolean = true): Promise<MidiMock> {
  const midi = await mockMidi(page, options);
  if (seed) await seedStorage(page, { [MIDI_KEY]: SAVED_MAPPINGS });
  await openApp(page);
  return midi;
}

test.describe('E-13 MIDI 풋스위치', () => {
  test('E-13 권한이 허용돼 있으면 열자마자 학습 없이 연결되고, 풋스위치가 반응하며, 상태가 매핑됨 · 연결됨이다(래치·토글·값 방향)', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'granted' });

    // 열 때 저절로 연결한다(권한이 허용돼 있으니 창은 뜨지 않는다). 아직 꽂힌 장치가 없다.
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 장치 없음 · Ch 1 · CC 81');
    await expect(banner(page)).toHaveCount(0);
    expect(await midi.stats()).toEqual({ requests: 1, connectedInputs: 0 });
    expect((await midi.permission()).prompts).toBe(0);

    const id = await midi.connect('Mock Footswitch');
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 연결됨 · Ch 1 · CC 81');
    await expect(midiStatus(page, 'Delay')).toHaveText('매핑됨 · 연결됨 · Ch 1 · CC 80');
    expect(await midi.listening(), '꽂힌 장치에 리스너가 붙었다').toBe(1);

    // 래치(Drive, 처음 켜짐): 값 방향 — 0 이 꺼짐, 127 이 켜짐(옛 앱은 반대였다)
    await expectOn(page, 'Drive', true);
    await midi.send(id, [0xb0, 81, 0]);
    await expectOn(page, 'Drive', false);
    await midi.send(id, [0xb0, 81, 127]);
    await expectOn(page, 'Drive', true);
    await midi.send(id, [0xb0, 81, 63]);
    await expectOn(page, 'Drive', false);
    await midi.send(id, [0xb0, 81, 64]);
    await expectOn(page, 'Drive', true);

    // 토글(Delay, 처음 꺼짐): 누를 때마다 전환, 뗌은 무시, 누른 채 반복되는 값은 한 번만
    await expectOn(page, 'Delay', false);
    await midi.send(id, [0xb0, 80, 127]);
    await expectOn(page, 'Delay', true);
    await midi.send(id, [0xb0, 80, 127]);
    await midi.send(id, [0xb0, 80, 0]);
    await expectOn(page, 'Delay', true);
    await midi.send(id, [0xb0, 80, 127]);
    await expectOn(page, 'Delay', false);

    // 다른 채널·다른 CC 는 무시
    await midi.send(id, [0xb1, 81, 0]);
    await midi.send(id, [0xb0, 99, 0]);
    await expectOn(page, 'Drive', true);

    // 저장된 상태도 따라온다(화면·엔진·저장이 같은 입구를 쓴다)
    await expect.poll(async () => {
      const raw = await readLocal(page, 'guitar-pedalboard:v2:state');
      return raw === null ? null : (JSON.parse(raw) as { pedals: Record<string, { active: boolean }> }).pedals.drive?.active;
    }).toBe(true);
    expect(await midi.stats()).toEqual({ requests: 1, connectedInputs: 1 });
  });

  test('E-13 매핑을 학습해 저장한 뒤 새로고침하면, 다시 학습하지 않아도 풋스위치가 반응하고 상태가 매핑됨 · 연결됨이다', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'granted' }, false);
    let id = await midi.connect('Mock Footswitch');
    await expect(midiStatus(page, 'Drive')).toHaveText('MIDI 미매핑');
    await pedalGroup(page, 'Drive').getByRole('button', { name: 'Drive MIDI 학습' }).click();
    await expect(midiStatus(page, 'Drive')).toHaveText('MIDI 입력 대기 중…');
    await expect.poll(() => midi.listening()).toBe(1);
    await midi.send(id, [0xb0, 90, 127]);
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 연결됨 · Ch 1 · CC 90');
    expect(await storedMapping(page, 'drive')).toBeDefined();

    await page.reload();
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 장치 없음 · Ch 1 · CC 90');
    await expect(banner(page)).toHaveCount(0);
    id = await midi.connect('Mock Footswitch');
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 연결됨 · Ch 1 · CC 90');
    // 학습 버튼을 누르지 않았는데 풋스위치가 일한다
    await midi.send(id, [0xb0, 90, 0]);
    await expectOn(page, 'Drive', false);
    await midi.send(id, [0xb0, 90, 127]);
    await expectOn(page, 'Drive', true);
    expect((await midi.permission()).prompts).toBe(0);
  });

  test('E-13 권한이 아직 허용되지 않았으면(prompt) 열 때 권한 창이 뜨지 않고, 배너 버튼을 눌러야 연결된다', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'prompt' });

    // 배너가 나온다. 지금까지 권한을 요청한 적도, 권한 창이 뜬 적도 없다.
    await expect(banner(page)).toBeVisible();
    await expect(banner(page)).toContainText('저장된 MIDI 풋스위치가 아직 연결되지 않았습니다.');
    await expect(bannerButton(page)).toBeVisible();
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 연결 안 됨 · Ch 1 · CC 81');
    expect(await midi.stats()).toEqual({ requests: 0, connectedInputs: 0 });
    expect(await midi.permission()).toEqual({ state: 'prompt', prompts: 0 });

    // 눌러야 권한을 요청한다(이때 권한 창이 뜬다)
    await bannerButton(page).click();
    await expect(banner(page)).toHaveCount(0);
    expect(await midi.permission()).toEqual({ state: 'granted', prompts: 1 });
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 장치 없음 · Ch 1 · CC 81');
    const id = await midi.connect('Mock Footswitch');
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 연결됨 · Ch 1 · CC 81');
    await midi.send(id, [0xb0, 81, 0]);
    await expectOn(page, 'Drive', false);

    // 한 번 허용했으니 새로고침하면 저절로 연결되고 배너도 없다
    await page.reload();
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 장치 없음 · Ch 1 · CC 81');
    await expect(banner(page)).toHaveCount(0);
    expect(await midi.permission()).toEqual({ state: 'granted', prompts: 0 });
    expect((await midi.stats()).requests).toBe(1);
  });

  test('E-13 키보드로 배너 버튼에 닿아 Enter 로 연결할 수 있다', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'prompt' });
    await expect(bannerButton(page)).toBeVisible();
    await bannerButton(page).focus();
    await expect(bannerButton(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(banner(page)).toHaveCount(0);
    expect((await midi.permission()).prompts).toBe(1);
  });

  test('E-13 권한 창에서 거부하면 배너가 막힘을 알리고, 사용자가 브라우저 설정에서 허용하면 저절로 이어서 연결한다', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'prompt', promptAnswer: 'deny' });
    await expect(banner(page)).toContainText('저장된 MIDI 풋스위치가 아직 연결되지 않았습니다.');
    await bannerButton(page).click();
    // 거부 → 배너는 막힘을 알린다(버튼은 그대로 있어 다시 시도할 수 있다)
    await expect(banner(page)).toContainText('MIDI 연결이 막혀 있습니다.');
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 연결 안 됨 · Ch 1 · CC 81');
    expect(await midi.permission()).toEqual({ state: 'denied', prompts: 1 });

    // 사용자가 사이트 설정에서 허용으로 바꾼다 → 버튼을 누르지 않아도 이어서 연결한다
    await midi.setPermission('granted');
    await expect(banner(page)).toHaveCount(0);
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 장치 없음 · Ch 1 · CC 81');
    const id = await midi.connect('Mock Footswitch');
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 연결됨 · Ch 1 · CC 81');
    await midi.send(id, [0xb0, 81, 0]);
    await expectOn(page, 'Drive', false);
  });

  test('E-13 처음부터 권한이 막혀 있으면 요청하지 않고 막힘을 알린다', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'denied' });
    await expect(banner(page)).toContainText('MIDI 연결이 막혀 있습니다.');
    expect(await midi.stats()).toEqual({ requests: 0, connectedInputs: 0 });
    expect((await midi.permission()).prompts).toBe(0);
  });

  test('E-13 권한 조회를 지원하지 않는 브라우저도 열 때 권한을 요청하지 않고 배너 버튼으로 연결한다', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'unsupported' });
    await expect(banner(page)).toBeVisible();
    expect(await midi.stats()).toEqual({ requests: 0, connectedInputs: 0 });
    await bannerButton(page).click();
    await expect(banner(page)).toHaveCount(0);
    expect((await midi.stats()).requests).toBe(1);
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 장치 없음 · Ch 1 · CC 81');
  });

  test('E-13 저장된 매핑이 없으면 권한도 요청하지 않고 배너도 없다', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'prompt' }, false);
    await expect(midiStatus(page, 'Drive')).toHaveText('MIDI 미매핑');
    await expect(banner(page)).toHaveCount(0);
    expect(await midi.stats()).toEqual({ requests: 0, connectedInputs: 0 });
    expect(await midi.permission()).toEqual({ state: 'prompt', prompts: 0 });
  });

  test('E-13 학습 중 누름 → 뗌이 1초 안에 이어지면 토글로 자동 지정하고 알린다', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'granted' }, false);
    const id = await midi.connect('Mock Footswitch');
    await pedalGroup(page, 'Delay').getByRole('button', { name: 'Delay MIDI 학습' }).click();
    await expect.poll(() => midi.listening()).toBe(1);
    await midi.send(id, [0xb0, 85, 127]);
    await midi.send(id, [0xb0, 85, 0]);

    await expect(modeButton(page, 'Delay')).toHaveText('방식: 토글');
    const toast = toastOf(page, 'midi-mode:delay');
    await expect(toast).toContainText('토글');
    await expect(toast).toContainText("'방식' 버튼");
    expect(await storedMapping(page, 'delay')).toEqual({ channel: 1, cc: 85, value: 127, mode: 'toggle' });
    // 학습할 때의 누름·뗌은 페달을 움직이지 않았다
    await expectOn(page, 'Delay', false);

    // 이제 누를 때마다 전환한다
    await midi.send(id, [0xb0, 85, 127]);
    await expectOn(page, 'Delay', true);
    await midi.send(id, [0xb0, 85, 0]);
    await expectOn(page, 'Delay', true);
    await midi.send(id, [0xb0, 85, 127]);
    await expectOn(page, 'Delay', false);
  });

  test('E-13 학습 중 신호가 한 번만 오면 래치로 지정하고, 1초 뒤에 알린다. 방식 버튼으로 토글로 바꿀 수 있다', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'granted' }, false);
    const id = await midi.connect('Mock Footswitch');
    await pedalGroup(page, 'Delay').getByRole('button', { name: 'Delay MIDI 학습' }).click();
    await expect.poll(() => midi.listening()).toBe(1);
    await midi.send(id, [0xb0, 86, 127]);
    await expect(midiStatus(page, 'Delay')).toHaveText('매핑됨 · 연결됨 · Ch 1 · CC 86');
    await expect(modeButton(page, 'Delay')).toHaveText('방식: 래치');

    // 1초가 지나면 래치로 정했다고 알린다
    const toast = toastOf(page, 'midi-mode:delay');
    await expect(toast).toContainText('래치', { timeout: 5000 });
    await expect(toast).toContainText('토글');
    expect(await storedMapping(page, 'delay')).toEqual({ channel: 1, cc: 86, value: 127 });

    // 래치: 값을 따라간다
    await midi.send(id, [0xb0, 86, 127]);
    await expectOn(page, 'Delay', true);
    await midi.send(id, [0xb0, 86, 0]);
    await expectOn(page, 'Delay', false);

    // 사용자가 방식을 토글로 바꾼다
    await modeButton(page, 'Delay').click();
    await expect(modeButton(page, 'Delay')).toHaveText('방식: 토글');
    expect((await storedMapping(page, 'delay'))?.mode).toBe('toggle');
    await midi.send(id, [0xb0, 86, 127]);
    await midi.send(id, [0xb0, 86, 0]);
    await expectOn(page, 'Delay', true);
  });

  test('E-13 장치를 뺐다 다시 꽂으면 리스너가 저절로 다시 붙는다(같은 장치·새 장치 모두)', async ({ page }) => {
    const midi = await openWithMidi(page, { permission: 'granted' });
    const id = await midi.connect('Mock Footswitch');
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 연결됨 · Ch 1 · CC 81');
    await midi.send(id, [0xb0, 81, 0]);
    await expectOn(page, 'Drive', false);

    // 뽑는다 → 장치 없음. 메시지는 오지 않는다.
    await midi.disconnect(id);
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 장치 없음 · Ch 1 · CC 81');
    expect((await midi.stats()).connectedInputs).toBe(0);
    expect(await midi.listening()).toBe(0);

    // 같은 장치를 다시 꽂는다 → 연결됨, 메시지가 다시 먹힌다(학습·새로고침 없이)
    await midi.reconnect(id);
    await expect(midiStatus(page, 'Drive')).toHaveText('매핑됨 · 연결됨 · Ch 1 · CC 81');
    expect(await midi.listening(), '다시 꽂으면 리스너가 저절로 다시 붙는다').toBe(1);
    await midi.send(id, [0xb0, 81, 127]);
    await expectOn(page, 'Drive', true);

    // 다른 장치를 새로 꽂아도 붙는다. 둘이 같이 있어도 한 번 누름은 한 번만 일한다.
    const other = await midi.connect('Other Footswitch');
    await expect.poll(() => midi.listening()).toBe(2);
    await midi.send(other, [0xb0, 81, 0]);
    await expectOn(page, 'Drive', false);
    await midi.disconnect(id);
    await midi.send(other, [0xb0, 81, 127]);
    await expectOn(page, 'Drive', true);
    expect(await isOn(page, 'Delay')).toBe(false);
  });

  test('E-13 휴대폰 화면에서 배너가 화면 안에 들어오고 버튼을 손가락으로 누를 수 있다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic(undefined, PHONE);
    const midi = await openWithMidi(page, { permission: 'prompt' });
    await expect(banner(page)).toBeVisible();
    expect(await horizontalOverflow(page)).toBe(0);
    const box = await bannerButton(page).boundingBox();
    expect(box, '배너 버튼 위치').not.toBeNull();
    const viewport = page.viewportSize();
    expect(box!.height, '손가락으로 누를 만한 높이').toBeGreaterThanOrEqual(42);
    expect(box!.x, '왼쪽이 화면 안').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, '오른쪽이 화면 안').toBeLessThanOrEqual(viewport!.width + 0.5);
    await bannerButton(page).tap();
    await expect(banner(page)).toHaveCount(0);
    expect((await midi.permission()).prompts).toBe(1);
  });
});
