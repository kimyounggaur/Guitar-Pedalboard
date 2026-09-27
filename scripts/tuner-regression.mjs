import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { URL } from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';

const SAMPLE_RATES = [44_100, 48_000, 96_000, 192_000];
const QUANTUM_SIZE = 128;
const TEST_DURATION_SECONDS = 0.9;
const NOTE_FREQUENCIES = {
  D2: 73.41619197935188,
  E2: 82.4068892282175,
  A2: 110,
  E4: 329.6275569128699,
};

const workletModule = await readFile(
  new URL('../src/audio/worklets/tuner-processor.ts', import.meta.url),
  'utf8',
);
const workletMatch = workletModule.match(
  /export const tunerProcessorSource = `([\s\S]*)`;\s*$/,
);
assert.ok(workletMatch, '튜너 워클렛 소스를 찾을 수 없습니다.');
const workletSource = workletMatch[1];

const tuningsModule = await readFile(
  new URL('../src/audio/utils/tunings.ts', import.meta.url),
  'utf8',
);
const transpiledTunings = ts.transpileModule(tuningsModule, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
const tuningsUrl = `data:text/javascript;base64,${Buffer.from(transpiledTunings).toString('base64')}`;
const { getPitchReading } = await import(tuningsUrl);

function centsBetween(actual, expected) {
  return 1200 * Math.log2(actual / expected);
}

function createProcessor(sampleRate) {
  let Processor = null;
  let renderFrame = 0;

  class MockPort {
    constructor() {
      this.onmessage = null;
      this.messages = [];
    }

    postMessage(message) {
      this.messages.push({ frame: renderFrame, message });
    }
  }

  class MockAudioWorkletProcessor {
    constructor() {
      this.port = new MockPort();
    }
  }

  const sandbox = {
    AudioWorkletProcessor: MockAudioWorkletProcessor,
    sampleRate,
    registerProcessor(name, constructor) {
      assert.equal(name, 'tuner-processor');
      Processor = constructor;
    },
  };
  vm.runInNewContext(workletSource, sandbox, { filename: 'tuner-processor.js' });
  assert.ok(Processor, '튜너 프로세서가 등록되지 않았습니다.');

  const processor = new Processor();
  return {
    processor,
    setRenderFrame(frame) {
      renderFrame = frame;
    },
  };
}

function feedSignal(
  runtime,
  sampleRate,
  durationSeconds,
  sampleForChannel,
) {
  const frameLimit = Math.ceil((sampleRate * durationSeconds) / QUANTUM_SIZE) * QUANTUM_SIZE;
  const processDurations = [];

  for (let startFrame = 0; startFrame < frameLimit; startFrame += QUANTUM_SIZE) {
    const channelCount = sampleForChannel.channelCount ?? 1;
    const channels = Array.from(
      { length: channelCount },
      () => new Float32Array(QUANTUM_SIZE),
    );

    for (let offset = 0; offset < QUANTUM_SIZE; offset += 1) {
      const frame = startFrame + offset;
      for (let channel = 0; channel < channelCount; channel += 1) {
        channels[channel][offset] = sampleForChannel(frame / sampleRate, channel);
      }
    }

    runtime.setRenderFrame(startFrame + QUANTUM_SIZE);
    const startedAt = performance.now();
    const alive = runtime.processor.process([channels]);
    processDurations.push(performance.now() - startedAt);
    assert.equal(alive, true, 'dispose 전 프로세서는 실행 상태여야 합니다.');
  }

  return processDurations;
}

function sine(frequency, amplitude = 0.65, phase = 0) {
  return (time) => amplitude * Math.sin(2 * Math.PI * frequency * time + phase);
}

function harmonicSignal(fundamental) {
  return (time) =>
    0.32 * Math.sin(2 * Math.PI * fundamental * time) +
    0.78 * Math.sin(2 * Math.PI * fundamental * 2 * time + 0.31);
}

function pitchMessages(runtime, sessionId) {
  return runtime.processor.port.messages.filter(
    ({ message }) => message.type === 'pitch' && message.sessionId === sessionId,
  );
}

function assertPitch(result, expected, label) {
  const detected = result
    .map(({ message }) => message.frequency)
    .filter((frequency) => frequency !== null);
  assert.ok(detected.length > 0, `${label}: 유효 피치를 감지하지 못했습니다.`);
  const actual = detected.at(-1);
  const error = Math.abs(centsBetween(actual, expected));
  assert.ok(error <= 2, `${label}: ${error.toFixed(3)} cents 오차`);
}

function assertCadence(messages, sampleRate, label) {
  for (let index = 1; index < messages.length; index += 1) {
    const interval = (messages[index].frame - messages[index - 1].frame) / sampleRate;
    assert.ok(interval >= 0.095, `${label}: ${(interval * 1000).toFixed(2)}ms 게시 간격`);
  }
}

function runPitchCase(sampleRate, frequency, signal, label) {
  const runtime = createProcessor(sampleRate);
  runtime.processor.port.onmessage({ data: { type: 'wake', sessionId: 1 } });
  const durations = feedSignal(runtime, sampleRate, TEST_DURATION_SECONDS, signal);
  const messages = pitchMessages(runtime, 1);
  assertPitch(messages, frequency, `${sampleRate}Hz ${label}`);
  assertCadence(messages, sampleRate, `${sampleRate}Hz ${label}`);

  const elapsedBudget = durations.reduce((sum, duration) => sum + duration, 0);
  assert.ok(
    elapsedBudget < TEST_DURATION_SECONDS * 1000,
    `${sampleRate}Hz ${label}: 합산 처리 시간이 실시간 예산을 초과했습니다.`,
  );

  const processor = runtime.processor;
  const scheduledSeconds =
    Math.ceil(processor.analysisLimit / processor.lagsPerQuantum) *
    (QUANTUM_SIZE / sampleRate);
  assert.ok(
    scheduledSeconds <= 0.08,
    `${sampleRate}Hz ${label}: 분석 분할이 ${(scheduledSeconds * 1000).toFixed(2)}ms`,
  );
  return { runtime, durations };
}

function assertTuningTargets() {
  const e2 = NOTE_FREQUENCIES.E2;
  const e3 = e2 * 2;
  const e5 = e2 * 8;

  assert.equal(getPitchReading(e2, 'standard').note, 'E2');
  assert.equal(getPitchReading(e3, 'standard').note, 'E2');
  assert.equal(getPitchReading(e5, 'standard').note, 'E4');
  assert.equal(getPitchReading(NOTE_FREQUENCIES.D2, 'drop-d').note, 'D2');

  for (const cents of [-3, 3]) {
    const frequency = e2 * 2 ** (cents / 1200);
    const reading = getPitchReading(frequency, 'standard');
    assert.equal(reading.note, 'E2');
    assert.ok(Math.abs(reading.cents - cents) < 1e-8);
  }
}

assertTuningTargets();

for (const sampleRate of SAMPLE_RATES) {
  for (const [note, frequency] of Object.entries(NOTE_FREQUENCIES)) {
    runPitchCase(sampleRate, frequency, sine(frequency), note);
  }

  for (const cents of [-3, 3]) {
    const frequency = NOTE_FREQUENCIES.E2 * 2 ** (cents / 1200);
    runPitchCase(sampleRate, frequency, sine(frequency), `E2 ${cents > 0 ? '+' : ''}${cents}c`);
  }

  runPitchCase(
    sampleRate,
    NOTE_FREQUENCIES.E2,
    harmonicSignal(NOTE_FREQUENCIES.E2),
    '강한 2차 배음',
  );

  const stereo = sine(NOTE_FREQUENCIES.A2);
  stereo.channelCount = 2;
  const stereoSignal = (time, channel) => (channel === 0 ? stereo(time) : -stereo(time));
  stereoSignal.channelCount = 2;
  runPitchCase(sampleRate, NOTE_FREQUENCIES.A2, stereoSignal, '역상 스테레오');

  const silentRuntime = createProcessor(sampleRate);
  silentRuntime.processor.port.onmessage({ data: { type: 'wake', sessionId: 20 } });
  feedSignal(silentRuntime, sampleRate, 0.55, () => 0);
  const silenceMessages = pitchMessages(silentRuntime, 20);
  assert.ok(silenceMessages.length > 0, `${sampleRate}Hz silence: 상태 게시 없음`);
  assert.ok(
    silenceMessages.every(({ message }) => message.frequency === null),
    `${sampleRate}Hz silence: 잘못된 피치 감지`,
  );
  assertCadence(silenceMessages, sampleRate, `${sampleRate}Hz silence`);
}

const lifecycleRate = 48_000;
const lifecycle = createProcessor(lifecycleRate);
lifecycle.processor.port.onmessage({ data: { type: 'wake', sessionId: 30 } });
feedSignal(lifecycle, lifecycleRate, 0.7, sine(NOTE_FREQUENCIES.E2));
assert.ok(pitchMessages(lifecycle, 30).length > 0, 'wake 세션 결과가 없습니다.');

const beforeSleep = lifecycle.processor.port.messages.length;
lifecycle.processor.port.onmessage({ data: { type: 'sleep', sessionId: 31 } });
const sleepMessage = lifecycle.processor.port.messages.at(-1).message;
assert.equal(sleepMessage.type, 'pitch');
assert.equal(sleepMessage.sessionId, 31);
assert.equal(sleepMessage.frequency, null);
feedSignal(lifecycle, lifecycleRate, 0.25, sine(NOTE_FREQUENCIES.E2));
assert.equal(
  lifecycle.processor.port.messages.length,
  beforeSleep + 1,
  'sleep 중 분석 메시지가 게시되었습니다.',
);

lifecycle.processor.port.onmessage({ data: { type: 'wake', sessionId: 32 } });
feedSignal(lifecycle, lifecycleRate, 0.7, sine(NOTE_FREQUENCIES.A2));
const wakeMessages = lifecycle.processor.port.messages.slice(beforeSleep + 1);
assert.ok(wakeMessages.some(({ message }) => message.type === 'pitch'));
assert.ok(
  wakeMessages.every(({ message }) => message.sessionId === 32),
  '새 wake 이후 stale 세션 메시지가 게시되었습니다.',
);

lifecycle.processor.port.onmessage({ data: { type: 'dispose', sessionId: 33 } });
const disposedMessage = lifecycle.processor.port.messages.at(-1).message;
assert.equal(disposedMessage.type, 'disposed');
assert.equal(disposedMessage.sessionId, 33);
lifecycle.setRenderFrame(1);
assert.equal(
  lifecycle.processor.process([[new Float32Array(QUANTUM_SIZE)]]),
  false,
  'dispose 이후 프로세서가 종료되지 않았습니다.',
);

console.log(
  `Tuner regression passed: ${SAMPLE_RATES.join('/')} Hz, pitch/cents/harmonics/silence/stereo/session/dispose.`,
);
