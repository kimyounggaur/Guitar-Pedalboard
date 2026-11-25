// S2.14: public/favicon.svg 의 페달 그림으로 maskable 아이콘(public/pwa-512x512-maskable.png)을 만든다.
// 사용: node docs/refactoring/tools/make-maskable-icon.mjs            (Playwright 의 Chromium 으로 그림)
//       E2E_CHROME_PATH=/usr/bin/google-chrome node docs/refactoring/tools/make-maskable-icon.mjs
// maskable 은 가운데 지름 80% 원 안에만 그림을 두어야 하므로 페달을 줄여(SCALE) 가운데에 놓고, 배경은 모서리 끝까지 채운다(투명 금지).
// 앱 코드나 시험을 바꾸지 않는다. 결과 PNG 는 저장소에 들어 있으므로 평소에는 돌릴 필요가 없다.
import console from 'node:console';
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';
import { fileURLToPath, URL } from 'node:url';
import { chromium } from '@playwright/test';

const SIZE = 512;
const SCALE = 0.8;
const BACKGROUND = '#111b27';

const publicDir = (name) => fileURLToPath(new URL(`../../../public/${name}`, import.meta.url));
const svg = await readFile(publicDir('favicon.svg'), 'utf8');
const start = svg.indexOf('<g id="pedal">');
const end = svg.indexOf('</g>', start);
if (start < 0 || end < 0) throw new Error('favicon.svg 에서 <g id="pedal"> 를 찾지 못했습니다');
const pedal = svg.slice(start, end + '</g>'.length);

const markup = [
  `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}">`,
  `<rect width="${SIZE}" height="${SIZE}" fill="${BACKGROUND}"/>`,
  `<g transform="translate(${SIZE / 2} ${SIZE / 2}) scale(${SCALE}) translate(${-SIZE / 2} ${-SIZE / 2})">${pedal}</g>`,
  '</svg>',
].join('');

const browser = await chromium.launch({ executablePath: process.env.E2E_CHROME_PATH || undefined });
try {
  const page = await browser.newPage({ viewport: { width: SIZE, height: SIZE }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><style>html,body{margin:0;background:${BACKGROUND}}svg{display:block}</style>${markup}`);
  const png = await page.locator('svg').screenshot({ type: 'png' });
  await writeFile(publicDir('pwa-512x512-maskable.png'), png);
  console.log(`public/pwa-512x512-maskable.png ${png.length} bytes (${SIZE}x${SIZE}, 페달 ${SCALE * 100}%)`);
} finally {
  await browser.close();
}
