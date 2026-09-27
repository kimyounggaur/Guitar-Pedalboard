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

const assetDirectory = path.join(distDirectory, 'assets');
const assetNames = await readdir(assetDirectory);
for (const assetName of assetNames.filter((name) => name.endsWith('.js'))) {
  const assetStat = await stat(path.join(assetDirectory, assetName));
  assert.ok(assetStat.size < 400_000, `${assetName} exceeds the 400 kB JavaScript budget`);
}

console.log(
  'PWA regression passed: exact manifest, service worker registration, precache/runtime NetworkFirst contract, and JavaScript budget.',
);
