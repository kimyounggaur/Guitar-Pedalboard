// E-00: 하네스 자체 시험. 도우미와 모의가 제대로 동작하는지 앱과 무관하게(또는 앱을 열어) 확인한다.
// 이후 Step 의 시나리오(E-01~E-22)가 이 도우미를 믿고 쓸 수 있어야 한다.
import { connectGuitar, openApp } from '../helpers/app';
import { BASE_URL } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { overlapsInCard, reachable, visibleRatio } from '../helpers/geometry';
import {
  bringOtherTabToFront,
  GET_USER_MEDIA_ERRORS,
  mockGetUserMediaError,
  mockMidi,
  mockStorage,
  readAudioTracking,
  setHidden,
  trackAudioContexts,
} from '../helpers/mocks';

test.describe('E-00 하네스', () => {
  test('E-00 도우미: reachable 은 가려진 요소와 화면 밖 요소를 가려낸다', async ({ page }) => {
    await page.setContent(`
      <style>body{margin:0} .box{position:absolute;width:80px;height:40px}</style>
      <button id="free" class="box" style="left:10px;top:10px">free</button>
      <button id="covered" class="box" style="left:10px;top:80px">covered</button>
      <div id="cover" class="box" style="left:0;top:70px;width:200px;height:60px;background:#ccc"></div>
      <button id="far" class="box" style="left:10px;top:3000px">far</button>
      <button id="gone" hidden>gone</button>`);
    expect(await reachable(page.locator('#free'))).toMatchObject({ reachable: true });
    expect(await reachable(page.locator('#covered'))).toMatchObject({ reachable: false, reason: 'covered', blockedBy: 'div.box' });
    // 화면 가운데로 스크롤하므로 아래쪽 요소도 닿는다.
    expect(await reachable(page.locator('#far'))).toMatchObject({ reachable: true });
    expect(await reachable(page.locator('#gone'))).toMatchObject({ reachable: false, reason: 'hidden' });
  });

  test('E-00 도우미: visibleRatio 는 덮인 만큼만 센다', async ({ page }) => {
    await page.setContent(`
      <style>body{margin:0} .box{position:absolute}</style>
      <div id="target" class="box" style="left:0;top:0;width:100px;height:100px;background:#09f"></div>
      <div class="box" style="left:50px;top:0;width:50px;height:100px;background:#f90"></div>`);
    const ratio = await visibleRatio(page.locator('#target'), { scroll: 'none' });
    expect(ratio).toBeGreaterThan(0.45);
    expect(ratio).toBeLessThan(0.55);
  });

  test('E-00 도우미: overlapsInCard 는 겹친 글자 상자를 센다', async ({ page }) => {
    await page.setContent(`
      <style>body{margin:0;font:16px sans-serif} .row{position:absolute;white-space:nowrap}</style>
      <article id="card">
        <span class="row" style="left:10px;top:10px">첫째 글자</span>
        <span class="row" style="left:14px;top:12px">겹친 글자</span>
        <span class="row" style="left:10px;top:100px">멀리 있는 글자</span>
      </article>`);
    const report = await overlapsInCard(page.locator('#card'));
    expect(report.count).toBe(1);
    expect(report.boxes).toBe(3);
  });

  test('E-00 모의: 저장소 차단과 가득 참', async ({ page }) => {
    await mockStorage(page, 'blocked');
    await page.goto('about:blank');
    await page.goto('./');
    expect(await page.evaluate(() => {
      try {
        void window.localStorage;
        return 'ok';
      } catch (error) {
        return (error as DOMException).name;
      }
    })).toBe('SecurityError');

    const quotaPage = await page.context().newPage();
    await mockStorage(quotaPage, 'quota');
    await quotaPage.goto('./');
    expect(await quotaPage.evaluate(() => {
      window.localStorage.getItem('x');
      try {
        window.localStorage.setItem('x', '1');
        return 'ok';
      } catch (error) {
        return (error as DOMException).name;
      }
    })).toBe('QuotaExceededError');
    // sessionStorage 는 영향이 없다.
    expect(await quotaPage.evaluate(() => {
      window.sessionStorage.setItem('x', '1');
      return window.sessionStorage.getItem('x');
    })).toBe('1');
  });

  test('E-00 모의: Web MIDI 장치 연결·메시지·분리', async ({ page }) => {
    const midi = await mockMidi(page);
    await page.goto('./');
    const result = await page.evaluate(async () => {
      const access = await navigator.requestMIDIAccess({ sysex: false });
      const log: string[] = [];
      access.onstatechange = (event) => log.push(`state:${event.port?.name}:${event.port?.state}`);
      (window as unknown as { __access: MIDIAccess; __log: string[] }).__access = access;
      (window as unknown as { __log: string[] }).__log = log;
      return access.inputs.size;
    });
    expect(result).toBe(0);

    const id = await midi.connect('Mock Controller');
    await page.evaluate((inputId) => {
      const access = (window as unknown as { __access: MIDIAccess }).__access;
      const log = (window as unknown as { __log: string[] }).__log;
      access.inputs.get(inputId)!.onmidimessage = (event) => log.push(`msg:${Array.from(event.data ?? []).join(',')}`);
    }, id);
    await midi.send(id, [0xb0, 64, 127]);
    await midi.disconnect(id);
    const log = await page.evaluate(() => (window as unknown as { __log: string[] }).__log);
    expect(log).toEqual(['state:Mock Controller:connected', 'msg:176,64,127', 'state:Mock Controller:disconnected']);
    expect(await midi.stats()).toEqual({ requests: 1, connectedInputs: 0 });
  });

  test('E-00 모의: 문서 숨김은 값과 이벤트를 함께 바꾼다', async ({ page }) => {
    await page.goto('./');
    await page.evaluate(() => {
      (window as unknown as { __events: string[] }).__events = [];
      document.addEventListener('visibilitychange', () => (window as unknown as { __events: string[] }).__events.push(document.visibilityState));
    });
    await setHidden(page, true);
    expect(await page.evaluate(() => [document.visibilityState, document.hidden])).toEqual(['hidden', true]);
    await setHidden(page, true); // 같은 값이면 이벤트를 또 일으키지 않는다
    await setHidden(page, false);
    expect(await page.evaluate(() => (window as unknown as { __events: string[] }).__events)).toEqual(['hidden', 'visible']);
    // 두 번째 탭을 앞으로: 헤드리스에서는 첫 탭의 가시성이 바뀌지 않을 수 있다(그래서 setHidden 모의를 같이 둔다).
    const { other, hiddenAfter } = await bringOtherTabToFront(page);
    expect(typeof hiddenAfter).toBe('boolean');
    await other.close();
  });

  test('E-00 모의: getUserMedia 오류 7종은 이름 그대로 거부된다', async ({ browser }) => {
    for (const name of GET_USER_MEDIA_ERRORS) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await mockGetUserMediaError(page, name);
      // mediaDevices 는 보안 컨텍스트(localhost)에서만 있으므로 앱 주소에서 확인한다.
      await page.goto(BASE_URL);
      const rejected = await page.evaluate(async () => {
        try {
          await navigator.mediaDevices.getUserMedia({ audio: true });
          return 'resolved';
        } catch (error) {
          return (error as Error).name;
        }
      });
      expect(rejected).toBe(name);
      await context.close();
    }
  });

  test('E-00 추적: AudioContext 와 getUserMedia 호출을 센다', async ({ page }) => {
    await trackAudioContexts(page);
    await page.goto('./');
    expect(await readAudioTracking(page)).toMatchObject({ contexts: [], getUserMediaCalls: 0 });
    await page.evaluate(async () => {
      const context = new AudioContext();
      void context;
      await navigator.mediaDevices.getUserMedia({ audio: true });
    });
    const tracking = await readAudioTracking(page);
    expect(tracking.contexts).toHaveLength(1);
    expect(tracking.getUserMediaCalls).toBe(1);
  });

  test('E-00 가짜 마이크: WAV 가 입력으로 들어와 출력 미터가 반응한다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('ref-pc.wav');
    await openApp(page);
    await connectGuitar(page);
    const meters = page.getByRole('meter');
    const labels = await meters.evaluateAll((elements) => elements.map((element) => element.getAttribute('aria-label')));
    // 지금 앱의 미터 이름은 'Input 레벨'·'Output 레벨'(영어 섞임). 문구를 바꾸는 Step(S4.6)에서 이 이름도 같이 바꾼다.
    expect(labels.join(' ')).toContain('Output 레벨');
    const output = page.getByRole('meter', { name: 'Output 레벨' });
    await expect
      .poll(async () => Number(await output.getAttribute('aria-valuenow')), {
        message: '가짜 마이크 신호가 출력 미터를 움직여야 합니다',
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
  });
});
