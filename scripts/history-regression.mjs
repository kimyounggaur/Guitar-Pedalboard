import assert from 'node:assert/strict';
import console from 'node:console';
import { Buffer } from 'node:buffer';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const bundle = await build({
  plugins: [workerUrlStub],
  stdin: { contents: `
    export { usePedalStore, clonePedals } from './store/pedalStore.ts';
    export { useHistoryStore } from './store/historyStore.ts';
    export { AudioEngine } from './audio/AudioEngine.ts';
  `, resolveDir: fileURLToPath(new URL('../src', import.meta.url)), sourcefile: 'history-harness.ts' },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});
const { usePedalStore, useHistoryStore, AudioEngine, clonePedals } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const pedal = () => usePedalStore.getState();
const history = () => useHistoryStore.getState();
const engine = AudioEngine.getInstance();
let rebuilds = 0;
engine.rebuildChain = () => { rebuilds++; };
// Initial restoration is not a user edit; the AppShell clears history immediately afterwards.
pedal().setActive(pedal().pedals[0].id, !pedal().pedals[0].active);
assert.equal(history().past.length, 1);
history().clear();
assert.equal(history().past.length, 0);
assert.equal(history().future.length, 0);
const before = JSON.stringify(pedal().pedals);
const firstId = pedal().pedals[0].id;
pedal().setActive(firstId, !pedal().pedals[0].active);
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
pedal().setActive(firstId, !pedal().pedals.find((p) => p.id === firstId).active);
assert.equal(history().future.length, 0, '새 편집은 다시 실행 기록을 지웁니다');
const presetSnapshot = pedal().pedals.map((p) => ({ ...p, params: { ...p.params } }));
const altered = presetSnapshot.map((p) => p.id === 'delay' ? { ...p, params: { ...p.params, bpm: 77 } } : p);
pedal().setPedals(altered);
history().undo();
assert.deepEqual(pedal().pedals, presetSnapshot, '프리셋 적용 이전 체인 복원');
// S4.3: 바뀐 페달만 새 객체가 되고 나머지는 참조를 유지한다(카드가 다시 그려지지 않으려면 필요하다).
// 바뀐 것이 없으면 배열도 그대로이고 실행 취소 기록도 늘지 않는다.
{
  const sameRefs = (list, changedId, label) => {
    for (const [index, item] of list.entries()) {
      if (item.id === changedId) assert.notEqual(pedal().pedals[index], item, `${label}: ${item.id} 는 새 객체여야 합니다`);
      else assert.equal(pedal().pedals[index], item, `${label}: ${item.id} 는 참조가 유지되어야 합니다`);
    }
  };
  const depth = history().past.length;
  const refs = pedal().pedals;
  const delay = refs.find((p) => p.id === 'delay');
  pedal().updatePedalParam('delay', 'bpm', delay.params.bpm);
  assert.equal(pedal().pedals, refs, '같은 값이면 배열이 그대로여야 합니다');
  assert.equal(history().past.length, depth, '같은 값은 실행 취소 기록을 만들지 않습니다');
  pedal().updatePedalParam('delay', 'bpm', delay.params.bpm + 1);
  assert.notEqual(pedal().pedals, refs);
  sameRefs(refs, 'delay', '노브 한 칸');

  const afterKnob = pedal().pedals;
  const first = afterKnob[0];
  pedal().setActive(first.id, first.active);
  assert.equal(pedal().pedals, afterKnob, '이미 같은 켜짐이면 배열이 그대로여야 합니다');
  pedal().setActive(first.id, !first.active);
  sameRefs(afterKnob, first.id, '켜고 끄기');

  const beforeMove = pedal().pedals;
  pedal().reorderPedals(0, 1);
  assert.ok(pedal().pedals.every((p) => beforeMove.includes(p)), '순서만 바꾸면 모든 페달 참조가 유지되어야 합니다');

  const depthBeforeSame = history().past.length;
  pedal().setPedals(clonePedals(pedal().pedals));
  assert.equal(history().past.length, depthBeforeSame, '내용이 같은 페달 목록을 다시 넣어도 기록이 늘지 않습니다');
}
console.log('History regression passed: toggle, reorder, preset, knob coalescing, redo invalidation, engine rebuild, reference preservation.');
