import assert from 'node:assert/strict';
import { Buffer, File } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { openApp } from './lib/app-browser.mjs';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';
import { FakeElement, installFakeElement } from './lib/fake-element.mjs';
import { find, textContent } from './lib/html-tree.mjs';
import { createSsrHarness } from './lib/ssr-harness.mjs';

const routingBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [
    fileURLToPath(new URL('../src/input/shortcutKeys.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const routingUrl = `data:text/javascript;base64,${Buffer.from(routingBundle.outputFiles[0].text).toString('base64')}`;
const {
  PEDAL_KEY_CODES,
  SHIFT_PEDAL_FIRST_INDEX,
  SHIFT_PEDAL_KEY_CODES,
  SHORTCUT_HELP_ROWS,
  resolveShortcutCommand,
} = await import(routingUrl);

function keyEvent(key, overrides = {}) {
  return {
    key,
    repeat: false,
    isComposing: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...overrides,
  };
}

assert.deepEqual(resolveShortcutCommand(keyEvent('1')), { type: 'toggle-pedal', index: 0 });
assert.deepEqual(resolveShortcutCommand(keyEvent('9')), { type: 'toggle-pedal', index: 8 });
assert.deepEqual(resolveShortcutCommand(keyEvent('0')), { type: 'toggle-pedal', index: 9 });
assert.deepEqual(resolveShortcutCommand(keyEvent('ㅅ', { code: 'KeyT', isComposing: true })), { type: 'tap-tempo' });
assert.deepEqual(resolveShortcutCommand(keyEvent('ㅛ', { code: 'KeyY' })), { type: 'toggle-pedal', index: 14 });
assert.equal(resolveShortcutCommand(keyEvent('10')), null);
assert.deepEqual(resolveShortcutCommand(keyEvent(' ')), { type: 'toggle-audio' });
assert.deepEqual(resolveShortcutCommand(keyEvent('Spacebar')), { type: 'toggle-audio' });
assert.deepEqual(resolveShortcutCommand(keyEvent('t')), { type: 'tap-tempo' });
assert.deepEqual(resolveShortcutCommand(keyEvent('A')), { type: 'activate-slot', slot: 'A' });
assert.deepEqual(resolveShortcutCommand(keyEvent('b')), { type: 'activate-slot', slot: 'B' });
assert.deepEqual(resolveShortcutCommand(keyEvent('Escape')), { type: 'panic' });
assert.deepEqual(resolveShortcutCommand(keyEvent('?', { shiftKey: true })), { type: 'show-help' });

for (const guardedEvent of [
  keyEvent('t', { repeat: true }),
  keyEvent('t', { isComposing: true }),
  keyEvent('t', { ctrlKey: true }),
  keyEvent('t', { metaKey: true }),
  keyEvent('t', { altKey: true }),
  keyEvent('t', { shiftKey: true }),
  keyEvent('Escape', { shiftKey: true }),
  keyEvent('?', { ctrlKey: true, shiftKey: true }),
]) {
  assert.equal(resolveShortcutCommand(guardedEvent), null);
}

// ── S2.11: 물리 키(code) 기준 — 한글 입력 상태에서도 같은 키가 같은 일을 한다 ──────────────────────
// 한글 두벌식에서 T → 'ㅅ', A → 'ㅁ', B → 'ㅠ'. key 는 한글이어도 code 는 그대로다.
assert.deepEqual(resolveShortcutCommand(keyEvent('ㅅ', { code: 'KeyT' })), { type: 'tap-tempo' });
assert.deepEqual(resolveShortcutCommand(keyEvent('ㅁ', { code: 'KeyA' })), { type: 'activate-slot', slot: 'A' });
assert.deepEqual(resolveShortcutCommand(keyEvent('ㅠ', { code: 'KeyB' })), { type: 'activate-slot', slot: 'B' });
assert.deepEqual(resolveShortcutCommand(keyEvent('Process', { code: 'KeyT', isComposing: true })), { type: 'tap-tempo' });
assert.deepEqual(resolveShortcutCommand(keyEvent('ㅂ', { code: 'KeyQ' })), { type: 'toggle-pedal', index: 10 });
assert.deepEqual(resolveShortcutCommand(keyEvent('ㅈ', { code: 'KeyW' })), { type: 'toggle-pedal', index: 11 });
assert.deepEqual(resolveShortcutCommand(keyEvent('ㄷ', { code: 'KeyE' })), { type: 'toggle-pedal', index: 12 });
assert.deepEqual(resolveShortcutCommand(keyEvent('ㄱ', { code: 'KeyR' })), { type: 'toggle-pedal', index: 13 });
// 판단은 key 가 아니라 code 다. 둘이 엇갈리면 code 를 따른다.
assert.deepEqual(resolveShortcutCommand(keyEvent('1', { code: 'KeyT' })), { type: 'tap-tempo' });
assert.equal(resolveShortcutCommand(keyEvent('t', { code: 'KeyZ' })), null);
// code 가 없는 환경(일부 가상 키보드)은 key 로 알아보되, 조합 중이면 글자를 믿지 않는다.
assert.deepEqual(resolveShortcutCommand(keyEvent('q')), { type: 'toggle-pedal', index: 10 });
assert.deepEqual(resolveShortcutCommand(keyEvent('Y')), { type: 'toggle-pedal', index: 14 });
assert.deepEqual(resolveShortcutCommand(keyEvent('Esc')), { type: 'panic' });
assert.equal(resolveShortcutCommand(keyEvent('ㅅ')), null);
assert.equal(resolveShortcutCommand(keyEvent('1', { shiftKey: true })), null);
assert.equal(resolveShortcutCommand(keyEvent('1', { isComposing: true })), null);

// ── S2.11: Shift + 1~6 = 10~15번째 페달(D13). 0 Q W E R Y 와 같은 여섯 페달이다 ───────────────────
assert.deepEqual(PEDAL_KEY_CODES, ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9', 'Digit0', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyY']);
assert.deepEqual(SHIFT_PEDAL_KEY_CODES, ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6']);
assert.equal(SHIFT_PEDAL_FIRST_INDEX, 9);
const shiftedSymbols = ['!', '@', '#', '$', '%', '^'];
SHIFT_PEDAL_KEY_CODES.forEach((code, offset) => {
  // Shift 를 누르면 key 는 기호(!@#$%^)가 되므로 code 로만 알아본다. 한글 입력 상태여도 같다.
  assert.deepEqual(
    resolveShortcutCommand(keyEvent(shiftedSymbols[offset], { code, shiftKey: true })),
    { type: 'toggle-pedal', index: 9 + offset },
    `Shift+${code} 는 ${10 + offset}번째 페달이어야 합니다.`,
  );
  assert.deepEqual(
    resolveShortcutCommand(keyEvent('Process', { code, shiftKey: true, isComposing: true })),
    { type: 'toggle-pedal', index: 9 + offset },
  );
  // 같은 페달을 윗줄 키로도 누를 수 있다(L-4 를 지우지 않고 더한다).
  const sameByLegacyKey = resolveShortcutCommand(keyEvent('x', { code: ['Digit0', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyY'][offset] }));
  assert.deepEqual(sameByLegacyKey, { type: 'toggle-pedal', index: 9 + offset });
});
// Shift 와 함께 쓰는 키는 Shift+1~6 과 도움말(?) 뿐이다. 나머지는 Shift 가 눌렸다고 다른 일을 하지 않는다.
for (const code of ['Digit0', 'Digit7', 'Digit8', 'Digit9', 'KeyQ', 'KeyT', 'KeyA', 'KeyB', 'KeyY', 'Space', 'Escape', 'Enter']) {
  assert.equal(resolveShortcutCommand(keyEvent('x', { code, shiftKey: true })), null, `Shift+${code} 는 아무 일도 하지 않아야 합니다.`);
}
// Shift 가 없는 Digit1~6 은 1~6번째 페달이다(윗줄 숫자는 Shift 유무로 다른 페달).
assert.deepEqual(resolveShortcutCommand(keyEvent('1', { code: 'Digit1' })), { type: 'toggle-pedal', index: 0 });
assert.deepEqual(resolveShortcutCommand(keyEvent('6', { code: 'Digit6' })), { type: 'toggle-pedal', index: 5 });
// Ctrl/⌘/Alt 가 함께 눌리면 Shift+숫자도 무시(브라우저·OS 단축키와 겹침), 키를 누르고 있는 반복도 무시.
for (const modifier of ['ctrlKey', 'metaKey', 'altKey']) {
  assert.equal(resolveShortcutCommand(keyEvent('!', { code: 'Digit1', shiftKey: true, [modifier]: true })), null, `${modifier} + Shift+1`);
  assert.equal(resolveShortcutCommand(keyEvent('1', { code: 'Digit1', [modifier]: true })), null, `${modifier} + 1`);
  assert.equal(resolveShortcutCommand(keyEvent('ㅅ', { code: 'KeyT', [modifier]: true })), null, `${modifier} + T`);
  assert.equal(resolveShortcutCommand(keyEvent('Escape', { code: 'Escape', [modifier]: true })), null, `${modifier} + Esc`);
}
for (const [key, code, shiftKey] of [['!', 'Digit1', true], ['1', 'Digit1', false], ['ㅅ', 'KeyT', false], ['Escape', 'Escape', false], [' ', 'Space', false], ['?', 'Slash', true]]) {
  assert.equal(resolveShortcutCommand(keyEvent(key, { code, shiftKey, repeat: true })), null, `${code} 반복 입력은 무시`);
}
// 도움말 키: 영문 배열이면 key '?', 다른 배열(한글 포함)에서도 물리 키 Shift+Slash 면 연다.
assert.deepEqual(resolveShortcutCommand(keyEvent('?', { code: 'Slash', shiftKey: true })), { type: 'show-help' });
assert.deepEqual(resolveShortcutCommand(keyEvent('?', { code: 'Slash', shiftKey: true, isComposing: true })), { type: 'show-help' });
assert.deepEqual(resolveShortcutCommand(keyEvent('/', { code: 'Slash', shiftKey: true })), { type: 'show-help' });
assert.equal(resolveShortcutCommand(keyEvent('/', { code: 'Slash' })), null);
// 목록에 없는 키는 아무 일도 하지 않는다.
for (const code of ['KeyZ', 'Enter', 'Tab', 'Numpad1', 'ArrowLeft', 'F1', 'Backspace']) {
  assert.equal(resolveShortcutCommand(keyEvent('x', { code })), null, `${code} 는 단축키가 아닙니다.`);
}

// ── S2.11: 도움말 표는 실제 키와 같은 곳에서 나오고, 말한 키를 눌러 보면 말한 일이 일어난다 ─────────────────
assert.deepEqual(
  SHORTCUT_HELP_ROWS.map((row) => row.label),
  ['1–9 / 0 / Q W E R Y', 'Shift + 1–6', 'Space', 'T', 'A / B', 'Esc', '?'],
);
for (const row of SHORTCUT_HELP_ROWS) {
  assert.ok(row.description.length > 0 && row.samples.length > 0, `${row.label}: 설명과 예시 키가 있어야 합니다.`);
  for (const sample of row.samples) {
    assert.deepEqual(
      resolveShortcutCommand(keyEvent('x', { code: sample.code, shiftKey: sample.shift === true })),
      sample.command,
      `${row.label}: 도움말이 말한 ${sample.shift ? 'Shift+' : ''}${sample.code} 가 말한 일을 하지 않습니다.`,
    );
  }
}
// 1~15번째 페달이 도움말에 빠짐없이 있다(10~15번째는 두 가지 키로).
const documentedPedalIndexes = SHORTCUT_HELP_ROWS.flatMap((row) => row.samples)
  .filter((sample) => sample.command.type === 'toggle-pedal')
  .map((sample) => sample.command.index);
for (let index = 0; index < 15; index += 1) {
  assert.ok(documentedPedalIndexes.includes(index), `${index + 1}번째 페달 키가 도움말에 없습니다.`);
}
assert.equal(documentedPedalIndexes.filter((index) => index >= 9).length, 12, '10~15번째 페달은 두 가지 키로 도움말에 있어야 합니다.');
assert.ok(SHORTCUT_HELP_ROWS.find((row) => row.label === 'Esc').description.includes('녹음'), 'Esc 도움말이 녹음 저장을 말해야 합니다.');

const storageValues = new Map();
globalThis.window = {
  localStorage: {
    getItem(key) {
      return storageValues.get(key) ?? null;
    },
    setItem(key, value) {
      storageValues.set(key, value);
    },
    removeItem(key) {
      storageValues.delete(key);
    },
  },
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

const windowListeners = [];
Object.assign(globalThis.window, {
  addEventListener: (type, handler, options) => { windowListeners.push({ op: 'add', type, handler, options }); },
  removeEventListener: (type, handler, options) => { windowListeners.push({ op: 'remove', type, handler, options }); },
});
const harness = await createSsrHarness({
  extraExports: [
    "{ AudioEngine } from './audio/AudioEngine.ts'",
    "{ createShortcutKeydownHandler, executeShortcutCommand, isEscapeOwnedByTarget, isInteractiveShortcutTarget, isShortcutBlockedByTarget } from './input/ShortcutService.ts'",
    "{ useAudioStore } from './store/audioStore.ts'",
    "{ clonePedals, usePedalStore } from './store/pedalStore.ts'",
    "{ usePresetStore } from './store/presetStore.ts'",
    "{ GlobalKeyboardShortcuts } from './components/GlobalKeyboardShortcuts.tsx'",
  ],
});
const {
  AudioEngine,
  clonePedals,
  createShortcutKeydownHandler,
  executeShortcutCommand,
  isEscapeOwnedByTarget,
  isInteractiveShortcutTarget,
  isShortcutBlockedByTarget,
  useAudioStore,
  usePedalStore,
  usePresetStore,
  GlobalKeyboardShortcuts,
} = harness.exports;

// ── 긴급 정지(Esc)의 대상 판정 ────────────────────────────────────────────────
// DOM 이 없는 환경이라 가짜 요소(lib/fake-element)는 선택자를 쉼표 조각으로 나눠 '이 요소(또는 조상)가 해당하는 조각'이 있는지만 본다.
// 운영 코드의 선택자 문자열에 그 조각이 들어 있어야 통과하므로, 선택자에서 조각이 빠지면 여기서 걸린다.
installFakeElement();

const escapeOwnedTargets = {
  '<select>': new FakeElement('select'),
  '<textarea>': new FakeElement('textarea'),
  '글자 입력 칸': new FakeElement('input', { type: 'text' }),
  '숫자 입력 칸(노브 값 편집)': new FakeElement('input', { type: 'number' }),
  '검색 입력 칸': new FakeElement('input', { type: 'search' }),
  'contenteditable': new FakeElement('div', {
    matches: ['[contenteditable]:not([contenteditable="false"])'],
  }),
  'role=textbox': new FakeElement('div', { matches: ['[role="textbox"]'] }),
  'role=searchbox': new FakeElement('div', { matches: ['[role="searchbox"]'] }),
  'role=spinbutton': new FakeElement('div', { matches: ['[role="spinbutton"]'] }),
  'role=combobox': new FakeElement('div', { matches: ['[role="combobox"]'] }),
  'role=listbox': new FakeElement('div', { matches: ['[role="listbox"]'] }),
  '열린 메뉴 안의 항목(MIDI 메뉴)': new FakeElement('button', { matches: ['button', '[role="menu"]'] }),
  '대화상자 안(role=dialog)': new FakeElement('button', { matches: ['button', '[role="dialog"]'] }),
  '모달 안(aria-modal)': new FakeElement('button', { matches: ['button', '[aria-modal="true"]'] }),
  '메뉴가 열린 트리거 버튼': new FakeElement('button', {
    matches: ['button', '[aria-haspopup][aria-expanded="true"]'],
  }),
};
for (const [label, element] of Object.entries(escapeOwnedTargets)) {
  assert.equal(isEscapeOwnedByTarget(element), true, `${label}: Esc 는 컨트롤이 먼저 써야 합니다.`);
}

const emergencyStopTargets = {
  '버튼': new FakeElement('button', { matches: ['button'] }),
  '페달 스위치(role=switch)': new FakeElement('button', { matches: ['button', '[role="switch"]'] }),
  '슬라이더(input range)': new FakeElement('input', { type: 'range', matches: ['[role="slider"]'] }),
  '체크박스': new FakeElement('input', { type: 'checkbox' }),
  '라디오': new FakeElement('input', { type: 'radio' }),
  '탭(role=tab)': new FakeElement('button', { matches: ['button', '[role="tab"]'] }),
  '링크': new FakeElement('a', { attributes: ['href'], matches: ['a[href]'] }),
  'role=button': new FakeElement('div', { matches: ['[role="button"]'] }),
  'tabindex 요소': new FakeElement('div', { matches: ['[tabindex]:not([tabindex="-1"])'] }),
  '메뉴가 닫힌 트리거 버튼': new FakeElement('button', { matches: ['button'] }),
};
for (const [label, element] of Object.entries(emergencyStopTargets)) {
  assert.equal(isInteractiveShortcutTarget(element), true, `${label}: 컨트롤로 판정되어야 합니다.`);
  assert.equal(isEscapeOwnedByTarget(element), false, `${label}: Esc 는 긴급 정지로 통해야 합니다.`);
  assert.equal(
    isShortcutBlockedByTarget({ type: 'panic' }, { target: element, isComposing: false }),
    false,
    `${label}: 포커스가 있어도 Esc 긴급 정지는 막히면 안 됩니다.`,
  );
  // Esc 가 아닌 단축키는 컨트롤이 먼저 쓰도록 계속 막는다(숫자 입력·Space 로 버튼 누르기 등).
  for (const command of [
    { type: 'toggle-pedal', index: 0 },
    { type: 'toggle-audio' },
    { type: 'tap-tempo' },
    { type: 'activate-slot', slot: 'A' },
    { type: 'show-help' },
  ]) {
    assert.equal(
      isShortcutBlockedByTarget(command, { target: element, isComposing: false }),
      true,
      `${label}: ${command.type} 는 컨트롤에 포커스가 있으면 막혀야 합니다.`,
    );
  }
}

// href 가 없는 <a> 는 링크가 아니라 컨트롤로 보지 않는다.
assert.equal(isInteractiveShortcutTarget(new FakeElement('a')), false, 'href 없는 <a> 는 컨트롤이 아닙니다.');
for (const [label, element] of Object.entries(escapeOwnedTargets)) {
  assert.equal(
    isShortcutBlockedByTarget({ type: 'panic' }, { target: element, isComposing: false }),
    true,
    `${label}: Esc 는 그 컨트롤이 쓰고 긴급 정지로 가지 않아야 합니다.`,
  );
}

// 한글 조합을 취소하는 Esc 는 긴급 정지가 아니다.
assert.equal(
  isShortcutBlockedByTarget({ type: 'panic' }, { target: emergencyStopTargets['버튼'], isComposing: true }),
  true,
);
// 컨트롤이 아닌 곳(body, 포커스 없음)에서는 전과 같이 모든 단축키가 통한다.
const plainBody = new FakeElement('body');
assert.equal(isInteractiveShortcutTarget(plainBody), false);
for (const command of [{ type: 'panic' }, { type: 'toggle-audio' }, { type: 'tap-tempo' }]) {
  assert.equal(isShortcutBlockedByTarget(command, { target: plainBody, isComposing: false }), false);
}
// Element 가 아닌 대상(window, null)은 막지 않는다.
assert.equal(isEscapeOwnedByTarget(null), false);
assert.equal(isEscapeOwnedByTarget({}), false);
assert.equal(isShortcutBlockedByTarget({ type: 'panic' }, { target: null, isComposing: false }), false);

const reorderedPedals = clonePedals(usePedalStore.getState().pedals).reverse();
usePedalStore.getState().setPedals(reorderedPedals);
const targetPedal = usePedalStore.getState().pedals[2];
const originalActive = targetPedal.active;
const originalSetActive = usePedalStore.getState().setActive;
const engine = AudioEngine.getInstance();
const originalEngineActive = engine.setPedalActive;
const activeOrder = [];
usePedalStore.setState({
  setActive: (id, active) => {
    activeOrder.push(`store:${id}:${active}`);
    originalSetActive(id, active);
  },
});
engine.setPedalActive = (id, active) => {
  activeOrder.push(`engine:${id}:${active}`);
};
const originalEngineBypass = engine.setPedalBypass;
let bypassCalls = 0;
engine.setPedalBypass = () => {
  bypassCalls += 1;
};

try {
  assert.equal(
    executeShortcutCommand({ type: 'toggle-pedal', index: 2 }, () => {}),
    true,
  );
  assert.deepEqual(activeOrder, [
    `store:${targetPedal.id}:${!originalActive}`,
    `engine:${targetPedal.id}:${!originalActive}`,
  ]);
  assert.equal(usePedalStore.getState().pedals[2].id, targetPedal.id);
  assert.equal(usePedalStore.getState().pedals[2].active, !originalActive);
  assert.equal(executeShortcutCommand({ type: 'toggle-pedal', index: -1 }, () => {}), false);
  assert.equal(executeShortcutCommand({ type: 'toggle-pedal', index: 15 }, () => {}), false);
  assert.equal(activeOrder.length, 2, '범위 밖 번호는 저장소도 엔진도 건드리지 않습니다.');
  // 켜고 끄는 길은 setPedalActive(저장소 → 엔진) 하나뿐이다. 옛 setPedalBypass 는 불리지 않는다.
  assert.equal(bypassCalls, 0, '단축키가 옛 Bypass 경로를 씁니다.');
} finally {
  usePedalStore.setState({ setActive: originalSetActive });
  engine.setPedalActive = originalEngineActive;
  engine.setPedalBypass = originalEngineBypass;
}

let starts = 0;
let stops = 0;
let taps = 0;
let panics = 0;
let activatedSlot = null;
let helpOpens = 0;
useAudioStore.setState({
  isLoading: true,
  isRunning: false,
  start: async () => {
    starts += 1;
  },
  stop: async () => {
    stops += 1;
  },
  tapTempoTap: () => {
    taps += 1;
  },
  panic: () => {
    panics += 1;
  },
});
usePresetStore.setState({
  activateSlot: (slot) => {
    activatedSlot = slot;
    return true;
  },
});

assert.equal(executeShortcutCommand({ type: 'toggle-audio' }, () => {}), true);
assert.equal(starts, 0);
useAudioStore.setState({ isLoading: false, isRunning: false });
assert.equal(executeShortcutCommand({ type: 'toggle-audio' }, () => {}), true);
assert.equal(starts, 1);
useAudioStore.setState({ isRunning: true });
assert.equal(executeShortcutCommand({ type: 'toggle-audio' }, () => {}), true);
assert.equal(stops, 1);

// 파일 모드의 Space 는 재생/일시정지이고, 마이크를 켜지도 연결을 끊지도 않는다(S2.6, E-10).
let filePlays = 0;
let filePauses = 0;
useAudioStore.setState({
  playFile: async () => {
    filePlays += 1;
  },
  pauseFile: () => {
    filePauses += 1;
  },
  inputMode: 'file',
  isRunning: true,
  isFilePaused: false,
  uploadedFile: new File(['x'], 'a.wav', { type: 'audio/wav' }),
});
assert.equal(executeShortcutCommand({ type: 'toggle-audio' }, () => {}), true);
assert.deepEqual({ filePauses, filePlays, starts, stops }, { filePauses: 1, filePlays: 0, starts: 1, stops: 1 }, '재생 중 Space = 일시정지');
useAudioStore.setState({ isFilePaused: true });
assert.equal(executeShortcutCommand({ type: 'toggle-audio' }, () => {}), true);
assert.deepEqual({ filePauses, filePlays, starts, stops }, { filePauses: 1, filePlays: 1, starts: 1, stops: 1 }, '일시정지 중 Space = 재생');
// 정지·Panic 으로 세션이 끝났어도 열어 둔 파일이 있으면 Space 는 마이크가 아니라 그 파일을 다시 튼다.
useAudioStore.setState({ inputMode: 'idle', isRunning: false });
assert.equal(executeShortcutCommand({ type: 'toggle-audio' }, () => {}), true);
assert.deepEqual({ filePauses, filePlays, starts, stops }, { filePauses: 1, filePlays: 2, starts: 1, stops: 1 }, '세션이 끝난 뒤에도 파일이 열려 있으면 Space = 파일 재생(마이크 아님)');
// 파일이 없으면 예전대로 기타를 연결한다. 기타가 연결돼 있으면 끊는다.
useAudioStore.setState({ uploadedFile: null });
assert.equal(executeShortcutCommand({ type: 'toggle-audio' }, () => {}), true);
assert.deepEqual({ filePauses, filePlays, starts, stops }, { filePauses: 1, filePlays: 2, starts: 2, stops: 1 }, '열린 파일이 없으면 Space = 기타 연결');
useAudioStore.setState({ inputMode: 'device', isRunning: true });
assert.equal(executeShortcutCommand({ type: 'toggle-audio' }, () => {}), true);
assert.deepEqual({ filePauses, filePlays, starts, stops }, { filePauses: 1, filePlays: 2, starts: 2, stops: 2 }, '기타가 연결돼 있으면 Space = 연결 해제');
useAudioStore.setState({ inputMode: 'idle', isRunning: false });
assert.equal(executeShortcutCommand({ type: 'tap-tempo' }, () => {}), true);
assert.equal(taps, 1);
assert.equal(
  executeShortcutCommand({ type: 'activate-slot', slot: 'B' }, () => {}),
  true,
);
assert.equal(activatedSlot, 'B');
assert.equal(executeShortcutCommand({ type: 'panic' }, () => {}), true);
assert.equal(panics, 1);
assert.equal(
  executeShortcutCommand({ type: 'show-help' }, () => {
    helpOpens += 1;
  }),
  true,
);
assert.equal(helpOpens, 1);

// ── S2.11: keydown 하나의 처음부터 끝까지(createShortcutKeydownHandler) ─────────────────────────────────
// 실제 이벤트와 같은 모양의 가짜 이벤트로 눌러 본다: 어느 키가 무슨 일을 하고, preventDefault 는 일한 키에서만 불리는지.
function pressThrough(handler, key, overrides = {}, target = plainBody) {
  const record = { prevented: 0, stopped: 0 };
  handler({
    ...keyEvent(key, overrides),
    target,
    preventDefault() {
      record.prevented += 1;
    },
    stopPropagation() {
      record.stopped += 1;
    },
  });
  return record;
}

let helpIsOpen = false;
let opened = 0;
let closed = 0;
const keydown = createShortcutKeydownHandler({
  isHelpOpen: () => helpIsOpen,
  openHelp: () => {
    opened += 1;
    helpIsOpen = true;
  },
  closeHelp: () => {
    closed += 1;
    helpIsOpen = false;
  },
});
const textInput = escapeOwnedTargets['글자 입력 칸'];
const plainButton = emergencyStopTargets['버튼'];
const baseline = () => ({ taps, panics, activatedSlot, opened, closed });

// 한글 입력 상태의 T(key 'ㅅ', code 'KeyT') → 탭 템포, A/B → 슬롯. 키를 처리했으니 preventDefault.
taps = 0;
let record = pressThrough(keydown, 'ㅅ', { code: 'KeyT' });
assert.deepEqual({ taps, prevented: record.prevented }, { taps: 1, prevented: 1 }, '한글 T 가 탭 템포가 되어야 합니다.');
activatedSlot = null;
record = pressThrough(keydown, 'ㅁ', { code: 'KeyA' });
assert.deepEqual({ activatedSlot, prevented: record.prevented }, { activatedSlot: 'A', prevented: 1 });
record = pressThrough(keydown, 'ㅠ', { code: 'KeyB', isComposing: true });
assert.deepEqual({ activatedSlot, prevented: record.prevented }, { activatedSlot: 'B', prevented: 1 });

// 글자 입력 칸·컨트롤에 포커스가 있으면 숫자·T·A/B·Space 는 컨트롤이 쓴다: 아무 일도 없고 preventDefault 도 없다.
for (const target of [textInput, plainButton, escapeOwnedTargets['<select>']]) {
  const before = baseline();
  for (const [key, code] of [['ㅅ', 'KeyT'], ['t', 'KeyT'], ['a', 'KeyA'], ['b', 'KeyB'], ['1', 'Digit1'], ['!', 'Digit1', true], [' ', 'Space']]) {
    const shiftKey = code === 'Digit1' && key === '!';
    record = pressThrough(keydown, key, { code, shiftKey }, target);
    assert.equal(record.prevented, 0, `${target.tagName} 포커스의 ${code} 에서 preventDefault 가 불렸습니다.`);
  }
  assert.deepEqual(baseline(), before, `${target.tagName} 포커스에서 단축키가 동작했습니다.`);
}
// 실행하지 못한 키는 처리한 것이 아니다: 저장된 슬롯이 없는 A/B 는 아무것도 바꾸지 못하므로 preventDefault 도 부르지 않는다.
usePresetStore.setState({
  activateSlot: (slot) => {
    activatedSlot = slot;
    return false;
  },
});
assert.equal(executeShortcutCommand({ type: 'activate-slot', slot: 'A' }, () => {}), false, '빈 슬롯의 A 는 실행하지 못한 것입니다.');
activatedSlot = null;
record = pressThrough(keydown, 'ㅁ', { code: 'KeyA' });
assert.deepEqual({ activatedSlot, prevented: record.prevented }, { activatedSlot: 'A', prevented: 0 }, '빈 슬롯의 A 는 시도하되 기본 동작을 가로채지 않습니다.');
usePresetStore.setState({
  activateSlot: (slot) => {
    activatedSlot = slot;
    return true;
  },
});
// 목록에 없는 키·반복 입력·Ctrl 조합은 아무 일도 없고 preventDefault 도 없다(브라우저 기본 동작을 가로채지 않는다).
{
  const before = baseline();
  for (const overrides of [{ code: 'KeyZ' }, { code: 'KeyT', repeat: true }, { code: 'KeyT', ctrlKey: true }, { code: 'Escape', repeat: true }, { code: 'Digit1', metaKey: true }]) {
    record = pressThrough(keydown, 'x', overrides);
    assert.equal(record.prevented, 0, `${JSON.stringify(overrides)} 에서 preventDefault 가 불렸습니다.`);
  }
  assert.deepEqual(baseline(), before);
}

// Esc: 컨트롤(버튼)에 포커스가 있어도 긴급 정지가 통한다. 글자 입력 칸에서는 그 칸이 Esc 를 쓰고 긴급 정지는 없다.
panics = 0;
record = pressThrough(keydown, 'Escape', { code: 'Escape' }, plainButton);
assert.deepEqual({ panics, prevented: record.prevented }, { panics: 1, prevented: 1 }, '버튼 포커스에서 Esc 는 긴급 정지입니다.');
record = pressThrough(keydown, 'Escape', { code: 'Escape' }, textInput);
assert.deepEqual({ panics, prevented: record.prevented }, { panics: 1, prevented: 0 }, '글자 입력 칸의 Esc 는 긴급 정지가 아닙니다.');
record = pressThrough(keydown, 'Escape', { code: 'Escape', isComposing: true }, plainButton);
assert.deepEqual({ panics, prevented: record.prevented }, { panics: 1, prevented: 0 }, '한글 조합을 취소하는 Esc 는 긴급 정지가 아닙니다.');

// '?' 는 도움말을 연다. 도움말이 열려 있는 동안: Esc 는 도움말만 닫고 긴급 정지로 가지 않으며, 다른 키는 모두 무시된다.
record = pressThrough(keydown, '?', { code: 'Slash', shiftKey: true });
assert.deepEqual({ opened, helpIsOpen, prevented: record.prevented }, { opened: 1, helpIsOpen: true, prevented: 1 });
{
  const before = baseline();
  for (const [key, code, shiftKey] of [['ㅅ', 'KeyT', false], ['a', 'KeyA', false], ['1', 'Digit1', false], ['!', 'Digit1', true], [' ', 'Space', false], ['?', 'Slash', true]]) {
    record = pressThrough(keydown, key, { code, shiftKey });
    assert.equal(record.prevented, 0, `도움말이 열려 있을 때 ${code} 가 처리됐습니다.`);
  }
  assert.deepEqual(baseline(), before, '도움말이 열려 있는 동안 다른 단축키는 동작하면 안 됩니다.');
}
panics = 0;
record = pressThrough(keydown, 'Escape', { code: 'Escape' });
assert.deepEqual(
  { panics, closed, helpIsOpen, prevented: record.prevented, stopped: record.stopped },
  { panics: 0, closed: 1, helpIsOpen: false, prevented: 1, stopped: 1 },
  '도움말이 열려 있을 때 Esc 는 도움말만 닫습니다(긴급 정지 없음).',
);
// 도움말이 닫힌 뒤의 Esc 는 다시 긴급 정지다.
record = pressThrough(keydown, 'Escape', { code: 'Escape' });
assert.deepEqual({ panics, closed, prevented: record.prevented, stopped: record.stopped }, { panics: 1, closed: 1, prevented: 1, stopped: 0 });

// Shift+1~6 은 현재 순서의 10~15번째 페달을 토글한다(0 Q W E R Y 와 같은 페달). 한글 입력 상태에서도 같다.
{
  const engineForShift = AudioEngine.getInstance();
  const originalSetPedalActive = engineForShift.setPedalActive;
  const engineCalls = [];
  engineForShift.setPedalActive = (id, active) => {
    engineCalls.push(`${id}:${active}`);
  };
  try {
    const shiftSymbols = ['!', '@', '#', '$', '%', '^'];
    const legacyCodes = ['Digit0', 'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyY'];
    for (let offset = 0; offset < 6; offset += 1) {
      const pedal = usePedalStore.getState().pedals[9 + offset];
      const before = pedal.active;
      record = pressThrough(keydown, shiftSymbols[offset], { code: `Digit${offset + 1}`, shiftKey: true });
      assert.equal(usePedalStore.getState().pedals[9 + offset].active, !before, `Shift+${offset + 1} 이 ${10 + offset}번째 페달을 전환해야 합니다.`);
      assert.equal(record.prevented, 1);
      assert.equal(engineCalls.at(-1), `${pedal.id}:${!before}`);
      // 윗줄 0 Q W E R Y 로 한 번 더 누르면 같은 페달이 되돌아온다.
      pressThrough(keydown, 'ㅂ', { code: legacyCodes[offset], isComposing: true });
      assert.equal(usePedalStore.getState().pedals[9 + offset].active, before, `${legacyCodes[offset]} 와 Shift+${offset + 1} 은 같은 페달이어야 합니다.`);
    }
    assert.equal(engineCalls.length, 12);
    // Shift+7, Shift+0 은 페달을 건드리지 않는다.
    const snapshot = JSON.stringify(usePedalStore.getState().pedals.map((pedal) => pedal.active));
    for (const code of ['Digit7', 'Digit0']) {
      record = pressThrough(keydown, '&', { code, shiftKey: true });
      assert.equal(record.prevented, 0);
    }
    assert.equal(JSON.stringify(usePedalStore.getState().pedals.map((pedal) => pedal.active)), snapshot);
    assert.equal(engineCalls.length, 12);
  } finally {
    engineForShift.setPedalActive = originalSetPedalActive;
  }
}

// ── 전역 keydown 리스너(GlobalKeyboardShortcuts): 하나만, 캡처 단계로 달고, 같은 처리기·같은 옵션으로 뗀다 ────────────
// 컴포넌트가 만든 리스너로 실제 키를 눌러, 키 해석·실행은 ShortcutService 가 하고 컴포넌트는 도움말 열림만 쥔다는 것을 본다.
{
  const keydownEntries = () => windowListeners.filter((entry) => entry.type === 'keydown');
  const tree = harness.render(GlobalKeyboardShortcuts);
  const status = find(tree, (node) => node.tag === 'output');
  assert.deepEqual(
    [status.attrs.role, status.attrs['aria-live'], status.attrs['aria-atomic'], status.attrs.class],
    ['status', 'polite', 'true', 'visually-hidden'],
  );
  assert.equal(textContent(status).trim(), '글로벌 템포 120 BPM, 탭 0회, 프리셋 비교 A 슬롯');
  assert.equal(find(tree, (node) => node.attrs.role === 'dialog'), null, '처음에는 도움말이 닫혀 있습니다.');
  assert.ok(find(harness.render(GlobalKeyboardShortcuts, {}, { states: { 0: true } }), (node) => node.attrs.role === 'dialog'), '열림 상태에서는 도움말 대화상자가 그려집니다.');

  harness.render(GlobalKeyboardShortcuts);
  windowListeners.length = 0;
  const mounted = harness.runEffects();
  assert.deepEqual(keydownEntries().map(({ op, options }) => [op, options]), [['add', { capture: true }]], '전역 keydown 은 캡처 단계로 하나만 닮니다.');
  const listener = keydownEntries()[0].handler;

  taps = 0;
  panics = 0;
  harness.stateSets.length = 0;
  record = pressThrough(listener, 'ㅅ', { code: 'KeyT' });
  assert.deepEqual({ taps, prevented: record.prevented }, { taps: 1, prevented: 1 }, '리스너가 실제 키 처리(ShortcutService)로 이어집니다.');
  record = pressThrough(listener, '?', { code: 'Slash', shiftKey: true });
  assert.deepEqual(harness.stateSets.map(({ action }) => action), [true], "'?' 는 도움말을 엽니다.");
  harness.stateSets.length = 0;
  record = pressThrough(listener, 'Escape', { code: 'Escape' });
  assert.deepEqual({ panics, sets: harness.stateSets.map(({ action }) => action) }, { panics: 0, sets: [false] }, '도움말이 열려 있는 동안 Esc 는 도움말만 닫습니다.');
  pressThrough(listener, 'Escape', { code: 'Escape' });
  assert.equal(panics, 1, '도움말이 닫히면 Esc 는 다시 긴급 정지입니다.');

  windowListeners.length = 0;
  mounted.cleanup();
  assert.deepEqual(
    keydownEntries().map(({ op, options, handler }) => [op, options, handler === listener]),
    [['remove', { capture: true }, true]],
    '같은 처리기를 같은 옵션으로 뗍니다.',
  );
}

// ── 도움말 대화상자는 실제 Chrome 에서: 접근성 속성, 열릴 때 포커스, Tab 가둠, Esc 로 닫고 포커스 복귀, CSS ────────────
await verifyHelpDialogInBrowser();

console.log(
  'Shortcut regression passed: code-based routing (Hangul), Shift+1-6 = pedals 10-15, table-driven help, guarded keydown handler, Esc emergency stop through focused controls, current-order bypass, audio/A-B/tap/panic actions, single listener and accessible focus-trapped help.',
);

async function verifyHelpDialogInBrowser() {
  const app = await openApp({ purpose: 'Shortcut help dialog browser checks' });
  if (!app) return;
  try {
    const active = `(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const close = dialog?.querySelector('button');
      return {
        closeFocused: Boolean(close) && document.activeElement === close,
        closeLabel: close?.getAttribute('aria-label') ?? null,
        activeId: document.activeElement?.id ?? '',
      };
    })()`;

    // 탭 순서 밖의 요소에 포커스를 두고 '?' 로 연다(열기 전 포커스 자리).
    assert.equal(await app.evaluate(`(() => {
      const probe = document.createElement('div');
      probe.id = 'focus-probe';
      probe.tabIndex = -1;
      document.body.append(probe);
      probe.focus();
      return document.activeElement === probe;
    })()`), true);
    await app.press('?', { code: 'Slash', shift: true });
    await app.waitFor(`document.querySelector('[role="dialog"]') !== null`, { label: '도움말 대화상자' });

    const dialog = await app.evaluate(`(() => {
      const dialog = document.querySelector('[role="dialog"]');
      const labelledBy = document.getElementById(dialog.getAttribute('aria-labelledby') ?? '');
      const describedBy = document.getElementById(dialog.getAttribute('aria-describedby') ?? '');
      return {
        modal: dialog.getAttribute('aria-modal'),
        labelledById: dialog.getAttribute('aria-labelledby'),
        title: labelledBy?.textContent ?? null,
        description: describedBy?.textContent ?? null,
        tabIndex: dialog.getAttribute('tabindex'),
        rows: [...dialog.querySelectorAll('dl > div')].map((row) => [row.querySelector('dt kbd')?.textContent, row.querySelector('dd')?.textContent]),
      };
    })()`);
    assert.equal(dialog.modal, 'true');
    assert.equal(dialog.labelledById, 'shortcut-help-title');
    assert.equal(dialog.title, '키보드 단축키');
    assert.ok(dialog.description && dialog.description.length > 0, '대화상자 설명(aria-describedby)이 있어야 합니다.');
    assert.equal(dialog.tabIndex, '-1');
    assert.deepEqual(dialog.rows, SHORTCUT_HELP_ROWS.map((row) => [row.label, row.description]), '도움말 표는 SHORTCUT_HELP_ROWS 에서 그대로 나옵니다.');

    // 열리면 포커스는 닫기 버튼으로 간다.
    assert.deepEqual(await app.evaluate(active), { closeFocused: true, closeLabel: '키보드 단축키 도움말 닫기', activeId: '' });
    // Tab·Shift+Tab 은 대화상자 안(닫기 버튼 하나뿐)에 갇힌다.
    await app.press('Tab', { code: 'Tab' });
    assert.equal((await app.evaluate(active)).closeFocused, true, 'Tab 이 대화상자 밖으로 나갔습니다.');
    await app.press('Tab', { code: 'Tab', shift: true });
    assert.equal((await app.evaluate(active)).closeFocused, true, 'Shift+Tab 이 대화상자 밖으로 나갔습니다.');

    // 배경 덮개: 화면 전체를 덮고 모든 것 위에 있다.
    const backdrop = await app.evaluate(`(() => {
      const element = document.querySelector('.shortcut-help-backdrop');
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      return {
        position: style.position,
        rect: [rect.left, rect.top, rect.width, rect.height],
        viewport: [0, 0, document.documentElement.clientWidth, innerHeight],
        topAtCorner: element.contains(document.elementFromPoint(4, 4)),
        topAtCenter: element.contains(document.elementFromPoint(innerWidth / 2, innerHeight / 2)),
        animation: style.animationName,
      };
    })()`);
    assert.equal(backdrop.position, 'fixed');
    assert.deepEqual(backdrop.rect, backdrop.viewport, '배경 덮개가 화면 전체를 덮어야 합니다.');
    assert.deepEqual([backdrop.topAtCorner, backdrop.topAtCenter], [true, true], '배경 덮개 위에 다른 요소가 있습니다.');

    // 대화상자 자체에 포커스가 오면(키보드로) 눈에 보이는 포커스 테두리가 있다.
    const focusRing = await app.evaluate(`(() => {
      const dialog = document.querySelector('.shortcut-help-dialog');
      dialog.focus({ focusVisible: true });
      const style = getComputedStyle(dialog);
      return { matches: dialog.matches(':focus-visible'), style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset };
    })()`);
    assert.deepEqual(focusRing, { matches: true, style: 'solid', width: '3px', offset: '3px' }, '대화상자의 :focus-visible 테두리');

    // 움직임 줄이기: 평소에는 나타나는 애니메이션이 있고, '줄이기' 를 켜면 없어진다.
    const animations = () => app.evaluate(`['.shortcut-help-backdrop', '.shortcut-help-dialog'].map((selector) => getComputedStyle(document.querySelector(selector)).animationName)`);
    assert.deepEqual(await animations(), ['shortcut-backdrop-in', 'shortcut-dialog-in']);
    await app.emulateMedia([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.deepEqual(await animations(), ['none', 'none'], 'prefers-reduced-motion: reduce 에서 도움말 애니메이션이 남아 있습니다.');
    await app.emulateMedia([{ name: 'prefers-reduced-motion', value: 'no-preference' }]);

    // 닫기 버튼으로 포커스를 돌려 놓고 Esc: 대화상자가 닫히고 포커스는 열기 전 자리로 돌아간다.
    await app.evaluate(`document.querySelector('.shortcut-help-close').focus()`);
    await app.press('Escape', { code: 'Escape' });
    await app.waitFor(`document.querySelector('[role="dialog"]') === null`, { label: '도움말 닫힘' });
    assert.equal((await app.evaluate(active)).activeId, 'focus-probe', '닫으면 포커스가 열기 전 자리로 돌아가야 합니다.');
  } finally {
    await app.close();
  }
}
