// E-00: 하네스 자체 시험. 도우미와 모의가 제대로 동작하는지 앱과 무관하게(또는 앱을 열어) 확인한다.
// 이후 Step 의 시나리오(E-01~E-22)가 이 도우미를 믿고 쓸 수 있어야 한다.
import { connectGuitar, openApp } from '../helpers/app';
import { BASE_URL } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { overlapsInCard, reachable, reachableAboveDock, visibleKnobs, visibleRatio } from '../helpers/geometry';
import { describeItem, measureContrast, pickBackground, type ColorBucket } from '../helpers/text-metrics';
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

  test('E-00 도우미: reachableAboveDock 은 도크 위로 스크롤해 닿는지, 도크에 가려지는지를 가려낸다', async ({ page }) => {
    await page.setViewportSize({ width: 300, height: 400 });
    // 문서는 길고, 아래쪽에 화면 절반(200px)을 덮는 도크가 고정되어 있다. 문서 끝에는 도크 높이만큼 여백이 있다.
    await page.setContent(`
      <style>body{margin:0;padding-bottom:200px} .tall{height:2000px;position:relative} .box{position:absolute;left:10px;width:80px;height:40px}
        .dock{position:fixed;left:0;right:0;bottom:0;height:200px;background:#222} #behind{position:fixed;left:10px;bottom:20px;width:80px;height:40px}</style>
      <div class="tall"><button id="mid" class="box" style="top:900px">mid</button><button id="last" class="box" style="top:1950px">last</button></div>
      <button id="behind">behind dock</button>
      <div class="dock mobile-control-dock"></div>`);
    // 요소를 화면 한가운데로 옮기는 reachable 은 가운데 점이 도크 위쪽 끝(y=200)에 걸려 '가려짐'으로 나온다 — 이 도우미가 필요한 이유다.
    expect(await reachable(page.locator('#mid'))).toMatchObject({ reachable: false, reason: 'covered' });
    // 도크 위 빈 영역의 가운데로 옮기면 닿는다.
    const mid = await reachableAboveDock(page.locator('#mid'));
    expect(mid).toMatchObject({ reachable: true, boxAboveDock: true, freeHeight: 200 });
    // 문서 맨 끝의 요소도 끝까지 스크롤하면 도크 위 빈 영역에 놓인다(바닥 여백 덕분).
    const last = await reachableAboveDock(page.locator('#last'));
    expect(last).toMatchObject({ reachable: true, boxAboveDock: true });
    // 도크 뒤에 고정된 요소는 아무리 스크롤해도 닿지 않는다.
    const behind = await reachableAboveDock(page.locator('#behind'));
    expect(behind.reachable).toBe(false);
    expect(behind.boxAboveDock).toBe(false);
    // 도크가 없으면 화면 전체가 빈 영역이다.
    await page.evaluate(() => document.querySelector('.mobile-control-dock')?.remove());
    expect(await reachableAboveDock(page.locator('#mid'))).toMatchObject({ reachable: true, boxAboveDock: true, freeHeight: 400 });
  });

  test('E-00 도우미: visibleKnobs 는 도크 위에 상자가 통째로 들어온 노브만 센다', async ({ page }) => {
    await page.setViewportSize({ width: 300, height: 400 });
    await page.setContent(`
      <style>body{margin:0} .pedal-card{position:absolute;left:0;top:0;width:300px;height:1000px}
        input{position:absolute;margin:0;width:40px;height:40px;opacity:0}
        .dock{position:fixed;left:0;right:0;bottom:0;height:150px;background:#222}</style>
      <article class="pedal-card">
        <input type="range" aria-label="위" style="left:10px;top:20px">
        <input type="range" aria-label="가장자리" style="left:10px;top:200px">
        <input type="range" aria-label="걸침" style="left:10px;top:230px">
        <input type="range" aria-label="도크 뒤" style="left:100px;top:300px">
        <input type="range" aria-label="오른쪽 밖" style="left:280px;top:20px">
      </article>
      <div class="dock mobile-control-dock"></div>`);
    // 도크 위 빈 영역은 0~250px. '위'(20~60)와 '가장자리'(200~240)는 통째로 들어오고, '걸침'(230~270)과 '도크 뒤'(300~340)와 '오른쪽 밖'(280~320 가로)은 아니다.
    const report = await visibleKnobs(page);
    expect(report.total).toBe(5);
    expect(report.fullyVisible).toBe(2);
    expect(report.labels).toEqual(['위', '가장자리']);
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

  // 글자 대비 측정의 배경 고르기(S4.5, E-21). CI(DejaVu Sans)에서 글로우 위의 글자가 대비 1.00:1 로 잘못 잡혀 배포가 막힌 일이 있었다.
  test('E-00 도우미: pickBackground 는 글로우로 갈라진 어두운 배경을 글자색보다 먼저 고른다', () => {
    const bucket = (n: number, rgb: readonly number[]): ColorBucket => ({ n, r: rgb[0] * n, g: rgb[1] * n, b: rgb[2] * n });
    const fg = [219, 255, 193];
    // 글자 칸 12 %, 어두운 배경이 5비트 칸 9개로 갈라져 한 칸은 모두 10 % 미만(합 88 % 가운데 가장 큰 칸 9.5 %)
    const text = bucket(12, fg);
    const dark = [bucket(9.5, [42, 83, 22]), bucket(9.5, [37, 76, 20]), bucket(9.5, [52, 99, 28]), bucket(9.5, [49, 93, 26]), bucket(9.5, [46, 90, 25]),
      bucket(9.5, [60, 110, 32]), bucket(9.5, [66, 120, 36]), bucket(9.5, [72, 128, 40]), bucket(9.5, [80, 140, 44])];
    const counts = new Map<number, ColorBucket>([[0, text], ...dark.map((entry, index) => [index + 1, entry] as const)]);
    const pick = pickBackground(counts, fg);
    expect(pick, '글자 칸이 가장 커도 먼 색이 절반 이상이면 그 가운데 가장 큰 칸이 배경').toBe(dark[0]);
    // 한 칸이 상자의 10 % 이상이면 예전과 같이 그 칸(글자 칸보다 작아도)
    const solid = new Map<number, ColorBucket>([[0, bucket(40, fg)], [1, bucket(11, [20, 30, 20])], [2, bucket(9, [90, 120, 60])]]);
    expect(pickBackground(solid, fg)).toBe(solid.get(1));
  });

  test('E-00 도우미: pickBackground 는 글자색과 배경이 정말 비슷하거나 글자가 상자를 덮으면 글자 칸을 돌려줘 위반으로 잡히게 한다', () => {
    const bucket = (n: number, rgb: readonly number[]): ColorBucket => ({ n, r: rgb[0] * n, g: rgb[1] * n, b: rgb[2] * n });
    // 배경 회색 150 · 글자 회색 136(거리 24): 먼 색 없음 → 가장 많은 칸(배경)이어서 대비가 낮게 나온다
    const gray = new Map<number, ColorBucket>([[0, bucket(70, [150, 150, 150])], [1, bucket(30, [136, 136, 136])]]);
    expect(pickBackground(gray, [136, 136, 136])).toBe(gray.get(0));
    // 먼 색이 있어도 합이 절반 미만(글자가 상자의 60 %)이면 가장 많은 칸 = 글자 칸 → 대비 1 → 위반으로 잡힌다
    const covered = new Map<number, ColorBucket>([[0, bucket(60, [219, 255, 193])], [1, bucket(5, [30, 50, 20])], [2, bucket(5, [32, 52, 22])], [3, bucket(5, [44, 80, 30])],
      [4, bucket(5, [46, 82, 30])], [5, bucket(5, [60, 100, 40])], [6, bucket(5, [62, 102, 40])], [7, bucket(5, [70, 120, 44])], [8, bucket(5, [72, 122, 44])], [9, bucket(5, [80, 140, 50])]]);
    expect(pickBackground(covered, [219, 255, 193])).toBe(covered.get(0));
    expect(pickBackground(new Map(), [0, 0, 0])).toBeNull();
  });

  test('E-00 도우미: measureContrast 는 낮은 대비 글자만 가려내고 어두운 바탕의 밝은 글자는 통과시킨다', async ({ page }) => {
    await page.setContent(`
      <style>body{margin:0;font:700 14px sans-serif} .row{position:absolute;left:10px;white-space:nowrap}</style>
      <div style="position:absolute;left:0;top:0;width:320px;height:40px;background:#fff"></div>
      <span class="row" style="top:10px;color:#111">fine dark on white</span>
      <div style="position:absolute;left:0;top:50px;width:320px;height:40px;background:linear-gradient(90deg,#10300a,#4a8a28)"></div>
      <span class="row" style="top:60px;color:#f2ffe6;text-shadow:0 0 10px rgba(143,235,78,.68)">fine light on glow</span>
      <div style="position:absolute;left:0;top:100px;width:320px;height:40px;background:#888"></div>
      <span class="row" style="top:110px;color:#777">too faint</span>`);
    const report = await measureContrast(page);
    expect(report.measured).toBe(3);
    expect(report.failures.map(describeItem).join('\n')).toContain('too faint');
    expect(report.failures).toHaveLength(1);
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
    // 미터 이름은 '입력 레벨'·'출력 레벨'(S4.6 에서 영어 섞임을 없앴다).
    expect(labels.join(' ')).toContain('출력 레벨');
    const output = page.getByRole('meter', { name: '출력 레벨' });
    await expect
      .poll(async () => Number(await output.getAttribute('aria-valuenow')), {
        message: '가짜 마이크 신호가 출력 미터를 움직여야 합니다',
        timeout: 20_000,
      })
      .toBeGreaterThan(0);
  });
});
