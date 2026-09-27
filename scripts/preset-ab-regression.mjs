import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const [presetStoreSource, panelSource, keyboardSource, shortcutRoutingSource] = await Promise.all([
  readFile(new URL('../src/store/presetStore.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PresetPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GlobalKeyboardShortcuts.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/keyboardShortcuts.ts', import.meta.url), 'utf8'),
]);

assert.match(presetStoreSource, /slotA: PedalState\[\] \| null/);
assert.match(presetStoreSource, /slotB: PedalState\[\] \| null/);
assert.match(presetStoreSource, /activeSlot: PresetComparisonSlot/);
assert.match(presetStoreSource, /captureCurrentToSlot: \(slot: PresetComparisonSlot\) => void/);
assert.match(presetStoreSource, /activateSlot: \(slot: PresetComparisonSlot\) => boolean/);
assert.match(presetStoreSource, /const capturedPedals = clonePedals\(usePedalStore\.getState\(\)\.pedals\)/);

const activateStart = presetStoreSource.indexOf('activateSlot: (slot) => {');
assert.ok(activateStart >= 0, '슬롯 활성화 action을 찾을 수 없습니다.');
const activateSource = presetStoreSource.slice(activateStart);
assert.match(
  activateSource,
  /setPedals\(clonePedals\(storedPedals\)\);[\s\S]*adoptTempoFromPedals\(\);[\s\S]*AudioEngine\.getInstance\(\)\.rebuildChain\(\)/,
  'setPedals → tempo adoption → 무중단 rebuild 순서가 아닙니다.',
);

assert.match(panelSource, /className="preset-ab-buttons"/);
const abButtonsStart = panelSource.indexOf('<div className="preset-ab-buttons"');
const abButtonsEnd = panelSource.indexOf('</div>', abButtonsStart);
const abButtonsSource = panelSource.slice(abButtonsStart, abButtonsEnd);
assert.equal([...abButtonsSource.matchAll(/<button/g)].length, 4, 'A/B toolbar 버튼은 정확히 4개여야 합니다.');
for (const label of ['A', 'B', 'A←현재', 'B←현재']) {
  assert.ok(abButtonsSource.includes(label), `${label} 버튼 누락`);
}
assert.match(abButtonsSource, /disabled=\{!slotA\}/);
assert.match(abButtonsSource, /disabled=\{!slotB\}/);
assert.equal([...abButtonsSource.matchAll(/aria-pressed=/g)].length, 2);
assert.match(panelSource, /<p role="status" aria-live="polite">/);

assert.match(shortcutRoutingSource, /key === 't'/);
assert.match(shortcutRoutingSource, /key === 'a' \|\| key === 'b'/);
assert.match(shortcutRoutingSource, /slot: key === 'a' \? 'A' : 'B'/);
assert.match(shortcutRoutingSource, /event\.repeat/);
assert.match(shortcutRoutingSource, /event\.isComposing/);
assert.match(shortcutRoutingSource, /event\.(?:ctrlKey|metaKey|altKey|shiftKey)/);
assert.match(keyboardSource, /input'[\s\S]*select'[\s\S]*textarea'[\s\S]*contenteditable/);
assert.match(keyboardSource, /activateSlot\(command\.slot\)/);
assert.equal(
  [...keyboardSource.matchAll(/addEventListener\('keydown'/g)].length,
  1,
  'keydown listener는 하나여야 합니다.',
);
assert.equal([...keyboardSource.matchAll(/removeEventListener\('keydown'/g)].length, 1);

const storageWrites = [];
const storageValues = new Map();
globalThis.window = {
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

const harnessBundle = await build({
  stdin: {
    contents: [
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export { useAudioStore } from './store/audioStore.ts';",
      "export { clonePedals, usePedalStore } from './store/pedalStore.ts';",
      "export { usePresetStore } from './store/presetStore.ts';",
    ].join('\n'),
    resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
    sourcefile: 'preset-ab-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const harnessUrl = `data:text/javascript;base64,${Buffer.from(harnessBundle.outputFiles[0].text).toString('base64')}`;
const { AudioEngine, clonePedals, useAudioStore, usePedalStore, usePresetStore } =
  await import(harnessUrl);

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
  usePresetStore.setState({ slotA: null, slotB: null, activeSlot: 'A' });
  assert.equal(usePresetStore.getState().slotA, null);
  assert.equal(usePresetStore.getState().slotB, null);
  assert.equal(usePresetStore.getState().activeSlot, 'A');
  const sourceA = pedalsWithTempo(137, 23);
  usePedalStore.getState().setPedals(sourceA);
  const presetWritesBeforeCapture = storageWrites.filter(
    ({ key }) => key === 'web-guitar-pedalboard-presets',
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
    storageWrites.filter(({ key }) => key === 'web-guitar-pedalboard-presets').length,
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
      pedal.id === 'drive' ? { ...pedal, enabled: false, bypassed: true } : pedal,
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

  usePresetStore.setState({ slotB: savedSlotB });
  useAudioStore.setState({ tapTempo: { taps: [1_000, 1_500], bpm: 120 } });
  assert.equal(usePresetStore.getState().activateSlot('A'), true);
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
    ['exportedAt', 'presets', 'version'],
    'Export payload에 세션 슬롯 필드가 포함되었습니다.',
  );
  assert.ok(!('slotA' in exported) && !('slotB' in exported) && !('activeSlot' in exported));
  assert.ok(
    storageWrites.some(({ key }) => key === 'web-guitar-pedalboard-presets'),
    '사용자 프리셋 localStorage 검증용 write가 발생하지 않았습니다.',
  );
  assert.ok(
    storageWrites
      .filter(({ key }) => key === 'web-guitar-pedalboard-presets')
      .every(({ value }) => !/"slotA"|"slotB"|"activeSlot"/.test(value)),
    '사용자 프리셋 localStorage에 세션 슬롯이 저장되었습니다.',
  );
} finally {
  engine.rebuildChain = originalRebuildChain;
}

console.log(
  'Preset A/B regression passed: isolated snapshots, overwrite/empty guards, active slot, single guarded keyboard listener, session-only export/storage and tempo-aware rebuild.',
);
