import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { clearTimeout, setTimeout } from 'node:timers';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const midiSource = await readFile(new URL('../src/audio/midi.ts', import.meta.url), 'utf8');
const audioStoreSource = await readFile(
  new URL('../src/store/audioStore.ts', import.meta.url),
  'utf8',
);
const pedalCardSource = await readFile(
  new URL('../src/components/PedalCard.tsx', import.meta.url),
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

assert.match(midiSource, /'guitar-pedalboard:midi'/, 'MIDI storage key');
assert.equal(
  [...audioStoreSource.matchAll(/navigator\.requestMIDIAccess\s*\(/g)].length,
  1,
  'requestMIDIAccess 호출 지점은 MIDI Learn 경로 하나여야 합니다.',
);
const requestHelperStart = audioStoreSource.indexOf('async function requestMidiAccessForLearn');
const disposeRuntimeStart = audioStoreSource.indexOf('function disposeMidiRuntime');
assert.ok(requestHelperStart >= 0 && disposeRuntimeStart > requestHelperStart);
assert.match(
  audioStoreSource.slice(requestHelperStart, disposeRuntimeStart),
  /navigator\.requestMIDIAccess\(\{ sysex: false \}\)/,
  'MIDI 권한 요청이 Learn helper 밖에 있습니다.',
);
const messageHandlerStart = audioStoreSource.indexOf('function handleMidiMessage');
const syncInputsStart = audioStoreSource.indexOf('function syncMidiInputs');
const messageHandlerSource = audioStoreSource.slice(messageHandlerStart, syncInputsStart);
assert.match(messageHandlerSource, /if \(learningPedalId\)/);
assert.match(messageHandlerSource, /createMidiMapping\(message\)/);
assert.ok(
  messageHandlerSource.indexOf('return;\n  }') < messageHandlerSource.indexOf('Object.entries'),
  '학습 이벤트가 일반 매핑 적용 경로로 이어집니다.',
);
assert.match(messageHandlerSource, /pedalStore\.setPedalBypass\(pedalId, message\.bypassed\)/);
assert.match(messageHandlerSource, /audioEngine\.setPedalBypass\(pedalId, message\.bypassed\)/);
assert.match(audioStoreSource, /midiAccess\.onstatechange = handleMidiStateChange/);
assert.match(audioStoreSource, /input\.onmidimessage = handleMidiMessage/);
assert.match(audioStoreSource, /input\.onmidimessage = null/);
assert.match(audioStoreSource, /midiAccess\.onstatechange = null/);

assert.match(toggleSource, /onContextMenu\?: MouseEventHandler<HTMLLabelElement>/);
assert.match(toggleSource, /<label className="toggle-switch" onContextMenu=\{onContextMenu\}>/);
assert.match(pedalCardSource, /role="menu"/);
assert.match(pedalCardSource, /role="menuitem"/);
assert.match(pedalCardSource, />\s*MIDI 학습\s*<\/button>/);
assert.match(pedalCardSource, /className="midi-learn-button"/);
assert.match(pedalCardSource, /aria-live="polite"/);
assert.match(
  pedalCardSource,
  /\{midiSupported \? \([\s\S]*className="midi-bypass-control"[\s\S]*\) : \(\s*bypassToggle\s*\)\}/,
  'Web MIDI 미지원 분기는 MIDI 컨트롤 없이 기존 Bypass 스위치만 렌더해야 합니다.',
);
assert.match(appShellSource, /useEffect\(\(\) => \(\) => disposeMidi\(\)/);

const midiBundle = await build({
  entryPoints: [fileURLToPath(new URL('../src/audio/midi.ts', import.meta.url))],
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
  bypassed: false,
});
assert.equal(parseMidiMessage(Uint8Array.of(0xb0, 12, 63)).bypassed, false);
assert.equal(parseMidiMessage(Uint8Array.of(0xb0, 12, 64)).bypassed, true);
assert.deepEqual(parseMidiMessage(Uint8Array.of(0xbf, 127, 127)), {
  kind: 'cc',
  channel: 16,
  cc: 127,
  value: 127,
  bypassed: true,
});
assert.deepEqual(parseMidiMessage(Uint8Array.of(0x9f, 60, 100)), {
  kind: 'note',
  channel: 16,
  note: 60,
  value: 100,
  bypassed: true,
});
assert.equal(parseMidiMessage(Uint8Array.of(0x9f, 60, 0)).bypassed, false);
assert.equal(parseMidiMessage(Uint8Array.of(0x8f, 60, 127)).bypassed, false);
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

  emit(bytes) {
    this._onmidimessage?.({ data: Uint8Array.from(bytes) });
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
  stdin: {
    contents: `
      export { useAudioStore } from './src/store/audioStore.ts';
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
const { AudioEngine, useAudioStore, usePedalStore } = await import(runtimeUrl);

assert.equal(requestCount, 0, '명시적 Learn 전에 MIDI 권한을 요청했습니다.');
assert.equal(useAudioStore.getState().midiSupported, true);
assert.deepEqual(useAudioStore.getState().midiMappings, {
  drive: { channel: 1, cc: 7, value: 64 },
});

const bypassCalls = [];
AudioEngine.getInstance().setPedalBypass = (pedalId, bypassed) => {
  bypassCalls.push([pedalId, bypassed]);
};
usePedalStore.getState().setPedalBypass('drive', false);

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
  usePedalStore.getState().pedals.find((pedal) => pedal.id === 'drive').bypassed,
  false,
  '학습 이벤트 자체가 Bypass를 적용했습니다.',
);
assert.deepEqual(bypassCalls, [], '학습 이벤트가 AudioEngine을 호출했습니다.');
assert.deepEqual(JSON.parse(storage.get('guitar-pedalboard:midi')).drive, ccMapping);

inputOne.emit([0xb1, 20, 127]);
assert.equal(
  usePedalStore.getState().pedals.find((pedal) => pedal.id === 'drive').bypassed,
  true,
);
assert.deepEqual(bypassCalls.at(-1), ['drive', true]);
inputOne.emit([0xb1, 20, 63]);
assert.equal(
  usePedalStore.getState().pedals.find((pedal) => pedal.id === 'drive').bypassed,
  false,
);
assert.deepEqual(bypassCalls.at(-1), ['drive', false]);
const callsBeforeWrongChannel = bypassCalls.length;
inputOne.emit([0xb2, 20, 127]);
assert.equal(bypassCalls.length, callsBeforeWrongChannel, '다른 MIDI 채널이 매핑을 실행했습니다.');

await useAudioStore.getState().startMidiLearn('compressor');
assert.equal(requestCount, 1, '기존 MIDIAccess를 재요청했습니다.');
assert.equal(access.stateHandlerAssignments, 1, 'statechange handler를 중복 연결했습니다.');
assert.equal(inputOne.handlerAssignments, 1, 'midimessage handler를 중복 연결했습니다.');
inputOne.emit([0x9f, 60, 100]);
assert.deepEqual(useAudioStore.getState().midiMappings.compressor, noteMapping);
const callsAfterNoteLearn = bypassCalls.length;
inputOne.emit([0x9f, 60, 100]);
assert.deepEqual(bypassCalls.at(-1), ['compressor', true]);
inputOne.emit([0x8f, 60, 64]);
assert.deepEqual(bypassCalls.at(-1), ['compressor', false]);
assert.equal(bypassCalls.length, callsAfterNoteLearn + 2);

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
