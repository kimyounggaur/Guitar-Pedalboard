// S2.9 MIDI 시험(설계서 S2.9·E-13, 수용 기준 ①~⑤).
//
//   1. 라우터   MidiRouter — 값 방향(64 이상 켜짐)·latch/toggle·학습 직후 1초 안의 누름→뗌으로 토글 자동 지정(경계 포함).
//   2. 서비스   MidiService — 사용자 동작 없이는 권한 창을 띄우지 않는다(granted 만 자동), 장치를 뺐다 꽂으면 리스너가 다시 붙는다.
//   3. 저장소   audioStore 에 이어 붙었을 때: 열자마자 연결 / 버튼으로 연결 / 학습→토글 지정이 저장·알림까지 이어지는지.
//   4. 소스     '권한 창은 사용자 동작에서만'의 호출 모양(AppShell·고급 설정·배너)이 그대로인지.
// 실제 브라우저에서의 화면(배너·'매핑됨 · 연결됨'·키보드)은 e2e E-13 이 본다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (key) => (storage.has(key) ? storage.get(key) : null),
    setItem: (key, value) => void storage.set(key, String(value)),
    removeItem: (key) => void storage.delete(key),
    key: (index) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
  },
  dispatchEvent() {},
  setTimeout: globalThis.setTimeout.bind(globalThis),
  clearTimeout: globalThis.clearTimeout.bind(globalThis),
};

// ---------------------------------------------------------------------------------------------
// 가짜 Web MIDI
// ---------------------------------------------------------------------------------------------
class MockInput {
  constructor(id, name) {
    this.id = id;
    this.name = name;
    this.manufacturer = 'Test';
    this.state = 'connected';
    this.assignments = 0;
    this._handler = null;
  }

  get onmidimessage() {
    return this._handler;
  }

  set onmidimessage(handler) {
    if (this._handler !== handler) this.assignments += 1;
    this._handler = handler;
  }

  emit(bytes, afterMs = 0) {
    this._handler?.({ data: Uint8Array.from(bytes), timeStamp: performance.now() + afterMs });
  }
}

class MockAccess {
  constructor(inputs) {
    this.inputs = new Map(inputs.map((input) => [input.id, input]));
    this._onstatechange = null;
  }

  get onstatechange() {
    return this._onstatechange;
  }

  set onstatechange(handler) {
    this._onstatechange = handler;
  }

  fire() {
    this._onstatechange?.({});
  }
}

class MockPermission {
  constructor(state) {
    this.state = state;
    this.onchange = null;
  }

  set(state) {
    this.state = state;
    this.onchange?.({});
  }
}

/** 이 시험 하나가 쓰는 navigator. 요청 횟수·권한 조회 기록을 남긴다. */
function installNavigator({ permission = 'prompt', supported = true, queryThrows = false, noPermissionsApi = false, requestImpl } = {}) {
  const record = { requests: 0, queries: [], status: new MockPermission(permission), access: null };
  const nav = {};
  if (supported) {
    nav.requestMIDIAccess = (options) => {
      record.requests += 1;
      record.lastOptions = options;
      return requestImpl ? requestImpl(record) : Promise.resolve(record.access);
    };
  }
  if (!noPermissionsApi) {
    nav.permissions = {
      query: async (descriptor) => {
        record.queries.push(descriptor);
        if (queryThrows) throw new TypeError("'midi' is not a valid enum value of PermissionName");
        return record.status;
      },
    };
  }
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: nav });
  return record;
}

// ---------------------------------------------------------------------------------------------
// 번들: 순수 모듈(midi/index) 과 저장소
// ---------------------------------------------------------------------------------------------
async function bundleToUrl(contents, sourcefile) {
  const result = await build({
    plugins: [workerUrlStub],
    stdin: { contents, resolveDir: fileURLToPath(new URL('../src', import.meta.url)), sourcefile },
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
  });
  return `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`;
}

const midi = await import(await bundleToUrl("export * from './audio/midi/index.ts';", 'midi-harness.ts'));
const { MidiRouter, MidiService, MIDI_MODE_PROBE_MS, parseMidiMessage, describeMidiConnection } = midi;
const msg = (bytes) => parseMidiMessage(Uint8Array.from(bytes));

assert.equal(MIDI_MODE_PROBE_MS, 1000, '설계서 4.11: 1초');

// ---------------------------------------------------------------------------------------------
// 1. 라우터
// ---------------------------------------------------------------------------------------------
function harness({ pedals = { drive: false, delay: false }, mappings = {}, learning = null } = {}) {
  const state = { mappings: JSON.parse(JSON.stringify(mappings)), learning, pedals: { ...pedals } };
  const log = { active: [], notices: [], learned: 0, changed: 0, ended: 0 };
  const timers = [];
  const router = new MidiRouter({
    getMappings: () => state.mappings,
    learned: (next) => {
      state.mappings = next;
      state.learning = null;
      log.learned += 1;
    },
    changeMappings: (next) => {
      state.mappings = next;
      log.changed += 1;
    },
    getLearningPedalId: () => state.learning,
    endLearning: () => {
      state.learning = null;
      log.ended += 1;
    },
    pedalActive: (id) => state.pedals[id],
    setPedalActive: (id, active) => {
      state.pedals[id] = active;
      log.active.push([id, active]);
    },
    notifyMode: (notice) => log.notices.push(notice),
    setTimer: (callback, ms) => {
      const timer = { callback, ms, cleared: false };
      timers.push(timer);
      return timer;
    },
    clearTimer: (timer) => {
      timer.cleared = true;
    },
  });
  return { router, state, log, timers };
}
const CC = (value, channel = 1, cc = 64) => msg([0xb0 | (channel - 1), cc, value]);

// ① 값 방향: 64 이상 켜짐, 미만 꺼짐(옛 코드는 127 이 꺼짐이었다)
{
  const h = harness({ mappings: { drive: { channel: 1, cc: 64, value: 127 } } });
  h.router.handle(CC(127), 0);
  assert.deepEqual(h.log.active.at(-1), ['drive', true], 'CC 127 = 켜짐');
  h.router.handle(CC(0), 10);
  assert.deepEqual(h.log.active.at(-1), ['drive', false], 'CC 0 = 꺼짐');
  h.router.handle(CC(64), 20);
  assert.equal(h.state.pedals.drive, true, '경계 64 = 켜짐');
  h.router.handle(CC(63), 30);
  assert.equal(h.state.pedals.drive, false, '경계 63 = 꺼짐');
  const before = h.log.active.length;
  h.router.handle(CC(127, 2), 40);
  h.router.handle(CC(127, 1, 65), 41);
  assert.equal(h.log.active.length, before, '다른 채널·다른 CC 는 무시');
}

// ② latch(방식이 없거나 momentary): 값을 따라간다. Note On/Off 도 같다
{
  const h = harness({ mappings: { drive: { channel: 1, note: 60, value: 100, mode: 'momentary' } } });
  h.router.handle(msg([0x90, 60, 100]), 0);
  assert.equal(h.state.pedals.drive, true);
  h.router.handle(msg([0x80, 60, 64]), 5);
  assert.equal(h.state.pedals.drive, false, 'Note Off = 꺼짐');
  h.router.handle(msg([0x90, 60, 100]), 10);
  h.router.handle(msg([0x90, 60, 0]), 15);
  assert.equal(h.state.pedals.drive, false, 'Note On 세기 0 = 뗌 = 꺼짐');
}

// ③ toggle: 누를 때마다 전환, 뗌 무시, 누른 채 반복되는 값은 한 번만
{
  const h = harness({
    pedals: { drive: false, delay: false },
    mappings: { drive: { channel: 1, cc: 64, value: 127, mode: 'toggle' }, delay: { channel: 1, note: 60, value: 100, mode: 'toggle' } },
  });
  h.router.handle(CC(127), 0);
  assert.equal(h.state.pedals.drive, true, '첫 누름 = 켜짐');
  h.router.handle(CC(127), 1);
  h.router.handle(CC(100), 2);
  assert.equal(h.log.active.length, 1, '누른 채 반복되는 값은 다시 전환하지 않는다');
  h.router.handle(CC(0), 3);
  assert.equal(h.state.pedals.drive, true, '뗌은 무시');
  assert.equal(h.log.active.length, 1);
  h.router.handle(CC(127), 4);
  assert.equal(h.state.pedals.drive, false, '다음 누름 = 꺼짐');
  h.router.handle(msg([0x90, 60, 100]), 5);
  assert.equal(h.state.pedals.delay, true, '두 번째 매핑은 따로 센다');
  assert.equal(h.state.pedals.drive, false);
  h.router.handle(msg([0x80, 60, 0]), 6);
  h.router.handle(msg([0x90, 60, 100]), 7);
  assert.equal(h.state.pedals.delay, false);
  // 페달 상태가 밖에서 바뀌어도 '지금과 반대로'를 따른다
  h.state.pedals.drive = true;
  h.router.handle(CC(0), 8);
  h.router.handle(CC(127), 9);
  assert.equal(h.state.pedals.drive, false, '토글은 기억한 값이 아니라 지금 상태의 반대로 간다');
}

// ④ 학습: 누름 하나만 오면 방식을 적지 않고(= latch), 1초가 지나면 latch 로 알린다
{
  const h = harness({ learning: 'drive' });
  h.router.handle(CC(127, 2, 20), 1000);
  assert.deepEqual(h.state.mappings.drive, { channel: 2, cc: 20, value: 127 }, '방식 없는 매핑으로 저장');
  assert.equal(h.log.learned, 1);
  assert.equal(h.state.learning, null, '학습이 끝났다');
  assert.deepEqual(h.log.active, [], '학습 메시지는 페달을 움직이지 않는다');
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 1000, '1초를 잰다');
  assert.equal(h.log.notices.length, 0, '1초가 지나기 전에는 알리지 않는다');
  h.timers[0].callback();
  assert.equal(h.log.notices.length, 1);
  assert.equal(h.log.notices[0].mode, 'momentary', '뗌이 없으면 latch');
  assert.equal(h.log.notices[0].pedalId, 'drive');
  assert.equal('mode' in h.state.mappings.drive, false, 'latch 는 방식을 적지 않는다');
  h.router.handle(CC(127, 2, 20), 5000);
  assert.equal(h.state.pedals.drive, true, '1초 뒤에는 보통 latch 로 일한다');
  h.router.handle(CC(0, 2, 20), 5100);
  assert.equal(h.state.pedals.drive, false, '뗌 = 꺼짐(latch)');
  assert.equal(h.log.changed, 0, '방식은 바뀌지 않았다');
}

// ⑤ 학습: 1초 안에 누름→뗌이 이어지면 toggle 로 지정하고 그 뗌은 페달을 움직이지 않는다
{
  const h = harness({ learning: 'drive' });
  h.router.handle(CC(127), 2000);
  h.router.handle(CC(0), 2300);
  assert.equal(h.state.mappings.drive.mode, 'toggle', '1초 안의 누름→뗌 = toggle');
  assert.equal(h.log.changed, 1);
  assert.deepEqual(h.log.active, [], '학습의 누름·뗌은 페달을 움직이지 않는다');
  assert.equal(h.log.notices.length, 1);
  assert.equal(h.log.notices[0].mode, 'toggle');
  assert.equal(h.timers[0].cleared, true, '판정이 끝나면 1초 타이머를 치운다');
  h.router.handle(CC(127), 5000);
  assert.equal(h.state.pedals.drive, true, '이제 누를 때마다 전환: 켜짐');
  h.router.handle(CC(0), 5050);
  h.router.handle(CC(127), 6000);
  assert.equal(h.state.pedals.drive, false, '다음 누름: 꺼짐');
  assert.equal(h.log.notices.length, 1, '알림은 한 번');
}

// ⑥ 경계: 정확히 1000ms 는 toggle, 1001ms 는 latch(그 뗌은 보통 처리)
{
  const edge = harness({ learning: 'drive' });
  edge.router.handle(CC(127), 100);
  edge.router.handle(CC(0), 1100);
  assert.equal(edge.state.mappings.drive.mode, 'toggle', '정확히 1초 = toggle');

  const late = harness({ pedals: { drive: true, delay: false }, learning: 'drive' });
  late.router.handle(CC(127), 100);
  late.router.handle(CC(0), 1101);
  assert.equal('mode' in late.state.mappings.drive, false, '1초를 넘긴 뗌은 toggle 이 아니다');
  assert.deepEqual(late.log.active.at(-1), ['drive', false], '그 뗌은 latch 로 처리돼 페달을 끈다');
  assert.equal(late.log.notices.at(-1).mode, 'momentary', 'latch 로 알린다');
  assert.equal(late.timers[0].cleared, true);
}

// ⑦ 1초 안에 같은 누름 값이 또 와도 방식을 가르지 않는다(평소처럼 처리, 판정은 계속)
{
  const h = harness({ learning: 'drive' });
  h.router.handle(CC(127), 0);
  h.router.handle(CC(127), 200);
  assert.deepEqual(h.log.active.at(-1), ['drive', true], '같은 누름 값은 평소처럼 latch 로 처리');
  assert.equal('mode' in h.state.mappings.drive, false);
  assert.equal(h.timers[0].cleared, false, '판정은 계속된다');
  h.router.handle(CC(0), 400);
  assert.equal(h.state.mappings.drive.mode, 'toggle');
}

// ⑧ 뗌 값으로 시작한 학습·다른 컨트롤·사이에 바뀐 매핑·지워진 페달
{
  const first = harness({ learning: 'drive' });
  first.router.handle(CC(0), 0);
  assert.equal(first.timers.length, 0, '뗌으로 시작하면 방식을 가릴 것이 없다');
  assert.deepEqual(first.state.mappings.drive, { channel: 1, cc: 64, value: 0 });

  const other = harness({ learning: 'drive', mappings: { delay: { channel: 1, cc: 70, value: 127 } } });
  other.router.handle(CC(127), 0);
  other.router.handle(CC(0, 1, 70), 100);
  assert.equal('mode' in other.state.mappings.drive, false, '다른 컨트롤의 뗌은 판정에 쓰지 않는다');
  assert.deepEqual(other.log.active.at(-1), ['delay', false], '다른 컨트롤은 자기 매핑대로 일한다');
  assert.equal(other.timers[0].cleared, false);

  const removed = harness({ learning: 'drive' });
  removed.router.handle(CC(127), 0);
  delete removed.state.mappings.drive;
  removed.router.handle(CC(0), 100);
  assert.equal(removed.timers[0].cleared, true, '사이에 매핑을 지우면 판정을 버린다');
  assert.equal(removed.log.changed, 0);
  assert.equal(removed.log.notices.length, 0);

  const missing = harness({ learning: 'ghost' });
  missing.router.handle(CC(127), 0);
  assert.equal(missing.log.ended, 1, '없는 페달의 학습은 매핑 없이 끝난다');
  assert.deepEqual(missing.state.mappings, {});
}

// ⑨ forget·다시 학습·dispose 는 판정과 타이머를 정리한다
{
  const h = harness({ learning: 'drive' });
  h.router.handle(CC(127), 0);
  h.router.forget('drive');
  assert.equal(h.timers[0].cleared, true, '방식을 사용자가 바꾸면 판정을 버린다');
  h.router.handle(CC(0), 50);
  assert.equal(h.log.changed, 0, 'forget 뒤의 뗌은 toggle 로 읽히지 않는다');
  assert.deepEqual(h.log.active.at(-1), ['drive', false]);

  const again = harness({ learning: 'drive' });
  again.router.handle(CC(127), 0);
  again.state.learning = 'delay';
  again.router.handle(CC(127, 1, 70), 100);
  assert.equal(again.timers[0].cleared, true, '다시 학습하면 앞 판정을 버리고');
  assert.equal(again.timers[1].cleared, false, '새 판정을 연다');
  again.router.handle(CC(0, 1, 70), 200);
  assert.equal(again.state.mappings.delay.mode, 'toggle');
  assert.equal('mode' in again.state.mappings.drive, false, '앞 페달은 건드리지 않는다');

  const disposed = harness({ learning: 'drive' });
  disposed.router.handle(CC(127), 0);
  disposed.router.dispose();
  assert.equal(disposed.timers[0].cleared, true);
}

// ⑩ 누른 기억(toggle)도 forget 으로 비워진다 — 방식을 바꾼 직후 첫 누름이 먹히지 않으면 안 된다
{
  const h = harness({ mappings: { drive: { channel: 1, cc: 64, value: 127, mode: 'toggle' } } });
  h.router.handle(CC(127), 0);
  assert.equal(h.state.pedals.drive, true);
  h.router.forget('drive');
  h.router.handle(CC(127), 1);
  assert.equal(h.state.pedals.drive, false, 'forget 뒤 첫 누름은 반복값으로 무시되지 않고 전환한다');
}

// ⑪ 없는 페달을 가리키는 매핑은 아무것도 하지 않는다(프리셋·순서 변경으로 페달이 사라진 경우)
{
  const h = harness({ pedals: { drive: false }, mappings: { ghost: { channel: 1, cc: 64, value: 127 }, drive: { channel: 1, cc: 65, value: 127 } } });
  h.router.handle(CC(127), 0);
  assert.deepEqual(h.log.active, [], '없는 페달은 켜지도 꺼지지도 않는다');
  h.router.handle(CC(127, 1, 65), 1);
  assert.deepEqual(h.log.active, [['drive', true]]);
}

// ⑫ 판정 중에 그 페달의 매핑이 다른 컨트롤로 바뀌면(채널·CC·Note 어느 것이든) 그 뗌은 토글 지정에 쓰지 않는다
{
  const cases = [
    ['채널', { channel: 2, cc: 64, value: 127 }, CC(0, 2)],
    ['CC 번호', { channel: 1, cc: 66, value: 127 }, CC(0, 1, 66)],
    ['CC→Note', { channel: 1, note: 60, value: 100 }, msg([0x80, 60, 0])],
  ];
  for (const [label, replacement, release] of cases) {
    const h = harness({ learning: 'drive' });
    h.router.handle(CC(127), 0);
    h.state.mappings.drive = replacement;
    h.router.handle(release, 100);
    assert.equal(h.log.changed, 0, `${label}: 바뀐 매핑에 토글을 적지 않는다`);
    assert.equal('mode' in h.state.mappings.drive, false, label);
    assert.equal(h.timers[0].cleared, true, `${label}: 판정을 버린다`);
  }
  const notes = harness({ learning: 'drive' });
  notes.router.handle(msg([0x90, 60, 100]), 0);
  notes.state.mappings.drive = { channel: 1, note: 61, value: 100 };
  notes.router.handle(msg([0x80, 61, 0]), 100);
  assert.equal('mode' in notes.state.mappings.drive, false, 'Note 번호가 바뀐 매핑에도 적지 않는다');
  const noteToggle = harness({ learning: 'drive' });
  noteToggle.router.handle(msg([0x90, 60, 100]), 0);
  noteToggle.router.handle(msg([0x80, 60, 0]), 200);
  assert.equal(noteToggle.state.mappings.drive.mode, 'toggle', 'Note On → Note Off 도 토글로 지정한다');
  const noteOffZero = harness({ learning: 'drive' });
  noteOffZero.router.handle(msg([0x90, 60, 100]), 0);
  noteOffZero.router.handle(msg([0x90, 60, 0]), 200);
  assert.equal(noteOffZero.state.mappings.drive.mode, 'toggle', 'Note On 세기 0 도 뗌이다');
}

// ⑬ 토글: 누름이 기록되지 않은 채 뗌만 오면(장치를 막 꽂았거나 방식을 바꾼 직후) 전환하지 않는다
{
  const h = harness({ mappings: { drive: { channel: 1, cc: 64, value: 127, mode: 'toggle' } } });
  h.router.handle(CC(0), 0);
  assert.equal(h.log.active.length, 0, '뗌만 온 것은 전환이 아니다');
  h.router.handle(CC(127), 10);
  assert.equal(h.state.pedals.drive, true, '그 뒤 첫 누름은 전환한다');
}

// ⑭ 학습은 그 페달의 눌림 기억을 비운다: 뗌 없이 다시 학습한 뒤 첫 누름이 '이미 눌려 있음'으로 먹히지 않는다
{
  const h = harness({ mappings: { drive: { channel: 1, cc: 64, value: 127, mode: 'toggle' } } });
  h.router.handle(CC(127), 0);
  assert.equal(h.state.pedals.drive, true);
  h.state.learning = 'drive';
  h.router.handle(CC(127, 1, 70), 100);
  h.router.handle(CC(0, 1, 70), 200);
  assert.equal(h.state.mappings.drive.mode, 'toggle');
  h.router.handle(CC(127, 1, 70), 5000);
  assert.equal(h.state.pedals.drive, false, '새로 학습한 토글의 첫 누름이 전환한다');
}

// ⑮ 이미 끝난 판정의 타이머 콜백이 늦게 불려도 알림은 없다 / 판정 중 매핑이 다른 컨트롤로 바뀌었으면 래치 알림도 없다
{
  const h = harness({ learning: 'drive' });
  h.router.handle(CC(127), 0);
  h.router.handle(CC(0), 100);
  assert.equal(h.log.notices.length, 1, '토글 알림 한 번');
  h.timers[0].callback();
  assert.equal(h.log.notices.length, 1, '끝난 판정은 시간이 다 돼도 다시 알리지 않는다');
  assert.equal(h.state.mappings.drive.mode, 'toggle');

  const swapped = harness({ learning: 'drive' });
  swapped.router.handle(CC(127), 0);
  swapped.state.mappings.drive = { channel: 1, cc: 70, value: 127 };
  swapped.timers[0].callback();
  assert.equal(swapped.log.notices.length, 0, '다른 컨트롤이 된 매핑에 래치 알림을 하지 않는다');

  const kept = harness({ learning: 'drive' });
  kept.router.handle(CC(127), 0);
  kept.timers[0].callback();
  assert.equal(kept.log.notices.length, 1);
  assert.equal(kept.log.notices[0].mode, 'momentary', '1초 안에 뗌이 없으면 래치');
}

// ---------------------------------------------------------------------------------------------
// 2. 서비스
// ---------------------------------------------------------------------------------------------
function serviceHarness() {
  const states = [];
  const messages = [];
  const service = new MidiService({ onMessage: (event) => messages.push(event), onState: (state) => states.push(state) });
  return { service, states, messages };
}

// 지원하지 않는 브라우저
{
  const record = installNavigator({ supported: false });
  const { service } = serviceHarness();
  assert.equal(service.supported, false);
  assert.equal(await service.connectIfAllowed(), 'unsupported');
  assert.equal(record.requests, 0);
  await assert.rejects(() => service.connect(), /지원하지 않는/);
  assert.equal(record.requests, 0);
  service.dispose();
  assert.equal(service.getState().link, 'unsupported', 'dispose 뒤에도 지원하지 않는 브라우저는 그대로다');
}

// ① 권한이 이미 허용(granted): 사용자 동작 없이 연결하고 리스너를 붙인다
{
  const input = new MockInput('in-1', 'Foot Controller');
  const record = installNavigator({ permission: 'granted' });
  record.access = new MockAccess([input]);
  const { service, states, messages } = serviceHarness();
  assert.equal(await service.connectIfAllowed(), 'connected');
  assert.equal(record.requests, 1, '허용돼 있으면 요청한다(창은 뜨지 않는다)');
  assert.deepEqual(record.lastOptions, { sysex: false });
  assert.deepEqual(record.queries, [{ name: 'midi', sysex: false }], 'sysex 없는 midi 권한을 묻는다');
  assert.equal(service.getState().permission, 'granted');
  assert.equal(service.getState().devices.length, 1);
  assert.equal(service.getState().devices[0].name, 'Foot Controller');
  assert.ok(input.onmidimessage, '입력에 리스너가 붙었다');
  input.emit([0xb0, 64, 127]);
  assert.equal(messages.length, 1, '메시지가 바깥으로 전달된다');
  assert.ok(states.some((state) => state.link === 'connecting'), '연결 중 상태를 거친다');
  assert.equal(states.at(-1).link, 'connected');
  // 두 번째 호출은 새로 요청하지 않는다
  await service.connectIfAllowed();
  assert.equal(record.requests, 1);
  assert.equal(input.assignments, 1, '같은 입력에 리스너를 두 번 붙이지 않는다');
}

// ② 권한 prompt: 열 때는 요청하지 않고(창이 뜨지 않는다) '연결 필요'로 둔다. 사용자 동작(connect)에서만 요청한다
{
  const input = new MockInput('in-1', 'Foot Controller');
  const record = installNavigator({ permission: 'prompt' });
  record.access = new MockAccess([input]);
  const { service } = serviceHarness();
  assert.equal(await service.connectIfAllowed(), 'needs-permission');
  assert.equal(record.requests, 0, 'prompt 상태에서 페이지를 열 때 권한을 요청하면 안 된다');
  assert.equal(service.getState().permission, 'prompt');
  assert.equal(input.onmidimessage, null);
  await service.connect();
  assert.equal(record.requests, 1, '버튼을 누르면 요청한다');
  assert.equal(service.getState().link, 'connected');
  assert.ok(input.onmidimessage);
}

// ③ 권한 거부(denied)·알 수 없음(조회 미지원·조회 실패)
{
  const denied = installNavigator({ permission: 'denied' });
  const first = serviceHarness();
  assert.equal(await first.service.connectIfAllowed(), 'denied');
  assert.equal(denied.requests, 0);

  const noApi = installNavigator({ noPermissionsApi: true });
  const second = serviceHarness();
  assert.equal(await second.service.connectIfAllowed(), 'needs-permission', '권한 조회가 없으면 사용자 동작으로 미룬다');
  assert.equal(noApi.requests, 0);
  assert.equal(second.service.getState().permission, 'unknown');

  const throws = installNavigator({ queryThrows: true });
  const third = serviceHarness();
  assert.equal(await third.service.connectIfAllowed(), 'needs-permission', "'midi' 조회가 예외여도 미룬다");
  assert.equal(throws.requests, 0);
}

// ④ 사용자가 브라우저 설정에서 권한을 허용하면 기다리던 연결이 저절로 이어진다
{
  const input = new MockInput('in-1', 'Foot Controller');
  const record = installNavigator({ permission: 'prompt' });
  record.access = new MockAccess([input]);
  const { service } = serviceHarness();
  await service.connectIfAllowed();
  assert.equal(record.requests, 0);
  record.status.set('granted');
  await sleep(10);
  assert.equal(record.requests, 1, '허용으로 바뀌면 이어서 연결한다');
  assert.equal(service.getState().link, 'connected');
  assert.ok(input.onmidimessage);
  service.dispose();
  assert.equal(record.status.onchange, null, 'dispose 가 권한 감시를 뗀다');
}

// ⑤ 장치를 뺐다 다시 꽂으면 리스너가 저절로 다시 붙는다(같은 입력 객체가 되살아나는 경우와 새 장치)
{
  const input = new MockInput('in-1', 'Foot Controller');
  const record = installNavigator({ permission: 'granted' });
  record.access = new MockAccess([input]);
  const { service, messages } = serviceHarness();
  await service.connectIfAllowed();
  input.state = 'disconnected';
  record.access.fire();
  assert.equal(input.onmidimessage, null, '뽑힌 장치의 리스너는 뗀다');
  assert.equal(service.getState().devices.length, 0);
  assert.equal(service.getState().link, 'connected', '장치가 없어도 연결(MIDIAccess)은 살아 있다');
  assert.equal(describeMidiConnection(service.getState().link, 0), '장치 없음');
  input.state = 'connected';
  record.access.fire();
  assert.ok(input.onmidimessage, '다시 꽂으면 리스너가 다시 붙는다');
  assert.equal(service.getState().devices.length, 1);
  input.emit([0xb0, 64, 127]);
  assert.equal(messages.length, 1);
  record.access.fire();
  record.access.fire();
  assert.equal(input.assignments, 3, '붙임·뗌·붙임 — 재검색이 중복으로 붙이지 않는다');

  const second = new MockInput('in-2', 'Backup');
  record.access.inputs.set(second.id, second);
  record.access.fire();
  assert.ok(second.onmidimessage, '새 장치에도 붙는다');
  assert.deepEqual(service.getState().devices.map((device) => device.id), ['in-2', 'in-1'], '장치 목록은 이름순(Backup, Foot Controller)');
}

// ⑥ 연결 실패는 denied 로 알리고 예외를 던진다 / 동시 요청은 하나로 합친다
{
  const failing = installNavigator({
    permission: 'prompt',
    requestImpl: () => Promise.reject(new Error('SecurityError')),
  });
  const { service, states } = serviceHarness();
  await assert.rejects(() => service.connect(), /SecurityError/);
  assert.equal(failing.requests, 1);
  assert.equal(states.at(-1).link, 'denied');
  assert.deepEqual(states.at(-1).devices, []);

  let resolveAccess;
  const shared = installNavigator({
    permission: 'prompt',
    requestImpl: () => new Promise((resolve) => (resolveAccess = resolve)),
  });
  const input = new MockInput('in-1', 'Foot Controller');
  const both = serviceHarness();
  const one = both.service.connect();
  const two = both.service.connect();
  resolveAccess(new MockAccess([input]));
  await Promise.all([one, two]);
  assert.equal(shared.requests, 1, '연결 중에 또 눌러도 요청은 한 번');
  assert.equal(input.assignments, 1);
}

// ⑦ dispose: 모든 리스너를 떼고, 이미 끝난 세션에 늦게 도착한 MIDIAccess 는 붙이지 않는다
{
  const input = new MockInput('in-1', 'Foot Controller');
  const record = installNavigator({ permission: 'granted' });
  record.access = new MockAccess([input]);
  const { service, states } = serviceHarness();
  await service.connectIfAllowed();
  service.dispose();
  assert.equal(input.onmidimessage, null);
  assert.equal(record.access.onstatechange, null);
  assert.equal(service.getState().link, 'idle');
  assert.deepEqual(service.getState().devices, []);
  assert.equal(states.at(-1).link, 'idle');

  const lateInput = new MockInput('late', 'Late');
  const lateAccess = new MockAccess([lateInput]);
  let resolveLate;
  installNavigator({ permission: 'prompt', requestImpl: () => new Promise((resolve) => (resolveLate = resolve)) });
  const stale = serviceHarness();
  const pending = stale.service.connect();
  stale.service.dispose();
  const statesBefore = stale.states.length;
  resolveLate(lateAccess);
  await pending;
  assert.equal(lateAccess.onstatechange, null, 'dispose 뒤에 도착한 access 에 붙지 않는다');
  assert.equal(lateInput.onmidimessage, null);
  assert.equal(stale.states.length, statesBefore, '끝난 세션이 상태를 더 바꾸지 않는다');

  // 권한을 묻는 도중 dispose(React 가 마운트를 두 번 돌릴 때)
  const slow = installNavigator({ permission: 'granted' });
  slow.access = new MockAccess([new MockInput('x', 'X')]);
  const mounted = serviceHarness();
  const connecting = mounted.service.connectIfAllowed();
  mounted.service.dispose();
  await connecting;
  assert.equal(slow.requests, 0, '권한 조회 중에 끝난 세션은 요청하지 않는다');
}

// ⑦-2 권한이 허용이 아닌 값으로 바뀌어도 연결하지 않는다 / 값이 그대로 상태에 반영된다 / 바뀐 뒤의 옛 감시는 무시한다
{
  const record = installNavigator({ permission: 'prompt' });
  record.access = new MockAccess([new MockInput('in-1', 'Foot Controller')]);
  const { service } = serviceHarness();
  await service.connectIfAllowed();
  record.status.set('denied');
  await sleep(10);
  assert.equal(record.requests, 0, '막힘으로 바뀌어도 요청하지 않는다');
  assert.equal(service.getState().permission, 'denied');
  record.status.set('prompt');
  await sleep(10);
  assert.equal(record.requests, 0, '다시 묻기로 바뀌어도 요청하지 않는다');
  assert.equal(service.getState().permission, 'prompt');
  record.status.set('granted');
  await sleep(10);
  assert.equal(record.requests, 1);
  assert.equal(service.getState().permission, 'granted');
  service.dispose();
}
{
  const first = new MockPermission('prompt');
  const second = new MockPermission('prompt');
  const record = installNavigator({ permission: 'prompt' });
  record.status = first;
  record.access = new MockAccess([new MockInput('in-1', 'Foot Controller')]);
  const { service } = serviceHarness();
  await service.connectIfAllowed();
  const staleHandler = first.onchange;
  assert.equal(typeof staleHandler, 'function');
  record.status = second;
  await service.connectIfAllowed();
  assert.equal(first.onchange, null, '새 권한 감시로 바뀌면 옛 것은 뗀다');
  assert.equal(typeof second.onchange, 'function');
  first.state = 'granted';
  staleHandler({});
  await sleep(10);
  assert.equal(record.requests, 0, '바뀌기 전의 옛 권한 감시가 늦게 불려도 연결하지 않는다');
  assert.equal(service.getState().permission, 'prompt');
  service.dispose();
}

// ⑦-3 이미 연결돼 있을 때 다시 부르면 지금 꽂힌 장치를 다시 훑는다(statechange 를 놓쳤어도)
{
  const first = new MockInput('in-1', 'Foot Controller');
  const record = installNavigator({ permission: 'granted' });
  record.access = new MockAccess([first]);
  const { service } = serviceHarness();
  await service.connectIfAllowed();
  const second = new MockInput('in-2', 'Backup');
  record.access.inputs.set(second.id, second);
  await service.connectIfAllowed();
  assert.ok(second.onmidimessage, 'connectIfAllowed 가 놓친 장치에 붙는다');
  const third = new MockInput('in-3', 'Third');
  record.access.inputs.set(third.id, third);
  await service.connect();
  assert.ok(third.onmidimessage, 'connect 가 놓친 장치에 붙는다');
  assert.equal(record.requests, 1, '다시 훑을 뿐 새로 요청하지 않는다');

  // 같은 장치의 리스너를 누가 떼어 갔다면 다시 붙인다
  first.onmidimessage = null;
  record.access.fire();
  assert.ok(first.onmidimessage, '떨어진 리스너를 다시 붙인다');

  // 같은 id 의 새 입력 객체가 옛 객체를 대신하면(장치를 다시 꽂을 때 브라우저가 새로 만든 경우) 옛 객체에서는 리스너를 뗀다
  const replacement = new MockInput('in-1', 'Foot Controller');
  record.access.inputs.set(replacement.id, replacement);
  record.access.fire();
  assert.equal(first.onmidimessage, null, '대신 들어온 입력이 있으면 옛 입력의 리스너는 뗀다');
  assert.ok(replacement.onmidimessage, '새 입력에 붙는다');
  service.dispose();
}

// ⑦-4 dispose 뒤의 새 연결은 dispose 전의 대기 중인 요청을 이어받지 않고 새로 요청한다
{
  const resolvers = [];
  const record = installNavigator({
    permission: 'prompt',
    requestImpl: () => new Promise((resolve) => resolvers.push(resolve)),
  });
  const { service } = serviceHarness();
  const old = service.connect();
  service.dispose();
  const fresh = service.connect();
  assert.equal(record.requests, 2, '끝난 세션의 대기 요청을 재사용하지 않는다');
  const input = new MockInput('in-1', 'Foot Controller');
  resolvers[1](new MockAccess([input]));
  resolvers[0](new MockAccess([]));
  await Promise.all([old, fresh]);
  assert.ok(input.onmidimessage, '새 세션에 붙는다');
  service.dispose();
}

// ⑧ 카드 표시 문구
assert.equal(describeMidiConnection('connected', 1), '연결됨');
assert.equal(describeMidiConnection('connected', 2), '연결됨');
assert.equal(describeMidiConnection('connected', 0), '장치 없음');
assert.equal(describeMidiConnection('connecting', 0), '연결 중');
for (const link of ['idle', 'needs-permission', 'denied', 'unsupported']) {
  assert.equal(describeMidiConnection(link, 3), '연결 안 됨', `${link}: 장치가 보여도 연결 전이면 '연결됨'이라고 하지 않는다`);
}

// ---------------------------------------------------------------------------------------------
// 3. 저장소에 이어 붙었을 때
// ---------------------------------------------------------------------------------------------
const STORAGE_MIDI = 'guitar-pedalboard:midi';
storage.set(STORAGE_MIDI, JSON.stringify({ drive: { channel: 1, cc: 64, value: 127 } }));
const storeInput = new MockInput('store-in', 'Foot Controller');
const storeNav = installNavigator({ permission: 'prompt' });
storeNav.access = new MockAccess([storeInput]);

const storeRuntime = await import(
  await bundleToUrl(
    [
      "export { useAudioStore } from './store/audioStore.ts';",
      "export { usePedalStore } from './store/pedalStore.ts';",
      "export { useToastStore } from './store/toastStore.ts';",
      "export { AudioEngine } from './audio/AudioEngine.ts';",
    ].join('\n'),
    'midi-store-harness.ts',
  )
);
const { useAudioStore, usePedalStore, useToastStore, AudioEngine } = storeRuntime;
const engineCalls = [];
AudioEngine.getInstance().setPedalActive = (pedalId, active) => engineCalls.push([pedalId, active]);
const audio = () => useAudioStore.getState();
const pedalOn = (id) => usePedalStore.getState().pedals.find((pedal) => pedal.id === id).active;

assert.equal(audio().midiSupported, true);
assert.equal(audio().midiLink, 'idle');

// 저장된 매핑이 있고 권한이 prompt → 열 때는 요청하지 않고 '연결 필요'
await audio().connectSavedMidi();
assert.equal(storeNav.requests, 0, '열 때 권한 창을 띄우면 안 된다');
assert.equal(audio().midiLink, 'needs-permission');
assert.equal(audio().midiPermission, 'prompt');
assert.equal(audio().midiError, null);
// 사용자가 '다시 연결' 을 누른다
await audio().connectSavedMidi({ force: true, userAction: true });
assert.equal(storeNav.requests, 1);
assert.equal(audio().midiLink, 'connected');
assert.equal(audio().midiDevices.length, 1);
// 저장된 매핑이 학습 없이 바로 일한다(새로고침 뒤 풋스위치가 반응)
usePedalStore.getState().setActive('drive', false);
storeInput.emit([0xb0, 64, 127]);
assert.equal(pedalOn('drive'), true, '학습 없이도 풋스위치가 반응한다');
assert.deepEqual(engineCalls.at(-1), ['drive', true]);
storeInput.emit([0xb0, 64, 0]);
assert.equal(pedalOn('drive'), false);

// 새로고침 = 앱을 닫았다 다시 연다(dispose 뒤 connectSavedMidi), 이번에는 권한 허용
audio().disposeMidi();
assert.equal(audio().midiLink, 'idle');
assert.equal(storeInput.onmidimessage, null);
storeNav.status.state = 'granted';
await audio().connectSavedMidi();
assert.equal(storeNav.requests, 2, '허용돼 있으면 열 때 저절로 연결한다');
assert.equal(audio().midiLink, 'connected');
usePedalStore.getState().setActive('drive', false);
storeInput.emit([0xb0, 64, 127]);
assert.equal(pedalOn('drive'), true);

// 저장된 것이 없으면(매핑도 고급 설정도 없으면) 권한 조회도 하지 않는다
audio().disposeMidi();
storage.set(STORAGE_MIDI, '{}');
useAudioStore.setState({ midiMappings: {} });
const queriesBefore = storeNav.queries.length;
await audio().connectSavedMidi();
assert.equal(storeNav.queries.length, queriesBefore, '저장된 매핑이 없으면 조용히 아무것도 하지 않는다');
assert.equal(audio().midiLink, 'idle');

// 학습 → 누름·뗌이 1초 안에 이어지면 토글로 저장하고 알린다
useToastStore.getState().clear();
await audio().startMidiLearn('drive');
assert.equal(audio().midiLearningPedalId, 'drive');
storeInput.emit([0xb0, 81, 127]);
assert.equal(audio().midiLearningPedalId, null);
assert.deepEqual(audio().midiMappings.drive, { channel: 1, cc: 81, value: 127 });
storeInput.emit([0xb0, 81, 0], 300);
assert.equal(audio().midiMappings.drive.mode, 'toggle', '화면 상태가 토글로 바뀌었다');
assert.equal(JSON.parse(storage.get(STORAGE_MIDI)).drive.mode, 'toggle', '저장소에도 적혔다');
const toggleToast = useToastStore.getState().toasts.find((toast) => toast.key === 'midi-mode:drive');
assert.ok(toggleToast, '지정 결과를 알린다');
assert.ok(toggleToast.message.includes('토글'), toggleToast.message);
assert.ok(toggleToast.message.includes('방식'), '바꾸는 길도 알려 준다');
usePedalStore.getState().setActive('drive', false);
storeInput.emit([0xb0, 81, 127], 5000);
assert.equal(pedalOn('drive'), true, '토글: 누름 = 켜짐');
storeInput.emit([0xb0, 81, 0], 5010);
storeInput.emit([0xb0, 81, 127], 6000);
assert.equal(pedalOn('drive'), false, '토글: 다음 누름 = 꺼짐');

// 학습 → 뗌이 안 오면 1초 뒤 래치로 알린다(실제 시간으로 1초를 기다린다)
useToastStore.getState().clear();
await audio().startMidiLearn('delay');
storeInput.emit([0xb0, 82, 127]);
assert.equal('mode' in audio().midiMappings.delay, false);
assert.equal(useToastStore.getState().toasts.some((toast) => toast.key === 'midi-mode:delay'), false, '1초 전에는 알리지 않는다');
await sleep(MIDI_MODE_PROBE_MS + 150);
const latchToast = useToastStore.getState().toasts.find((toast) => toast.key === 'midi-mode:delay');
assert.ok(latchToast, '1초가 지나면 래치로 정했다고 알린다');
assert.ok(latchToast.message.includes('래치'), latchToast.message);
assert.ok(latchToast.message.includes('토글'), '토글로 바꾸는 길도 알려 준다');
assert.equal('mode' in audio().midiMappings.delay, false);

// 방식을 사용자가 바꾸면 눌림 기억이 비워진다
usePedalStore.getState().setActive('delay', false);
audio().setMidiMode('delay', 'toggle');
storeInput.emit([0xb0, 82, 127]);
assert.equal(pedalOn('delay'), true);
audio().setMidiMode('delay', 'momentary');
audio().setMidiMode('delay', 'toggle');
storeInput.emit([0xb0, 82, 127]);
assert.equal(pedalOn('delay'), false, '방식을 바꾼 뒤 첫 누름이 반복값으로 먹히지 않는다');

// 없는 페달의 학습은 시작하지 않고, 학습 중 페달이 사라지면 학습을 끝낸다
await audio().startMidiLearn('ghost');
assert.equal(audio().midiLearningPedalId, null, '없는 페달은 학습하지 않는다');
useAudioStore.setState({ midiLearningPedalId: 'ghost' });
storeInput.emit([0xb0, 99, 127]);
assert.equal(audio().midiLearningPedalId, null, '학습 중 페달이 사라지면 학습을 끝낸다');
assert.equal('ghost' in audio().midiMappings, false);

// 학습 결과 알림은 8초 동안 보인다
assert.equal(toggleToast.durationMs, 8000, '토글 알림은 8초');
assert.equal(latchToast.durationMs, 8000, '래치 알림은 8초');

// 학습이 끝나면 이전 오류 문구가 사라진다
useToastStore.getState().clear();
await audio().startMidiLearn('delay');
useAudioStore.setState({ midiError: '아직 남은 오류' });
storeInput.emit([0xb0, 83, 127]);
assert.equal(audio().midiError, null, '학습에 성공하면 이전 오류를 지운다');
assert.equal(audio().midiLearningPedalId, null);
// 방식을 가리는 도중에 앱을 닫으면(dispose) 1초 뒤에 알림이 뜨지 않는다
audio().disposeMidi();
await sleep(MIDI_MODE_PROBE_MS + 150);
assert.equal(useToastStore.getState().toasts.some((toast) => toast.key === 'midi-mode:delay'), false, 'dispose 뒤에는 방식 알림이 없다');

// 연결 도중 앱이 닫히면(dispose) 늦게 실패해도 학습 오류를 띄우지 않는다
{
  let rejectRequest;
  installNavigator({ permission: 'prompt', requestImpl: () => new Promise((_, reject) => (rejectRequest = reject)) });
  const learning = audio().startMidiLearn('drive');
  assert.equal(audio().midiLearningPedalId, 'drive');
  audio().disposeMidi();
  rejectRequest(new Error('late failure'));
  await learning;
  assert.equal(audio().midiError, null, '끝난 세션의 실패는 알리지 않는다');
  assert.equal(audio().midiLearningPedalId, null);
}

// 연결 실패는 오류 문구를 남기고 banner 가 읽는 상태는 denied
audio().disposeMidi();
useAudioStore.setState({ midiError: '이전 오류' });
const okNav = installNavigator({ permission: 'granted' });
okNav.access = new MockAccess([]);
useAudioStore.setState({ midiMappings: { drive: { channel: 1, cc: 64, value: 127 } } });
await audio().connectSavedMidi();
assert.equal(audio().midiError, null, '연결에 성공하면 이전 연결 오류를 지운다');
assert.equal(audio().midiLink, 'connected');
audio().disposeMidi();
storeNav.status.state = 'prompt';
const failNav = installNavigator({ permission: 'prompt', requestImpl: () => Promise.reject(new Error('blocked')) });
storage.set(STORAGE_MIDI, JSON.stringify({ drive: { channel: 1, cc: 64, value: 127 } }));
useAudioStore.setState({ midiMappings: { drive: { channel: 1, cc: 64, value: 127 } } });
await audio().connectSavedMidi({ force: true, userAction: true });
assert.equal(failNav.requests, 1);
assert.equal(audio().midiLink, 'denied');
assert.ok(audio().midiError.includes('연결하지 못했습니다'));
audio().disposeMidi();

// ---------------------------------------------------------------------------------------------
// 4. 소스 검사: 권한 창은 사용자 동작에서만
// ---------------------------------------------------------------------------------------------
const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const appShell = await read('../src/components/AppShell.tsx');
const advanced = await read('../src/components/MidiAdvancedControls.tsx');
const banner = await read('../src/components/MidiReconnectBanner.tsx');
const pedalFooter = await read('../src/components/PedalFooter.tsx'); // S4.3: 발스위치 줄은 PedalCard 에서 PedalFooter 로 옮겨졌다
const audioStoreSource = await read('../src/store/audioStore.ts');
assert.ok(appShell.includes('void useAudioStore.getState().connectSavedMidi();'), '앱을 열 때의 연결은 사용자 동작이 아니다');
assert.ok(appShell.includes('<MidiReconnectBanner />'));
assert.equal([...advanced.matchAll(/connectSavedMidi\(\{ force: true \}\)/g)].length, 1, '고급 설정을 열 때의 연결은 사용자 동작이 아니다');
assert.equal([...advanced.matchAll(/connectSavedMidi\(\{ force: true, userAction: true \}\)/g)].length, 2, '저장 버튼·MIDI 연결 버튼만 사용자 동작');
assert.ok(banner.includes('connectSavedMidi({ force: true, userAction: true })'));
assert.ok(banner.includes('MIDI 풋스위치 다시 연결'));
assert.ok(pedalFooter.includes('describeMidiConnection(midiLink, midiDeviceCount)'));
assert.ok(audioStoreSource.includes('await midiService.connect();'), '학습은 사용자 동작이다');
assert.ok(audioStoreSource.includes('else await midiService.connectIfAllowed();'));

console.log(
  'MIDI reconnect regression passed: value direction, latch/toggle, learn-time toggle detection (1 s edge), permission-aware connect (no prompt on load), device replug, banner/status contract.',
);
