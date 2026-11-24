import assert from 'node:assert/strict';
import console from 'node:console';
import { access, readFile, readdir, stat } from 'node:fs/promises';
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
assert.deepEqual(
  manifest.icons.map(({ src, sizes, type }) => ({ src, sizes, type })),
  [
    { src: `${expectedBase}pwa-192x192.png`, sizes: '192x192', type: 'image/png' },
    { src: `${expectedBase}pwa-512x512.png`, sizes: '512x512', type: 'image/png' },
  ],
);

const builtIndex = await readFile(indexPath, 'utf8');
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
  'PWA regression passed: exact manifest, service worker registration (no automatic reload), skipWaiting/clientsClaim, precache/runtime NetworkFirst contract, and JavaScript budget.',
);
