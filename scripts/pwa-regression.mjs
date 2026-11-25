import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { access, readFile, readdir, stat } from 'node:fs/promises';
import { inflateSync } from 'node:zlib';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const distDirectory = path.join(projectRoot, 'dist');
const expectedBase = '/Guitar-Pedalboard/';

const packageJson = JSON.parse(
  await readFile(path.join(projectRoot, 'package.json'), 'utf8'),
);
assert.ok(packageJson.devDependencies?.['vite-plugin-pwa'], 'vite-plugin-pwa must be a devDependency');

const manifestPath = path.join(distDirectory, 'manifest.webmanifest');
const serviceWorkerPath = path.join(distDirectory, 'sw.js');
const indexPath = path.join(distDirectory, 'index.html');
await Promise.all([access(manifestPath), access(serviceWorkerPath), access(indexPath)]);

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
assert.equal(manifest.name, 'Guitar Pedalboard');
assert.equal(manifest.short_name, 'Pedalboard');
assert.equal(manifest.display, 'standalone');
assert.equal(manifest.orientation, 'any');
assert.equal(manifest.background_color, '#0b0f16');
assert.equal(manifest.theme_color, '#0b0f16');
assert.equal(manifest.start_url, expectedBase);
assert.equal(manifest.scope, expectedBase);
assert.equal(manifest.lang, 'ko');
assert.equal(manifest.id, manifest.start_url, 'id 는 start_url 과 같아야 이미 설치한 앱의 식별이 바뀌지 않는다');
assert.deepEqual(
  manifest.icons.map(({ src, sizes, type, purpose }) => ({ src, sizes, type, purpose })),
  [
    { src: `${expectedBase}pwa-192x192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: `${expectedBase}pwa-512x512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: `${expectedBase}pwa-512x512-maskable.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
  ],
);

// 아이콘은 경로 문자열이 아니라 dist/ 에 실제로 있는 파일과 그 안의 크기로 확인한다(S2.14: 예전엔 파일이 없어도 이 시험이 통과했다).
const distFile = (publicPath) => {
  assert.ok(publicPath.startsWith(expectedBase), `${publicPath} must live under ${expectedBase}`);
  return path.join(distDirectory, publicPath.slice(expectedBase.length));
};

/** PNG 한 장을 8비트 RGB/RGBA 비인터레이스 기준으로 풀어 가로·세로와 픽셀(RGBA)을 돌려준다. */
function decodePng(buffer, label) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', `${label} must be a PNG file`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const [depth, colorType, , , interlace] = [buffer[24], buffer[25], buffer[26], buffer[27], buffer[28]];
  assert.equal(depth, 8, `${label} must be 8-bit`);
  assert.ok(colorType === 2 || colorType === 6, `${label} must be RGB or RGBA (color type ${colorType})`);
  assert.equal(interlace, 0, `${label} must not be interlaced`);
  const channels = colorType === 6 ? 4 : 3;
  const chunks = [];
  for (let offset = 8; offset < buffer.length;) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('latin1');
    if (type === 'IDAT') chunks.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * channels;
  const rgba = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y += 1) {
    const filter = raw[y * (stride + 1)];
    const line = new Uint8Array(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let x = 0; x < stride; x += 1) {
      const left = x >= channels ? line[x - channels] : 0;
      const up = previous[x];
      const upLeft = x >= channels ? previous[x - channels] : 0;
      let predictor = 0;
      if (filter === 1) predictor = left;
      else if (filter === 2) predictor = up;
      else if (filter === 3) predictor = (left + up) >> 1;
      else if (filter === 4) {
        const estimate = left + up - upLeft;
        const dLeft = Math.abs(estimate - left);
        const dUp = Math.abs(estimate - up);
        const dUpLeft = Math.abs(estimate - upLeft);
        predictor = dLeft <= dUp && dLeft <= dUpLeft ? left : dUp <= dUpLeft ? up : upLeft;
      } else assert.equal(filter, 0, `${label} has an unknown PNG filter ${filter}`);
      line[x] = (line[x] + predictor) & 255;
    }
    for (let x = 0; x < width; x += 1) {
      const from = x * channels;
      const to = (y * width + x) * 4;
      rgba[to] = line[from];
      rgba[to + 1] = line[from + 1];
      rgba[to + 2] = line[from + 2];
      rgba[to + 3] = channels === 4 ? line[from + 3] : 255;
    }
    previous = line;
  }
  return { width, height, rgba };
}

const decoded = new Map();
for (const icon of manifest.icons) {
  const [declaredWidth, declaredHeight] = icon.sizes.split('x').map(Number);
  const png = decodePng(await readFile(distFile(icon.src)), icon.src);
  assert.deepEqual({ width: png.width, height: png.height }, { width: declaredWidth, height: declaredHeight }, `${icon.src}: declared size ${icon.sizes} must equal the real PNG size`);
  decoded.set(icon.src, png);
}
const hasArtwork = (png) => {
  const base = png.rgba.subarray(0, 4);
  let differing = 0;
  for (let at = 0; at < png.rgba.length; at += 4) {
    if (Math.abs(png.rgba[at] - base[0]) + Math.abs(png.rgba[at + 1] - base[1]) + Math.abs(png.rgba[at + 2] - base[2]) > 24) differing += 1;
  }
  return differing / (png.width * png.height);
};
for (const [src, png] of decoded) {
  assert.ok(hasArtwork(png) > 0.1, `${src} must not be a blank image`);
}

// maskable: 투명한 곳이 없고 그림이 가운데 지름 80% 원 안에만 있어야 어떤 모양으로 잘려도 그림이 남는다.
{
  const png = decoded.get(`${expectedBase}pwa-512x512-maskable.png`);
  let translucent = 0;
  let farthest = 0;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const at = (y * png.width + x) * 4;
      if (png.rgba[at + 3] !== 255) translucent += 1;
      const diff = Math.abs(png.rgba[at] - png.rgba[0]) + Math.abs(png.rgba[at + 1] - png.rgba[1]) + Math.abs(png.rgba[at + 2] - png.rgba[2]);
      if (diff > 24) farthest = Math.max(farthest, Math.hypot(x + 0.5 - png.width / 2, y + 0.5 - png.height / 2));
    }
  }
  assert.equal(translucent, 0, 'the maskable icon must be fully opaque');
  assert.ok(farthest <= png.width * 0.4, `maskable artwork must stay inside the central 80% circle (farthest ${farthest.toFixed(1)} px)`);
}

// 홈 화면·탭 아이콘: apple-touch-icon 은 180 px PNG, favicon.ico 는 16·32 px 를 담고, favicon.svg 는 SVG 다.
{
  const touch = decodePng(await readFile(path.join(distDirectory, 'apple-touch-icon.png')), 'apple-touch-icon.png');
  assert.deepEqual({ width: touch.width, height: touch.height }, { width: 180, height: 180 }, 'apple-touch-icon.png must be 180x180');
  assert.ok(hasArtwork(touch) > 0.1, 'apple-touch-icon.png must not be blank');

  const ico = await readFile(path.join(distDirectory, 'favicon.ico'));
  assert.deepEqual([ico.readUInt16LE(0), ico.readUInt16LE(2)], [0, 1], 'favicon.ico must start with an ICO header');
  const icoSizes = Array.from({ length: ico.readUInt16LE(4) }, (_, index) => ico[6 + index * 16] || 256).sort((a, b) => a - b);
  assert.deepEqual(icoSizes, [16, 32], 'favicon.ico must hold the 16 and 32 px images');

  const svg = await readFile(path.join(distDirectory, 'favicon.svg'), 'utf8');
  assert.ok(svg.includes('<svg') && svg.includes('viewBox="0 0 512 512"'), 'favicon.svg must be an SVG with a square viewBox');
}

const builtIndex = await readFile(indexPath, 'utf8');
// 아이콘 링크는 중복 없이 svg·ico·apple-touch 세 개이고 모두 dist/ 에 있는 파일을 가리킨다.
{
  const iconLinks = builtIndex
    .split('<link ')
    .slice(1)
    .map((tag) => tag.slice(0, tag.indexOf('>')))
    .filter((tag) => tag.includes('rel="icon"') || tag.includes('rel="apple-touch-icon"'))
    .map((tag) => ({ rel: tag.split('rel="')[1].split('"')[0], href: tag.split('href="')[1].split('"')[0] }));
  assert.deepEqual(
    iconLinks.map(({ rel, href }) => `${rel} ${href}`),
    [`icon ${expectedBase}favicon.svg`, `icon ${expectedBase}favicon.ico`, `apple-touch-icon ${expectedBase}apple-touch-icon.png`],
    'index.html must link the svg, ico and apple-touch icons exactly once each',
  );
  await Promise.all(iconLinks.map(({ href }) => access(distFile(href))));
}
assert.match(builtIndex, /manifest\.webmanifest/);
assert.match(builtIndex, /registerSW\.js/);

const serviceWorker = await readFile(serviceWorkerPath, 'utf8');
assert.match(serviceWorker, /NetworkFirst/);
assert.match(serviceWorker, /guitar-pedalboard-runtime/);

// 새 버전 알림(S2.4)이 기대는 동작: 새 서비스 워커가 곧바로 켜지고(skipWaiting) 열린 탭을 넘겨받으며(clientsClaim), 그때 탭에 controllerchange 가 온다.
// 등록 스크립트는 평범한 등록뿐이다 — 새 서비스 워커가 켜졌다고 페이지를 스스로 다시 불러오지 않는다(연주 중 자동 새로고침 금지).
assert.ok(serviceWorker.includes('skipWaiting()'), 'the new service worker must activate immediately (skipWaiting)');
assert.ok(serviceWorker.includes('clientsClaim()'), 'the activated service worker must claim open tabs (clientsClaim)');
const registerScript = await readFile(path.join(distDirectory, 'registerSW.js'), 'utf8');
assert.ok(
  registerScript.includes(`navigator.serviceWorker.register('${expectedBase}sw.js'`),
  'registerSW.js must register the service worker under the app base path',
);
assert.ok(!registerScript.includes('reload'), 'registerSW.js must not reload the page by itself (no automatic reload while playing)');

const assetDirectory = path.join(distDirectory, 'assets');
const assetNames = await readdir(assetDirectory);
for (const assetName of assetNames.filter((name) => name.endsWith('.js'))) {
  const assetStat = await stat(path.join(assetDirectory, assetName));
  assert.ok(assetStat.size < 400_000, `${assetName} exceeds the 400 kB JavaScript budget`);
}

console.log(
  'PWA regression passed: exact manifest (lang/id/icons), real icon files and PNG sizes in dist, maskable safe zone, favicon/apple-touch links, service worker registration (no automatic reload), skipWaiting/clientsClaim, precache/runtime NetworkFirst contract, and JavaScript budget.',
);
