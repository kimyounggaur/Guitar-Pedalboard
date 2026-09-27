import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const effectSource = await readFile(
  new URL('../src/audio/nodes/ChorusEffect.ts', import.meta.url),
  'utf8',
);

assert.match(effectSource, /const MIN_DELAY_SECONDS = 0\.012;/);
assert.match(effectSource, /const MAX_DELAY_SECONDS = 0\.028;/);
assert.match(effectSource, /const MAX_MODULATION_SECONDS = 0\.004;/);
assert.match(effectSource, /export const CHORUS_VOICE_BANK_SIZE = 4;/);
assert.match(effectSource, /const SUPPORTED_VOICE_COUNTS = \[2, 3, 4\] as const;/);
assert.doesNotMatch(effectSource, /\.value\s*=/, 'AudioParam 직접 대입이 있습니다.');
assert.doesNotMatch(effectSource, /setValueAtTime|linearRampToValueAtTime/);

const updateStart = effectSource.indexOf('override update(');
const disposeStart = effectSource.indexOf('override dispose(');
assert.ok(updateStart >= 0 && disposeStart > updateStart, 'update/dispose 구현을 찾을 수 없습니다.');
const updateSource = effectSource.slice(updateStart, disposeStart);
assert.doesNotMatch(
  updateSource,
  /new\s+(?:Gain|Delay|Oscillator|StereoPanner|BiquadFilter)Node/,
  'update 중 오디오 노드를 재생성합니다.',
);
assert.match(updateSource, /smoothParam\(lfo\.oscillator\.frequency/);
assert.match(updateSource, /smoothParam\(lfo\.depth\.gain/);
assert.match(effectSource, /oscillator\.start\(\);/);
assert.match(effectSource, /lfo\.oscillator\.stop\(\);/);
assert.match(effectSource, /if \(this\.disposed\) return;/);
assert.match(effectSource, /voice\.delay\.disconnect\(\);/);
assert.match(effectSource, /voice\.panner\.disconnect\(\);/);
assert.match(effectSource, /voice\.gain\.disconnect\(\);/);
assert.match(effectSource, /lfo\.depth\.disconnect\(\);/);

const migrationBundle = await build({
  entryPoints: [
    fileURLToPath(new URL('../src/store/__migration_check.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const migrationCode = migrationBundle.outputFiles[0].text;
const migrationUrl = `data:text/javascript;base64,${Buffer.from(migrationCode).toString('base64')}`;
const { runMigrationChecks } = await import(migrationUrl);
runMigrationChecks();

console.log('Chorus regression passed: schema v5, bounds/NaN, fixed banks, smoothing and lifecycle.');
