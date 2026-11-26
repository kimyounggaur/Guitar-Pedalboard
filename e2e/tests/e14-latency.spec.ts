// E-14 지연·끊김 표시(설계서 S2.10, R2-10, D11). 실제 Chromium 에서 입력·처리·출력 지연과 끊김 수가 화면에 어떻게 보이는지 본다.
//   ① 연결하면 입력·처리·출력이 따로 보이고, 입력과 처리가 합계에 들어간다. 처리는 켜진 페달(+리미터)만 더하므로 페달을 끄면 줄어든다.
//   ② 시험 전용 부하 워클릿으로 오디오 스레드를 막으면(실제 과부하) 화면의 끊김 수가 context.playbackStats.underrunEvents 의 증가분과 같다.
//   ③ playbackStats 가 없는 환경(모의)에서는 끊김이 '측정 불가'이고 이유가 툴팁에 있다. 연결 전에는 '--' 다.
//   ④ 입력·출력을 못 읽는 환경(모의)에서는 해당 항목이 '미포함'이고 합계에서 빠진다.
//   ⑤ 합계가 크면 '지연을 줄이려면: …' 안내가 나오고, 화면(문구·툴팁·속성 포함)과 README 어디에도 'ASIO' 가 없다.
//   ⑥ 세션을 시작하기 전에 이미 쌓여 있던 끊김은 세지 않는다(장치 모드). 시작한 뒤의 증가분만 보인다.
//   ⑦ 음원 파일 모드에서도 같다. 입력은 '입력 없음(음원 파일)' 이다.
//   ⑧ 휴대폰 화면에서 새 문구가 가로로 넘치지 않는다.
// 숫자(단위 변환·합계·경계·표 값)를 하나하나 맞추는 쪽은 Node 시험(scripts/latency-regression.mjs)이다. 여기서는 브라우저가 실제로 주는 값이 화면에 맞게 나오는지 본다.
// 지연·끊김 수는 1초마다 다시 읽으므로(설계서 4.12) 값을 기다릴 때는 poll 을 쓴다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { connectGuitar, horizontalOverflow, openApp, openAudioInputMenu, setMobileDock } from '../helpers/app';
import { fixturePath, repoRoot } from '../helpers/env';
import { openFileThroughButton } from '../helpers/file-media';
import { expect, test } from '../helpers/fixtures';
import { stompOf } from '../helpers/storage';

const REPO = repoRoot;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

const ADVICE = '지연을 줄이려면: 유선 헤드폰 사용 · 블루투스 끄기 · 다른 오디오 앱 닫기 · 인터페이스를 48 kHz로 설정 · 노트북 전원 연결';

const headline = (page: Page): Locator => page.locator('.latency-status > span').first();
const itemOf = (page: Page, key: 'input' | 'processing' | 'output'): Locator => page.locator(`.latency-status .latency-item-${key}`);
const underrunOutput = (page: Page): Locator => page.locator('.performance-status .underrun-count');
const compactLatency = (page: Page): Locator => page.locator('.performance-status > span', { hasText: '지연' }).locator('output');
const underrunLabel = (page: Page): Locator => page.locator('.performance-status > span', { has: page.locator('.underrun-count') });

interface Parsed {
  total: number;
  rateKhz: number;
}

/** '지연 약 24.0 ms @ 44.1 kHz' 에서 합계와 샘플레이트를 읽는다. */
async function readHeadline(page: Page): Promise<Parsed> {
  const text = (await headline(page).textContent()) ?? '';
  const found = /지연 약 ([\d.]+) ms @ ([\d.]+) kHz/.exec(text);
  expect(found, `헤드라인 형식: ${text}`).not.toBeNull();
  return { total: Number(found?.[1]), rateKhz: Number(found?.[2]) };
}

async function readNumber(locator: Locator, pattern: RegExp): Promise<number> {
  const text = (await locator.textContent()) ?? '';
  const found = pattern.exec(text);
  expect(found, `${text} 가 ${String(pattern)} 에 맞는다`).not.toBeNull();
  return Number(found?.[1]);
}

/** P-16 기준선: 지정한 샘플레이트에서 기본 페달 중 지연을 더하는 것(Drive·Cab)의 합(ms) */
function baselinePedalsMs(rateKhz: number): number {
  const baseline = JSON.parse(readFileSync(join(REPO, 'docs', 'baseline', 'audio-probe.json'), 'utf8')) as {
    results: Record<string, { 'P-16': { metrics: Record<string, number> } }>;
  };
  const metrics = baseline.results[String(Math.round(rateKhz * 1000))]?.['P-16'].metrics;
  expect(metrics, `기준선에 ${rateKhz} kHz 가 있다`).toBeDefined();
  return (metrics?.['latencyMs.drive'] ?? 0) + (metrics?.['latencyMs.cab'] ?? 0) - 2 * (metrics?.['latencyMs.empty'] ?? 0);
}

/** 앱이 만드는 AudioContext 를 시험이 잡을 수 있게 모아 둔다(window.__e14Contexts). */
async function exposeAudioContexts(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const created: AudioContext[] = [];
    Object.defineProperty(window, '__e14Contexts', { configurable: true, value: created });
    const Native = window.AudioContext;
    const Wrapped = function (this: unknown, ...args: ConstructorParameters<typeof AudioContext>) {
      const instance = Reflect.construct(Native, args, new.target ?? Wrapped) as AudioContext;
      created.push(instance);
      return instance;
    } as unknown as typeof AudioContext;
    Wrapped.prototype = Native.prototype;
    Object.setPrototypeOf(Wrapped, Native);
    window.AudioContext = Wrapped;
  });
}

/** 지금 열려 있는 컨텍스트의 playbackStats.underrunEvents(브라우저가 1초마다 갱신) */
async function rawUnderruns(page: Page): Promise<number> {
  return page.evaluate(() => {
    const contexts = (window as unknown as { __e14Contexts: AudioContext[] }).__e14Contexts;
    const live = contexts.filter((context) => context.state !== 'closed');
    return (live[live.length - 1] as AudioContext & { playbackStats: { underrunEvents: number } }).playbackStats.underrunEvents;
  });
}

/** 열린 컨텍스트의 오디오 스레드를 `busyMs` 만큼 막는 워클릿(시험 전용 부하)을 `durationMs` 동안 돌린다. */
async function overload(page: Page, busyMs: number, durationMs: number): Promise<void> {
  await page.evaluate(
    async ({ busy, duration }) => {
      const contexts = (window as unknown as { __e14Contexts: AudioContext[] }).__e14Contexts;
      const context = contexts.filter((candidate) => candidate.state !== 'closed').pop() as AudioContext;
      const source = `class E14Load extends AudioWorkletProcessor {
        constructor() { super(); this.busy = ${busy}; this.port.onmessage = (event) => { this.busy = event.data; }; }
        process() { if (this.busy > 0) { const until = Date.now() + this.busy; while (Date.now() < until) { /* 오디오 스레드를 붙잡는다 */ } } return true; }
      }
      registerProcessor('e14-load', E14Load);`;
      const url = URL.createObjectURL(new Blob([source], { type: 'text/javascript' }));
      await context.audioWorklet.addModule(url);
      const node = new AudioWorkletNode(context, 'e14-load', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1] });
      node.connect(context.destination);
      await new Promise((resolve) => setTimeout(resolve, duration));
      node.port.postMessage(0);
      node.disconnect();
      URL.revokeObjectURL(url);
    },
    { busy: busyMs, duration: durationMs },
  );
}

/** 값이 두 번 연달아 같을 때까지(브라우저의 1초 갱신 주기보다 길게) 기다렸다가 돌려준다. */
async function settledUnderruns(page: Page): Promise<number> {
  let previous = await rawUnderruns(page);
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await page.waitForTimeout(1300);
    const current = await rawUnderruns(page);
    if (current === previous) return current;
    previous = current;
  }
  throw new Error('끊김 수가 가라앉지 않았다');
}

function shownCount(text: string | null): number {
  const found = /^(\d+)회$/.exec(text?.trim() ?? '');
  expect(found, `끊김 표시 형식: ${text}`).not.toBeNull();
  return Number(found?.[1]);
}

test.describe('E-14 지연·끊김 표시', () => {
  test('E-14 ① 입력·처리·출력이 따로 보이고 입력과 처리가 합계에 들어간다. 처리는 켜진 페달만 더한다', async ({ page }) => {
    await openApp(page);
    await openAudioInputMenu(page);
    await expect(headline(page)).toHaveText('지연시간 측정 대기');
    await connectGuitar(page);
    await expect(itemOf(page, 'input')).toBeVisible();
    // 페달 그래프는 연결 직후 조금 늦게 만들어진다. 켜진 Drive·Cab 의 지연이 처리에 들어올 때까지 기다린 뒤 읽는다.
    await expect.poll(async () => readNumber(itemOf(page, 'processing'), /페달 ([\d.]+) ms/), { timeout: 6000 }).toBeGreaterThan(2);

    const { total, rateKhz } = await readHeadline(page);
    const inputText = (await itemOf(page, 'input').textContent()) ?? '';
    const processingText = (await itemOf(page, 'processing').textContent()) ?? '';
    const outputText = (await itemOf(page, 'output').textContent()) ?? '';
    // 가짜 마이크도 트랙 설정에 지연 목표치를 준다(10 ms). 어느 쪽에서 읽었는지(트랙 통계·장치 설정값)가 적혀 있다.
    expect(inputText).toMatch(/^입력 [\d.]+ ms\((트랙 통계|장치 설정값)\)$/);
    expect(processingText).toMatch(/^처리 [\d.]+ ms\(페달 [\d.]+ ms \+ 리미터 [\d.]+ ms\)$/);
    expect(outputText).toMatch(/^출력 [\d.]+ ms\(버퍼 [\d.]+ ms \+ 장치 [\d.]+ ms\)$/);

    const input = await readNumber(itemOf(page, 'input'), /^입력 ([\d.]+) ms/);
    const processing = await readNumber(itemOf(page, 'processing'), /^처리 ([\d.]+) ms/);
    const pedals = await readNumber(itemOf(page, 'processing'), /페달 ([\d.]+) ms/);
    const limiter = await readNumber(itemOf(page, 'processing'), /리미터 ([\d.]+) ms/);
    const output = await readNumber(itemOf(page, 'output'), /^출력 ([\d.]+) ms/);
    // 합계 = 입력 + 처리 + 출력(각 값을 소수 첫째 자리로 보이므로 반올림 오차를 허용한다)
    expect(Math.abs(total - (input + processing + output))).toBeLessThanOrEqual(0.2);
    expect(Math.abs(processing - (pedals + limiter))).toBeLessThanOrEqual(0.2);
    // 처리: 켜진 기본 페달 중 지연을 더하는 것은 Drive(2배 오버샘플링)와 Cab(컨볼버)이고, 값은 P-16 이 잰 기준선과 같다. 리미터는 1 ms 다.
    expect(Math.abs(pedals - baselinePedalsMs(rateKhz))).toBeLessThanOrEqual(0.15);
    expect(limiter).toBeCloseTo(1, 0);
    expect(input).toBeGreaterThanOrEqual(0);
    // 연결 상태 줄(한 줄 요약)과 미터 아래 한 줄 요약의 지연도 같은 합계다.
    await expect(page.locator('.connect-status-latency .connect-status-value')).toHaveText(`${total.toFixed(1)}ms`);
    await expect(compactLatency(page)).toHaveText(`${total.toFixed(1)}ms`);

    // Drive 를 끄면 처리 지연이 Drive 몫(약 2.7~2.9 ms)만큼 줄고, 다시 켜면 돌아온다. 1초 간격으로 다시 읽으므로 기다린다.
    await stompOf(page, 'Drive').click();
    await expect(stompOf(page, 'Drive')).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () => readNumber(itemOf(page, 'processing'), /페달 ([\d.]+) ms/), { timeout: 6000 })
      .toBeLessThan(pedals - 2);
    await stompOf(page, 'Drive').click();
    await expect(stompOf(page, 'Drive')).toHaveAttribute('aria-pressed', 'true');
    await expect
      .poll(async () => readNumber(itemOf(page, 'processing'), /페달 ([\d.]+) ms/), { timeout: 6000 })
      .toBeGreaterThan(pedals - 0.2);
  });

  test('E-14 ② 오디오 스레드를 막는 시험 부하를 걸면 화면의 끊김 수가 playbackStats.underrunEvents 의 증가분과 같다', async ({ page }) => {
    test.setTimeout(120_000);
    await exposeAudioContexts(page);
    await openApp(page);
    await openAudioInputMenu(page);
    await expect(underrunOutput(page)).toHaveText('--');
    await connectGuitar(page);
    await expect(underrunOutput(page)).toHaveText(/^\d+회$/);

    // 부하 전: 값이 가라앉은 뒤 화면과 브라우저의 값을 함께 적는다.
    const before = await settledUnderruns(page);
    await page.waitForTimeout(1300);
    const shownBefore = shownCount(await underrunOutput(page).textContent());
    expect(shownBefore, '세션 시작 때의 값이 기준선이라 화면은 브라우저 누적값보다 크지 않다').toBeLessThanOrEqual(before);

    // 실제 과부하: 오디오 스레드를 약 4 초 동안 매 렌더 덩어리마다 붙잡는다.
    await overload(page, 30, 4000);
    const after = await settledUnderruns(page);
    expect(after - before, '시험 부하가 실제로 끊김을 만들었다').toBeGreaterThan(5);
    await expect
      .poll(async () => shownCount(await underrunOutput(page).textContent()), { timeout: 8000 })
      .toBe(shownBefore + (after - before));
  });

  test('E-14 ③ playbackStats 가 없는 환경에서는 끊김이 측정 불가이고 이유가 툴팁에 있다(지연 표시는 그대로)', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(AudioContext.prototype, 'playbackStats', { configurable: true, get: () => undefined });
    });
    await openApp(page);
    await openAudioInputMenu(page);
    await expect(underrunOutput(page)).toHaveText('--');
    await connectGuitar(page);
    await expect(underrunOutput(page)).toHaveText('측정 불가');
    await expect(underrunLabel(page)).toHaveAttribute('title', /playbackStats/);
    // 끊김을 못 재도 지연은 읽는다.
    await expect(itemOf(page, 'processing')).toBeVisible();
    expect((await readHeadline(page)).total).toBeGreaterThan(0);
  });

  test('E-14 ④ 입력·출력 지연을 못 읽으면 그 항목은 미포함이고 합계에서 빠진다', async ({ page }) => {
    await page.addInitScript(() => {
      // 트랙 통계(track.stats)와 트랙 설정의 지연을 모두 뺀다. 컨텍스트의 두 출력 지연도 없는 것처럼 한다.
      Object.defineProperty(MediaStreamTrack.prototype, 'stats', { configurable: true, get: () => undefined });
      const native = MediaStreamTrack.prototype.getSettings;
      MediaStreamTrack.prototype.getSettings = function (this: MediaStreamTrack) {
        const settings = native.call(this) as MediaTrackSettings & { latency?: number };
        delete settings.latency;
        return settings;
      };
      Object.defineProperty(AudioContext.prototype, 'baseLatency', { configurable: true, get: () => undefined });
      Object.defineProperty(AudioContext.prototype, 'outputLatency', { configurable: true, get: () => undefined });
    });
    await openApp(page);
    await openAudioInputMenu(page);
    await connectGuitar(page);
    await expect(itemOf(page, 'input')).toBeVisible();
    await expect(itemOf(page, 'input')).toHaveText('입력 지연 미포함');
    await expect(itemOf(page, 'output')).toHaveText('출력 지연 미포함');
    // 합계에는 처리(페달 + 리미터)만 남는다.
    const { total } = await readHeadline(page);
    const processing = await readNumber(itemOf(page, 'processing'), /^처리 ([\d.]+) ms/);
    expect(Math.abs(total - processing)).toBeLessThanOrEqual(0.15);
    await expect(page.locator('.connect-status-latency .connect-status-value')).toHaveText(`${total.toFixed(1)}ms`);
  });

  test('E-14 ⑤ 합계가 크면 지연을 줄이는 방법을 안내하고, 화면·README 어디에도 ASIO 가 없다', async ({ page }) => {
    // 출력 버퍼 지연을 50 ms 로 만들어 합계가 20 ms 를 넘게 한다.
    await page.addInitScript(() => {
      Object.defineProperty(AudioContext.prototype, 'baseLatency', { configurable: true, get: () => 0.05 });
    });
    await openApp(page);
    await openAudioInputMenu(page);
    await expect(page.locator('.latency-advice')).toHaveCount(0);
    await connectGuitar(page);
    await expect(page.locator('.latency-advice')).toContainText(ADVICE);
    expect((await readHeadline(page)).total).toBeGreaterThan(50);

    // 화면 전체(보이는 글자·툴팁·aria 속성 포함한 HTML)와 README 에 'ASIO' 가 없다.
    const html = await page.evaluate(() => document.documentElement.outerHTML);
    expect(html).not.toMatch(/asio/i);
    expect(await page.evaluate(() => document.body.innerText)).not.toMatch(/asio/i);
    expect(readFileSync(join(REPO, 'README.md'), 'utf8')).not.toMatch(/asio/i);
  });

  test('E-14 ⑥ 세션을 시작하기 전에 쌓인 끊김은 세지 않고 시작한 뒤의 증가분만 보인다(장치)', async ({ page }) => {
    // 브라우저가 알려 주는 누적값을 시험이 정한다: 연결하기 전에 이미 5건이 쌓여 있다.
    await page.addInitScript(() => {
      const fake = { underrunEvents: 5 };
      Object.defineProperty(window, '__e14Fake', { configurable: true, value: fake });
      Object.defineProperty(AudioContext.prototype, 'playbackStats', { configurable: true, get: () => fake });
    });
    await openApp(page);
    await openAudioInputMenu(page);
    await expect(underrunOutput(page)).toHaveText('--');
    await connectGuitar(page);
    await expect(underrunOutput(page), '시작 전의 5건은 세지 않는다').toHaveText('0회');
    await page.waitForTimeout(1300);
    await expect(underrunOutput(page)).toHaveText('0회');
    await page.evaluate(() => {
      (window as unknown as { __e14Fake: { underrunEvents: number } }).__e14Fake.underrunEvents = 8;
    });
    await expect(underrunOutput(page), '시작한 뒤 늘어난 3건만 보인다').toHaveText('3회');
  });

  test('E-14 ⑦ 음원 파일 모드에서도 시작 전의 끊김은 세지 않고, 입력은 입력 없음(음원 파일)이다', async ({ page }) => {
    await page.addInitScript(() => {
      const fake = { underrunEvents: 5 };
      Object.defineProperty(window, '__e14Fake', { configurable: true, value: fake });
      Object.defineProperty(AudioContext.prototype, 'playbackStats', { configurable: true, get: () => fake });
    });
    await openApp(page);
    await openAudioInputMenu(page);
    await openFileThroughButton(page, fixturePath('ref-pc.wav'));
    await expect(itemOf(page, 'input')).toHaveText('입력 없음(음원 파일)');
    await expect(underrunOutput(page), '시작 전의 5건은 세지 않는다').toHaveText('0회');
    // 파일에는 입력 지연이 없으므로 합계는 처리 + 출력이다.
    const { total } = await readHeadline(page);
    const processing = await readNumber(itemOf(page, 'processing'), /^처리 ([\d.]+) ms/);
    expect(total).toBeGreaterThanOrEqual(processing - 0.15);
    await page.evaluate(() => {
      (window as unknown as { __e14Fake: { underrunEvents: number } }).__e14Fake.underrunEvents = 7;
    });
    await expect(underrunOutput(page), '시작한 뒤 늘어난 2건만 보인다').toHaveText('2회');
  });

  test('E-14 ⑧ 휴대폰 화면에서 지연 문구가 가로로 넘치지 않는다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic(undefined, PHONE);
    await openApp(page);
    await openAudioInputMenu(page);
    await setMobileDock(page, true);
    await connectGuitar(page);
    await setMobileDock(page, true, 'meter');
    await expect(itemOf(page, 'input')).toBeVisible();
    await expect(itemOf(page, 'processing')).toBeVisible();
    await expect(itemOf(page, 'output')).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
  });
});
