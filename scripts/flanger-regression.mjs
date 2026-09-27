import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const effectSource = await readFile(
  new URL('../src/audio/nodes/FlangerEffect.ts', import.meta.url),
  'utf8',
);

assert.match(effectSource, /const MIN_RATE_HZ = 0\.05;/);
assert.match(effectSource, /const MAX_RATE_HZ = 5;/);
assert.match(effectSource, /const MIN_MANUAL_SECONDS = 0\.0005;/);
assert.match(effectSource, /const MAX_MANUAL_SECONDS = 0\.01;/);
assert.match(effectSource, /export const FLANGER_MAX_FEEDBACK = 0\.95;/);
assert.match(
  effectSource,
  /Math\.min\(\s*boundedManual - MIN_MANUAL_SECONDS,\s*MAX_MANUAL_SECONDS - boundedManual/,
);
assert.doesNotMatch(effectSource, /\.value\s*=/, 'AudioParam 직접 대입이 있습니다.');

const updateStart = effectSource.indexOf('override update(');
const disposeStart = effectSource.indexOf('override dispose(');
assert.ok(updateStart >= 0 && disposeStart > updateStart, 'update/dispose 구현을 찾을 수 없습니다.');
const updateSource = effectSource.slice(updateStart, disposeStart);
assert.doesNotMatch(
  updateSource,
  /new\s+(?:Gain|Delay|Oscillator|StereoPanner|BiquadFilter)Node/,
  'update 중 오디오 노드를 재생성합니다.',
);
assert.match(updateSource, /smoothParam\(this\.delay\.delayTime/);
assert.match(updateSource, /smoothParam\(this\.oscillator\.frequency/);
assert.match(updateSource, /this\.modulationDepth\.gain/);
assert.match(updateSource, /smoothParam\(this\.feedback\.gain/);
assert.match(updateSource, /const wetMakeup = Math\.max\(0\.05, 1 - Math\.abs\(feedback\)\);/);
assert.match(updateSource, /smoothParam\(this\.wetMakeup\.gain, wetMakeup, this\.context\);/);
assert.match(
  updateSource,
  /clamp\(params\.feedback \/ 100, -FLANGER_MAX_FEEDBACK, FLANGER_MAX_FEEDBACK\)/,
);

assert.match(effectSource, /this\.delay\.connect\(this\.feedback\);/);
assert.match(effectSource, /this\.feedback\.connect\(this\.delay\);/);
assert.match(effectSource, /this\.delay\.connect\(this\.wetMakeup\);/);
assert.match(effectSource, /this\.wetMakeup\.connect\(this\.effectOutput\);/);
assert.match(effectSource, /this\.oscillator\.start\(\);/);
assert.match(effectSource, /this\.oscillator\.stop\(\);/);
assert.match(effectSource, /if \(this\.disposed\) return;/);
assert.match(effectSource, /this\.oscillator\.disconnect\(\);/);
assert.match(effectSource, /this\.modulationDepth\.disconnect\(\);/);
assert.match(effectSource, /this\.feedback\.disconnect\(\);/);
assert.match(effectSource, /this\.wetMakeup\.disconnect\(\);/);
assert.match(effectSource, /this\.delay\.disconnect\(\);/);

const effectBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/nodes/FlangerEffect.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const effectCode = effectBundle.outputFiles[0].text;
const effectUrl = `data:text/javascript;base64,${Buffer.from(effectCode).toString('base64')}`;
const { FLANGER_MAX_FEEDBACK, getFlangerModulationDepth, normalizeFlangerParams } =
  await import(effectUrl);

assert.equal(FLANGER_MAX_FEEDBACK, 0.95);
assert.deepEqual(
  normalizeFlangerParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    rate: Number.NaN,
    depth: Number.NEGATIVE_INFINITY,
    feedback: Number.NaN,
    manual: Number.POSITIVE_INFINITY,
  }),
  { mix: 35, level: 100, rate: 0.25, depth: 55, feedback: 60, manual: 2 },
);
assert.deepEqual(
  normalizeFlangerParams({
    mix: -1,
    level: 300,
    rate: 20,
    depth: 200,
    feedback: -1000,
    manual: 20,
  }),
  { mix: 0, level: 200, rate: 5, depth: 100, feedback: -95, manual: 10 },
);
assert.equal(
  normalizeFlangerParams({
    mix: 35,
    level: 100,
    rate: 0.05,
    depth: 0,
    feedback: 1000,
    manual: 0,
  }).feedback,
  95,
);

const minimumManual = 0.0005;
const maximumManual = 0.01;
const manualExtremes = [minimumManual, maximumManual];
const depthExtremes = [0, 100];

for (const manual of manualExtremes) {
  for (const depth of depthExtremes) {
    const sweep = getFlangerModulationDepth(manual, depth);
    assert.ok(manual - sweep >= minimumManual, `${manual}/${depth}: lower sweep bound`);
    assert.ok(manual + sweep <= maximumManual, `${manual}/${depth}: upper sweep bound`);
  }
}

for (const manual of [0.0006, 0.00525, 0.0099]) {
  const sweep = getFlangerModulationDepth(manual, 100);
  assert.ok(manual - sweep >= minimumManual, `${manual}: lower sweep bound`);
  assert.ok(manual + sweep <= maximumManual, `${manual}: upper sweep bound`);
}

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

console.log('Flanger regression passed: schema v6, signed feedback clamp, smoothing and lifecycle.');
