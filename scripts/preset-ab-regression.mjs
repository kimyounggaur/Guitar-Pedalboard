import assert from 'node:assert/strict';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import { FakeElement, installFakeElement } from './lib/fake-element.mjs';
import { byClass, find, findAll, textContent } from './lib/html-tree.mjs';
import { createSsrHarness, hostText } from './lib/ssr-harness.mjs';

// S2.4: 사용자 프리셋과 작업 상태는 v2 키에 쓴다(옛 v1 키는 백업이라 앱이 다시 쓰지 않는다).
const USER_PRESETS_KEY = 'guitar-pedalboard:v2:presets';
const PEDAL_STATE_KEY = 'guitar-pedalboard:v2:state';
const storageWrites = [];
const storageValues = new Map();
globalThis.window = {
  dispatchEvent() {},
  localStorage: {
    getItem(key) {
      return storageValues.get(key) ?? null;
    },
    setItem(key, value) {
      storageWrites.push({ key, value });
      storageValues.set(key, value);
    },
    removeItem(key) {
      storageValues.delete(key);
    },
  },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

// 실제 스토어·엔진·화면 컴포넌트를 올린다. 화면 구조와 처리기는 소스를 글자로 읽는 대신 그려서(SSR) 확인한다(S4.7).
const harness = await createSsrHarness({
  extraExports: [
    "{ AudioEngine } from './audio/AudioEngine.ts'",
    "{ CabEffect } from './audio/nodes/CabEffect.ts'",
    "{ useAudioStore } from './store/audioStore.ts'",
    "{ clonePedals, usePedalStore } from './store/pedalStore.ts'",
    "{ usePresetStore, parsePresetJson, applyPresetPedals } from './store/presetStore.ts'",
    "{ useToastStore } from './store/toastStore.ts'",
    "{ resetToDefaultChain } from './store/chainActions.ts'",
    "{ PresetPanel } from './components/PresetPanel.tsx'",
    "{ GlobalKeyboardShortcuts } from './components/GlobalKeyboardShortcuts.tsx'",
    "{ createShortcutKeydownHandler } from './input/ShortcutService.ts'",
  ],
  windowOverrides: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) },
});
const {
  AudioEngine, CabEffect, GlobalKeyboardShortcuts, PresetPanel, applyPresetPedals, clonePedals, createShortcutKeydownHandler,
  parsePresetJson, resetToDefaultChain, useAudioStore, usePedalStore, usePresetStore, useToastStore,
} = harness.exports;

function pedalsWithTempo(bpm, driveAmount) {
  return clonePedals(usePedalStore.getState().pedals).map((pedal) => {
    if (pedal.id === 'delay') {
      return {
        ...pedal,
        params: { ...pedal.params, sync: true, bpm },
      };
    }
    if (pedal.id === 'tremolo') {
      return {
        ...pedal,
        params: { ...pedal.params, sync: false },
      };
    }
    if (pedal.id === 'drive') {
      return {
        ...pedal,
        params: { ...pedal.params, drive: driveAmount },
      };
    }
    return pedal;
  });
}

const engine = AudioEngine.getInstance();
const originalRebuildChain = engine.rebuildChain;
let rebuildCount = 0;
engine.rebuildChain = () => {
  rebuildCount += 1;
};

try {
  // 처음 상태: 슬롯 둘이 모두 비어 있고 A 가 활성이며, 슬롯의 음량 보정은 0 dB 이다.
  const freshSlots = usePresetStore.getState();
  assert.deepEqual(
    { slotA: freshSlots.slotA, slotB: freshSlots.slotB, slotATrimDb: freshSlots.slotATrimDb, slotBTrimDb: freshSlots.slotBTrimDb, activeSlot: freshSlots.activeSlot },
    { slotA: null, slotB: null, slotATrimDb: 0, slotBTrimDb: 0, activeSlot: 'A' },
  );
  usePresetStore.setState({ slotA: null, slotB: null, activeSlot: 'A' });
  assert.equal(usePresetStore.getState().slotA, null);
  assert.equal(usePresetStore.getState().slotB, null);
  assert.equal(usePresetStore.getState().activeSlot, 'A');
  const sourceA = pedalsWithTempo(137, 23);
  usePedalStore.getState().setPedals(sourceA);
  const presetWritesBeforeCapture = storageWrites.filter(
    ({ key }) => key === USER_PRESETS_KEY,
  ).length;
  usePresetStore.getState().captureCurrentToSlot('A');

  let presetState = usePresetStore.getState();
  assert.equal(presetState.activeSlot, 'A');
  assert.ok(presetState.slotA);
  assert.notEqual(presetState.slotA, usePedalStore.getState().pedals, '슬롯 배열 deep copy 누락');
  assert.notEqual(
    presetState.slotA[0].params,
    usePedalStore.getState().pedals[0].params,
    '슬롯 params deep copy 누락',
  );
  assert.equal(
    storageWrites.filter(({ key }) => key === USER_PRESETS_KEY).length,
    presetWritesBeforeCapture,
    '세션 슬롯 캡처가 사용자 프리셋 localStorage를 변경했습니다.',
  );

  usePedalStore.getState().updatePedalParam('drive', 'drive', 91);
  assert.equal(
    usePresetStore.getState().slotA.find((pedal) => pedal.id === 'drive').params.drive,
    23,
    '캡처 이후 현재 체인 변경이 슬롯에 누출되었습니다.',
  );

  const firstSlotA = usePresetStore.getState().slotA;
  const overwrittenA = pedalsWithTempo(149, 44)
    .map((pedal) =>
      pedal.id === 'drive' ? { ...pedal, active: false } : pedal,
    )
    .reverse();
  usePedalStore.getState().setPedals(overwrittenA);
  usePresetStore.getState().captureCurrentToSlot('A');
  presetState = usePresetStore.getState();
  assert.notEqual(presetState.slotA, firstSlotA, 'A 슬롯 덮어쓰기가 새 snapshot을 만들지 않았습니다.');
  assert.equal(presetState.slotA.find((pedal) => pedal.id === 'delay').params.bpm, 149);
  assert.equal(presetState.slotA.find((pedal) => pedal.id === 'drive').params.drive, 44);

  usePedalStore.getState().setPedals(pedalsWithTempo(173, 67));
  usePresetStore.getState().captureCurrentToSlot('B');
  assert.equal(usePresetStore.getState().activeSlot, 'B');
  assert.equal(
    usePresetStore.getState().slotB.find((pedal) => pedal.id === 'delay').params.bpm,
    173,
  );

  const savedSlotB = usePresetStore.getState().slotB;
  usePresetStore.setState({ slotB: null, activeSlot: 'A' });
  const pedalsBeforeEmptyActivation = JSON.stringify(usePedalStore.getState().pedals);
  rebuildCount = 0;
  assert.equal(usePresetStore.getState().activateSlot('B'), false, '빈 슬롯 활성화 결과');
  assert.equal(usePresetStore.getState().activeSlot, 'A', '빈 슬롯이 activeSlot을 변경했습니다.');
  assert.equal(JSON.stringify(usePedalStore.getState().pedals), pedalsBeforeEmptyActivation);
  assert.equal(rebuildCount, 0, '빈 슬롯이 체인을 rebuild했습니다.');

  // 사용자 IR(S5.4): 저장된 IR 은 값·순서 변경이나 슬롯 불러오기로 지워지지 않고, 쓸지는 Cab 모델('내 IR')이 정한다.
  class MockParam {
    value = 0;
    cancelScheduledValues() {}
    setValueAtTime(value) { this.value = value; }
    setTargetAtTime(value) { this.value = value; }
    linearRampToValueAtTime(value) { this.value = value; }
  }
  class MockNode {
    gain = new MockParam(); frequency = new MockParam(); Q = new MockParam();
    connect() {} disconnect() {}
  }
  let convolver;
  const context = {
    sampleRate: 48000, currentTime: 0,
    createGain: () => new MockNode(), createBiquadFilter: () => new MockNode(),
    createConvolver: () => { convolver = new MockNode(); convolver.buffer = null; return convolver; },
    createBuffer: (count, length) => {
      const data = Array.from({ length: count }, () => new Float32Array(length));
      return { numberOfChannels: count, getChannelData: (channel) => data[channel] };
    },
  };
  const library = engine.cabinetIrs;
  const customBuffer = { numberOfChannels: 1, length: 3, getChannelData: () => new Float32Array([0, 0.2, -0.1]) };
  library.stored = { name: 'custom.wav', sampleRate: 48000, cut: false, originalSeconds: 0.1, channels: [new Float32Array([0, 0.2, -0.1])], savedAt: 1 };
  library.revision += 1;
  library.prepared = { buffer: customBuffer, makeupDb: 0, revision: library.revision, sampleRate: 48000 };
  // IR 교체는 페이드 뒤 타이머로 일어난다 — 걸린 타이머를 모두 실행해 최종 상태를 본다.
  const timerQueue = [];
  const flushTimers = () => { while (timerQueue.length) timerQueue.shift()(); };
  const timers = { setTimeout: (callback) => { timerQueue.push(callback); return timerQueue.length; }, clearTimeout: () => {} };
  const storeCab = () => usePedalStore.getState().pedals.find((pedal) => pedal.id === 'cab');
  usePedalStore.getState().updatePedalParam('cab', 'model', 'my-ir');
  const cab = new CabEffect(context, storeCab(), timers, () => library.ready(48000));
  assert.equal(convolver.buffer, customBuffer, "모델이 '내 IR' 이면 사용자 IR 이 컨볼버에 들어간다");
  engine.effects.set('cab', cab);
  usePedalStore.getState().updatePedalParam('cab', 'lowCut', 90);
  usePedalStore.getState().setPedals([...usePedalStore.getState().pedals].reverse());
  assert.equal(engine.getCabinetIrInfo().name, 'custom.wav', '값·순서를 바꿔도 저장된 IR 은 그대로다');
  usePresetStore.setState({ slotB: savedSlotB });
  useAudioStore.setState({ tapTempo: { taps: [1_000, 1_500], bpm: 120 } });
  assert.equal(usePresetStore.getState().activateSlot('A'), true);
  assert.equal(storeCab().params.model, 'v30-4x12', '슬롯 A 의 Cab 모델이 적용된다');
  assert.equal(engine.getCabinetIrInfo().name, 'custom.wav', '슬롯을 불러와도 저장된 IR 은 지워지지 않는다');
  // 엔진은 체인을 다시 만들 때 이펙트에 update 를 준다 — 그때 Cab 은 모델대로 만든 IR 로 돌아간다.
  cab.update(storeCab());
  flushTimers();
  assert.notEqual(convolver.buffer, customBuffer, '모델이 바뀌면 활성 CabEffect 는 사용자 IR 쓰기를 멈춘다');
  usePedalStore.getState().updatePedalParam('cab', 'model', 'my-ir');
  cab.update(storeCab());
  flushTimers();
  assert.equal(convolver.buffer, customBuffer, "다시 '내 IR' 을 고르면 저장된 IR 을 쓴다");
  usePedalStore.getState().updatePedalParam('cab', 'model', 'v30-4x12');
  library.stored = null;
  library.revision += 1;
  library.prepared = null;
  assert.equal(usePresetStore.getState().activeSlot, 'A');
  assert.equal(rebuildCount, 1);
  assert.equal(
    usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').params.bpm,
    149,
  );
  assert.deepEqual(
    usePedalStore.getState().pedals,
    usePresetStore.getState().slotA,
    '슬롯의 순서/enabled/bypass/params가 완전히 복원되지 않았습니다.',
  );
  assert.deepEqual(useAudioStore.getState().tapTempo, { taps: [], bpm: 149 });
  assert.notEqual(
    usePedalStore.getState().pedals,
    usePresetStore.getState().slotA,
    '활성화된 체인이 슬롯 배열을 공유합니다.',
  );

  usePedalStore.getState().updatePedalParam('delay', 'bpm', 205);
  assert.equal(
    usePresetStore.getState().slotA.find((pedal) => pedal.id === 'delay').params.bpm,
    149,
    '활성화 후 현재 체인 변경이 슬롯에 누출되었습니다.',
  );

  usePresetStore.getState().savePreset('A/B storage isolation', usePedalStore.getState().pedals);
  const exported = JSON.parse(usePresetStore.getState().exportPresets());
  assert.deepEqual(
    Object.keys(exported).sort(),
    ['appVersion', 'exportedAt', 'format', 'presets', 'schemaVersion'],
    'Export payload에 세션 슬롯 필드가 포함되었습니다.',
  );
  assert.ok(!('slotA' in exported) && !('slotB' in exported) && !('activeSlot' in exported));
  assert.ok(
    storageWrites.some(({ key }) => key === USER_PRESETS_KEY),
    '사용자 프리셋 localStorage 검증용 write가 발생하지 않았습니다.',
  );
  assert.ok(
    storageWrites
      .filter(({ key }) => key === USER_PRESETS_KEY)
      .every(({ value }) => !/"slotA"|"slotB"|"activeSlot"/.test(value)),
    '사용자 프리셋 localStorage에 세션 슬롯이 저장되었습니다.',
  );

  // ── 슬롯에는 음량 보정(S1.4c)도 담겨, 슬롯을 켜면 함께 적용된다 ───────────────────────────────────────
  usePedalStore.getState().setPedals(clonePedals(usePedalStore.getState().pedals), 3);
  usePresetStore.getState().captureCurrentToSlot('A');
  usePedalStore.getState().setPedals(clonePedals(usePedalStore.getState().pedals), -2);
  usePresetStore.getState().captureCurrentToSlot('B');
  usePedalStore.getState().setPedals(clonePedals(usePedalStore.getState().pedals), 0);
  usePresetStore.getState().activateSlot('A');
  assert.equal(usePedalStore.getState().presetTrimDb, 3, '슬롯 A 를 켜면 A 에 담긴 음량 보정이 적용됩니다.');
  usePresetStore.getState().activateSlot('B');
  assert.equal(usePedalStore.getState().presetTrimDb, -2, '슬롯 B 를 켜면 B 에 담긴 음량 보정이 적용됩니다.');

  // ── 프리셋을 적용하는 하나의 길: 페달·음량 보정 → 템포 이어받기 → 체인 재구성 (이 순서). 사용자 IR 은 건드리지 않는다(S5.4) ──────
  // 엔진·스토어 함수를 감싸 호출 순서만 기록한다(실제 동작은 그대로 실행).
  const orderOf = (action) => {
    const order = [];
    const restorers = [];
    const wrapEngine = (name) => {
      const original = engine[name];
      engine[name] = (...args) => {
        order.push(name);
        return original.apply(engine, args);
      };
      restorers.push(() => {
        engine[name] = original;
      });
    };
    const wrapStore = (store, name) => {
      const original = store.getState()[name];
      store.setState({ [name]: (...args) => {
        order.push(name);
        return original(...args);
      } });
      restorers.push(() => store.setState({ [name]: original }));
    };
    wrapEngine('rebuildChain');
    wrapStore(usePedalStore, 'setPedals');
    wrapStore(usePedalStore, 'resetPedalOrder');
    wrapStore(useAudioStore, 'adoptTempoFromPedals');
    try {
      action();
    } finally {
      restorers.reverse().forEach((restore) => restore());
    }
    return order;
  };
  const APPLY_ORDER = ['setPedals', 'adoptTempoFromPedals', 'rebuildChain'];
  const studio = usePresetStore.getState().presets.find((preset) => preset.name === 'Studio Clean');
  assert.ok(studio, '팩토리 프리셋 Studio Clean 이 목록에 있어야 합니다.');
  assert.deepEqual(orderOf(() => applyPresetPedals(studio.pedals, studio.trimDb)), APPLY_ORDER);
  assert.deepEqual(usePedalStore.getState().pedals, studio.pedals);
  assert.equal(usePedalStore.getState().presetTrimDb, studio.trimDb ?? 0);
  usePedalStore.getState().setPedals(clonePedals(usePedalStore.getState().pedals), -4);
  applyPresetPedals(studio.pedals);
  assert.equal(usePedalStore.getState().presetTrimDb, 0, '음량 보정이 없는 프리셋을 불러오면 앞 프리셋의 보정이 남지 않습니다.');

  // ── 화면 처리기: 패널의 프리셋 불러오기·기본 페달 설정·A/B 단추가 같은 길을 쓴다 ─────────────────────────────────
  harness.render(PresetPanel);
  const loadButton = harness.findHost('button', (props) => props.className === 'preset-load-button' && hostText(props.children).startsWith('Warm Jazz Clean'));
  assert.ok(loadButton, '프리셋 목록에 불러오기 단추가 있어야 합니다.');
  const warm = usePresetStore.getState().presets.find((preset) => preset.name === 'Warm Jazz Clean');
  usePedalStore.getState().setPedals(clonePedals(usePedalStore.getState().pedals).reverse(), 5);
  assert.deepEqual(orderOf(() => loadButton.props.onClick()), APPLY_ORDER, '패널에서 프리셋을 불러오면 applyPresetPedals 와 같은 길을 지납니다.');
  assert.deepEqual(usePedalStore.getState().pedals, warm.pedals);
  assert.equal(usePedalStore.getState().presetTrimDb, warm.trimDb ?? 0);

  const resetButton = harness.findHost('button', (props) => typeof props.className === 'string' && props.className.includes('preset-reset-button'));
  assert.equal(hostText(resetButton.props.children).trim(), '기본 페달 설정');
  usePedalStore.getState().setPedals(clonePedals(usePedalStore.getState().pedals).reverse(), 0);
  assert.deepEqual(orderOf(() => resetButton.props.onClick()), ['resetPedalOrder', 'rebuildChain'], "'기본 페달 설정' 은 순서·값 되돌리기 → 체인 재구성입니다.");
  assert.deepEqual(usePedalStore.getState().pedals, usePedalStore.getInitialState().pedals, '모든 페달이 처음 순서와 값으로 돌아옵니다.');
  assert.deepEqual(orderOf(() => resetButton.props.onClick()), [], '이미 기본 페달 설정이면 아무것도 바꾸지 않습니다.');
  assert.deepEqual(orderOf(() => resetToDefaultChain()), ['resetPedalOrder', 'rebuildChain'], 'resetToDefaultChain 의 순서');

  // ── A/B 도구줄: 단추 넷, 빈 슬롯은 켤 수 없고, 켜진 슬롯만 눌림 표시, 상태 문구는 정중한 알림 영역 ─────────────────
  const toolbarAt = (state) => {
    const restore = harness.serverState(usePresetStore, state);
    try {
      const tree = harness.render(PresetPanel);
      const buttons = findAll(find(tree, byClass('preset-ab-buttons')), (node) => node.tag === 'button');
      const status = find(find(tree, byClass('preset-ab-toolbar')), (node) => node.tag === 'p' && node.attrs.role === 'status');
      return {
        labels: buttons.map(textContent),
        disabled: buttons.map((button) => 'disabled' in button.attrs),
        pressed: buttons.map((button) => button.attrs['aria-pressed'] ?? null),
        live: status.attrs['aria-live'],
        status: textContent(status),
      };
    } finally {
      restore();
    }
  };
  const somePedals = usePedalStore.getState().pedals;
  assert.deepEqual(toolbarAt({ slotA: null, slotB: null, activeSlot: 'A' }), {
    labels: ['A', 'B', 'A←현재', 'B←현재'],
    disabled: [true, true, false, false],
    pressed: ['false', 'false', null, null],
    live: 'polite',
    status: 'A/B 비교 슬롯이 비어 있습니다.',
  });
  assert.deepEqual(toolbarAt({ slotA: somePedals, slotB: null, activeSlot: 'A' }), {
    labels: ['A', 'B', 'A←현재', 'B←현재'],
    disabled: [false, true, false, false],
    pressed: ['true', 'false', null, null],
    live: 'polite',
    status: 'A 슬롯 활성 · A 저장됨 · B 비어 있음',
  });
  assert.deepEqual(toolbarAt({ slotA: somePedals, slotB: somePedals, activeSlot: 'B' }), {
    labels: ['A', 'B', 'A←현재', 'B←현재'],
    disabled: [false, false, false, false],
    pressed: ['false', 'true', null, null],
    live: 'polite',
    status: 'B 슬롯 활성 · A 저장됨 · B 저장됨',
  });
  assert.deepEqual(toolbarAt({ slotA: null, slotB: somePedals, activeSlot: 'A' }).pressed, ['false', 'false', null, null], '빈 슬롯은 활성이어도 눌림 표시가 없습니다.');
  assert.deepEqual(toolbarAt({ slotA: somePedals, slotB: null, activeSlot: 'B' }).pressed, ['false', 'false', null, null], '비어 있는 B 슬롯은 활성이어도 눌림 표시가 없습니다.');

  // 단추 처리기: '←현재' 는 지금 체인을 그 슬롯에 담고, 'A'·'B' 는 그 슬롯을 켠다.
  harness.render(PresetPanel);
  const abButton = (label) => harness.findHost('button', (props) => hostText(props.children) === label);
  usePedalStore.getState().setPedals(pedalsWithTempo(161, 31));
  abButton('A←현재').props.onClick();
  assert.deepEqual(usePresetStore.getState().slotA, usePedalStore.getState().pedals);
  assert.equal(usePresetStore.getState().activeSlot, 'A');
  usePedalStore.getState().setPedals(pedalsWithTempo(97, 12));
  abButton('B←현재').props.onClick();
  assert.equal(usePresetStore.getState().activeSlot, 'B');
  rebuildCount = 0;
  abButton('A').props.onClick();
  assert.equal(usePresetStore.getState().activeSlot, 'A');
  assert.equal(usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').params.bpm, 161);
  assert.equal(rebuildCount, 1, '슬롯을 켜면 체인을 한 번 다시 만듭니다.');

  // ── 키보드: A·B 로 슬롯을 켜고, 막아야 할 때는 막으며, keydown 리스너는 캡처 단계로 하나만 달고 같은 것을 뗀다 ─────────
  const restoreElement = installFakeElement();
  const activated = [];
  const realActivateSlot = usePresetStore.getState().activateSlot;
  let activateResult = true;
  usePresetStore.setState({ activateSlot: (slot) => {
    activated.push(slot);
    return activateResult;
  } });
  const keydown = createShortcutKeydownHandler({ isHelpOpen: () => false, openHelp() {}, closeHelp() {} });
  const press = (init, target = new FakeElement('body')) => {
    const record = { prevented: 0 };
    keydown({
      key: 'a', repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init, target,
      preventDefault() { record.prevented += 1; },
      stopPropagation() {},
    });
    return record.prevented;
  };
  try {
    assert.equal(press({ key: 'a', code: 'KeyA' }), 1);
    assert.equal(press({ key: 'ㅠ', code: 'KeyB' }), 1, '한글 입력 상태의 B(물리 키)');
    assert.equal(press({ key: 'B' }), 1, 'code 가 없는 환경은 key 로 알아봅니다.');
    assert.deepEqual(activated, ['A', 'B', 'B']);
    activated.length = 0;
    for (const [label, init, target] of [
      ['누르고 있는 반복', { key: 'a', code: 'KeyA', repeat: true }],
      ['한글 조합 중인 글자(code 없음)', { key: 'a', isComposing: true }],
      ['Ctrl+A', { key: 'a', code: 'KeyA', ctrlKey: true }],
      ['⌘+A', { key: 'a', code: 'KeyA', metaKey: true }],
      ['Alt+A', { key: 'a', code: 'KeyA', altKey: true }],
      ['Shift+A', { key: 'A', code: 'KeyA', shiftKey: true }],
      ['input 에 포커스', { key: 'a', code: 'KeyA' }, new FakeElement('input', { type: 'text' })],
      ['select 에 포커스', { key: 'a', code: 'KeyA' }, new FakeElement('select')],
      ['textarea 에 포커스', { key: 'a', code: 'KeyA' }, new FakeElement('textarea')],
      ['contenteditable 에 포커스', { key: 'a', code: 'KeyA' }, new FakeElement('div', { matches: ['[contenteditable]:not([contenteditable="false"])'] })],
    ]) {
      assert.equal(press(init, target), 0, `${label} 에서는 슬롯을 켜지 않습니다.`);
    }
    assert.deepEqual(activated, [], '막힌 키는 activateSlot 을 부르지 않습니다.');
    activateResult = false; // 빈 슬롯: 켜지 못했으면 키의 기본 동작을 막지 않는다.
    assert.equal(press({ key: 'a', code: 'KeyA' }), 0);
    assert.deepEqual(activated, ['A']);
    activateResult = true;

    harness.render(GlobalKeyboardShortcuts);
    const added = [];
    const removed = [];
    const realAdd = globalThis.window.addEventListener;
    const realRemove = globalThis.window.removeEventListener;
    globalThis.window.addEventListener = (...args) => added.push(args);
    globalThis.window.removeEventListener = (...args) => removed.push(args);
    try {
      const effects = harness.runEffects();
      assert.deepEqual(added.map(([type, , options]) => [type, options]), [['keydown', { capture: true }]], 'keydown 은 캡처 단계로 하나만 듣습니다.');
      assert.deepEqual(removed, []);
      activated.length = 0;
      added[0][1]({
        key: 'b', code: 'KeyB', repeat: false, isComposing: false, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false,
        target: new FakeElement('body'), preventDefault() {}, stopPropagation() {},
      });
      assert.deepEqual(activated, ['B'], '달아 둔 처리기가 단축키를 실행합니다.');
      effects.cleanup();
      assert.deepEqual(removed.map(([type, listener, options]) => [type, listener === added[0][1], options]), [['keydown', true, { capture: true }]], '같은 처리기를 같은 옵션으로 뗍니다.');
    } finally {
      globalThis.window.addEventListener = realAdd;
      globalThis.window.removeEventListener = realRemove;
    }
  } finally {
    usePresetStore.setState({ activateSlot: realActivateSlot });
    restoreElement();
  }
} finally {
  engine.rebuildChain = originalRebuildChain;
}

// Corrupt optional metadata is safely discarded on import and legacy reload.
const dirtyPreset = { id: 'unsafe-meta', name: '복구 프리셋', updatedAt: 100, pedals: [],
  libraryName: 123, libraryId: { bad: true }, description: ['bad'], tags: ['clean', 123, null, { value: 'bad' }] };
const dirtyPayload = JSON.stringify({ version: 10, presets: [dirtyPreset] });
const parsedDirty = parsePresetJson(dirtyPayload)[0];
assert.equal(parsedDirty.libraryName, undefined);
assert.equal(parsedDirty.libraryId, undefined);
assert.equal(parsedDirty.description, undefined);
assert.deepEqual(parsedDirty.tags, ['clean']);
assert.equal(parsedDirty.name, dirtyPreset.name);
// 저장소에서 다시 읽는 길(v2): 모양이 틀린 표시용 필드는 버리고 읽는다.
storageValues.set(USER_PRESETS_KEY, JSON.stringify({
  schemaVersion: 2,
  presets: [{
    schemaVersion: 2, id: 'unsafe-meta', name: '복구 프리셋', origin: 'user', chain: [], pedals: {}, trimDb: 0,
    createdAt: new Date(100).toISOString(), updatedAt: new Date(100).toISOString(),
    libraryName: 123, libraryId: { bad: true }, description: ['bad'], tags: ['clean', 123, null, { value: 'bad' }],
  }],
}));
usePresetStore.getState().reloadPresets();
const restoredDirty = usePresetStore.getState().presets.find((preset) => preset.id === 'unsafe-meta');
assert.equal(typeof restoredDirty.libraryName, 'string');
assert.equal(typeof restoredDirty.description, 'string');
assert.deepEqual(restoredDirty.tags, ['clean']);
assert.equal(restoredDirty.libraryName.toUpperCase(), 'MY PRESETS');
assert.throws(() => parsePresetJson(JSON.stringify({ presets: [{ ...dirtyPreset, name: 123 }] })), /올바르지/);
usePresetStore.getState().savePreset('export fixture', usePedalStore.getState().pedals);

// Only user presets should be exported, and unavailable storage must not block edits.
const exportedPresets = JSON.parse(usePresetStore.getState().exportPresets()).presets;
assert.ok(exportedPresets.length > 0);
assert.ok(exportedPresets.every((preset) => !preset.id.startsWith('factory-')));
// 저장 실패 안내는 SafeStorage 가 토스트로 한 번만 띄운다(S1.7). 저장이 두 번 실패해도 안내는 하나다.
const quotaToasts = () => useToastStore.getState().toasts.filter((toast) => toast.key === 'storage:quota');
assert.equal(quotaToasts().length, 0);
const originalSetItem = globalThis.window.localStorage.setItem;
globalThis.window.localStorage.setItem = () => { throw new Error('quota exceeded'); };
try {
  usePresetStore.getState().savePreset('저장소 오류에서도 사용', usePedalStore.getState().pedals);
  assert.ok(usePresetStore.getState().presets.some((preset) => preset.name === '저장소 오류에서도 사용'));
  const prior = usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').active;
  usePedalStore.getState().setActive('delay', !prior);
  assert.equal(usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').active, !prior);
  assert.equal(quotaToasts().length, 1, '저장이 두 번 실패해도 안내는 한 번만 보인다');
} finally {
  globalThis.window.localStorage.setItem = originalSetItem;
}

// Frequent knob changes are coalesced while the most recent value stays in memory.
usePedalStore.getState().savePedalsToStorage();
const pedalWriteCount = () => storageWrites.filter(({ key }) => key === PEDAL_STATE_KEY).length;
const writesBeforeKnob = pedalWriteCount();
usePedalStore.getState().updatePedalParam('delay', 'bpm', 135);
usePedalStore.getState().updatePedalParam('delay', 'bpm', 136);
assert.equal(pedalWriteCount(), writesBeforeKnob);
assert.equal(usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').params.bpm, 136);
await delay(400);
assert.equal(pedalWriteCount(), writesBeforeKnob + 1);

harness.restore();
console.log(
  'Preset A/B regression passed: isolated snapshots, overwrite/empty guards, active slot with trim, rendered A/B toolbar and handlers, shared apply path order, single guarded capture keydown listener, session-only export/storage and tempo-aware rebuild.',
);
