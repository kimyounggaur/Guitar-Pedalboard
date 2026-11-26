import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';
import { createSsrHarness, hostText } from './lib/ssr-harness.mjs';
import { find, findAll, hasClass, textContent } from './lib/html-tree.mjs';

const midiBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [fileURLToPath(new URL('../src/audio/midi/mapping.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
  metafile: true,
});
// 해석·매핑 모듈은 저장소·화면·브라우저를 모른다(S2.9): 묶어 보면 자기 파일 하나뿐이고, 아래 시험은 window·localStorage 가 아직 없는 상태에서 돌아가므로 만졌다면 ReferenceError 로 드러난다.
assert.equal(typeof globalThis.window, 'undefined');
assert.deepEqual(Object.keys(midiBundle.metafile.inputs), ['src/audio/midi/mapping.ts'], 'MIDI 해석 모듈이 다른 모듈(저장소 등)을 가져옵니다.');
const midiUrl = `data:text/javascript;base64,${Buffer.from(midiBundle.outputFiles[0].text).toString('base64')}`;
const {
  createMidiMapping,
  formatMidiMapping,
  isMidiMapping,
  midiMappingMatches,
  parseMidiMappingsJson,
  parseMidiMessage,
  validateMidiMappings,
} = await import(midiUrl);

assert.deepEqual(parseMidiMessage(Uint8Array.of(0xb0, 12, 0)), {
  kind: 'cc',
  channel: 1,
  cc: 12,
  value: 0,
  active: false,
});
assert.equal(parseMidiMessage(Uint8Array.of(0xb0, 12, 63)).active, false);
assert.equal(parseMidiMessage(Uint8Array.of(0xb0, 12, 64)).active, true);
assert.deepEqual(parseMidiMessage(Uint8Array.of(0xbf, 127, 127)), {
  kind: 'cc',
  channel: 16,
  cc: 127,
  value: 127,
  active: true,
});
assert.deepEqual(parseMidiMessage(Uint8Array.of(0x9f, 60, 100)), {
  kind: 'note',
  channel: 16,
  note: 60,
  value: 100,
  active: true,
});
assert.equal(parseMidiMessage(Uint8Array.of(0x9f, 60, 0)).active, false);
assert.equal(parseMidiMessage(Uint8Array.of(0x8f, 60, 127)).active, false);
assert.equal(parseMidiMessage(Uint8Array.of(0xe0, 0, 64)), null);
assert.equal(parseMidiMessage(Uint8Array.of(0xb0, 1)), null);
assert.equal(parseMidiMessage([0xb0, 128, 0]), null);
assert.equal(parseMidiMessage([Number.NaN, 1, 1]), null);

const ccMapping = { channel: 2, cc: 20, value: 127 };
const noteMapping = { channel: 16, note: 60, value: 100 };
assert.equal(isMidiMapping(ccMapping), true);
assert.equal(isMidiMapping(noteMapping), true);
assert.equal(isMidiMapping({ channel: 1, cc: 1, note: 1, value: 1 }), false);
assert.equal(isMidiMapping({ channel: 0, cc: 1, value: 1 }), false);
assert.equal(isMidiMapping({ channel: 1, cc: 128, value: 1 }), false);
assert.equal(isMidiMapping({ channel: 1, cc: 1, value: 1, extra: true }), false);
assert.deepEqual(createMidiMapping(parseMidiMessage(Uint8Array.of(0xb1, 20, 127))), ccMapping);
assert.equal(formatMidiMapping(ccMapping), 'Ch 2 · CC 20');
assert.equal(formatMidiMapping(noteMapping), 'Ch 16 · Note 60');
assert.equal(
  midiMappingMatches(ccMapping, parseMidiMessage(Uint8Array.of(0xb1, 20, 0))),
  true,
);
assert.equal(
  midiMappingMatches(ccMapping, parseMidiMessage(Uint8Array.of(0xb2, 20, 0))),
  false,
);
assert.equal(
  midiMappingMatches(noteMapping, parseMidiMessage(Uint8Array.of(0x9f, 60, 1))),
  true,
);

assert.deepEqual(
  validateMidiMappings({
    drive: ccMapping,
    compressor: noteMapping,
    both: { channel: 1, cc: 1, note: 1, value: 1 },
    range: { channel: 17, cc: 1, value: 1 },
    extra: { channel: 1, cc: 1, value: 1, unexpected: true },
    empty: null,
  }),
  { drive: ccMapping, compressor: noteMapping },
);
assert.deepEqual(parseMidiMappingsJson('{not-json'), {});
assert.deepEqual(parseMidiMappingsJson('[]'), {});
assert.deepEqual(
  parseMidiMappingsJson(
    '{"__proto__":{"channel":1,"cc":1,"value":1},"drive":{"channel":1,"cc":7,"value":64}}',
  ),
  { drive: { channel: 1, cc: 7, value: 64 } },
);

class MockMidiInput {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.manufacturer = 'Test MIDI';
    this.state = 'connected';
    this.handlerAssignments = 0;
    this._onmidimessage = null;
  }

  get onmidimessage() {
    return this._onmidimessage;
  }

  set onmidimessage(handler) {
    if (this._onmidimessage !== handler) this.handlerAssignments += 1;
    this._onmidimessage = handler;
  }

  /** `afterMs`: 이 메시지가 지금보다 몇 ms 뒤에 받은 것처럼 시각을 붙인다(학습 직후 1초 판정을 시계 없이 시험하려고). */
  emit(bytes, afterMs = 0) {
    this._onmidimessage?.({ data: Uint8Array.from(bytes), timeStamp: performance.now() + afterMs });
  }
}

class MockMidiAccess {
  constructor(inputs) {
    this.inputs = new Map(inputs.map((input) => [input.id, input]));
    this.stateHandlerAssignments = 0;
    this._onstatechange = null;
  }

  get onstatechange() {
    return this._onstatechange;
  }

  set onstatechange(handler) {
    if (this._onstatechange !== handler) this.stateHandlerAssignments += 1;
    this._onstatechange = handler;
  }

  emitStateChange() {
    this._onstatechange?.({});
  }
}

const storage = new Map([
  [
    'guitar-pedalboard:midi',
    JSON.stringify({
      drive: { channel: 1, cc: 7, value: 64 },
      malformed: { channel: 0, cc: 999, value: -1 },
    }),
  ],
]);
const localStorage = {
  getItem(key) {
    return storage.get(key) ?? null;
  },
  setItem(key, value) {
    storage.set(key, String(value));
  },
  removeItem(key) {
    storage.delete(key);
  },
};
Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: { localStorage, setTimeout, clearTimeout },
});

const inputOne = new MockMidiInput('input-1', 'Foot Controller');
const access = new MockMidiAccess([inputOne]);
let requestCount = 0;
const requestArgs = [];
const navigatorMock = {
  async requestMIDIAccess(...args) {
    requestCount += 1;
    requestArgs.push(args);
    return access;
  },
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: navigatorMock,
});

// 저장소·엔진·화면은 한 묶음(하니스)으로 불러 같은 인스턴스를 함께 쓴다. 화면은 서버 렌더로 그려 보고, 처리기는 직접 불러 본다.
const windowListeners = [];
const harness = await createSsrHarness({
  extraExports: [
    "{ useAudioStore, registerMidiAdvancedHandler } from './store/audioStore.ts'",
    "{ validateMidiAdvanced, parseAdvancedMessage, dispatchAdvancedMessage } from './audio/midiAdvanced.ts'",
    "{ usePedalStore } from './store/pedalStore.ts'",
    "{ usePresetStore } from './store/presetStore.ts'",
    "{ AudioEngine } from './audio/AudioEngine.ts'",
    "{ STORAGE_KEYS } from './persistence/index.ts'",
    "{ ko } from './i18n/ko.ts'",
    "{ describeMidiConnection } from './audio/midi/index.ts'",
    "{ ToggleSwitch } from './components/ToggleSwitch.tsx'",
    "{ PedalFooter } from './components/PedalFooter.tsx'",
    "{ PedalCard } from './components/PedalCard.tsx'",
    "{ AppShell } from './components/AppShell.tsx'",
    "{ MidiAdvancedControls } from './components/MidiAdvancedControls.tsx'",
  ],
  stubs: {
    // 켜기 스위치는 받은 props 만 기록한다(__ssrCalls). 실제 클릭 대신 onChange 를 직접 부른다.
    'components/StompToggleSwitch': 'export function StompToggleSwitch(props: any) { (globalThis as any).__ssrCalls.push({ stomp: props }); return <button type="button" className="stomp-stub" />; }',
    // AppShell 의 자식 화면은 이 시험의 관심사가 아니다(AppShell 이 시작할 때 하는 일만 본다).
    'components/HistoryControls': 'export function HistoryControls() { return null; }',
    'components/ChainText': 'export function ChainText() { return null; }',
    'components/ConnectGuitarPanel': 'export function ConnectGuitarPanel() { return null; }',
    'components/GlobalKeyboardShortcuts': 'export function GlobalKeyboardShortcuts() { return null; }',
    'components/Meter': 'export function Meter() { return null; }',
    'components/MidiReconnectBanner': 'export function MidiReconnectBanner() { return null; }',
    'components/PedalBoard': 'export function PedalBoard() { return null; }',
    'components/PresetPanel': 'export function PresetPanel() { return null; }',
  },
  windowOverrides: {
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    addEventListener: (type, handler, options) => { windowListeners.push({ op: 'add', type, handler, options }); },
    removeEventListener: (type, handler, options) => { windowListeners.push({ op: 'remove', type, handler, options }); },
  },
});
const {
  AudioEngine, useAudioStore, usePedalStore, usePresetStore, registerMidiAdvancedHandler, validateMidiAdvanced,
  parseAdvancedMessage, dispatchAdvancedMessage, STORAGE_KEYS, ko, describeMidiConnection,
  ToggleSwitch, PedalFooter, PedalCard, AppShell, MidiAdvancedControls,
} = harness.exports;

// 저장 키 문자열은 S1.7 에서 src/persistence/keys.ts 한 곳으로 모였다. 값은 그대로여야 한다(키 이름 변경은 S2.4 범위).
assert.equal(STORAGE_KEYS.midi, 'guitar-pedalboard:midi', 'MIDI storage key');

assert.equal(requestCount, 0, '명시적 Learn 전에 MIDI 권한을 요청했습니다.');
assert.equal(useAudioStore.getState().midiSupported, true);
assert.deepEqual(useAudioStore.getState().midiMappings, {
  drive: { channel: 1, cc: 7, value: 64 },
});

const activeCalls = [];
// 엔진이 불린 순간 저장소가 이미 새 값이어야 한다(저장소 먼저, 엔진 나중 — S2.4). 켜고 끄는 길은 setPedalActive 하나뿐이라 옛 setPedalBypass 는 불리지 않아야 한다.
const storeActiveAtEngineCall = [];
let bypassCalls = 0;
AudioEngine.getInstance().setPedalActive = (pedalId, active) => {
  activeCalls.push([pedalId, active]);
  storeActiveAtEngineCall.push(usePedalStore.getState().pedals.find((pedal) => pedal.id === pedalId)?.active);
};
AudioEngine.getInstance().setPedalBypass = () => {
  bypassCalls += 1;
};
usePedalStore.getState().setActive('drive', true);

await useAudioStore.getState().startMidiLearn('drive');
assert.equal(requestCount, 1);
assert.deepEqual(requestArgs, [[{ sysex: false }]], 'MIDI 권한 요청은 사용자 동작(학습 시작)에서, SysEx 없이 한 번만 합니다.');
assert.equal(access.stateHandlerAssignments, 1);
assert.equal(inputOne.handlerAssignments, 1);
assert.equal(useAudioStore.getState().midiDevices.length, 1);
assert.equal(useAudioStore.getState().midiLearningPedalId, 'drive');

inputOne.emit([0xb1, 20, 127]);
assert.equal(useAudioStore.getState().midiLearningPedalId, null);
assert.deepEqual(useAudioStore.getState().midiMappings.drive, ccMapping);
assert.equal(
  usePedalStore.getState().pedals.find((pedal) => pedal.id === 'drive').active,
  true,
  '학습 이벤트 자체가 켜짐·꺼짐을 바꿨습니다.',
);
assert.deepEqual(activeCalls, [], '학습 이벤트가 AudioEngine을 호출했습니다.');
assert.deepEqual(JSON.parse(storage.get('guitar-pedalboard:midi')).drive, ccMapping);

usePedalStore.getState().setActive('drive', false);
inputOne.emit([0xb1, 20, 127]);
assert.equal(
  usePedalStore.getState().pedals.find((pedal) => pedal.id === 'drive').active,
  true,
);
assert.deepEqual(activeCalls.at(-1), ['drive', true]);
assert.deepEqual(storeActiveAtEngineCall, [true], 'MIDI 로 켠 뒤: 엔진이 불렸을 때 저장소는 이미 켜져 있어야 합니다.');
// 학습 직후 1초 안의 뗌은 '토글로 지정'으로 읽힌다(S2.9). 이 시험은 래치의 값 따르기를 보므로 1초가 지난 뒤의 뗌을 보낸다.
inputOne.emit([0xb1, 20, 63], 5000);
assert.equal(
  usePedalStore.getState().pedals.find((pedal) => pedal.id === 'drive').active,
  false,
);
assert.deepEqual(activeCalls.at(-1), ['drive', false]);
const callsBeforeWrongChannel = activeCalls.length;
inputOne.emit([0xb2, 20, 127]);
assert.equal(activeCalls.length, callsBeforeWrongChannel, '다른 MIDI 채널이 매핑을 실행했습니다.');

await useAudioStore.getState().startMidiLearn('compressor');
assert.equal(requestCount, 1, '기존 MIDIAccess를 재요청했습니다.');
assert.equal(access.stateHandlerAssignments, 1, 'statechange handler를 중복 연결했습니다.');
assert.equal(inputOne.handlerAssignments, 1, 'midimessage handler를 중복 연결했습니다.');
// 꺼져 있는 페달에서 '켜짐' 값(노트 온)으로 학습해도, 그 학습 이벤트는 매핑을 만들 뿐 페달을 켜지 않는다(일반 매핑 경로로 이어지지 않는다).
usePedalStore.getState().setActive('compressor', false);
const callsBeforeNoteLearn = activeCalls.length;
inputOne.emit([0x9f, 60, 100]);
assert.deepEqual(useAudioStore.getState().midiMappings.compressor, noteMapping);
assert.equal(usePedalStore.getState().pedals.find((pedal) => pedal.id === 'compressor').active, false, '학습 이벤트가 꺼진 페달을 켰습니다.');
assert.equal(activeCalls.length, callsBeforeNoteLearn, '학습 이벤트가 엔진을 불렀습니다.');
const callsAfterNoteLearn = activeCalls.length;
inputOne.emit([0x9f, 60, 100]);
assert.deepEqual(activeCalls.at(-1), ['compressor', true]);
inputOne.emit([0x8f, 60, 64], 5000);
assert.deepEqual(activeCalls.at(-1), ['compressor', false]);
assert.equal(activeCalls.length, callsAfterNoteLearn + 2);

useAudioStore.getState().setMidiMode('compressor', 'toggle');
const beforeToggle = activeCalls.length;
inputOne.emit([0x9f, 60, 100]);
inputOne.emit([0x9f, 60, 100]); // repeated high must not toggle again
assert.equal(activeCalls.length, beforeToggle + 1);
assert.deepEqual(activeCalls.at(-1), ['compressor', true]);
inputOne.emit([0x8f, 60, 0]);
assert.equal(activeCalls.length, beforeToggle + 1);
inputOne.emit([0x9f, 60, 100]);
assert.deepEqual(activeCalls.at(-1), ['compressor', false]);
assert.equal(JSON.parse(storage.get('guitar-pedalboard:midi')).compressor.mode, 'toggle');


const advanced = validateMidiAdvanced({ channel: 2, volumeCc: 20, wahCc: 11, programs: { '8': 'preset-1', '128': 'invalid' } });
assert.deepEqual(advanced, { channel: 2, volumeCc: 20, wahCc: 11, programs: { '8': 'preset-1' } });
assert.equal(validateMidiAdvanced({ volumeCc: 7, wahCc: 7 }).wahCc, null);
assert.deepEqual(parseAdvancedMessage([0xc1, 8], advanced), { type: 'program', value: 8 });
assert.equal(parseAdvancedMessage([0xc0, 8], advanced), null);
assert.equal(parseAdvancedMessage([0xc1, 9], advanced), null);
const advancedActions = [];
const advancedHandlers = { program: (id) => advancedActions.push(['program', id]), volume: (value) => advancedActions.push(['volume', value]), wah: (value) => advancedActions.push(['wah', value]) };
registerMidiAdvancedHandler((data) => dispatchAdvancedMessage(data, advanced, advancedHandlers), (data) => Boolean(parseAdvancedMessage(data, advanced)));
const beforeAdvanced = activeCalls.length;
inputOne.emit([0xc1, 8]);
inputOne.emit([0xb1, 20, 127]);
inputOne.emit([0xb1, 11, 0]);
assert.deepEqual(advancedActions, [['program', 'preset-1'], ['volume', 1], ['wah', 0]]);
assert.equal(activeCalls.length, beforeAdvanced, '익스프레션 CC가 페달 스위치에도 적용되었습니다.');

// S5.2: CC 0~127 이 대상 범위 전체를 움직인다 — 볼륨은 0~1, 와우 수동 위치는 0~100 의 모든 정수에 닿고, 값이 커지면 커진다(거꾸로 가지 않는다).
{
  const volumes = [];
  const wahs = [];
  const sweep = { program: () => {}, volume: (value) => volumes.push(value), wah: (value) => wahs.push(value) };
  for (let cc = 0; cc <= 127; cc += 1) {
    assert.equal(dispatchAdvancedMessage([0xb1, 20, cc], advanced, sweep), true);
    assert.equal(dispatchAdvancedMessage([0xb1, 11, cc], advanced, sweep), true);
  }
  assert.equal(volumes.length, 128);
  assert.equal(wahs.length, 128);
  assert.equal(volumes[0], 0, '볼륨 CC 0 은 0');
  assert.equal(volumes[127], 1, '볼륨 CC 127 은 1');
  assert.ok(volumes.every((value, index) => value >= 0 && value <= 1 && (index === 0 || value > volumes[index - 1])), '볼륨은 0~1 안에서 CC 가 커질수록 커진다');
  assert.equal(wahs[0], 0, '와우 CC 0 은 0');
  assert.equal(wahs[127], 100, '와우 CC 127 은 100');
  assert.ok(wahs.every((value, index) => Number.isInteger(value) && (index === 0 || value >= wahs[index - 1])), '와우는 정수이고 거꾸로 가지 않는다');
  assert.deepEqual([...new Set(wahs)], Array.from({ length: 101 }, (_, index) => index), '와우 수동 위치 0~100 의 모든 값에 닿는다');
  // 범위 밖 값(128 이상·음수)은 처리하지 않는다.
  assert.equal(dispatchAdvancedMessage([0xb1, 20, 128], advanced, sweep), false);
  assert.equal(dispatchAdvancedMessage([0xb1, 20, -1], advanced, sweep), false);
  assert.equal(volumes.length, 128);
}

let advancedMount = null;
const clone = (value) => JSON.parse(JSON.stringify(value));
// 같은 설정을 화면(MidiAdvancedControls)이 저장소에서 읽어 처리기를 등록한다: 프로그램 변경 → 프리셋 적용, CC → 마스터 볼륨·수동 와우.
{
  const engine = AudioEngine.getInstance();
  const engineCalls = [];
  engine.rebuildChain = () => engineCalls.push(['rebuildChain']);
  engine.setMasterVolume = (value) => engineCalls.push(['setMasterVolume', value]);
  engine.setPedalParam = (id, key, value) => engineCalls.push(['setPedalParam', id, key, value]);
  const connectCalls = [];
  const originalConnect = useAudioStore.getState().connectSavedMidi;
  useAudioStore.setState({ connectSavedMidi: async (options) => { connectCalls.push(options); } });
  storage.set(STORAGE_KEYS.midiAdvanced, JSON.stringify(advanced));
  const presetPedals = clone(usePedalStore.getState().pedals).reverse();
  usePresetStore.setState({ presets: [{ id: 'preset-1', name: '무대용', pedals: presetPedals, trimDb: -3, updatedAt: 0 }] });
  const restoreSupported = harness.serverState(useAudioStore, { midiSupported: true });
  harness.render(MidiAdvancedControls);
  restoreSupported();
  const mounted = harness.runEffects();
  assert.deepEqual(connectCalls, [{ force: true }], '저장된 고급 설정(CC·프로그램)이 있으면 시작할 때 MIDI 연결을 이어 줍니다.');

  const notices = () => harness.stateSets.map(({ action }) => action);
  harness.stateSets.length = 0;
  inputOne.emit([0xc1, 8]);
  assert.deepEqual(usePedalStore.getState().pedals.map((pedal) => pedal.id), presetPedals.map((pedal) => pedal.id), 'Program Change 8 이 프리셋의 페달 순서를 적용합니다.');
  assert.equal(usePedalStore.getState().presetTrimDb, -3, 'Program Change 가 프리셋의 음량 보정까지 적용합니다.');
  assert.deepEqual(engineCalls, [['rebuildChain']], '프리셋 적용은 체인 재구성(공통 적용 길)입니다. 사용자 IR 은 건드리지 않습니다.');
  assert.deepEqual(notices(), [ko.midi.programLoaded('무대용')]);

  usePresetStore.setState({ presets: [] });
  const pedalsBefore = JSON.stringify(usePedalStore.getState().pedals);
  engineCalls.length = 0;
  harness.stateSets.length = 0;
  inputOne.emit([0xc1, 8]);
  assert.equal(JSON.stringify(usePedalStore.getState().pedals), pedalsBefore, '없는 프리셋이면 페달을 바꾸지 않습니다.');
  assert.deepEqual(engineCalls, []);
  assert.deepEqual(notices(), [ko.midi.programMissing]);

  engineCalls.length = 0;
  inputOne.emit([0xb1, 20, 127]);
  assert.deepEqual(engineCalls, [['setMasterVolume', 1]]);
  assert.equal(useAudioStore.getState().masterVolume, 1);
  const wah = usePedalStore.getState().pedals.find((pedal) => pedal.type === 'autoWah');
  engineCalls.length = 0;
  inputOne.emit([0xb1, 11, 127]);
  assert.deepEqual(engineCalls.at(-1), ['setPedalParam', wah.id, 'manual', 100]);
  assert.equal(usePedalStore.getState().pedals.find((pedal) => pedal.id === wah.id).params.manual, 100);
  assert.equal(usePedalStore.getState().pedals.find((pedal) => pedal.id === wah.id).params.mode, 'manual', '수동 와우 CC 는 와우를 수동 모드로 바꿉니다.');

  // 처리기는 아래 '이미 사용 중' 시험에도 쓰인다. 정리는 그 뒤에 한다.
  useAudioStore.setState({ connectSavedMidi: originalConnect });
  advancedMount = { mounted, presetPedals };
}
await useAudioStore.getState().startMidiLearn('drive');
inputOne.emit([0xb1, 20, 64]);
assert.equal(useAudioStore.getState().midiLearningPedalId, 'drive');
assert.equal(useAudioStore.getState().midiError, ko.midi.signalInUse);
useAudioStore.getState().cancelMidiLearn();
// 화면이 사라지면(효과 정리) 처리기도 풀려, 같은 Program Change 가 더는 프리셋을 적용하지 않는다.
{
  advancedMount.mounted.cleanup();
  usePresetStore.setState({ presets: [{ id: 'preset-1', name: '무대용', pedals: clone(advancedMount.presetPedals).reverse(), trimDb: -3, updatedAt: 0 }] });
  const pedalsBefore = JSON.stringify(usePedalStore.getState().pedals);
  inputOne.emit([0xc1, 8]);
  assert.equal(JSON.stringify(usePedalStore.getState().pedals), pedalsBefore, '정리 뒤에는 Program Change 가 프리셋을 적용하지 않습니다.');
}
registerMidiAdvancedHandler(null, null);

const inputTwo = new MockMidiInput('input-2', 'Backup Controller');
access.inputs.set(inputTwo.id, inputTwo);
access.emitStateChange();
assert.equal(inputTwo.handlerAssignments, 1);
assert.equal(useAudioStore.getState().midiDevices.length, 2);
access.emitStateChange();
assert.equal(inputTwo.handlerAssignments, 1, '재검색이 handler를 중복 연결했습니다.');

inputOne.state = 'disconnected';
access.emitStateChange();
assert.equal(inputOne.onmidimessage, null);
assert.deepEqual(
  useAudioStore.getState().midiDevices.map((device) => device.id),
  ['input-2'],
);

useAudioStore.getState().disposeMidi();
assert.equal(inputTwo.onmidimessage, null);
assert.equal(access.onstatechange, null);
assert.deepEqual(useAudioStore.getState().midiDevices, []);

navigatorMock.requestMIDIAccess = async () => {
  requestCount += 1;
  throw new Error('permission denied');
};
await useAudioStore.getState().startMidiLearn('drive');
assert.equal(useAudioStore.getState().midiLearningPedalId, null);
assert.equal(useAudioStore.getState().midiError, 'MIDI 접근 권한을 확인할 수 없습니다.');
assert.deepEqual(useAudioStore.getState().midiDevices, []);

let resolveStaleAccess;
const staleInput = new MockMidiInput('stale-input', 'Stale Controller');
const staleAccess = new MockMidiAccess([staleInput]);
navigatorMock.requestMIDIAccess = () => {
  requestCount += 1;
  return new Promise((resolve) => {
    resolveStaleAccess = resolve;
  });
};
const staleLearn = useAudioStore.getState().startMidiLearn('drive');
useAudioStore.getState().disposeMidi();
resolveStaleAccess(staleAccess);
await staleLearn;
assert.equal(staleAccess.onstatechange, null, 'dispose 이후 stale access를 연결했습니다.');
assert.equal(staleInput.onmidimessage, null, 'dispose 이후 stale input을 연결했습니다.');

// ── 화면: 소스를 글자로 읽지 않고, 그려 본 결과와 처리기 호출로 확인한다 ──────────────────────────────────────────
// ToggleSwitch: 오른쪽 클릭(onContextMenu)을 라벨에 이어 준다(MIDI 메뉴를 여는 길).
{
  const onContextMenu = () => {};
  harness.render(ToggleSwitch, { label: 'Sync', checked: true, onChange() {}, onContextMenu });
  assert.equal(harness.findHost('label').props.className, 'toggle-switch');
  assert.equal(harness.findHost('label').props.onContextMenu, onContextMenu, 'ToggleSwitch 는 onContextMenu 를 라벨에 연결합니다.');
  harness.render(ToggleSwitch, { label: 'Sync', checked: false, onChange() {} });
  assert.equal(harness.findHost('label').props.onContextMenu, undefined);
}

// PedalFooter: 발스위치 + MIDI 설정 메뉴(접근성 계약).
const footerCalls = [];
const footerProps = { pedalId: 'drive', pedalName: '드라이브', active: true };
const mappingMomentary = { channel: 1, cc: 7, value: 64, mode: 'momentary' };
const footerStoreState = {
  midiSupported: true,
  midiLearningPedalId: null,
  midiMappings: {},
  midiLink: 'connected',
  midiDevices: [{ id: 'input-1', name: 'Foot Controller', manufacturer: 'Test MIDI' }],
  startMidiLearn: async (pedalId) => { footerCalls.push(['startMidiLearn', pedalId]); },
  cancelMidiLearn: () => { footerCalls.push(['cancelMidiLearn']); },
  setMidiMode: (pedalId, mode) => { footerCalls.push(['setMidiMode', pedalId, mode]); },
  removeMidiMapping: (pedalId) => { footerCalls.push(['removeMidiMapping', pedalId]); },
};
const renderFooter = (patch = {}, states = {}) => {
  const restore = harness.serverState(useAudioStore, { ...footerStoreState, ...patch });
  try {
    harness.calls.length = 0;
    footerCalls.length = 0;
    return harness.render(PedalFooter, footerProps, { states });
  } finally {
    restore();
  }
};
const isButton = (node) => node.tag === 'button';
const stateAfter = (current) => harness.stateSets.map(({ action }) => harness.applyStateAction(action, current));
const hostButton = (predicate) => harness.findHost('button', predicate);
const learnLabel = (suffix = '') => `드라이브 MIDI 학습${suffix}`;

// 닫힌 메뉴·미매핑: 'MIDI 설정'(메뉴 단추), 'MIDI 학습', 상태 문구(정중한 알림 영역), 메뉴는 없다.
{
  const tree = renderFooter();
  assert.ok(hasClass(find(tree, (node) => node.tag === 'footer'), 'pedal-switches'));
  const trigger = find(tree, (node) => isButton(node) && node.attrs['aria-haspopup'] === 'menu');
  assert.equal(textContent(trigger).trim(), 'MIDI 설정');
  assert.equal(trigger.attrs['aria-expanded'], 'false');
  assert.ok(hasClass(trigger, 'midi-learn-button'));
  const learn = find(tree, (node) => isButton(node) && node.attrs['aria-label'] === learnLabel());
  assert.equal(textContent(learn).trim(), 'MIDI 학습');
  assert.ok(hasClass(learn, 'midi-learn-button'));
  const status = find(tree, (node) => node.attrs.role === 'status');
  assert.equal(status.attrs['aria-live'], 'polite');
  assert.equal(status.attrs['aria-atomic'], 'true');
  assert.equal(textContent(status).trim(), 'MIDI 미매핑');
  assert.equal(find(tree, (node) => node.attrs.role === 'menu'), null, '메뉴는 열기 전에는 없습니다.');
  assert.equal(findAll(tree, (node) => node.attrs.role === 'menuitem').length, 0);
  assert.equal(findAll(tree, (node) => node.tag === 'button' && /mode|방식/.test(textContent(node))).length, 0, '매핑이 없으면 방식 단추도 없습니다.');
  // 켜기 스위치: '효과' 라벨, 지금 켜짐 상태를 그대로 보여 준다(옛 'Bypass' 라벨은 없다).
  const stomps = harness.calls.filter((call) => call.stomp);
  assert.equal(stomps.length, 1);
  assert.equal(stomps[0].stomp.label, '효과');
  assert.equal(stomps[0].stomp.checked, true);
}

// 켜기 스위치를 누르면 단 하나의 입구(setPedalActive): 저장소가 먼저, 엔진이 나중이다.
{
  renderFooter();
  usePedalStore.getState().setActive('drive', true);
  activeCalls.length = 0;
  storeActiveAtEngineCall.length = 0;
  harness.calls.find((call) => call.stomp).stomp.onChange(false);
  assert.deepEqual(activeCalls, [['drive', false]]);
  assert.deepEqual(storeActiveAtEngineCall, [false]);
  assert.equal(usePedalStore.getState().pedals.find((pedal) => pedal.id === 'drive').active, false);
}

// MIDI 를 쓸 수 없는 브라우저: 켜기 스위치만 있고 MIDI 단추·상태 문구는 없다.
{
  const tree = renderFooter({ midiSupported: false });
  assert.equal(findAll(tree, isButton).length, 1, '켜기 스위치(가짜 단추) 하나뿐입니다.');
  assert.equal(find(tree, (node) => node.attrs.role === 'status'), null);
  assert.equal(harness.calls.filter((call) => call.stomp).length, 1);
}

// 매핑됨: 상태 문구(연결 상태 · 매핑), 방식 단추(래치 ↔ 토글).
{
  const tree = renderFooter({ midiMappings: { drive: mappingMomentary } });
  assert.equal(textContent(find(tree, (node) => node.attrs.role === 'status')).trim(), '매핑됨 · 연결됨 · Ch 1 · CC 7');
  const mode = hostButton((props) => typeof props.title === 'string' && props.title.startsWith('래치:'));
  assert.equal(hostText(mode.props.children), '방식: 래치');
  mode.props.onClick();
  assert.deepEqual(footerCalls, [['setMidiMode', 'drive', 'toggle']], '래치에서 누르면 토글로 바뀝니다.');
  const toggleTree = renderFooter({ midiMappings: { drive: { ...mappingMomentary, mode: 'toggle' } } });
  assert.ok(textContent(toggleTree).includes('방식: 토글'));
  const toggleMode = hostButton((props) => typeof props.title === 'string' && props.title.startsWith('토글:'));
  toggleMode.props.onClick();
  assert.deepEqual(footerCalls, [['setMidiMode', 'drive', 'momentary']], '토글에서 누르면 래치로 바뀝니다.');
  for (const [link, devices, expected] of [['connected', 1, '연결됨'], ['connected', 0, '장치 없음'], ['connecting', 0, '연결 중'], ['idle', 0, '연결 안 됨']]) {
    const linkTree = renderFooter({ midiMappings: { drive: mappingMomentary }, midiLink: link, midiDevices: footerStoreState.midiDevices.slice(0, devices) });
    assert.equal(textContent(find(linkTree, (node) => node.attrs.role === 'status')).trim(), `매핑됨 · ${expected} · Ch 1 · CC 7`);
    assert.equal(describeMidiConnection(link, devices), expected);
  }
}

// 학습 중: 상태 문구·단추 이름이 바뀌고, 누르면 취소다. 다른 페달이 학습 중이면 영향이 없다.
{
  const tree = renderFooter({ midiLearningPedalId: 'drive' });
  const status = find(tree, (node) => node.attrs.role === 'status');
  assert.equal(textContent(status).trim(), 'MIDI 입력 대기 중…');
  assert.ok(hasClass(status, 'is-learning'));
  const cancel = hostButton((props) => props['aria-label'] === learnLabel(' 취소'));
  assert.equal(hostText(cancel.props.children), '학습 취소');
  cancel.props.onClick();
  assert.deepEqual(footerCalls, [['cancelMidiLearn']]);
  const other = renderFooter({ midiLearningPedalId: 'delay' });
  assert.equal(textContent(find(other, (node) => node.attrs.role === 'status')).trim(), 'MIDI 미매핑');
  assert.ok(!hasClass(find(other, (node) => node.attrs.role === 'status'), 'is-learning'));
}

// 'MIDI 학습' 단추: 학습을 시작하고 열려 있던 메뉴는 닫는다.
{
  renderFooter();
  hostButton((props) => props['aria-label'] === learnLabel()).props.onClick();
  assert.deepEqual(footerCalls, [['startMidiLearn', 'drive']]);
  assert.deepEqual(stateAfter(true), [false], '학습을 시작하면 메뉴를 닫습니다.');
}

// 'MIDI 설정' 단추는 메뉴를 여닫고, 오른쪽 클릭은 지원할 때만 메뉴를 연다.
{
  renderFooter();
  const trigger = hostButton((props) => props['aria-haspopup'] === 'menu');
  trigger.props.onClick();
  assert.deepEqual([stateAfter(false), stateAfter(true)], [[true], [false]], '누를 때마다 열림·닫힘이 바뀝니다.');
  harness.stateSets.length = 0;
  const events = [];
  const event = { preventDefault: () => events.push('preventDefault'), stopPropagation: () => events.push('stopPropagation') };
  trigger.props.onContextMenu(event);
  assert.deepEqual(events, ['preventDefault', 'stopPropagation']);
  assert.deepEqual(stateAfter(false), [true], '오른쪽 클릭은 메뉴를 엽니다.');
}

// 카드 위의 포인터·마우스·터치·키 입력은 발스위치 줄 밖(끌기·단축키)으로 퍼지지 않는다.
{
  renderFooter();
  const footerHost = harness.findHost('footer');
  for (const name of ['onPointerDown', 'onMouseDown', 'onTouchStart', 'onKeyDown']) {
    let stopped = 0;
    footerHost.props[name]({ stopPropagation: () => { stopped += 1; } });
    assert.equal(stopped, 1, `${name} 은 전파를 멈춥니다.`);
  }
}

// 열린 메뉴: role=menu(이름 포함) 안에 menuitem 들. 매핑이 있을 때만 '매핑 해제'가 있다.
{
  const opened = renderFooter({}, { 0: true });
  assert.equal(find(opened, (node) => node.attrs['aria-haspopup'] === 'menu').attrs['aria-expanded'], 'true');
  const menu = find(opened, (node) => node.attrs.role === 'menu');
  assert.ok(hasClass(menu, 'midi-learn-menu'));
  assert.equal(menu.attrs['aria-label'], '드라이브 MIDI 메뉴');
  const items = findAll(menu, (node) => node.attrs.role === 'menuitem');
  assert.deepEqual(items.map((item) => [item.tag, item.attrs.type, textContent(item).trim()]), [['button', 'button', 'MIDI 학습']]);
  hostButton((props) => props.role === 'menuitem').props.onClick();
  assert.deepEqual(footerCalls, [['startMidiLearn', 'drive']]);
  assert.deepEqual(stateAfter(true), [false]);

  const mapped = renderFooter({ midiMappings: { drive: mappingMomentary } }, { 0: true });
  const mappedItems = findAll(find(mapped, (node) => node.attrs.role === 'menu'), (node) => node.attrs.role === 'menuitem');
  assert.deepEqual(mappedItems.map((item) => textContent(item).trim()), ['MIDI 학습', '매핑 해제']);
  hostButton((props) => props.role === 'menuitem' && hostText(props.children) === '매핑 해제').props.onClick();
  assert.deepEqual(footerCalls, [['removeMidiMapping', 'drive']]);
  assert.deepEqual(stateAfter(true), [false], '매핑을 풀면 메뉴를 닫습니다.');
}

// 열린 메뉴의 효과: Esc 와 바깥 포인터 입력으로 닫히고, 정리하면 같은 처리기를 같은 옵션으로 뗀다. 닫힌 메뉴는 아무것도 달지 않는다.
{
  const footerListeners = () => windowListeners.filter((entry) => entry.type === 'keydown' || entry.type === 'pointerdown');
  windowListeners.length = 0;
  renderFooter();
  harness.runEffects();
  assert.deepEqual(footerListeners(), [], '닫힌 메뉴는 창 이벤트를 듣지 않습니다.');

  renderFooter({}, { 0: true });
  windowListeners.length = 0;
  const mounted = harness.runEffects();
  const added = footerListeners();
  assert.deepEqual(added.map(({ op, type, options }) => [op, type, options]), [['add', 'pointerdown', true], ['add', 'keydown', true]]);
  const keydown = added.find((entry) => entry.type === 'keydown').handler;
  const pointerdown = added.find((entry) => entry.type === 'pointerdown').handler;
  harness.stateSets.length = 0;
  keydown({ key: 'a' });
  assert.deepEqual(harness.stateSets, [], 'Esc 가 아닌 키는 메뉴를 닫지 않습니다.');
  keydown({ key: 'Escape' });
  assert.deepEqual(stateAfter(true), [false]);
  harness.stateSets.length = 0;
  globalThis.Node = class FakeNode {};
  try {
    pointerdown({ target: new globalThis.Node() });
  } finally {
    delete globalThis.Node;
  }
  assert.deepEqual(stateAfter(true), [false], '메뉴 밖을 누르면 닫힙니다.');
  windowListeners.length = 0;
  mounted.cleanup();
  assert.deepEqual(
    footerListeners().map(({ op, type, options, handler }) => [op, type, options, handler === (type === 'keydown' ? keydown : pointerdown)]),
    [['remove', 'pointerdown', true, true], ['remove', 'keydown', true, true]],
    '정리: 달았던 처리기를 같은 옵션으로 뗍니다.',
  );
}

// 페달 카드: 켜기 스위치는 '효과' 하나이고 옛 'Bypass' 라벨은 어디에도 없다(모든 기본 페달).
{
  const restore = harness.serverState(useAudioStore, footerStoreState);
  try {
    for (const pedal of usePedalStore.getState().pedals) {
      harness.calls.length = 0;
      const html = harness.html(PedalCard, { pedal });
      assert.ok(!html.includes('Bypass'), `${pedal.id}: 화면에 Bypass 라벨이 남아 있습니다.`);
      const stomps = harness.calls.filter((call) => call.stomp);
      assert.equal(stomps.length, 1, `${pedal.id}: 켜기 스위치는 하나입니다.`);
      assert.equal(stomps[0].stomp.label, '효과');
      assert.equal(stomps[0].stomp.checked, pedal.active);
    }
  } finally {
    restore();
  }
}

// AppShell: 시작하면 저장된 MIDI 장치에 사용자 동작 없이 한 번 연결을 시도하고(권한 질문은 사용자 동작 길에서만), 닫히면 연결을 정리한다.
{
  const shellCalls = [];
  const shellPatch = {
    connectSavedMidi: async (...args) => { shellCalls.push(['connectSavedMidi', args]); },
    disposeMidi: () => { shellCalls.push(['disposeMidi']); },
  };
  const originalState = useAudioStore.getState();
  useAudioStore.setState(shellPatch);
  const restore = harness.serverState(useAudioStore, shellPatch);
  // 도크 높이 효과가 문서 루트의 스타일을 만진다(화면 밖이라 아무 일도 하지 않는 가짜).
  globalThis.document = { documentElement: { style: { setProperty() {}, removeProperty() {} } } };
  try {
    harness.render(AppShell);
    const mountedShell = harness.runEffects();
    assert.deepEqual(shellCalls, [['connectSavedMidi', []]], '시작할 때 한 번, 옵션 없이(자동 연결) 부릅니다.');
    mountedShell.cleanup();
    assert.deepEqual(shellCalls.map(([name]) => name), ['connectSavedMidi', 'disposeMidi'], '닫히면 MIDI 연결을 정리합니다.');
  } finally {
    delete globalThis.document;
    restore();
    useAudioStore.setState({ connectSavedMidi: originalState.connectSavedMidi, disposeMidi: originalState.disposeMidi });
  }
}

assert.equal(bypassCalls, 0, '켜고 끄는 길은 setPedalActive 하나입니다(옛 setPedalBypass 는 불리지 않습니다).');

console.log(
  'MIDI regression passed: parsing/channels/thresholds, strict storage, learn suppression, CC/Note bypass, device lifecycle, unsupported UI and accessible menu contract.',
);
