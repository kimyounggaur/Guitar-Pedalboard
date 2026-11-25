// E-19 로딩 성능(설계서 S4.1, 보고서 R4-1): 로고가 첫 화면의 대부분을 차지하던 문제.
//   ① 로고 파일 각 ≤ 50 KB(1배 520 px, 2배 1040 px), 서비스 워커 프리캐시에 logo.png 가 없고 두 로고는 있다
//   ② 첫 방문 전송량(페이지 + 서비스 워커 프리캐시) ≤ 1 MB — GitHub Pages 처럼 글자 파일을 gzip 으로 내려 주는 서버에서 잰다(압축 안 한 값도 함께 적는다)
//   ③ '느린 4G'(내려받기 1.6 Mbps, 지연 150 ms)에서 로고가 화면에 나타나기까지 ≤ 2.5 초 — 데스크톱·휴대폰 둘 다
//   ④ srcset 이 화면 폭×화면 배율에 맞는 파일을 고른다(데스크톱 1배 → 520 px, 휴대폰 3배 → 1040 px)
//      · preload(index.html 의 imagesrcset·imagesizes)와 <img> 의 srcset·sizes 가 같아서 로고를 한 번만 받는다
//      · width·height 속성이 파일의 가로세로 비율과 같다(그림이 도착해도 레이아웃이 밀리지 않는다), decoding=async, fetchpriority=high
// 서버: 시험용 dist 서버(helpers/dist-server.ts)가 응답 크기를 센다. 서비스 워커의 요청도 센다(브라우저 쪽 네트워크 이벤트에는 안 잡힌다).
// 옛 코드(1.6 MB PNG)와 비교하려면 옛 코드를 빌드한 폴더를 E2E_DIST_DIR 로 넘긴다 — 이 파일의 ① 은 실패하지만 측정값은 먼저 출력된다.
// 공개 사이트(GitHub Pages)의 실제 전송량·실제 4G 회선은 '사람 확인 필요'다. 이 시험은 같은 dist 를 로컬에서 흉내 낸다.
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Browser, BrowserContextOptions, Page } from '@playwright/test';
import { startDistServer, type DistServer } from '../helpers/dist-server';
import { repoRoot } from '../helpers/env';
import { PEDAL_COUNT, pedalCards } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

const DIST_DIR = process.env.E2E_DIST_DIR ?? join(repoRoot, 'dist');
const LOGO_FILES = ['logo-520.webp', 'logo-1040.webp'];
const MAX_LOGO_BYTES = 50 * 1024;
const MAX_FIRST_VISIT_BYTES = 1_000_000;
const MAX_LOGO_SHOWN_MS = 2500;

/** 크롬 개발자 도구의 'Slow 4G' 와 같은 값 */
const SLOW_4G = { latency: 150, downloadThroughput: (1.6 * 1000 * 1000) / 8, uploadThroughput: (750 * 1000) / 8 };

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 };
const PHONE: BrowserContextOptions = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true };

let server: DistServer;

test.beforeEach(async () => {
  server = await startDistServer({ gzip: true, distDir: DIST_DIR });
});

test.afterEach(async () => {
  await server.close();
});

/** 새 컨텍스트(캐시·서비스 워커 없음)에서 페이지를 열어 둔다 */
async function freshPage(browser: Browser, options: BrowserContextOptions): Promise<Page> {
  const context = await browser.newContext(options);
  return context.newPage();
}

/** 로고가 처음으로 그려질 수 있는 상태(내려받음·크기 있음·자리 잡음)가 된 시각을 navigation start 기준으로 남긴다 */
const RECORD_LOGO_SHOWN = `
  (() => {
    window.__logoShownAt = null;
    const check = () => {
      const img = document.querySelector('.app-logo-title img');
      if (img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0) {
        const box = img.getBoundingClientRect();
        if (box.width > 0 && box.height > 0) {
          requestAnimationFrame(() => { window.__logoShownAt = performance.now(); });
          return;
        }
      }
      requestAnimationFrame(check);
    };
    requestAnimationFrame(check);
  })();
`;

interface LogoInfo {
  currentSrc: string;
  /** 고른 파일 자체의 가로·세로(srcset 의 w 값을 쓰면 img.naturalWidth 는 화면 배율로 나눈 값이라 파일을 따로 읽는다) */
  fileWidth: number;
  fileHeight: number;
  attributeWidth: number;
  attributeHeight: number;
  decoding: string;
  fetchPriority: string;
}

function readLogo(page: Page): Promise<LogoInfo> {
  return page.evaluate(async () => {
    const img = document.querySelector('.app-logo-title img') as HTMLImageElement;
    const file = new Image();
    file.src = img.currentSrc;
    await file.decode();
    return {
      currentSrc: img.currentSrc,
      fileWidth: file.naturalWidth,
      fileHeight: file.naturalHeight,
      attributeWidth: Number(img.getAttribute('width')),
      attributeHeight: Number(img.getAttribute('height')),
      decoding: img.decoding,
      fetchPriority: img.fetchPriority,
    };
  });
}

interface FirstVisit {
  logo: LogoInfo;
  /** 이 페이지가 로고를 요청한 횟수(서비스 워커의 프리캐시 요청은 빠진다) */
  logoPageRequests: number;
  /** 서비스 워커 프리캐시에 들어 있는 주소(base 경로를 뺀 것) */
  precached: string[];
  wireBytes: number;
  rawBytes: number;
  requestCount: number;
}

/** 첫 방문: 앱이 뜨고 서비스 워커가 프리캐시를 끝낼 때까지 기다린 뒤, 서버가 내려 준 양과 로고 상태를 읽는다 */
async function firstVisit(browser: Browser, options: BrowserContextOptions): Promise<FirstVisit> {
  const page = await freshPage(browser, options);
  let logoPageRequests = 0;
  page.on('request', (request) => {
    if (/\/logo[^/]*\.(webp|png)$/.test(new URL(request.url()).pathname)) logoPageRequests += 1;
  });
  await page.goto(server.url);
  await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
  // 서비스 워커가 active 가 되었다는 것은 install(= 프리캐시 내려받기)이 끝났다는 뜻이다.
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => undefined));
  const precached = await page.evaluate(async () => {
    const urls: string[] = [];
    for (const name of await caches.keys()) {
      if (!name.includes('precache')) continue;
      const cache = await caches.open(name);
      for (const request of await cache.keys()) urls.push(new URL(request.url).pathname);
    }
    return urls;
  });
  // 전송량과 요청 횟수는 로고 정보를 읽기 전에 센다(readLogo 는 고른 파일의 크기를 알아내려고 한 번 더 받는다).
  const basePath = new URL(server.url).pathname;
  const counted = {
    logoPageRequests,
    precached: precached.map((path) => path.slice(basePath.length)),
    wireBytes: server.requests.reduce((sum, request) => sum + request.bytes, 0),
    rawBytes: server.requests.reduce((sum, request) => sum + request.rawBytes, 0),
    requestCount: server.requests.length,
  };
  const result: FirstVisit = { ...counted, logo: await readLogo(page) };
  await page.context().close();
  return result;
}

/** '느린 4G' 에서 새로 열어 로고가 나타난 시각(ms)을 잰다 */
async function logoShownMs(browser: Browser, options: BrowserContextOptions): Promise<number> {
  const page = await freshPage(browser, options);
  await page.addInitScript(RECORD_LOGO_SHOWN);
  const client = await page.context().newCDPSession(page);
  await client.send('Network.enable');
  await client.send('Network.emulateNetworkConditions', { offline: false, ...SLOW_4G });
  await page.goto(server.url, { waitUntil: 'commit' });
  await page.waitForFunction(() => (window as unknown as { __logoShownAt: number | null }).__logoShownAt !== null, undefined, {
    timeout: 90_000,
    polling: 50,
  });
  const shown = await page.evaluate(() => (window as unknown as { __logoShownAt: number }).__logoShownAt);
  await page.context().close();
  return shown;
}

function report(label: string, value: string): void {
  test.info().annotations.push({ type: label, description: value });
  console.log(`[E-19] ${label}: ${value}`);
}

const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;

test.describe('E-19 로딩 성능 — 로고 경량화(S4.1)', () => {
  test('E-19 로고 파일은 각각 50 KB 이하이고, 프리캐시에는 logo.png 가 없고 두 로고가 있다', async ({ browser }) => {
    const sizes = LOGO_FILES.map((file) => ({ file, bytes: existsSync(join(DIST_DIR, file)) ? statSync(join(DIST_DIR, file)).size : -1 }));
    report('로고 파일 크기', sizes.map((entry) => `${entry.file} ${entry.bytes < 0 ? '없음' : kb(entry.bytes)}`).join(', '));
    const visit = await firstVisit(browser, DESKTOP);
    report('프리캐시 목록', visit.precached.join(', '));
    for (const entry of sizes) {
      expect(entry.bytes, `${entry.file} 이 dist 에 있다`).toBeGreaterThan(0);
      expect(entry.bytes, `${entry.file} ≤ 50 KB`).toBeLessThanOrEqual(MAX_LOGO_BYTES);
    }
    expect(visit.precached.filter((path) => path.endsWith('logo.png')), '프리캐시에 logo.png 가 없다').toEqual([]);
    for (const file of LOGO_FILES) {
      expect(visit.precached, `${file} 은 오프라인에서도 보이도록 프리캐시에 있다`).toContain(file);
    }
  });

  test('E-19 첫 방문 전송량(페이지 + 서비스 워커 프리캐시, gzip)은 1 MB 이하다', async ({ browser }) => {
    const visit = await firstVisit(browser, DESKTOP);
    report('첫 방문 전송량(gzip)', `${visit.wireBytes} B (${kb(visit.wireBytes)}), 응답 ${visit.requestCount}건`);
    report('첫 방문 전송량(압축 전)', `${visit.rawBytes} B (${kb(visit.rawBytes)})`);
    expect(visit.wireBytes, '첫 방문 전송량 ≤ 1 MB').toBeLessThanOrEqual(MAX_FIRST_VISIT_BYTES);
  });

  test('E-19 데스크톱(1배)은 520 px, 휴대폰(3배)은 1040 px 로고를 고르고 한 번만 받는다', async ({ browser }) => {
    const desktop = await firstVisit(browser, DESKTOP);
    report('데스크톱 로고', `${desktop.logo.currentSrc.split('/').pop()}, 요청 ${desktop.logoPageRequests}회`);
    expect(desktop.logo.currentSrc.endsWith('/logo-520.webp'), '데스크톱 1배는 520 px').toBe(true);
    expect(desktop.logo.fileWidth).toBe(520);
    expect(desktop.logoPageRequests, 'preload 한 번으로 끝난다(<img> 가 다시 받지 않는다)').toBe(1);

    const phone = await firstVisit(browser, PHONE);
    report('휴대폰 로고', `${phone.logo.currentSrc.split('/').pop()}, 요청 ${phone.logoPageRequests}회`);
    expect(phone.logo.currentSrc.endsWith('/logo-1040.webp'), '휴대폰 3배는 1040 px').toBe(true);
    expect(phone.logo.fileWidth).toBe(1040);
    expect(phone.logoPageRequests, 'preload 한 번으로 끝난다').toBe(1);

    for (const visit of [desktop, phone]) {
      const natural = visit.logo.fileWidth / visit.logo.fileHeight;
      const declared = visit.logo.attributeWidth / visit.logo.attributeHeight;
      expect(Math.abs(natural - declared), 'width·height 속성의 비율이 파일과 같다').toBeLessThan(0.01);
      expect(visit.logo.decoding).toBe('async');
      expect(visit.logo.fetchPriority).toBe('high');
    }
  });

  test('E-19 느린 4G 에서 로고가 2.5 초 안에 나타난다(데스크톱)', async ({ browser }) => {
    const shown = await logoShownMs(browser, DESKTOP);
    report('느린 4G 로고 표시(데스크톱)', `${Math.round(shown)} ms`);
    expect(shown, '로고 표시 ≤ 2.5 초').toBeLessThanOrEqual(MAX_LOGO_SHOWN_MS);
  });

  test('E-19 느린 4G 에서 로고가 2.5 초 안에 나타난다(휴대폰, 3배 화면)', async ({ browser }) => {
    const shown = await logoShownMs(browser, PHONE);
    report('느린 4G 로고 표시(휴대폰)', `${Math.round(shown)} ms`);
    expect(shown, '로고 표시 ≤ 2.5 초').toBeLessThanOrEqual(MAX_LOGO_SHOWN_MS);
  });
});
