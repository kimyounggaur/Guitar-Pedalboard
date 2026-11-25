import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

// S2.9: 해석·매핑은 src/audio/midi/mapping.ts, 연결은 MidiService.ts, 메시지 처리는 MidiRouter.ts 로 나뉘었다.
const midiSource = await readFile(new URL('../src/audio/midi/mapping.ts', import.meta.url), 'utf8');
const midiServiceSource = await readFile(new URL('../src/audio/midi/MidiService.ts', import.meta.url), 'utf8');
const midiRouterSource = await readFile(new URL('../src/audio/midi/MidiRouter.ts', import.meta.url), 'utf8');
const keysSource = await readFile(new URL('../src/persistence/keys.ts', import.meta.url), 'utf8');
const audioStoreSource = await readFile(
  new URL('../src/store/audioStore.ts', import.meta.url),
  'utf8',
);
const pedalCardSource = await readFile(
  new URL('../src/components/PedalCard.tsx', import.meta.url),
  'utf8',
);
// S4.3: 발스위치 줄(켜기 스위치와 MIDI 메뉴)은 PedalCard 에서 PedalFooter 로 옮겨졌다.
const pedalFooterSource = await readFile(
  new URL('../src/components/PedalFooter.tsx', import.meta.url),
  'utf8',
);
const toggleSource = await readFile(
  new URL('../src/components/ToggleSwitch.tsx', import.meta.url),
  'utf8',
);
const appShellSource = await readFile(
  new URL('../src/components/AppShell.tsx', import.meta.url),
  'utf8',
);

// 저장 키 문자열은 S1.7 에서 src/persistence/keys.ts 한 곳으로 모였다. 값은 그대로여야 한다(키 이름 변경은 S2.4 범위).
assert.match(keysSource, /midi: 'guitar-pedalboard:midi'/, 'MIDI storage key');
assert.match(audioStoreSource, /STORAGE_KEYS\.midi/);
assert.doesNotMatch(midiSource, /localStorage|guitar-pedalboard:midi/, 'MIDI 해석 모듈은 저장소와 키 문자열을 모른다');
assert.equal(
  [...midiServiceSource.matchAll(/navigator\.requestMIDIAccess\s*\(/g)].length,
  1,
  'requestMIDIAccess 호출 지점은 MidiService.connect 하나여야 합니다.',
);
assert.equal(
  [...audioStoreSource.matchAll(/requestMIDIAccess\s*\(/g)].length,
  0,
  '저장소는 MIDI 접근을 직접 요청하지 않는다(MidiService 만 요청한다).',
);
const connectStart = midiServiceSource.indexOf('async connect()');
const disposeStart = midiServiceSource.indexOf('dispose(): void');
assert.ok(connectStart >= 0 && disposeStart > connectStart);
assert.match(
  midiServiceSource.slice(connectStart, disposeStart),
  /navigator\.requestMIDIAccess\(\{ sysex: false \}\)/,
  'MIDI 권한 요청이 connect(사용자 동작 길) 밖에 있습니다.',
);
const routerHandleStart = midiRouterSource.indexOf('handle(message');
const routerLearnStart = midiRouterSource.indexOf('private learn(');
const routerHandleSource = midiRouterSource.slice(routerHandleStart, routerLearnStart);
assert.match(routerHandleSource, /if \(learningPedalId\)/);
assert.match(midiRouterSource, /createMidiMapping\(message\)/);
assert.ok(
  routerHandleSource.indexOf('return;\n    }') < routerHandleSource.indexOf('Object.entries'),
  '학습 이벤트가 일반 매핑 적용 경로로 이어집니다.',
);
// 켜고 끄는 입구는 하나(setPedalActive, S2.4)다. 라우터는 포트로만 켜고 끄고, 저장소의 포트가 그 입구를 부른다.
assert.ok(midiRouterSource.includes('this.ports.setPedalActive(pedalId, active)'));
assert.ok(!midiRouterSource.includes('setPedalBypass'));
assert.match(audioStoreSource, /setPedalActive: \(pedalId, active\) => \{\s*setPedalActive\(pedalId, active\);/);
assert.match(midiServiceSource, /access\.onstatechange = this\.stateChangeHandler/);
assert.match(midiServiceSource, /input\.onmidimessage = this\.messageHandler/);
assert.match(midiServiceSource, /input\.onmidimessage = null/);
assert.match(midiServiceSource, /this\.access\.onstatechange = null/);

assert.match(toggleSource, /onContextMenu\?: MouseEventHandler<HTMLLabelElement>/);
assert.match(toggleSource, /<label className="toggle-switch" onContextMenu=\{onContextMenu\}>/);
assert.match(pedalFooterSource, /role="menu"/);
assert.match(pedalFooterSource, /role="menuitem"/);
assert.match(pedalFooterSource, />\s*MIDI 학습\s*<\/button>/);
assert.match(pedalFooterSource, /className="midi-learn-button"/);
assert.match(pedalFooterSource, /aria-live="polite"/);
assert.ok(pedalFooterSource.includes('<StompToggleSwitch label="효과" checked={active} onChange={(checked) => setPedalActive(pedalId, checked)} />'));
assert.match(pedalFooterSource, /aria-haspopup="menu"/);
assert.doesNotMatch(pedalCardSource, /label="Bypass"/);
assert.doesNotMatch(pedalFooterSource, /label="Bypass"/);

assert.match(appShellSource, /connectSavedMidi\(\)/);

const midiBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [fileURLToPath(new URL('../src/audio/midi/mapping.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
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
const navigatorMock = {
  async requestMIDIAccess() {
    requestCount += 1;
    return access;
  },
};
Object.defineProperty(globalThis, 'navigator', {
  configurable: true,
  value: navigatorMock,
});

const runtimeBundle = await build({
  plugins: [workerUrlStub],
  stdin: {
    contents: `
      export { useAudioStore, registerMidiAdvancedHandler } from './src/store/audioStore.ts';
      export { validateMidiAdvanced, parseAdvancedMessage, dispatchAdvancedMessage } from './src/audio/midiAdvanced.ts';
      export { usePedalStore } from './src/store/pedalStore.ts';
      export { AudioEngine } from './src/audio/AudioEngine.ts';
    `,
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
    sourcefile: 'midi-runtime-entry.ts',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const runtimeUrl = `data:text/javascript;base64,${Buffer.from(runtimeBundle.outputFiles[0].text).toString('base64')}`;
const { AudioEngine, useAudioStore, usePedalStore, registerMidiAdvancedHandler, validateMidiAdvanced, parseAdvancedMessage, dispatchAdvancedMessage } = await import(runtimeUrl);

assert.equal(requestCount, 0, '명시적 Learn 전에 MIDI 권한을 요청했습니다.');
assert.equal(useAudioStore.getState().midiSupported, true);
assert.deepEqual(useAudioStore.getState().midiMappings, {
  drive: { channel: 1, cc: 7, value: 64 },
});

const activeCalls = [];
AudioEngine.getInstance().setPedalActive = (pedalId, active) => {
  activeCalls.push([pedalId, active]);
};
usePedalStore.getState().setActive('drive', true);

await useAudioStore.getState().startMidiLearn('drive');
assert.equal(requestCount, 1);
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
inputOne.emit([0x9f, 60, 100]);
assert.deepEqual(useAudioStore.getState().midiMappings.compressor, noteMapping);
usePedalStore.getState().setActive('compressor', false);
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
await useAudioStore.getState().startMidiLearn('drive');
inputOne.emit([0xb1, 20, 64]);
assert.equal(useAudioStore.getState().midiLearningPedalId, 'drive');
assert.match(useAudioStore.getState().midiError, /이미 사용 중/);
useAudioStore.getState().cancelMidiLearn();
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

console.log(
  'MIDI regression passed: parsing/channels/thresholds, strict storage, learn suppression, CC/Note bypass, device lifecycle, unsupported UI and accessible menu contract.',
);
