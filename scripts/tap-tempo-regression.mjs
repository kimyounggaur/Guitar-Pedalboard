import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { installFakeElement, FakeElement } from './lib/fake-element.mjs';
import { byClass, find, textContent } from './lib/html-tree.mjs';
import { createSsrHarness } from './lib/ssr-harness.mjs';

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

// ── 스토어: 전역 BPM 이 동기된 페달에만, 엔진을 다시 만들지 않고 적용된다 ─────────────────────────────────────────
// 실제 audioStore·pedalStore 를 올리고, 엔진 호출만 기록한다. 소스를 글자로 읽던 검사(S4.7 이전)를 실행 결과 검사로 바꿨다.
const recordSwitch = `export function ToggleSwitch(props: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  (globalThis as any).__ssrCalls.push({ component: 'ToggleSwitch', ...props });
  return <span data-toggle={props.label} />;
}`;
const harness = await createSsrHarness({
  extraExports: [
    "{ AudioEngine } from './audio/AudioEngine.ts'",
    "{ useAudioStore } from './store/audioStore.ts'",
    "{ usePedalStore } from './store/pedalStore.ts'",
    "{ createShortcutKeydownHandler } from './input/ShortcutService.ts'",
    "{ DelayPedal } from './components/effects/DelayPedal.tsx'",
    "{ TremoloPedal } from './components/effects/TremoloPedal.tsx'",
  ],
  stubs: { 'components/ToggleSwitch': recordSwitch },
});
const { AudioEngine, DelayPedal, TremoloPedal, createShortcutKeydownHandler, useAudioStore, usePedalStore } = harness.exports;
const pedalOf = (id) => usePedalStore.getState().pedals.find((pedal) => pedal.id === id);
const delayId = usePedalStore.getState().pedals.find((pedal) => pedal.type === 'delay').id;
const tremoloId = usePedalStore.getState().pedals.find((pedal) => pedal.type === 'tremolo').id;

// 상태 모양: { taps, bpm }. 처음에는 탭이 없고 기본 120 BPM 이다.
assert.deepEqual(useAudioStore.getState().tapTempo, { taps: [], bpm: 120 });

// 엔진 호출 기록: 호출 순간의 스토어 값도 함께 적어, "스토어를 먼저 바꾸고 그 뒤에 엔진" 순서를 본다.
const engine = AudioEngine.getInstance();
const engineCalls = [];
let rebuilds = 0;
engine.setPedalParam = (id, key, value) => {
  engineCalls.push({ id, key, value, storeBpm: pedalOf(id).params.bpm, storeSync: pedalOf(id).params.sync });
};
engine.rebuildChain = () => {
  rebuilds += 1;
};
const patchParams = (id, params) => {
  usePedalStore.getState().setPedals(
    usePedalStore.getState().pedals.map((pedal) => (pedal.id === id ? { ...pedal, params: { ...pedal.params, ...params } } : pedal)),
  );
};

// Delay 는 동기(sync) 켬 · BPM 100, Tremolo 는 동기 끔 · BPM 77.
patchParams(delayId, { sync: true, bpm: 100 });
patchParams(tremoloId, { sync: false, bpm: 77 });
let before = usePedalStore.getState().pedals;

useAudioStore.getState().setGlobalBpm(90);
assert.deepEqual(useAudioStore.getState().tapTempo, { taps: [], bpm: 90 });
assert.equal(pedalOf(delayId).params.bpm, 90, '동기된 페달은 전역 BPM 을 따릅니다.');
assert.equal(pedalOf(tremoloId).params.bpm, 77, '동기가 꺼진 페달의 BPM 은 그대로입니다.');
const changedPedalIds = (previous) => usePedalStore.getState().pedals
  .filter((pedal, index) => JSON.stringify(pedal) !== JSON.stringify(previous[index]))
  .map((pedal) => pedal.id);
assert.deepEqual(changedPedalIds(before), [delayId], '바뀐 페달은 동기된 페달 하나뿐입니다.');
assert.deepEqual(engineCalls, [{ id: delayId, key: 'bpm', value: 90, storeBpm: 90, storeSync: true }], '엔진에는 스토어를 바꾼 뒤 BPM 만 전합니다.');
assert.equal(rebuilds, 0, 'BPM 이 바뀌어도 체인을 다시 만들지 않습니다.');
// 같은 값이면 아무것도 하지 않는다.
useAudioStore.getState().setGlobalBpm(90);
assert.equal(engineCalls.length, 1);
// 범위를 벗어난 값은 40~240 으로 잘린다.
useAudioStore.getState().setGlobalBpm(999);
assert.equal(useAudioStore.getState().tapTempo.bpm, 240);
assert.equal(pedalOf(delayId).params.bpm, 240);
useAudioStore.getState().setGlobalBpm(90);
engineCalls.length = 0;

// 페달별 동기 켜기/끄기: 켜면 전역 BPM 을 가져오고(sync 만 엔진에 전한다), 끄면 BPM 은 그대로 둔다.
useAudioStore.getState().setTempoSync(tremoloId, true);
assert.deepEqual({ sync: pedalOf(tremoloId).params.sync, bpm: pedalOf(tremoloId).params.bpm }, { sync: true, bpm: 90 });
assert.deepEqual(engineCalls, [{ id: tremoloId, key: 'sync', value: true, storeBpm: 90, storeSync: true }]);
useAudioStore.getState().setTempoSync(tremoloId, false);
assert.deepEqual({ sync: pedalOf(tremoloId).params.sync, bpm: pedalOf(tremoloId).params.bpm }, { sync: false, bpm: 90 });
assert.equal(engineCalls.length, 2);
useAudioStore.getState().setTempoSync(tremoloId, false);
assert.equal(engineCalls.length, 2, '이미 같은 상태면 엔진을 다시 부르지 않습니다.');
const nonTempoId = usePedalStore.getState().pedals.find((pedal) => pedal.type !== 'delay' && pedal.type !== 'tremolo').id;
before = usePedalStore.getState().pedals;
useAudioStore.getState().setTempoSync(nonTempoId, true);
assert.deepEqual(changedPedalIds(before), [], '템포 페달이 아니면 아무것도 바꾸지 않습니다.');
assert.equal(engineCalls.length, 2);

// 탭: 한 번 누르면 전역 BPM 도 페달도 그대로, 두 번째 탭부터 동기된 페달에 적용된다.
let clock = 10_000;
// performance.now 는 프로토타입의 메서드라 객체 자신에 덮어 쓰고, 끝나면 그 덮어쓴 것을 지워 원래대로 돌린다.
Object.defineProperty(globalThis.performance, 'now', { configurable: true, value: () => clock });
try {
  useAudioStore.setState({ tapTempo: { taps: [], bpm: 90 } });
  patchParams(delayId, { bpm: 100 }); // 전역 BPM(90)과 다르게 두어, 첫 탭이 페달에 적용되면 드러나게 한다.
  engineCalls.length = 0;
  useAudioStore.getState().tapTempoTap();
  assert.deepEqual(useAudioStore.getState().tapTempo, { taps: [10_000], bpm: 90 });
  assert.equal(engineCalls.length, 0, '첫 탭은 페달을 바꾸지 않습니다.');
  assert.equal(pedalOf(delayId).params.bpm, 100);
  clock = 10_500;
  useAudioStore.getState().tapTempoTap();
  assert.deepEqual(useAudioStore.getState().tapTempo, { taps: [10_000, 10_500], bpm: 120 });
  assert.equal(pedalOf(delayId).params.bpm, 120, '두 번째 탭부터 동기된 페달에 BPM 이 적용됩니다.');
  assert.deepEqual(engineCalls, [{ id: delayId, key: 'bpm', value: 120, storeBpm: 120, storeSync: true }]);
  assert.equal(rebuilds, 0);
} finally {
  delete globalThis.performance.now;
}

// 저장된 보드에 동기된 페달이 있으면 그 BPM 을 전역 BPM 으로 이어받는다(adoptTempoFromPedals).
patchParams(delayId, { sync: true, bpm: 133 });
useAudioStore.getState().adoptTempoFromPedals();
assert.deepEqual(useAudioStore.getState().tapTempo, { taps: [], bpm: 133 });

// ── 화면: Delay·Tremolo 둘 다 TAP 버튼(TapTempoControl)을 그리고, Sync 스위치는 자기 페달만 동기시킨다 ─────────────────
patchParams(delayId, { sync: false, bpm: 120 });
patchParams(tremoloId, { sync: false, bpm: 120 });
for (const [label, component, id] of [['Delay', DelayPedal, delayId], ['Tremolo', TremoloPedal, tremoloId]]) {
  harness.calls.length = 0;
  const tree = harness.render(component, { pedalId: id, params: pedalOf(id).params, onChange() {} });
  const tapButton = find(tree, byClass('tap-tempo-button'));
  assert.ok(tapButton, `${label}: TAP 버튼(TapTempoControl)이 그려져야 합니다.`);
  assert.equal(tapButton.attrs.title, '탭 템포 (T)');
  // 서버 렌더는 스토어의 처음 상태를 그린다(zustand 의 서버 스냅샷).
  assert.equal(textContent(find(tree, byClass('tap-tempo-status'))), `${useAudioStore.getInitialState().tapTempo.bpm} BPM · 0/4`);
  const syncSwitch = harness.calls.find((call) => call.label === 'Sync');
  assert.ok(syncSwitch, `${label}: Sync 스위치가 있어야 합니다.`);
  syncSwitch.onChange(true);
  assert.equal(pedalOf(id).params.sync, true, `${label}: Sync 스위치는 자기 페달을 동기시킵니다.`);
  const otherId = id === delayId ? tremoloId : delayId;
  assert.equal(pedalOf(otherId).params.sync, false, `${label}: 다른 페달은 건드리지 않습니다.`);
  syncSwitch.onChange(false);
  assert.equal(pedalOf(id).params.sync, false);
}

// ── T 단축키: 실제 keydown 처리기를 거쳐 탭 템포가 불리는 때와 막히는 때 ────────────────────────────────────────────
const restoreElement = installFakeElement();
let tapCalls = 0;
useAudioStore.setState({ tapTempoTap: () => { tapCalls += 1; } });
const keydown = createShortcutKeydownHandler({ isHelpOpen: () => false, openHelp() {}, closeHelp() {} });
function press(init, target = new FakeElement('body')) {
  const record = { prevented: 0 };
  keydown({
    key: 't', repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init, target,
    preventDefault() { record.prevented += 1; },
    stopPropagation() {},
  });
  return record;
}
const tapsFrom = (init, target) => {
  const sent = tapCalls;
  const record = press(init, target);
  return { taps: tapCalls - sent, prevented: record.prevented };
};
assert.deepEqual(tapsFrom({}), { taps: 1, prevented: 1 }, 'T 는 탭 템포이고 기본 동작은 막습니다.');
assert.deepEqual(tapsFrom({ key: 'ㅅ', code: 'KeyT', isComposing: true }), { taps: 1, prevented: 1 }, '한글 입력 상태에서도 물리 키 T 는 탭 템포입니다.');
for (const [label, init] of [
  ['누르고 있는 반복', { repeat: true }],
  ['조합 중인 글자(code 없음)', { isComposing: true }],
  ['Ctrl+T', { ctrlKey: true }],
  ['⌘+T', { metaKey: true }],
  ['Alt+T', { altKey: true }],
  ['Shift+T', { shiftKey: true }],
  ['Shift+T(물리 키)', { key: 'T', code: 'KeyT', shiftKey: true }],
  ['Ctrl+T(물리 키)', { key: 't', code: 'KeyT', ctrlKey: true }],
  ['반복(물리 키)', { key: 't', code: 'KeyT', repeat: true }],
]) {
  assert.deepEqual(tapsFrom(init), { taps: 0, prevented: 0 }, `${label} 은 탭 템포가 아닙니다.`);
}
for (const [label, target] of [
  ['input', new FakeElement('input', { type: 'text' })],
  ['select', new FakeElement('select')],
  ['textarea', new FakeElement('textarea')],
  ['contenteditable', new FakeElement('div', { matches: ['[contenteditable]:not([contenteditable="false"])'] })],
]) {
  assert.deepEqual(tapsFrom({}, target), { taps: 0, prevented: 0 }, `${label} 에 포커스가 있으면 T 는 글자 입력입니다.`);
}
restoreElement();
harness.restore();

console.log(
  'Tap tempo regression passed: four-tap median, gap reset, clamped global BPM, synced-only updates without rebuild, per-pedal Sync, Delay/Tremolo TAP UI and guarded T shortcut.',
);
