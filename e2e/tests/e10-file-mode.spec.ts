// E-10 음원 파일 모드(설계서 S2.6, 4.11 '파일 재생', R2-5). 실제 브라우저에서 파일을 열어 수용 기준 5개를 본다.
//   1. 재생이 끝나도 파일이 남고, 반복이 켜져 있으면 처음부터 다시 재생한다. 반복을 끄면 끝에서 멈추고 파일은 그대로다.
//   2. 탐색 막대로 아무 위치로나 이동하고 ±10초 버튼도 쓴다.
//   3. 파일 모드의 Space = 재생/일시정지. 마이크(getUserMedia)는 켜지지 않는다.
//   4. 정지(연결 해제)한 뒤 다시 재생해도 같은 파일로 재생된다. 세션마다 새 `<audio>` 요소를 쓰고 이전 Object URL 은 해제한다.
//   5. 화면에 브라우저 기본 영문 파일 버튼이 보이지 않는다. '음원 파일 열기' 버튼으로 연다.
// '이음매에서 큰 클릭이 없다'(수용 기준 1 의 뒷부분)는 설계서가 청취 확인으로 정한 항목이라 여기서 시험하지 않는다(사람 확인).
// 파일은 `scripts/make-fixture-wavs.mjs` 가 만든 합성 WAV 다(e2e/fixtures). 1초 파일(REF-IMPULSE)로 반복·끝을, 60초 파일(G-1)로 탐색을 본다.
import type { BrowserContextOptions, Page } from '@playwright/test';
import { connectGuitar, disconnectButton, horizontalOverflow, openApp, openAudioInputMenu, selectMobileTab, setMobileDock } from '../helpers/app';
import { fixturePath } from '../helpers/env';
import {
  closeFileButton,
  countRewinds,
  currentFileElement,
  EMPTY_FILE_TEXT,
  fileButton,
  filePlayer,
  loopSwitch,
  loopSwitchLabel,
  openFileButton,
  openFileThroughButton,
  positionSlider,
  readFileMedia,
  releaseFocus,
  sampleFilePosition,
  trackFileMedia,
} from '../helpers/file-media';
import { expect, test, type MicSession } from '../helpers/fixtures';
import { readAudioTracking, trackAudioContexts } from '../helpers/mocks';

type Launch = (wavName?: string, contextOptions?: BrowserContextOptions) => Promise<MicSession>;

/** 8초. 일반 시험용 */
const NORMAL = 'ref-pc.wav';
/** 1초. 반복·끝 시험용(1초마다 처음으로 돌아온다) */
const SHORT = 'ref-impulse.wav';
/** 60초. 탐색 시험용 */
const LONG = 'g-1.wav';
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

/** 오디오 컨텍스트·마이크 요청·`<audio>` 요소·Object URL 을 지켜보며 앱을 연다. */
async function openTracked(launchWithMic: Launch, contextOptions?: BrowserContextOptions): Promise<Page> {
  const { page } = await launchWithMic(NORMAL, contextOptions);
  await trackAudioContexts(page);
  await trackFileMedia(page);
  await openApp(page);
  await openAudioInputMenu(page);
  return page;
}

/** 지금 세션의 요소가 실제로 재생 중(멈춤 아님·위치가 앞으로 가는 중)일 때까지 기다린다. */
async function expectPlaying(page: Page, afterSeconds = 0.3): Promise<void> {
  await expect
    .poll(async () => {
      const element = await currentFileElement(page);
      return element !== null && !element.paused && element.currentTime > afterSeconds;
    }, { timeout: 15_000, message: '파일이 재생 중이어야 합니다' })
    .toBe(true);
}

async function expectIdleWithFile(page: Page, name: string): Promise<void> {
  await expect(filePlayer(page)).toContainText(name);
  await expect(fileButton(page, '재생'), '세션이 끝나도 파일은 남아 있어 재생을 다시 누를 수 있다').toBeEnabled();
  await expect(fileButton(page, '일시정지')).toBeDisabled();
  await expect(fileButton(page, '정지')).toBeDisabled();
  await expect(positionSlider(page)).toBeDisabled();
  await expect(closeFileButton(page)).toBeEnabled();
}

test.describe('E-10 음원 파일 모드', () => {
  test('수용 기준 5: 영문 기본 파일 버튼이 보이지 않고, 한국어 버튼으로 연다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await expect(openFileButton(page)).toBeEnabled();
    await expect(closeFileButton(page), '열린 파일이 없으면 닫을 것도 없다').toBeDisabled();
    await expect(filePlayer(page)).toContainText(EMPTY_FILE_TEXT);
    await expect(fileButton(page, '재생'), '열린 파일이 없으면 재생할 것도 없다').toBeDisabled();

    // 실제 파일 입력(#audio-file)은 화면에 없다(display: none). 브라우저 기본 'Choose File'(영문)·'파일 선택'이 그려지지 않는다.
    const input = await page.evaluate(() => {
      const element = document.querySelector('#audio-file');
      return element ? { display: getComputedStyle(element).display, type: element.getAttribute('type') } : null;
    });
    expect(input, '파일 입력은 DOM 에 있되 숨겨져 있다').toEqual({ display: 'none', type: 'file' });
    await expect(page.locator('#audio-file')).toBeHidden();

    // 사용자가 하는 그대로: 버튼을 누르면 브라우저의 파일 선택 창이 뜨고, 고르면 재생된다.
    await openFileThroughButton(page, fixturePath(NORMAL));
    await expectPlaying(page);
    await expect(filePlayer(page)).toContainText(NORMAL);
    await expect(closeFileButton(page)).toBeEnabled();
    await expect(fileButton(page, '일시정지')).toBeEnabled();
    expect((await readAudioTracking(page)).getUserMediaCalls, '파일을 열어도 마이크는 켜지지 않는다').toBe(0);
  });

  test('수용 기준 1: 반복 재생이 켜져 있으면 끝에서 처음부터 다시 재생하고 파일은 그대로다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await expect(page.locator('#audio-file')).toBeHidden();
    await page.setInputFiles('#audio-file', fixturePath(SHORT));
    await expectPlaying(page, 0.05);
    await expect(loopSwitch(page), "'반복 재생' 은 기본 켜짐").toBeChecked();

    // 1초짜리 파일을 3.5초 동안 보면 처음으로 돌아오는 일이 두세 번 있어야 하고, 그동안 한 번도 멈추지 않는다.
    const samples = await sampleFilePosition(page, 3500);
    expect(countRewinds(samples), `반복: 위치가 처음으로 돌아온 횟수 — ${samples.map((s) => s.currentTime.toFixed(2)).join(' ')}`).toBeGreaterThanOrEqual(2);
    expect(samples.every((sample) => !sample.paused), '반복 재생 중에는 멈추지 않는다').toBe(true);

    const reading = await readFileMedia(page);
    expect(reading.elements, '같은 세션에서는 같은 <audio> 요소가 되풀이된다').toHaveLength(1);
    expect(reading.elements[0].loop).toBe(true);
    await expect(filePlayer(page)).toContainText(SHORT);
    expect(reading.revokedUrls, '재생 중에는 Object URL 을 해제하지 않는다').toEqual([]);
  });

  test('수용 기준 1: 반복을 끄면 끝에서 멈추고 파일은 남는다. 재생을 누르면 처음부터 다시 튼다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(SHORT));
    await expectPlaying(page, 0.05);

    await loopSwitchLabel(page).click();
    await expect(loopSwitch(page)).not.toBeChecked();
    expect((await currentFileElement(page))?.loop, '재생 중에도 바로 적용된다').toBe(false);

    // 끝까지 가서 멈춘다.
    await expect
      .poll(async () => {
        const element = await currentFileElement(page);
        return element !== null && element.paused && element.currentTime >= element.duration - 0.05;
      }, { timeout: 8000, message: '반복을 끄면 끝에서 멈춰야 합니다' })
      .toBe(true);
    await expect(filePlayer(page), '끝나도 파일은 남아 있다').toContainText(SHORT);
    await expect(fileButton(page, '재생'), '끝에서 멈춘 파일은 다시 재생할 수 있다').toBeEnabled();
    await expect(fileButton(page, '일시정지')).toBeDisabled();
    await expect(closeFileButton(page)).toBeEnabled();
    await expect(page.locator('.toast'), '끝났다고 안내(토스트)를 띄우지 않는다').toHaveCount(0);
    // 끝에서 멈춘 상태가 화면에도 같다: 위치는 끝, 시간표시도 끝.
    await expect(filePlayer(page)).toContainText('0:01 / 0:01');

    // 재생을 누르면 처음부터 다시 튼다(같은 세션이라 요소도 같다).
    await fileButton(page, '재생').click();
    const restarted = await sampleFilePosition(page, 400, 20);
    expect(restarted.some((sample) => !sample.paused && sample.currentTime < 0.6), `끝에서 다시 재생하면 처음부터 튼다 — ${restarted.map((s) => s.currentTime.toFixed(2)).join(' ')}`).toBe(true);
    expect((await readFileMedia(page)).elements, '같은 세션이므로 요소는 그대로다').toHaveLength(1);

    // 반복을 다시 켜면 다시 되풀이된다.
    await loopSwitchLabel(page).click();
    await expect(loopSwitch(page)).toBeChecked();
    expect((await currentFileElement(page))?.loop).toBe(true);
  });

  test('수용 기준 2: 탐색 막대로 아무 위치로나 이동하고 ±10초 버튼도 쓴다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(LONG));
    await expectPlaying(page, 0.2);
    await expect(filePlayer(page), '전체 길이가 보인다').toContainText('/ 1:00');
    const slider = positionSlider(page);
    await expect(slider).toBeEnabled();

    const position = async (): Promise<number> => (await currentFileElement(page))?.currentTime ?? -1;

    // 막대로 아무 데나: 한가운데, 거의 끝, 처음.
    for (const target of [30, 55, 4]) {
      await slider.fill(String(target));
      await expect.poll(position, { message: `막대를 ${target}초로 옮기면 재생 위치가 거기로 간다` }).toBeGreaterThanOrEqual(target - 0.3);
      expect(await position()).toBeLessThan(target + 3);
    }

    // ±10초
    await slider.fill('30');
    await expect.poll(position).toBeGreaterThanOrEqual(29.7);
    const beforeForward = await position();
    await fileButton(page, '앞으로 10초').click();
    await expect.poll(position, { message: '앞으로 10초' }).toBeGreaterThanOrEqual(beforeForward + 9.8);
    expect(await position()).toBeLessThan(beforeForward + 13);
    const beforeBack = await position();
    await fileButton(page, '뒤로 10초').click();
    await expect.poll(position, { message: '뒤로 10초' }).toBeLessThanOrEqual(beforeBack - 9.5);
    expect(await position()).toBeGreaterThan(beforeBack - 13);

    // 처음에서 뒤로 가기는 0 에서 멈춘다(음수가 되지 않는다).
    await slider.fill('3');
    await fileButton(page, '뒤로 10초').click();
    await expect.poll(position).toBeLessThan(3);
    expect(await position()).toBeGreaterThanOrEqual(0);

    // 시간 표시(막대의 읽기 값·화면 문구)가 실제 위치를 따라간다.
    await slider.fill('42');
    await expect(slider).toHaveAttribute('aria-valuetext', /^0:4[2-9] \/ 1:00$/);
    await expect(filePlayer(page)).toContainText(/0:4[2-9] \/ 1:00/);
  });

  test('수용 기준 2: 막대를 마우스로 잡아 끌어도 따라가고, 놓으면 다시 재생 위치를 따라간다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(LONG));
    await expectPlaying(page, 0.2);
    const slider = positionSlider(page);
    const box = await slider.boundingBox();
    expect(box, '막대가 화면에 있어야 합니다').not.toBeNull();
    if (!box) return;
    const y = box.y + box.height / 2;

    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.8, y, { steps: 6 });
    await page.mouse.up();

    // 끌어 놓은 곳(80%, 약 48초)에서 재생이 이어진다. 눈금 여백 때문에 몇 초 어긋날 수 있어 범위로 본다.
    await expect.poll(async () => (await currentFileElement(page))?.currentTime ?? 0, { timeout: 5000 }).toBeGreaterThan(42);
    expect((await currentFileElement(page))?.currentTime ?? 0).toBeLessThan(56);

    // 놓은 뒤에는 막대가 재생 위치를 따라 앞으로 간다(끌던 값에 붙잡혀 멈춰 있지 않다).
    const released = Number(await slider.inputValue());
    await expect.poll(async () => Number(await slider.inputValue()), { timeout: 5000, message: '놓은 뒤 막대가 앞으로 가야 합니다' }).toBeGreaterThan(released + 0.8);
  });

  test('수용 기준 2: 막대 밖에서 마우스를 놓아도 막대가 다시 재생 위치를 따라간다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(LONG));
    await expectPlaying(page, 0.2);
    const slider = positionSlider(page);
    const box = await slider.boundingBox();
    expect(box, '막대가 화면에 있어야 합니다').not.toBeNull();
    if (!box) return;
    const y = box.y + box.height / 2;
    // 놓는 자리는 막대에서 충분히 먼 곳(화면 안에서 아래쪽, 모자라면 위쪽)이다.
    const viewport = page.viewportSize();
    const outsideY = viewport && y + 160 < viewport.height ? y + 160 : Math.max(2, y - 160);
    expect(Math.abs(outsideY - y), '놓는 자리가 막대 밖이어야 합니다').toBeGreaterThan(box.height);

    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.6, y, { steps: 6 });
    await page.mouse.move(box.x + box.width * 0.6, outsideY, { steps: 6 });
    await page.mouse.up();

    // 끌던 곳(60%, 약 36초)에서 재생이 이어지고, 막대는 끌던 값에 붙잡히지 않고 재생 위치를 따라 앞으로 간다.
    await expect.poll(async () => (await currentFileElement(page))?.currentTime ?? 0, { timeout: 5000 }).toBeGreaterThan(28);
    const released = Number(await slider.inputValue());
    await expect
      .poll(async () => Number(await slider.inputValue()), { timeout: 5000, message: '막대 밖에서 놓은 뒤에도 막대가 앞으로 가야 합니다' })
      .toBeGreaterThan(released + 0.8);
  });

  test('수용 기준 2: 놓는 신호가 막대가 아니라 창으로 와도 막대가 다시 재생 위치를 따라간다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(LONG));
    await expectPlaying(page, 0.2);
    const slider = positionSlider(page);
    const box = await slider.boundingBox();
    expect(box, '막대가 화면에 있어야 합니다').not.toBeNull();
    if (!box) return;
    const y = box.y + box.height / 2;

    // Chromium 은 막대를 잡은 채 밖에서 놓아도 놓는 신호를 막대로 돌려준다. 그렇지 않은 브라우저를 흉내 내려고
    // 마우스를 놓는 대신 창에 직접 pointerup 을 보낸다(막대 쪽 핸들러만으로는 이 신호를 듣지 못한다).
    await page.mouse.move(box.x + box.width * 0.2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.5, y, { steps: 6 });
    await expect.poll(async () => (await currentFileElement(page))?.currentTime ?? 0, { timeout: 5000 }).toBeGreaterThan(24);
    await page.evaluate(() => {
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
    });

    const released = Number(await slider.inputValue());
    await expect
      .poll(async () => Number(await slider.inputValue()), { timeout: 5000, message: '창으로 놓는 신호가 와도 막대가 앞으로 가야 합니다' })
      .toBeGreaterThan(released + 0.8);
    await page.mouse.up();
  });

  test('반복을 끈 값은 정지 뒤 다시 여는 새 요소와 다른 파일에도 이어진다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(NORMAL));
    await expectPlaying(page);
    await loopSwitchLabel(page).click();
    await expect(loopSwitch(page)).not.toBeChecked();

    await fileButton(page, '정지').click();
    await expectIdleWithFile(page, NORMAL);
    await expect(loopSwitch(page), '정지해도 스위치는 그대로다').not.toBeChecked();
    await fileButton(page, '재생').click();
    await expect.poll(async () => (await readFileMedia(page)).elements.length, { message: '새 세션: 새 요소' }).toBe(2);
    expect((await readFileMedia(page)).elements[1].loop, '새 요소도 반복을 끈 채로 시작한다').toBe(false);

    await page.setInputFiles('#audio-file', fixturePath(SHORT));
    await expect.poll(async () => (await readFileMedia(page)).elements.length, { message: '다른 파일: 새 요소' }).toBe(3);
    expect((await readFileMedia(page)).elements[2].loop, '다른 파일도 반복을 끈 채로 시작한다').toBe(false);
    await expect(loopSwitch(page)).not.toBeChecked();

    // 다시 켜면 그다음 요소부터 반복으로 시작한다.
    await loopSwitchLabel(page).click();
    await expect(loopSwitch(page)).toBeChecked();
    await fileButton(page, '정지').click();
    await fileButton(page, '재생').click();
    await expect.poll(async () => (await readFileMedia(page)).elements.length).toBe(4);
    expect((await readFileMedia(page)).elements[3].loop, '다시 켜면 새 요소도 반복으로 시작한다').toBe(true);
  });

  test('수용 기준 2: 반복을 끄고 끝까지 탐색하면 끝에서 멈춘다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(LONG));
    await expectPlaying(page, 0.2);
    await loopSwitchLabel(page).click();
    await positionSlider(page).fill('55');
    await fileButton(page, '앞으로 10초').click();
    await expect
      .poll(async () => {
        const element = await currentFileElement(page);
        return element !== null && element.paused && element.currentTime >= element.duration - 0.2;
      }, { timeout: 8000, message: '끝을 넘는 이동은 끝에서 멈춘다' })
      .toBe(true);
    await expect(filePlayer(page)).toContainText('1:00 / 1:00');
    await expect(fileButton(page, '재생')).toBeEnabled();
  });

  test('수용 기준 3: Space 는 재생/일시정지이고 마이크는 켜지지 않는다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(NORMAL));
    await expectPlaying(page);
    await releaseFocus(page);

    await page.keyboard.press('Space');
    await expect.poll(async () => (await currentFileElement(page))?.paused, { message: 'Space 로 일시정지' }).toBe(true);
    await expect(fileButton(page, '재생')).toBeEnabled();
    await expect(fileButton(page, '일시정지')).toBeDisabled();
    await expect(filePlayer(page), '일시정지해도 파일은 그대로다').toContainText(NORMAL);

    await page.keyboard.press('Space');
    await expect.poll(async () => (await currentFileElement(page))?.paused, { message: 'Space 로 다시 재생' }).toBe(false);
    await expect(fileButton(page, '일시정지')).toBeEnabled();
    expect((await readFileMedia(page)).elements, '일시정지·재생은 같은 요소다').toHaveLength(1);

    // 정지(세션 끝) 뒤에 Space: 마이크가 켜지는 것이 아니라 열어 둔 파일을 처음부터 다시 튼다.
    await fileButton(page, '정지').click();
    await expectIdleWithFile(page, NORMAL);
    await releaseFocus(page);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readFileMedia(page)).elements.length, { message: '새 세션: 새 요소' }).toBe(2);
    await expectPlaying(page);
    await expect(fileButton(page, '일시정지')).toBeEnabled();

    // 긴급 정지(Esc) 뒤에도 같다.
    await releaseFocus(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('.toast', { hasText: '긴급 정지했습니다' })).toBeVisible();
    await expectIdleWithFile(page, NORMAL);
    await releaseFocus(page);
    await page.keyboard.press('Space');
    await expect.poll(async () => (await readFileMedia(page)).elements.length, { message: '긴급 정지 뒤에도 파일로 다시 시작' }).toBe(3);
    await expectPlaying(page);

    const tracking = await readAudioTracking(page);
    expect(tracking.getUserMediaCalls, 'Space 를 몇 번을 눌러도 마이크는 한 번도 요청하지 않는다').toBe(0);
    expect(tracking.inputTracks, '입력 트랙도 없다').toEqual([]);
    expect(tracking.maxOpenContexts, '오디오 컨텍스트는 한 번에 하나').toBe(1);
  });

  test('Space: 열린 파일이 없으면 예전처럼 기타를 연결하고, 파일을 닫으면 그렇게 돌아온다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await releaseFocus(page);
    await page.keyboard.press('Space');
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    expect((await readAudioTracking(page)).getUserMediaCalls, '파일이 없으면 Space 는 마이크를 연결한다').toBe(1);
    await releaseFocus(page);
    await page.keyboard.press('Space');
    await expect(page.getByRole('button', { name: '기타 연결하기' })).toBeVisible();

    // 파일을 열었다가 '파일 닫기' 를 누르면 다시 기타 연결이다.
    await page.setInputFiles('#audio-file', fixturePath(NORMAL));
    await expectPlaying(page);
    await closeFileButton(page).click();
    await expect(filePlayer(page)).toContainText(EMPTY_FILE_TEXT);
    await releaseFocus(page);
    await page.keyboard.press('Space');
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    expect((await readAudioTracking(page)).getUserMediaCalls, '파일을 닫은 뒤의 Space 는 다시 기타 연결').toBe(2);
  });

  test('수용 기준 4: 정지한 뒤 다시 재생해도 같은 파일이 새 <audio> 요소로 재생되고, 이전 Object URL 은 해제된다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await openFileThroughButton(page, fixturePath(NORMAL));
    await expectPlaying(page);
    let reading = await readFileMedia(page);
    expect(reading.elements).toHaveLength(1);
    expect(reading.createdUrls).toHaveLength(1);
    const firstUrl = reading.createdUrls[0];
    expect(reading.elements[0].url).toBe(firstUrl);

    // 정지: 세션은 끝나고(컨텍스트 닫힘, 요소는 자원을 놓음, URL 해제) 파일은 남는다.
    await fileButton(page, '정지').click();
    await expectIdleWithFile(page, NORMAL);
    await expect.poll(async () => (await readAudioTracking(page)).contexts.map((context) => context.state), { message: '정지하면 컨텍스트가 닫힌다' }).toEqual(['closed']);
    reading = await readFileMedia(page);
    expect(reading.revokedUrls, '정지하면 Object URL 을 해제한다').toContain(firstUrl);
    expect(reading.elements[0].hasSrcAttribute, '옛 요소는 자원을 놓았다').toBe(false);
    expect(reading.elements[0].paused).toBe(true);

    // 다시 재생: 같은 파일, 새 요소, 새 URL, 처음부터.
    await fileButton(page, '재생').click();
    await expectPlaying(page, 0.1);
    reading = await readFileMedia(page);
    expect(reading.elements, '새 세션은 새 <audio> 요소를 만든다').toHaveLength(2);
    expect(reading.createdUrls, '새 Object URL').toHaveLength(2);
    expect(reading.createdUrls[1]).not.toBe(firstUrl);
    expect(reading.elements[1].url).toBe(reading.createdUrls[1]);
    expect(reading.elements[1].currentTime, '처음부터 다시 튼다').toBeLessThan(3);
    await expect(filePlayer(page)).toContainText(NORMAL);
    expect((await readAudioTracking(page)).contexts.map((context) => context.state)).toEqual(['closed', 'running']);

    // 같은 파일을 파일 선택 창에서 다시 골라도(브라우저는 같은 값이면 change 를 주지 않는다 — 앱이 값을 비운다) 다시 열린다.
    const secondUrl = reading.createdUrls[1];
    await openFileThroughButton(page, fixturePath(NORMAL));
    await expect.poll(async () => (await readFileMedia(page)).elements.length, { message: '같은 파일을 다시 열면 새 세션' }).toBe(3);
    await expectPlaying(page, 0.1);
    reading = await readFileMedia(page);
    expect(reading.revokedUrls, '다시 열면 이전 URL 을 해제한다').toContain(secondUrl);
    expect(reading.revokedUrls, '현재 세션의 URL 은 해제하지 않는다').not.toContain(reading.createdUrls[2]);
    const tracking = await readAudioTracking(page);
    expect(tracking.maxOpenContexts, '컨텍스트는 한 번에 하나').toBe(1);
    expect(tracking.getUserMediaCalls).toBe(0);
  });

  test('다른 파일을 열면 이전 파일을 놓고, 파일 닫기는 파일을 놓는다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(NORMAL));
    await expectPlaying(page);
    const first = (await readFileMedia(page)).createdUrls[0];

    await page.setInputFiles('#audio-file', fixturePath('ref-sine-1k.wav'));
    await expect(filePlayer(page)).toContainText('ref-sine-1k.wav');
    await expect.poll(async () => (await readFileMedia(page)).elements.length).toBe(2);
    await expectPlaying(page);
    let reading = await readFileMedia(page);
    expect(reading.revokedUrls, '다른 파일을 열면 이전 파일의 URL 을 해제한다').toContain(first);
    const second = reading.createdUrls[1];

    await closeFileButton(page).click();
    await expect(filePlayer(page)).toContainText(EMPTY_FILE_TEXT);
    await expect(closeFileButton(page)).toBeDisabled();
    await expect(fileButton(page, '재생'), '닫은 파일은 재생할 수 없다').toBeDisabled();
    await expect(fileButton(page, '정지')).toBeDisabled();
    await expect(positionSlider(page)).toBeDisabled();
    reading = await readFileMedia(page);
    expect(reading.revokedUrls, '파일 닫기는 재생을 멈추고 URL 을 해제한다').toContain(second);
    expect(reading.elements[1].paused).toBe(true);
    await expect.poll(async () => (await readAudioTracking(page)).contexts.map((context) => context.state)).toEqual(['closed', 'closed']);
  });

  test('기타를 연결하면 열어 둔 파일은 놓는다(연결이 끝나도 되살아나지 않는다)', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic);
    await page.setInputFiles('#audio-file', fixturePath(NORMAL));
    await expectPlaying(page);
    await fileButton(page, '정지').click();
    await expectIdleWithFile(page, NORMAL);

    await connectGuitar(page);
    await disconnectButton(page).click();
    await expect(page.getByRole('button', { name: '기타 연결하기' })).toBeVisible();
    await expect(filePlayer(page), '기타를 연결했다 끊으면 파일은 이미 놓인 상태다').toContainText(EMPTY_FILE_TEXT);
    await expect(fileButton(page, '재생')).toBeDisabled();

    // 놓은 파일이 보이지 않게만 남아 있지 않다: 이제 Space 는 (보이지 않는 옛 파일이 아니라) 기타를 연결한다.
    const gumBefore = (await readAudioTracking(page)).getUserMediaCalls;
    const elementsBefore = (await readFileMedia(page)).elements.length;
    await releaseFocus(page);
    await page.keyboard.press('Space');
    await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
    expect((await readAudioTracking(page)).getUserMediaCalls, '기타 연결 뒤의 Space 는 마이크를 다시 연결한다').toBe(gumBefore + 1);
    expect((await readFileMedia(page)).elements, '옛 파일의 새 요소가 만들어지지 않는다').toHaveLength(elementsBefore);
  });

  test('휴대폰: 입력 탭에서 한국어 버튼으로 열고, 재생·일시정지·정지·다시 재생이 된다', async ({ launchWithMic }) => {
    const page = await openTracked(launchWithMic, PHONE);
    await setMobileDock(page, true);
    await expect(openFileButton(page)).toBeVisible();
    await expect(page.locator('#audio-file')).toBeHidden();
    await openFileThroughButton(page, fixturePath(NORMAL));
    await expectPlaying(page);
    await expect(filePlayer(page)).toContainText(NORMAL);

    await fileButton(page, '일시정지').click();
    await expect.poll(async () => (await currentFileElement(page))?.paused).toBe(true);
    await fileButton(page, '재생').click();
    await expect.poll(async () => (await currentFileElement(page))?.paused).toBe(false);
    await fileButton(page, '정지').click();
    await expectIdleWithFile(page, NORMAL);
    await fileButton(page, '재생').click();
    await expect.poll(async () => (await readFileMedia(page)).elements.length).toBe(2);
    await expectPlaying(page, 0.1);

    // 다른 탭으로 갔다 와도 파일 상태는 그대로다(패널은 계속 그려져 있다).
    await selectMobileTab(page, 'meter');
    await selectMobileTab(page, 'input');
    await expect(filePlayer(page)).toContainText(NORMAL);
    expect(await horizontalOverflow(page), '휴대폰에서 가로로 넘치지 않는다').toBe(0);
    expect((await readAudioTracking(page)).getUserMediaCalls).toBe(0);
  });
});
