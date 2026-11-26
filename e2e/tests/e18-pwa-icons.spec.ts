// E-18 앱 아이콘·파비콘·설치 조건(설계서 S2.14, 보고서 R2-11). `vite preview` 가 배포와 같은 base 경로(/Guitar-Pedalboard/)로 내보내는 dist/ 를 본다.
//   ① 아이콘 6종(192·512·512 maskable·apple-touch 180·favicon.svg·favicon.ico)이 모두 200 이고 종류(content-type)가 맞다
//   ② 브라우저가 여섯 개를 모두 그림으로 읽는다(깨진 파일이 아니다). PNG 는 선언한 크기와 실제 크기가 같다
//   ③ 설치 정보(manifest): 이름·언어(ko)·id(=start_url)·아이콘 세 개(any 192·any 512·maskable 512, 한 항목에 any 와 maskable 을 묶지 않는다)와 각 파일이 200
//   ④ index.html 의 아이콘 링크가 중복 없이 svg·ico·apple-touch 세 개이고 모두 200
//   ⑤ Chrome 설치 조건: CDP `Page.getInstallabilityErrors` 결과 0건, `Page.getAppManifest` 오류 0건
//   ⑥ maskable 아이콘은 투명한 곳이 없고 그림이 가운데 지름 80% 원 안에만 있다(그림이 있기는 하다)
// 공개 사이트(GitHub Pages)가 실제로 200 을 주는지는 배포 뒤 사람이 확인한다(이 시험은 같은 dist 를 로컬에서 본다).
import type { Page } from '@playwright/test';
import { BASE_URL } from '../helpers/env';
import { openApp } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

interface IconFile {
  file: string;
  /** 허용하는 content-type(서버마다 ico 의 이름이 달라 둘 이상 적는다) */
  types: string[];
  /** PNG 의 가로·세로(그 밖은 null) */
  size: number | null;
}

const ICONS: IconFile[] = [
  { file: 'pwa-192x192.png', types: ['image/png'], size: 192 },
  { file: 'pwa-512x512.png', types: ['image/png'], size: 512 },
  { file: 'pwa-512x512-maskable.png', types: ['image/png'], size: 512 },
  { file: 'apple-touch-icon.png', types: ['image/png'], size: 180 },
  { file: 'favicon.svg', types: ['image/svg+xml'], size: null },
  { file: 'favicon.ico', types: ['image/x-icon', 'image/vnd.microsoft.icon'], size: null },
];

const urlOf = (file: string): string => new URL(file, BASE_URL).toString();

interface Decoded {
  ok: boolean;
  width: number;
  height: number;
}

/** 브라우저가 이 주소의 그림을 읽을 수 있는지와 읽은 크기 */
async function decode(page: Page, url: string): Promise<Decoded> {
  return page.evaluate(async (target) => {
    const image = new Image();
    image.src = target;
    try {
      await image.decode();
      return { ok: true, width: image.naturalWidth, height: image.naturalHeight };
    } catch {
      return { ok: false, width: 0, height: 0 };
    }
  }, url);
}

interface ManifestIcon {
  src: string;
  sizes: string;
  type: string;
  purpose?: string;
}

interface Manifest {
  name: string;
  short_name: string;
  lang?: string;
  id?: string;
  start_url: string;
  scope: string;
  display: string;
  icons: ManifestIcon[];
}

async function readManifest(page: Page): Promise<Manifest> {
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href, 'index.html 에 manifest 링크가 있다').toBeTruthy();
  const response = await page.request.get(new URL(href ?? '', BASE_URL).toString());
  expect(response.status()).toBe(200);
  return (await response.json()) as Manifest;
}

test.describe('E-18 앱 아이콘·파비콘·설치 조건', () => {
  test('E-18 ① 아이콘 6종이 모두 200 이고 종류가 맞다', async ({ page }) => {
    for (const icon of ICONS) {
      const response = await page.request.get(urlOf(icon.file));
      expect(response.status(), `${icon.file} 응답`).toBe(200);
      const type = (response.headers()['content-type'] ?? '').split(';')[0].trim();
      expect(icon.types, `${icon.file} 의 content-type(${type})`).toContain(type);
      expect((await response.body()).length, `${icon.file} 크기`).toBeGreaterThan(100);
    }
  });

  test('E-18 ② 아이콘을 브라우저가 그림으로 읽고 PNG 는 크기가 맞다', async ({ page }) => {
    await openApp(page);
    for (const icon of ICONS) {
      const decoded = await decode(page, urlOf(icon.file));
      expect(decoded.ok, `${icon.file} 을 그림으로 읽는다`).toBe(true);
      expect(decoded.width, `${icon.file} 가로`).toBeGreaterThan(0);
      if (icon.size !== null) {
        expect({ width: decoded.width, height: decoded.height }, `${icon.file} 크기`).toEqual({ width: icon.size, height: icon.size });
      }
    }
  });

  test('E-18 ③ 설치 정보에 이름·언어·id 와 아이콘 세 개(any 192·any 512·maskable 512)가 있고 모두 200 이다', async ({ page }) => {
    await openApp(page);
    const manifest = await readManifest(page);
    expect(manifest.name).toBe('Guitar Pedalboard');
    expect(manifest.short_name).toBe('Pedalboard');
    expect(manifest.display).toBe('standalone');
    expect(manifest.lang).toBe('ko');
    expect(manifest.id, 'id 는 start_url 과 같아 이미 설치한 앱의 식별이 바뀌지 않는다').toBe(manifest.start_url);

    const summary = manifest.icons.map((icon) => ({ file: icon.src.split('/').pop(), sizes: icon.sizes, type: icon.type, purpose: icon.purpose }));
    expect(summary).toEqual([
      { file: 'pwa-192x192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { file: 'pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { file: 'pwa-512x512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ]);
    for (const icon of manifest.icons) {
      const url = new URL(icon.src, BASE_URL).toString();
      const response = await page.request.get(url);
      expect(response.status(), `${icon.src} 응답`).toBe(200);
      const [width, height] = icon.sizes.split('x').map(Number);
      const decoded = await decode(page, url);
      expect({ width: decoded.width, height: decoded.height }, `${icon.src} 의 선언한 크기와 실제 크기`).toEqual({ width, height });
    }
  });

  test('E-18 ④ index.html 의 아이콘 링크가 중복 없이 svg·ico·apple-touch 세 개이고 모두 200 이다', async ({ page }) => {
    await openApp(page);
    const links = await page.evaluate(() =>
      Array.from(document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')).map((link) => ({
        rel: link.getAttribute('rel') ?? '',
        type: link.getAttribute('type') ?? '',
        sizes: link.getAttribute('sizes') ?? '',
        href: (link as HTMLLinkElement).href,
      })),
    );
    expect(links.map((link) => `${link.rel} ${new URL(link.href).pathname.split('/').pop()}`)).toEqual([
      'icon favicon.svg',
      'icon favicon.ico',
      'apple-touch-icon apple-touch-icon.png',
    ]);
    expect(new Set(links.map((link) => link.href)).size, '같은 주소를 두 번 걸지 않는다').toBe(links.length);
    expect(links[0].type).toBe('image/svg+xml');
    for (const link of links) {
      expect((await page.request.get(link.href)).status(), `${link.href} 응답`).toBe(200);
    }
  });

  test('E-18 ⑤ Chrome 설치 조건을 채운다(설치 오류 0건, manifest 오류 0건)', async ({ page }) => {
    await openApp(page);
    const client = await page.context().newCDPSession(page);
    // manifest 를 내려받고 해석하는 데 시간이 걸릴 수 있어 오류가 비는 것을 기다린다.
    let errors: unknown[] = [];
    await expect
      .poll(
        async () => {
          const result = await client.send('Page.getInstallabilityErrors');
          errors = result.installabilityErrors;
          return errors.length;
        },
        { message: `설치 오류: ${JSON.stringify(errors)}`, timeout: 10_000 },
      )
      .toBe(0);

    const app = await client.send('Page.getAppManifest');
    expect(app.errors, 'manifest 해석 오류').toEqual([]);
    expect(app.url).toBe(urlOf('manifest.webmanifest'));
    const parsed = JSON.parse(app.data ?? '{}') as Manifest;
    expect(parsed.icons.length).toBe(3);
  });

  test('E-18 ⑥ maskable 아이콘은 투명한 곳이 없고 그림이 가운데 지름 80% 원 안에만 있다', async ({ page }) => {
    await openApp(page);
    const result = await page.evaluate(async (target) => {
      const image = new Image();
      image.src = target;
      await image.decode();
      const size = image.naturalWidth;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('canvas 를 만들 수 없습니다');
      context.drawImage(image, 0, 0);
      const { data } = context.getImageData(0, 0, size, size);
      const background = [data[0], data[1], data[2]];
      let translucent = 0;
      let artwork = 0;
      let maxRadius = 0;
      for (let y = 0; y < size; y += 1) {
        for (let x = 0; x < size; x += 1) {
          const at = (y * size + x) * 4;
          if (data[at + 3] !== 255) translucent += 1;
          const diff = Math.abs(data[at] - background[0]) + Math.abs(data[at + 1] - background[1]) + Math.abs(data[at + 2] - background[2]);
          if (diff > 24) {
            artwork += 1;
            maxRadius = Math.max(maxRadius, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2));
          }
        }
      }
      const corners = [0, size - 1].flatMap((y) => [0, size - 1].map((x) => {
        const at = (y * size + x) * 4;
        return `${data[at]},${data[at + 1]},${data[at + 2]}`;
      }));
      return { size, translucent, artwork, maxRadius, corners };
    }, urlOf('pwa-512x512-maskable.png'));

    expect(result.size).toBe(512);
    expect(result.translucent, '투명하거나 반투명한 픽셀(마스크가 잘라도 배경이 비면 안 된다)').toBe(0);
    expect(new Set(result.corners).size, '네 모서리가 같은 배경색으로 채워져 있다').toBe(1);
    expect(result.artwork, '그림 픽셀 수(빈 아이콘이 아니다)').toBeGreaterThan(result.size * result.size * 0.1);
    expect(result.maxRadius, '가운데에서 가장 먼 그림 픽셀까지의 거리(안전 영역 반지름 0.4 × 크기 = 204.8)').toBeLessThanOrEqual(result.size * 0.4);
  });
});
