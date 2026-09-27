import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const helperBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/tapTempo.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const helperCode = helperBundle.outputFiles[0].text;
const helperUrl = `data:text/javascript;base64,${Buffer.from(helperCode).toString('base64')}`;
const {
  addTapTempoTap,
  normalizeTapTempoBpm,
  TAP_TEMPO_MAX_BPM,
  TAP_TEMPO_MAX_TAPS,
  TAP_TEMPO_MIN_BPM,
  TAP_TEMPO_RESET_GAP_MS,
} = await import(helperUrl);

assert.equal(TAP_TEMPO_MIN_BPM, 40);
assert.equal(TAP_TEMPO_MAX_BPM, 240);
assert.equal(TAP_TEMPO_MAX_TAPS, 4);
assert.equal(TAP_TEMPO_RESET_GAP_MS, 2_000);

const initial = { taps: [], bpm: 120 };
let tempo = addTapTempoTap(initial, 1_000);
assert.deepEqual(tempo, { taps: [1_000], bpm: 120 });
assert.deepEqual(initial, { taps: [], bpm: 120 }, 'helper가 입력 상태를 변경했습니다.');

tempo = addTapTempoTap(tempo, 1_500);
assert.deepEqual(tempo, { taps: [1_000, 1_500], bpm: 120 });

tempo = addTapTempoTap(tempo, 2_040);
assert.deepEqual(tempo, {
  taps: [1_000, 1_500, 2_040],
  bpm: 115,
});

tempo = addTapTempoTap(tempo, 2_500);
assert.deepEqual(tempo, {
  taps: [1_000, 1_500, 2_040, 2_500],
  bpm: 120,
});

tempo = addTapTempoTap(tempo, 3_100);
assert.deepEqual(tempo, {
  taps: [1_500, 2_040, 2_500, 3_100],
  bpm: 111,
});

const reset = addTapTempoTap(tempo, 5_101);
assert.deepEqual(reset, { taps: [5_101], bpm: 111 });
assert.deepEqual(addTapTempoTap(reset, 7_101), {
  taps: [5_101, 7_101],
  bpm: 40,
});

assert.equal(addTapTempoTap({ taps: [0], bpm: 120 }, 100).bpm, 240);
assert.deepEqual(addTapTempoTap({ taps: [100], bpm: 90 }, Number.NaN), {
  taps: [],
  bpm: 90,
});
assert.equal(normalizeTapTempoBpm(-1), 40);
assert.equal(normalizeTapTempoBpm(999), 240);
assert.equal(normalizeTapTempoBpm(Number.NaN, 132), 132);

const audioStoreSource = await readFile(
  new URL('../src/store/audioStore.ts', import.meta.url),
  'utf8',
);
const applyStart = audioStoreSource.indexOf('function applyGlobalBpmToSyncedPedals');
const syncStart = audioStoreSource.indexOf('function applyTempoSyncToPedal');
assert.ok(applyStart >= 0 && syncStart > applyStart, '전역 BPM 적용 함수를 찾을 수 없습니다.');
const applySource = audioStoreSource.slice(applyStart, syncStart);
assert.match(audioStoreSource, /tapTempo:\s*\{\s*taps:\s*number\[\];\s*bpm:\s*number\s*\}/);
assert.match(applySource, /!pedal\.params\.sync/);
assert.match(applySource, /pedalStore\.setPedals\(pedals\);[\s\S]*setPedalParam\(pedalId, 'bpm', bpm\)/);
assert.doesNotMatch(applySource, /rebuildChain/);
assert.match(audioStoreSource, /setGlobalBpm:[\s\S]*applyGlobalBpmToSyncedPedals\(bpm\)/);
assert.match(audioStoreSource, /setTempoSync:[\s\S]*applyTempoSyncToPedal/);

const [keyboardSource, shortcutRoutingSource] = await Promise.all([
  readFile(new URL('../src/components/GlobalKeyboardShortcuts.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/keyboardShortcuts.ts', import.meta.url), 'utf8'),
]);
assert.match(shortcutRoutingSource, /key === 't'/);
assert.match(shortcutRoutingSource, /event\.repeat/);
assert.match(shortcutRoutingSource, /event\.isComposing/);
assert.match(shortcutRoutingSource, /event\.(?:ctrlKey|metaKey|altKey|shiftKey)/);
assert.match(keyboardSource, /input'[\s\S]*select'[\s\S]*textarea'[\s\S]*contenteditable/);
assert.match(keyboardSource, /addEventListener\('keydown',[\s\S]*capture: true/);

for (const componentPath of [
  '../src/components/effects/DelayPedal.tsx',
  '../src/components/effects/TremoloPedal.tsx',
]) {
  const source = await readFile(new URL(componentPath, import.meta.url), 'utf8');
  assert.match(source, /<TapTempoControl \/>/);
  assert.match(source, /setTempoSync\(pedalId, checked\)/);
}

console.log(
  'Tap tempo regression passed: four-tap median, gap reset, clamped global BPM, synced updates, UI and guarded T shortcut.',
);
