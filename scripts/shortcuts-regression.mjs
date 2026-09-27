import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const routingBundle = await build({
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
assert.equal(resolveShortcutCommand(keyEvent('0')), null);
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

const [globalSource, helpSource, routingSource, cssSource] = await Promise.all([
  readFile(new URL('../src/components/GlobalKeyboardShortcuts.tsx', import.meta.url), 'utf8'),
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

const storeWrite = globalSource.indexOf('pedalStore.setPedalBypass(pedal.id, bypassed);');
const engineWrite = globalSource.indexOf(
  "AudioEngine.getInstance().setPedalBypass(pedal.id, bypassed);",
);
assert.ok(storeWrite >= 0 && engineWrite > storeWrite, 'Bypass가 store → engine 순서가 아닙니다.');
assert.match(globalSource, /const pedal = pedalStore\.pedals\[command\.index\]/);
assert.match(globalSource, /command\.index < 0 \|\| command\.index > 8/);
assert.match(globalSource, /if \(audioState\.isLoading\) return true/);
assert.match(globalSource, /audioState\.isRunning[\s\S]*audioState\.stop\(\)[\s\S]*audioState\.start\(\)/);
assert.match(globalSource, /tapTempoTap\(\)/);
assert.match(globalSource, /activateSlot\(command\.slot\)/);
assert.match(globalSource, /getState\(\)\.panic\(\)/);

const modalBranch = globalSource.indexOf('if (helpOpenRef.current)');
const globalExecution = globalSource.indexOf('executeShortcutCommand(command, openHelp)');
assert.ok(modalBranch >= 0 && globalExecution > modalBranch, '도움말 Esc 우선순위가 없습니다.');
assert.match(
  globalSource.slice(modalBranch, globalExecution),
  /command\?\.type === 'panic'[\s\S]*closeHelp\(\)[\s\S]*return/,
);

assert.match(routingSource, /event\.repeat \|\| event\.isComposing/);
assert.match(routingSource, /event\.ctrlKey \|\| event\.metaKey \|\| event\.altKey/);
assert.match(routingSource, /event\.shiftKey && !isHelpKey/);
assert.match(routingSource, /\^\[1-9\]\$/);

assert.match(helpSource, /role="dialog"/);
assert.match(helpSource, /aria-modal="true"/);
assert.match(helpSource, /aria-labelledby="shortcut-help-title"/);
assert.match(helpSource, /closeButtonRef\.current\?\.focus\(\)/);
assert.match(helpSource, /previousFocus\?\.isConnected[\s\S]*previousFocus\.focus\(\)/);
assert.match(helpSource, /event\.key !== 'Tab'/);
assert.match(helpSource, /event\.shiftKey[\s\S]*firstElement[\s\S]*lastElement/);
assert.match(helpSource, /querySelectorAll<HTMLElement>\(FOCUSABLE_SELECTOR\)/);
assert.match(helpSource, /onKeyDown=\{handleKeyDown\}/);
for (const keyLabel of ['1–9', 'Space', 'T', 'A / B', 'Esc', '?']) {
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
  stdin: {
    contents: [
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export { executeShortcutCommand } from './components/GlobalKeyboardShortcuts.tsx';",
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
  useAudioStore,
  usePedalStore,
  usePresetStore,
} = await import(harnessUrl);

const reorderedPedals = clonePedals(usePedalStore.getState().pedals).reverse();
usePedalStore.getState().setPedals(reorderedPedals);
const targetPedal = usePedalStore.getState().pedals[2];
const originalBypassed = targetPedal.bypassed;
const originalSetPedalBypass = usePedalStore.getState().setPedalBypass;
const engine = AudioEngine.getInstance();
const originalEngineBypass = engine.setPedalBypass;
const bypassOrder = [];
usePedalStore.setState({
  setPedalBypass: (id, bypassed) => {
    bypassOrder.push(`store:${id}:${bypassed}`);
    originalSetPedalBypass(id, bypassed);
  },
});
engine.setPedalBypass = (id, bypassed) => {
  bypassOrder.push(`engine:${id}:${bypassed}`);
};

try {
  assert.equal(
    executeShortcutCommand({ type: 'toggle-pedal', index: 2 }, () => {}),
    true,
  );
  assert.deepEqual(bypassOrder, [
    `store:${targetPedal.id}:${!originalBypassed}`,
    `engine:${targetPedal.id}:${!originalBypassed}`,
  ]);
  assert.equal(usePedalStore.getState().pedals[2].id, targetPedal.id);
  assert.equal(usePedalStore.getState().pedals[2].bypassed, !originalBypassed);
  assert.equal(executeShortcutCommand({ type: 'toggle-pedal', index: -1 }, () => {}), false);
  assert.equal(executeShortcutCommand({ type: 'toggle-pedal', index: 9 }, () => {}), false);
} finally {
  usePedalStore.setState({ setPedalBypass: originalSetPedalBypass });
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
  'Shortcut regression passed: guarded routing, current-order bypass, audio/A-B/tap/panic actions, single listener and accessible focus-trapped help.',
);
