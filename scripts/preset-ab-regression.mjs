import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
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
assert.match(activateSource, /applyPresetPedals\(storedPedals\)/);
assert.match(presetStoreSource, /clearAllCabinetIrs\(\);[\s\S]*setPedals\(clonePedals\(pedals\)\);[\s\S]*adoptTempoFromPedals\(\);[\s\S]*rebuildChain\(\)/);
assert.match(panelSource, /applyPresetPedals\(preset\.pedals\)/);
assert.match(panelSource, /clearAllCabinetIrs\(\);[\s\S]*resetPedalOrder\(\)/);
const midiSource = await readFile(new URL('../src/components/MidiAdvancedControls.tsx', import.meta.url), 'utf8');
assert.match(midiSource, /applyPresetPedals\(preset\.pedals\)/);


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

const harnessBundle = await build({
  stdin: {
    contents: [
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export { CabEffect } from './audio/nodes/CabEffect.ts';",
      "export { useAudioStore } from './store/audioStore.ts';",
      "export { clonePedals, usePedalStore } from './store/pedalStore.ts';",
      "export { usePresetStore, parsePresetJson } from './store/presetStore.ts';",
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
const { AudioEngine, CabEffect, clonePedals, useAudioStore, usePedalStore, usePresetStore, parsePresetJson } =
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

  // A regular parameter change or chain reorder preserves the session IR.
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
  const cab = new CabEffect(context, usePedalStore.getState().pedals.find((pedal) => pedal.id === 'cab'));
  const customBuffer = {};
  cab.setCustomImpulse(customBuffer);
  engine.effects.set('cab', cab);
  engine.cabImpulses.set('cab', { name: 'custom.wav', buffer: customBuffer });
  engine.cabIrRequests.set('cab', 7);
  usePedalStore.getState().updatePedalParam('cab', 'lowCut', 90);
  usePedalStore.getState().setPedals([...usePedalStore.getState().pedals].reverse());
  assert.equal(engine.getCabinetIrName('cab'), 'custom.wav');
  usePresetStore.setState({ slotB: savedSlotB });
  useAudioStore.setState({ tapTempo: { taps: [1_000, 1_500], bpm: 120 } });
  assert.equal(usePresetStore.getState().activateSlot('A'), true);
  assert.equal(engine.getCabinetIrName('cab'), null, 'snapshot loading clears session IR');
  assert.notEqual(convolver.buffer, customBuffer, 'active CabEffect must stop using the custom IR');
  assert.equal(engine.cabIrRequests.get('cab'), 8, 'snapshot loading invalidates pending decode');
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
storageValues.set('web-guitar-pedalboard-presets', dirtyPayload);
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
let storageWarnings = 0;
globalThis.window.dispatchEvent = () => { storageWarnings += 1; return true; };
const originalSetItem = globalThis.window.localStorage.setItem;
globalThis.window.localStorage.setItem = () => { throw new Error('quota exceeded'); };
try {
  usePresetStore.getState().savePreset('저장소 오류에서도 사용', usePedalStore.getState().pedals);
  assert.ok(usePresetStore.getState().presets.some((preset) => preset.name === '저장소 오류에서도 사용'));
  const prior = usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').bypassed;
  usePedalStore.getState().setPedalBypass('delay', !prior);
  assert.equal(usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').bypassed, !prior);
  assert.equal(storageWarnings, 2);
} finally {
  globalThis.window.localStorage.setItem = originalSetItem;
}

// Frequent knob changes are coalesced while the most recent value stays in memory.
usePedalStore.getState().savePedalsToStorage();
const pedalWriteCount = () => storageWrites.filter(({ key }) => key === 'guitar-pedalboard:pedals').length;
const writesBeforeKnob = pedalWriteCount();
usePedalStore.getState().updatePedalParam('delay', 'bpm', 135);
usePedalStore.getState().updatePedalParam('delay', 'bpm', 136);
assert.equal(pedalWriteCount(), writesBeforeKnob);
assert.equal(usePedalStore.getState().pedals.find((pedal) => pedal.id === 'delay').params.bpm, 136);
await delay(400);
assert.equal(pedalWriteCount(), writesBeforeKnob + 1);

console.log(
  'Preset A/B regression passed: isolated snapshots, overwrite/empty guards, active slot, single guarded keyboard listener, session-only export/storage and tempo-aware rebuild.',
);
