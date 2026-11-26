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
    export { useHistoryStore, beginHistoryGesture, endHistoryGesture, isHistoryGestureActive } from './store/historyStore.ts';
    export { AudioEngine } from './audio/AudioEngine.ts';
  `, resolveDir: fileURLToPath(new URL('../src', import.meta.url)), sourcefile: 'history-harness.ts' },
  bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
});
const { usePedalStore, useHistoryStore, AudioEngine, clonePedals, beginHistoryGesture, endHistoryGesture, isHistoryGestureActive } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
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

// ── S5.3: 노브 끌기 한 번 = 실행 취소 한 단계, 50단계 한도, 프리셋 불러오기 되돌리기 ───────────────────────────
{
  // 시간은 우리가 정한다 — 끌다가 멈춘 시간(수 초)을 실제로 기다리지 않고 재현한다.
  const realNow = Date.now;
  let clock = realNow();
  Date.now = () => clock;
  const tick = (ms) => { clock += ms; };
  const bpm = () => pedal().pedals.find((p) => p.id === 'delay').params.bpm;
  const setBpm = (value) => pedal().updatePedalParam('delay', 'bpm', value);
  const COALESCE_PAUSE_MS = 1500; // COALESCE_MS(350)보다 훨씬 긴 멈춤
  try {
    history().clear();
    endHistoryGesture();
    const start = bpm();

    // 끌기 밖: 같은 노브라도 350 ms 넘게 멈추면 단계가 갈라진다(키보드 화살표의 시간 묶기).
    setBpm(start + 1); tick(COALESCE_PAUSE_MS); setBpm(start + 2);
    assert.equal(history().past.length, 2, '끌기 밖에서는 350 ms 넘게 멈추면 두 단계');
    history().clear();
    setBpm(start); // 값을 처음으로 되돌려 둔다
    history().clear();

    // 끌기 안: 도중에 길게 멈춰도 한 단계다.
    beginHistoryGesture();
    assert.equal(isHistoryGestureActive(), true);
    setBpm(start + 3); tick(COALESCE_PAUSE_MS); setBpm(start + 7); tick(5000); setBpm(start + 11);
    assert.equal(history().past.length, 1, '끌기 도중 멈춤이 있어도 한 단계');
    // 끌기 도중에는 실행 취소·다시 실행이 아무것도 하지 않는다(끌던 값과 어긋나지 않게).
    history().undo(); history().redo();
    assert.equal(bpm(), start + 11, '끌기 도중 실행 취소는 무시한다');
    assert.equal(history().past.length, 1);
    endHistoryGesture();
    assert.equal(isHistoryGestureActive(), false);
    history().undo();
    assert.equal(bpm(), start, '끌기 한 번은 실행 취소 한 번에 처음 값으로 돌아온다');
    assert.equal(history().past.length, 0);
    history().redo();
    assert.equal(bpm(), start + 11, '다시 실행은 끌기가 끝난 값으로 간다');

    // 같은 노브를 이어서 두 번 끌면(사이 간격이 매우 짧아도) 두 단계다.
    history().clear();
    beginHistoryGesture(); setBpm(start + 20); setBpm(start + 25); endHistoryGesture();
    beginHistoryGesture(); setBpm(start + 30); setBpm(start + 35); endHistoryGesture();
    assert.equal(history().past.length, 2, '끌기 둘은 두 단계(사이 시간이 0 이어도)');
    history().undo(); assert.equal(bpm(), start + 25);
    history().undo(); assert.equal(bpm(), start + 11);

    // 앞 끌기가 끝 신호 없이 남아 있어도(포인터를 잃은 경우) 새 끌기가 시작되면 새 단계다.
    history().clear();
    beginHistoryGesture(); setBpm(start + 80);
    beginHistoryGesture(); setBpm(start + 81);
    assert.equal(history().past.length, 2, '끝 신호가 없었어도 새 끌기는 새 단계');
    endHistoryGesture();

    // 끌기 도중에 기록을 비워도(앱을 다시 열 때) 이어지는 변화는 새 기록으로 시작한다.
    history().clear();
    beginHistoryGesture(); setBpm(start + 82);
    history().clear();
    setBpm(start + 83);
    assert.equal(history().past.length, 1, '기록을 비운 뒤의 변화는 새 단계');
    endHistoryGesture();

    // 끌기가 끝난 뒤의 키보드 변화는 방금 끌기에 묶이지 않고 새 단계다.
    history().clear();
    beginHistoryGesture(); setBpm(start + 40); endHistoryGesture();
    setBpm(start + 41);
    assert.equal(history().past.length, 2, '끌기 직후 같은 노브 키보드 변화는 새 단계');

    // 누르기만 하고 값이 안 바뀌면 단계가 생기지 않는다.
    history().clear();
    beginHistoryGesture(); tick(2000); endHistoryGesture();
    assert.equal(history().past.length, 0, '값이 안 바뀐 끌기는 기록하지 않는다');

    // 끌기 도중 구조가 바뀌면(순서 바꾸기 등) 그것은 따로 한 단계고, 그 뒤의 값 변화는 또 새 단계다.
    history().clear();
    const beforeMixed = bpm();
    beginHistoryGesture();
    setBpm(start + 50); setBpm(start + 51);
    pedal().reorderPedals(0, 1);
    setBpm(start + 52); setBpm(start + 53);
    assert.equal(history().past.length, 3, '값 변화 / 순서 바꾸기 / 이어진 값 변화 — 세 단계');
    endHistoryGesture();
    history().undo(); history().undo(); history().undo();
    assert.equal(bpm(), beforeMixed, '세 번 되돌리면 처음으로');
    history().clear();

    // 두 값이 한꺼번에 바뀌는 노브도(한 번의 호출로 params 둘) 끌기 한 단계에 묶인다.
    const beforeTwo = bpm();
    beginHistoryGesture();
    const twoParams = (a, b) => pedal().setPedals(pedal().pedals.map((p) => (p.id === 'delay' ? { ...p, params: { ...p.params, bpm: a, feedback: b } } : p)));
    twoParams(start + 60, 31); twoParams(start + 61, 32);
    assert.equal(history().past.length, 1, '두 값을 함께 바꾸는 끌기도 한 단계');
    endHistoryGesture();
    history().undo();
    assert.equal(bpm(), beforeTwo, '두 값을 함께 바꾼 끌기도 한 번에 돌아온다');
    history().clear();

    // 음량 보정이 함께 바뀌면(프리셋 불러오기) 끌기 도중이라도 새 단계다.
    beginHistoryGesture();
    setBpm(start + 70);
    pedal().setPedals(pedal().pedals.map((p) => (p.id === 'delay' ? { ...p, params: { ...p.params, bpm: start + 71 } } : p)), -4);
    setBpm(start + 72);
    assert.equal(history().past.length, 3, '보정이 바뀐 변화는 끌기에 묶이지 않는다');
    endHistoryGesture();
    history().clear();

    // 끝 신호가 와도 끌기가 없으면 아무 일도 없다(창 전체의 pointerup 안전장치가 부른다).
    endHistoryGesture();
    assert.equal(isHistoryGestureActive(), false);
    assert.equal(history().past.length, 0);
  } finally {
    endHistoryGesture();
    Date.now = realNow;
  }

  // 50단계 한도: 60번 고치면 가장 오래된 10단계는 사라지고, 50번 되돌리면 더 못 간다.
  history().clear();
  const ids = pedal().pedals.map((p) => p.id);
  const states = [JSON.stringify(pedal().pedals)];
  for (let i = 0; i < 60; i += 1) {
    const id = ids[i % ids.length];
    pedal().setActive(id, !pedal().pedals.find((p) => p.id === id).active);
    states.push(JSON.stringify(pedal().pedals));
  }
  assert.equal(history().past.length, 50, '기록은 50단계까지');
  for (let i = 0; i < 50; i += 1) history().undo();
  assert.equal(history().past.length, 0);
  assert.equal(JSON.stringify(pedal().pedals), states[10], '50번 되돌리면 10번째 변경 직후 상태(가장 오래된 10단계는 잊힌다)');
  const rebuildsBefore = rebuilds;
  history().undo();
  assert.equal(JSON.stringify(pedal().pedals), states[10], '더 이상 되돌릴 것이 없으면 아무 일도 없다');
  assert.equal(rebuilds, rebuildsBefore, '되돌릴 것이 없으면 체인을 다시 만들지도 않는다');
  for (let i = 0; i < 50; i += 1) history().redo();
  assert.equal(JSON.stringify(pedal().pedals), states[60], '50번 다시 실행하면 끝 상태');
  assert.equal(history().future.length, 0);

  // 프리셋 불러오기(페달 전부 + 음량 보정)를 한 번에 되돌린다.
  history().clear();
  const trimBefore = pedal().presetTrimDb;
  const pedalsBefore = JSON.stringify(pedal().pedals);
  pedal().setPedals(pedal().pedals.map((p) => (p.id === 'delay' ? { ...p, params: { ...p.params, bpm: 91 } } : { ...p, active: !p.active })), trimBefore - 3.5);
  assert.equal(history().past.length, 1, '프리셋 불러오기는 한 단계');
  history().undo();
  assert.equal(JSON.stringify(pedal().pedals), pedalsBefore, '프리셋 불러오기를 되돌리면 페달이 모두 돌아온다');
  assert.equal(pedal().presetTrimDb, trimBefore, '음량 보정도 함께 돌아온다');
  history().redo();
  assert.equal(pedal().presetTrimDb, trimBefore - 3.5, '다시 실행하면 보정도 다시 간다');
}
console.log('History regression passed: toggle, reorder, preset, knob coalescing, redo invalidation, engine rebuild, reference preservation, gesture grouping (one drag = one step), 50-step cap, preset load undo.');
