// 오디오 세션 정리 절차 시험(S1.2, 설계서 4.2절, 보고서 R1-3).
//
// 연결 해제·Panic·Esc·하울링 차단·입력 장치 분리·시작 실패가 모두 AudioSession.stop(reason) 하나를 지나는지,
// 그 안의 순서가 ①~⑧ 인지, 한 단계가 실패해도 나머지가 끝까지 도는지, 시작과 정지가 겹쳐도 새 세션이
// 옛 정지에 꺼지지 않는지를 호출 기록만으로 확인한다. 브라우저·Web Audio 는 쓰지 않는다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { setImmediate, setTimeout } from 'node:timers';
import { build } from 'esbuild';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { AudioSession, TEARDOWN_STEPS, DEFAULT_FINALIZE_TIMEOUT_MS } = await load('src/audio/engine/AudioSession.ts');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** 호출 기록을 남기는 가짜 포트. overrides 로 단계마다 동작을 바꾼다. */
function createPorts(overrides = {}) {
  const log = [];
  const notices = [];
  const ports = {
    start: async (source) => {
      log.push(`start:${source.kind}`);
    },
    invalidatePendingStart: () => {
      log.push('invalidate-pending-start');
    },
    silenceOutput: async () => {
      log.push('silence-output');
    },
    stopInput: () => {
      log.push('stop-input');
    },
    finalizeRecording: async () => {
      log.push('finalize-recording');
      return false;
    },
    pausePlayback: () => {
      log.push('pause-playback');
    },
    releaseGraph: () => {
      log.push('release-graph');
    },
    closeContext: async () => {
      log.push('close-context');
    },
    advanceGeneration: () => {
      log.push('advance-generation');
    },
    notify: (result, detail) => {
      log.push('notify');
      notices.push({ result, detail });
    },
    ...overrides,
  };
  return { ports, log, notices };
}

const FULL_ORDER = [
  'invalidate-pending-start',
  'silence-output',
  'stop-input',
  'finalize-recording',
  'pause-playback',
  'release-graph',
  'close-context',
  'advance-generation',
  'notify',
];

// 0. 단계 이름 목록이 설계서 순서(변경 사항 L-16: ②·③ 맞바꿈)와 같다.
assert.deepEqual(
  [...TEARDOWN_STEPS],
  [
    'silence-output',
    'stop-input',
    'finalize-recording',
    'pause-playback',
    'release-graph',
    'close-context',
    'advance-generation',
    'notify',
  ],
);
assert.equal(DEFAULT_FINALIZE_TIMEOUT_MS, 2000, '녹음 마감 대기는 설계서대로 최대 2초');

// 1. 모든 정지 이유가 같은 순서의 정리 절차를 지난다.
for (const reason of ['user-disconnect', 'panic', 'howl', 'device-lost', 'error']) {
  const { ports, log, notices } = createPorts();
  const session = new AudioSession(ports);
  await session.start({ kind: 'device' });
  log.length = 0;
  const result = await session.stop(reason, reason === 'howl' ? { howlFrequencyHz: 987 } : {});
  assert.deepEqual(log, FULL_ORDER, `${reason}: 정리 순서가 설계서와 다릅니다`);
  assert.equal(result.reason, reason);
  assert.deepEqual(result.failedSteps, []);
  assert.equal(result.recordingSaved, false);
  assert.equal(session.state, 'idle');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].result.reason, reason);
  assert.equal(notices[0].detail.howlFrequencyHz, reason === 'howl' ? 987 : undefined);
}

// 2. 아무것도 열려 있지 않을 때의 정지: 정리는 돌지만(멱등) 안내는 띄우지 않는다.
{
  const { ports, log, notices } = createPorts();
  const session = new AudioSession(ports);
  const result = await session.stop('panic');
  assert.deepEqual(log, FULL_ORDER.filter((step) => step !== 'notify'));
  assert.equal(notices.length, 0);
  assert.equal(result.reason, 'panic');
  assert.equal(session.state, 'idle');
}

// 3. 한 단계가 던져도 나머지 단계는 끝까지 돈다. 실패한 단계는 결과에 남고 상태는 error 다.
for (const failing of TEARDOWN_STEPS.filter((step) => step !== 'notify')) {
  const portName = {
    'silence-output': 'silenceOutput',
    'stop-input': 'stopInput',
    'finalize-recording': 'finalizeRecording',
    'pause-playback': 'pausePlayback',
    'release-graph': 'releaseGraph',
    'close-context': 'closeContext',
    'advance-generation': 'advanceGeneration',
  }[failing];
  const { ports, log, notices } = createPorts({
    [portName]: () => {
      log.push(`${failing}(throws)`);
      throw new Error('boom');
    },
  });
  const session = new AudioSession(ports);
  await session.start({ kind: 'device' });
  log.length = 0;
  const result = await session.stop('panic');
  const expected = FULL_ORDER.map((step) => (step === failing ? `${failing}(throws)` : step));
  assert.deepEqual(log, expected, `${failing} 이 실패해도 나머지 단계가 돌아야 합니다`);
  assert.deepEqual(result.failedSteps, [failing]);
  assert.equal(session.state, 'error');
  assert.equal(notices.length, 1, '실패해도 안내는 띄운다');
  assert.deepEqual(notices[0].result.failedSteps, [failing]);
  // error 상태에서도 다시 시작할 수 있다.
  const outcome = await session.start({ kind: 'device' });
  assert.equal(outcome, 'running');
  assert.equal(session.state, 'running');
}

// 3b. 시작 요청 무효화(사전 처리)가 던져도 정리 절차는 계속된다.
{
  const { ports, log } = createPorts({
    invalidatePendingStart: () => {
      log.push('invalidate-pending-start(throws)');
      throw new Error('boom');
    },
  });
  const session = new AudioSession(ports);
  await session.start({ kind: 'device' });
  log.length = 0;
  const result = await session.stop('panic');
  assert.deepEqual(log, FULL_ORDER.map((step) => (step === 'invalidate-pending-start' ? 'invalidate-pending-start(throws)' : step)));
  assert.deepEqual(result.failedSteps, []);
  assert.equal(session.state, 'idle');
}

// 3c. 안내(notify)가 던져도 정지는 끝난다. 세션은 idle 이고 결과에만 남는다.
{
  const { ports } = createPorts({
    notify: () => {
      throw new Error('toast failed');
    },
  });
  const session = new AudioSession(ports);
  await session.start({ kind: 'device' });
  const result = await session.stop('howl');
  assert.deepEqual(result.failedSteps, ['notify']);
  assert.equal(session.state, 'idle');
}

// 4. 녹음 마감: 파일이 만들어지면 recordingSaved, 2초(여기서는 40 ms)를 넘기면 포기하고 다음 단계로 간다.
{
  const { ports, notices } = createPorts({ finalizeRecording: async () => true });
  const session = new AudioSession(ports);
  await session.start({ kind: 'device' });
  const result = await session.stop('panic');
  assert.equal(result.recordingSaved, true);
  assert.equal(notices[0].result.recordingSaved, true);
}
{
  const never = new Promise(() => {});
  const { ports, log } = createPorts({
    finalizeRecording: () => {
      log.push('finalize-recording(hangs)');
      return never;
    },
  });
  const session = new AudioSession(ports, { finalizeTimeoutMs: 40 });
  await session.start({ kind: 'device' });
  log.length = 0;
  const startedAt = Date.now();
  const result = await session.stop('panic');
  const elapsed = Date.now() - startedAt;
  assert.ok(elapsed >= 35 && elapsed < 1000, `마감 대기 제한이 지켜져야 합니다 (${elapsed} ms)`);
  assert.equal(result.recordingSaved, false);
  assert.deepEqual(result.failedSteps, [], '시간 초과는 오류가 아니라 저장 못 함이다');
  assert.deepEqual(
    log.filter((step) => step !== 'finalize-recording(hangs)'),
    FULL_ORDER.filter((step) => step !== 'finalize-recording'),
    '녹음 마감이 멈춰도 나머지 단계는 이어져야 합니다',
  );
}

// 5. 마이크 표시등은 녹음 마감을 기다리지 않고 꺼진다(②가 ③보다 먼저, 수용 기준 500 ms).
{
  const gate = deferred();
  const { ports, log } = createPorts({
    finalizeRecording: async () => {
      log.push('finalize-recording(begin)');
      await gate.promise;
      log.push('finalize-recording(end)');
      return true;
    },
  });
  const session = new AudioSession(ports);
  await session.start({ kind: 'device' });
  log.length = 0;
  const stopping = session.stop('panic');
  await tick();
  assert.ok(log.includes('stop-input'), '녹음 마감을 기다리는 동안에도 입력 트랙은 이미 멈춰 있어야 합니다');
  assert.ok(log.indexOf('stop-input') < log.indexOf('finalize-recording(begin)'));
  assert.ok(!log.includes('close-context'), '마감이 끝나기 전에는 컨텍스트를 닫지 않는다');
  gate.resolve();
  const result = await stopping;
  assert.equal(result.recordingSaved, true);
  assert.ok(log.indexOf('finalize-recording(end)') < log.indexOf('close-context'));
}

// 6. 동시에 불린 정지는 하나로 합쳐진다. 정리 단계는 한 번만 돈다.
{
  const gate = deferred();
  const { ports, log, notices } = createPorts({
    closeContext: async () => {
      log.push('close-context');
      await gate.promise;
    },
  });
  const session = new AudioSession(ports);
  await session.start({ kind: 'device' });
  log.length = 0;
  const first = session.stop('panic');
  const second = session.stop('howl');
  const third = session.stop('user-disconnect');
  assert.equal(session.state, 'stopping');
  gate.resolve();
  const results = await Promise.all([first, second, third]);
  assert.equal(results[0], results[1]);
  assert.equal(results[0], results[2]);
  assert.equal(results[0].reason, 'panic', '먼저 불린 이유로 안내한다');
  assert.equal(log.filter((step) => step === 'close-context').length, 1);
  assert.equal(notices.length, 1);
}

// 7. 시작 성공/실패.
{
  const { ports, log, notices } = createPorts();
  const session = new AudioSession(ports);
  const seen = [];
  session.subscribe((state) => seen.push(state));
  assert.equal(await session.start({ kind: 'file', file: { name: 'a.wav' } }), 'running');
  assert.equal(session.state, 'running');
  assert.deepEqual(log, ['start:file']);
  await session.stop('user-disconnect');
  assert.deepEqual(seen, ['starting', 'running', 'stopping', 'idle']);
  assert.equal(notices.length, 1);
}
{
  // 실패한 시작도 같은 정리 절차를 지난 뒤 오류를 그대로 던진다.
  const failure = new Error('mic denied');
  const { ports, log, notices } = createPorts({
    start: async () => {
      log.push('start:device(fails)');
      throw failure;
    },
  });
  const session = new AudioSession(ports);
  await assert.rejects(() => session.start({ kind: 'device' }), (error) => error === failure);
  assert.deepEqual(log, ['start:device(fails)', ...FULL_ORDER]);
  assert.equal(session.state, 'idle');
  assert.equal(notices.length, 1);
  assert.equal(notices[0].result.reason, 'error');
}

// 8. 시작하는 도중에 정지가 불리면 시작은 오류 없이 'cancelled' 로 끝난다.
{
  const pending = deferred();
  const { ports, log } = createPorts({
    start: () => {
      log.push('start:device');
      return pending.promise;
    },
  });
  const session = new AudioSession(ports);
  const starting = session.start({ kind: 'device' });
  await tick();
  assert.equal(session.state, 'starting');
  const result = await session.stop('panic');
  assert.equal(result.reason, 'panic');
  assert.equal(session.state, 'idle');
  pending.resolve();
  assert.equal(await starting, 'cancelled');
  assert.equal(session.state, 'idle', '취소된 시작이 늦게 끝나도 상태를 running 으로 바꾸지 못한다');
}
{
  // 취소된 시작이 오류로 끝나도 그것은 오류가 아니다(예: getUserMedia 가 늦게 AbortError).
  const pending = deferred();
  const { ports, log } = createPorts({
    start: () => {
      log.push('start:device');
      return pending.promise;
    },
  });
  const session = new AudioSession(ports);
  const starting = session.start({ kind: 'device' });
  await tick();
  await session.stop('user-disconnect');
  log.length = 0;
  pending.reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
  assert.equal(await starting, 'cancelled');
  assert.deepEqual(log, [], '취소된 시작이 던진 오류는 다시 정리 절차를 부르지 않는다');
  assert.equal(session.state, 'idle');
}

// 9. 나중에 부른 시작이 이긴다. 앞선 시작은 성공해도 실패해도 'cancelled' 이고 새 세션을 건드리지 않는다.
{
  const first = deferred();
  const second = deferred();
  let calls = 0;
  const { ports, log } = createPorts({
    start: (source) => {
      calls += 1;
      log.push(`start:${source.deviceId}`);
      return calls === 1 ? first.promise : second.promise;
    },
  });
  const session = new AudioSession(ports);
  const a = session.start({ kind: 'device', deviceId: 'A' });
  await tick();
  const b = session.start({ kind: 'device', deviceId: 'B' });
  await tick();
  first.reject(new Error('A failed'));
  assert.equal(await a, 'cancelled');
  assert.ok(!log.includes('close-context'), '앞선 시작의 실패가 새 세션을 정리하면 안 된다');
  second.resolve();
  assert.equal(await b, 'running');
  assert.equal(session.state, 'running');
  assert.deepEqual(log, ['start:A', 'start:B']);
}

// 10. 정지가 진행 중일 때 부른 시작은 정지가 끝난 뒤에 시작한다 — Panic 직후 재연결 경쟁.
//     (이전 구현은 Panic 이 늦게 부른 dispose 가 새로 연 세션을 꺼 버렸다.)
{
  const gate = deferred();
  const { ports, log } = createPorts({
    finalizeRecording: async () => {
      log.push('finalize-recording');
      await gate.promise;
      return true;
    },
  });
  const session = new AudioSession(ports);
  await session.start({ kind: 'device' });
  log.length = 0;
  const stopping = session.stop('panic');
  const restarting = session.start({ kind: 'device' });
  await tick();
  assert.ok(!log.includes('start:device'), '정지가 끝나기 전에는 새 시작이 입력을 열면 안 된다');
  gate.resolve();
  await stopping;
  assert.equal(await restarting, 'running');
  assert.deepEqual(log, [...FULL_ORDER, 'start:device']);
  assert.equal(log.lastIndexOf('close-context') < log.indexOf('start:device'), true);
  assert.equal(session.state, 'running');
}

// 11. 정지 중에 시작을 대기시킨 뒤 또 정지를 부르면(이미 정지 중이라 합쳐져도) 대기 중인 시작은 취소된다.
{
  const gate = deferred();
  const { ports, log } = createPorts({
    closeContext: async () => {
      log.push('close-context');
      await gate.promise;
    },
  });
  const session = new AudioSession(ports);
  await session.start({ kind: 'device' });
  log.length = 0;
  const first = session.stop('user-disconnect');
  const waitingStart = session.start({ kind: 'device' });
  session.stop('panic'); // 사용자가 Panic 을 눌렀다 → 대기 중인 시작을 되살리지 않는다
  gate.resolve();
  await first;
  assert.equal(await waitingStart, 'cancelled');
  assert.ok(!log.includes('start:device'));
  assert.equal(session.state, 'idle');
}

// 12. 실행 중에 시작을 부르면 입력을 바꾸는 재시작이다. 정리 절차는 돌지 않는다(컨텍스트 교체는 ports.start 가 한다).
{
  const { ports, log } = createPorts();
  const session = new AudioSession(ports);
  await session.start({ kind: 'device', deviceId: 'A' });
  log.length = 0;
  assert.equal(await session.start({ kind: 'device', deviceId: 'B' }), 'running');
  assert.deepEqual(log, ['start:device']);
  assert.equal(session.state, 'running');
}

// 13. 구독을 끊으면 더는 알리지 않는다.
{
  const { ports } = createPorts();
  const session = new AudioSession(ports);
  const seen = [];
  const unsubscribe = session.subscribe((state) => seen.push(state));
  await session.start({ kind: 'device' });
  unsubscribe();
  await session.stop('panic');
  assert.deepEqual(seen, ['starting', 'running']);
}

// 14. 정지 → 다시 연결을 10번 반복해도 열려 있는 컨텍스트는 동시에 1개를 넘지 않는다.
{
  let open = 0;
  let maxOpen = 0;
  const { ports } = createPorts({
    start: async () => {
      open += 1; // 새 컨텍스트 생성
      maxOpen = Math.max(maxOpen, open);
    },
    closeContext: async () => {
      await sleep(1);
      open = 0;
    },
  });
  const session = new AudioSession(ports);
  for (let cycle = 0; cycle < 10; cycle += 1) {
    await session.start({ kind: 'device' });
    assert.equal(open, 1);
    await session.stop(cycle % 2 === 0 ? 'user-disconnect' : 'panic');
    assert.equal(open, 0);
  }
  // 정지를 기다리지 않고 바로 다시 눌러도 겹치지 않는다.
  for (let cycle = 0; cycle < 10; cycle += 1) {
    void session.stop('panic');
    await session.start({ kind: 'device' });
  }
  assert.equal(maxOpen, 1, 'AudioContext 는 한 번에 하나만 열려 있어야 합니다');
  await session.stop('user-disconnect');
}

console.log(
  'AudioSession regression passed: single 8-step teardown for every reason, failure isolation, finalize timeout, join of concurrent stops, start/stop races, Panic→reconnect ordering and one-context-at-a-time.',
);
