import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const bundle = await build({
  stdin: { contents: `
    export { usePedalStore, clonePedals } from './store/pedalStore.ts';
    export { useHistoryStore } from './store/historyStore.ts';
    export { AudioEngine } from './audio/AudioEngine.ts';
  `, resolveDir: fileURLToPath(new URL('../src', import.meta.url)), sourcefile: 'history-harness.ts' },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});
const { usePedalStore, useHistoryStore, AudioEngine } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const pedal = () => usePedalStore.getState();
const history = () => useHistoryStore.getState();
const engine = AudioEngine.getInstance();
let rebuilds = 0;
engine.rebuildChain = () => { rebuilds++; };
// Initial restoration is not a user edit; the AppShell clears history immediately afterwards.
pedal().setPedalBypass(pedal().pedals[0].id, !pedal().pedals[0].bypassed);
assert.equal(history().past.length, 1);
history().clear();
assert.equal(history().past.length, 0);
assert.equal(history().future.length, 0);
const before = JSON.stringify(pedal().pedals);
const firstId = pedal().pedals[0].id;
pedal().setPedalBypass(firstId, !pedal().pedals[0].bypassed);
const toggled = JSON.stringify(pedal().pedals);
assert.notEqual(before, toggled);
history().undo();
assert.equal(JSON.stringify(pedal().pedals), before);
history().redo();
assert.equal(JSON.stringify(pedal().pedals), toggled);
assert.equal(rebuilds, 2);
pedal().reorderPedals(0, 1);
const reordered = JSON.stringify(pedal().pedals);
history().undo();
assert.equal(JSON.stringify(pedal().pedals), toggled);
history().redo();
assert.equal(JSON.stringify(pedal().pedals), reordered);
const baselineDepth = history().past.length;
pedal().updatePedalParam('delay', 'bpm', 111);
pedal().updatePedalParam('delay', 'bpm', 112);
assert.equal(history().past.length, baselineDepth + 1, '같은 노브 연속 변경은 한 단계');
history().undo();
assert.equal(JSON.stringify(pedal().pedals), reordered);
pedal().setPedalBypass(firstId, !pedal().pedals.find((p) => p.id === firstId).bypassed);
assert.equal(history().future.length, 0, '새 편집은 다시 실행 기록을 지웁니다');
const presetSnapshot = pedal().pedals.map((p) => ({ ...p, params: { ...p.params } }));
const altered = presetSnapshot.map((p) => p.id === 'delay' ? { ...p, params: { ...p.params, bpm: 77 } } : p);
pedal().setPedals(altered);
history().undo();
assert.deepEqual(pedal().pedals, presetSnapshot, '프리셋 적용 이전 체인 복원');
console.log('History regression passed: toggle, reorder, preset, knob coalescing, redo invalidation, engine rebuild.');
