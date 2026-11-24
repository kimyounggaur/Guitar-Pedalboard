import assert from 'node:assert/strict';
import { Buffer, File } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const routingBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [
    fileURLToPath(new URL('../src/components/keyboardShortcuts.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const routingUrl = `data:text/javascript;base64,${Buffer.from(routingBundle.outputFiles[0].text).toString('base64')}`;
const { resolveShortcutCommand } = await import(routingUrl);

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

const [globalSource, actionsSource, helpSource, routingSource, cssSource] = await Promise.all([
  readFile(new URL('../src/components/GlobalKeyboardShortcuts.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/store/pedalActions.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/ShortcutHelp.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/keyboardShortcuts.ts', import.meta.url), 'utf8'),
  Promise.all([
    readFile(new URL('../src/styles/panels.css', import.meta.url), 'utf8'),
    readFile(new URL('../src/styles/responsive.css', import.meta.url), 'utf8'),
  ]).then((sources) => sources.join('\n')),
]);

assert.equal(
  [...globalSource.matchAll(/window\.addEventListener\('keydown'/g)].length,
  1,
  '전역 keydown listener는 정확히 하나여야 합니다.',
);
assert.equal([...globalSource.matchAll(/window\.removeEventListener\('keydown'/g)].length, 1);
assert.match(globalSource, /capture: true/);
assert.match(globalSource, /tagName === 'input'[\s\S]*tagName === 'select'[\s\S]*tagName === 'textarea'/);
assert.match(globalSource, /tagName === 'button'/);
assert.match(globalSource, /tagName === 'a'[\s\S]*hasAttribute\('href'\)/);
assert.match(globalSource, /contenteditable/);
assert.match(globalSource, /\[role="button"\]/);
assert.match(globalSource, /\[tabindex\]:not/);

// 단축키는 켜고 끄는 단일 입구(togglePedalActive → setPedalActive, S2.4)를 쓴다. store → engine 순서는 입구 한 곳에서 지킨다.
assert.ok(globalSource.includes('togglePedalActive(pedal.id);'), '단축키가 켜고 끄는 단일 입구를 쓰지 않습니다.');
assert.ok(!globalSource.includes('setPedalBypass'), '단축키가 옛 Bypass 경로를 씁니다.');
const storeWrite = actionsSource.indexOf('usePedalStore.getState().setActive(pedalId, active);');
const engineWrite = actionsSource.indexOf('AudioEngine.getInstance().setPedalActive(pedalId, active);');
assert.ok(storeWrite >= 0 && engineWrite > storeWrite, '켜고 끄기가 store → engine 순서가 아닙니다.');
assert.ok(globalSource.includes('const pedal = usePedalStore.getState().pedals[command.index];'));
assert.match(globalSource, /command\.index < 0 \|\| command\.index > 14/);
assert.match(globalSource, /if \(audioState\.isLoading\) return true/);
assert.match(globalSource, /audioState\.isRunning[\s\S]*audioState\.stop\(\)[\s\S]*audioState\.start\(\)/);
assert.match(globalSource, /tapTempoTap\(\)/);
assert.match(globalSource, /activateSlot\(command\.slot\)/);
assert.match(globalSource, /getState\(\)\.panic\(\)/);
// 긴급 정지(Esc)는 컨트롤에 포커스가 있어도 통하되, Esc 를 자기 일에 쓰는 컨트롤만 예외다(REFACTOR_LOG L-17).
assert.match(globalSource, /export function isEscapeOwnedByTarget/);
assert.match(globalSource, /export function isShortcutBlockedByTarget/);
assert.match(
  globalSource,
  /command\.type === 'panic'\) return event\.isComposing \|\| isEscapeOwnedByTarget\(event\.target\)/,
);
assert.match(globalSource, /!command \|\| isShortcutBlockedByTarget\(command, event\)/);

const modalBranch = globalSource.indexOf('if (helpOpenRef.current)');
const globalExecution = globalSource.indexOf('executeShortcutCommand(command, openHelp)');
assert.ok(modalBranch >= 0 && globalExecution > modalBranch, '도움말 Esc 우선순위가 없습니다.');
assert.match(
  globalSource.slice(modalBranch, globalExecution),
  /command\?\.type === 'panic'[\s\S]*closeHelp\(\)[\s\S]*return/,
);

assert.match(routingSource, /event\.repeat/);
assert.match(routingSource, /event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey/);
assert.match(routingSource, /event\.shiftKey && !isHelpKey/);
assert.match(routingSource, /Digit0/);

assert.match(helpSource, /role="dialog"/);
assert.match(helpSource, /aria-modal="true"/);
assert.match(helpSource, /aria-labelledby="shortcut-help-title"/);
assert.match(helpSource, /closeButtonRef\.current\?\.focus\(\)/);
assert.match(helpSource, /previousFocus\?\.isConnected[\s\S]*previousFocus\.focus\(\)/);
assert.match(helpSource, /event\.key !== 'Tab'/);
assert.match(helpSource, /event\.shiftKey[\s\S]*firstElement[\s\S]*lastElement/);
assert.match(helpSource, /querySelectorAll<HTMLElement>\(FOCUSABLE_SELECTOR\)/);
assert.match(helpSource, /onKeyDown=\{handleKeyDown\}/);
for (const keyLabel of ['1–9 / 0 / Q W E R Y', 'Space', 'T', 'A / B', 'Esc', '?']) {
  assert.ok(helpSource.includes(`key: '${keyLabel}'`), `${keyLabel} 도움말 항목 누락`);
}
assert.match(cssSource, /\.shortcut-help-backdrop/);
assert.match(cssSource, /\.shortcut-help-dialog:focus-visible/);
assert.match(cssSource, /@media \(prefers-reduced-motion: reduce\)/);

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

const harnessBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export { executeShortcutCommand, isEscapeOwnedByTarget, isInteractiveShortcutTarget, isShortcutBlockedByTarget } from './components/GlobalKeyboardShortcuts.tsx';",
      "export { useAudioStore } from './store/audioStore.ts';",
      "export { clonePedals, usePedalStore } from './store/pedalStore.ts';",
      "export { usePresetStore } from './store/presetStore.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'shortcut-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const harnessUrl = `data:text/javascript;base64,${Buffer.from(harnessBundle.outputFiles[0].text).toString('base64')}`;
const {
  AudioEngine,
  clonePedals,
  executeShortcutCommand,
  isEscapeOwnedByTarget,
  isInteractiveShortcutTarget,
  isShortcutBlockedByTarget,
  useAudioStore,
  usePedalStore,
  usePresetStore,
} = await import(harnessUrl);

// ── 긴급 정지(Esc)의 대상 판정 ────────────────────────────────────────────────
// DOM 이 없는 환경이라 선택자를 쉼표 조각으로 나눠 '이 요소(또는 조상)가 해당하는 조각'이 있는지만 본다.
// 운영 코드의 선택자 문자열에 그 조각이 들어 있어야 통과하므로, 선택자에서 조각이 빠지면 여기서 걸린다.
class FakeElement {
  constructor(tagName, { type = '', attributes = [], matches = [] } = {}) {
    this.tagName = tagName.toUpperCase();
    this.type = type;
    this.attributes = new Set(attributes);
    this.matches = new Set(matches);
  }

  hasAttribute(name) {
    return this.attributes.has(name);
  }

  closest(selector) {
    const clauses = selector.split(',').map((clause) => clause.trim());
    return clauses.some((clause) => this.matches.has(clause)) ? this : null;
  }
}
globalThis.Element = FakeElement;

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
} finally {
  usePedalStore.setState({ setActive: originalSetActive });
  engine.setPedalActive = originalEngineActive;
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

console.log(
  'Shortcut regression passed: guarded routing, Esc emergency stop through focused controls, current-order bypass, audio/A-B/tap/panic actions, single listener and accessible focus-trapped help.',
);
