import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { setTimeout as delay } from 'node:timers/promises';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const [presetStoreSource, panelSource, keyboardSource, shortcutRoutingSource, chainActionsSource] = await Promise.all([
  readFile(new URL('../src/store/presetStore.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/PresetPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/GlobalKeyboardShortcuts.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/keyboardShortcuts.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/store/chainActions.ts', import.meta.url), 'utf8'),
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
assert.match(activateSource, /applyPresetPedals\(storedPedals, storedTrimDb\)/, '슬롯을 켜면 슬롯에 담긴 음량 보정(S1.4c)도 함께 적용한다');
assert.match(presetStoreSource, /clearAllCabinetIrs\(\);[\s\S]*setPedals\(clonePedals\(pedals\), clampTrimDb\(trimDb\)\);[\s\S]*adoptTempoFromPedals\(\);[\s\S]*rebuildChain\(\)/);
assert.match(panelSource, /applyPresetPedals\(preset\.pedals, preset\.trimDb\)/);
// S2.8: '기본 페달 설정' 은 `chainActions` 로 옮겼다(되돌리기 스냅숏을 함께 다루려고). IR 을 지운 뒤 페달을 처음 값으로 돌리는 순서는 그대로다.
assert.match(chainActionsSource, /clearAllCabinetIrs\(\);[\s\S]*resetPedalOrder\(\)/);
assert.ok(panelSource.includes('resetToDefaultChain()'), "패널의 '기본 페달 설정' 은 chainActions 의 resetToDefaultChain 을 부른다");
const midiSource = await readFile(new URL('../src/components/MidiAdvancedControls.tsx', import.meta.url), 'utf8');
assert.match(midiSource, /applyPresetPedals\(preset\.pedals, preset\.trimDb\)/);


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

const harnessBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: [
      "export { AudioEngine } from './audio/AudioEngine.ts';",
      "export { CabEffect } from './audio/nodes/CabEffect.ts';",
      "export { useAudioStore } from './store/audioStore.ts';",
      "export { clonePedals, usePedalStore } from './store/pedalStore.ts';",
      "export { usePresetStore, parsePresetJson } from './store/presetStore.ts';",
      "export { useToastStore } from './store/toastStore.ts';",
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
const { AudioEngine, CabEffect, clonePedals, useAudioStore, usePedalStore, usePresetStore, parsePresetJson, useToastStore } =
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

console.log(
  'Preset A/B regression passed: isolated snapshots, overwrite/empty guards, active slot, single guarded keyboard listener, session-only export/storage and tempo-aware rebuild.',
);
