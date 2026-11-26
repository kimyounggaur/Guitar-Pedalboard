// S1.3 입력 채널 처리(InputStage) 시험.
//   1) 자동 판정 규칙(ChannelDecider): 300 ms·15 dB·−50 dBFS 경계, 한 번만 판정, 늦은 폴링에도 안전
//   2) InputStage 그래프: 연결 모양, 모드별 게인, 20 ms·8 ms 램프, 판정 적용, 통과 모드, 정리
//   3) S1.5: 채널 레벨은 InputStage 가 재지 않는다(분석 노드 없음). MonitorService 가 넘긴 오디오 시계로 판정하고, 표시할 채널을 알려 준다.
// 실제 소리(좌우 RMS 차·레벨 손실)는 프로브 P-06 과 E2E E-02 가 브라우저에서 잰다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

async function load(entry) {
  const bundle = await build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node20',
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}

const decisionModule = await load('../src/audio/engine/channelDecision.ts');
const {
  ChannelDecider,
  DECISION_DIFFERENCE_DB,
  DECISION_SIGNAL_SECONDS,
  MAX_STEP_SECONDS,
  SIGNAL_GATE_DB,
  describeDecision,
} = decisionModule;

// ---------------------------------------------------------------------------------------------
// 1) 판정 규칙
// ---------------------------------------------------------------------------------------------
assert.equal(DECISION_SIGNAL_SECONDS, 0.3);
assert.equal(DECISION_DIFFERENCE_DB, 15);
assert.equal(SIGNAL_GATE_DB, -50);

/** 일정한 레벨을 50 ms 간격으로 넣으며 판정이 나는 시각(초)과 결과를 돌려준다. */
function feed(decider, levels, { stepSeconds = 0.05, seconds = 2, start = 0 } = {}) {
  let time = start;
  const end = start + seconds;
  while (time <= end + 1e-9) {
    const result = decider.push(time, levels);
    if (result !== null) return { result, time };
    time += stepSeconds;
  }
  return { result: null, time: end };
}

{
  // 왼쪽에만 신호(인터페이스 1번 입력): 신호가 300 ms 쌓인 순간 ch1.
  const decider = new ChannelDecider();
  const { result, time } = feed(decider, [-27, -120]);
  assert.equal(result, 'ch1');
  assert.ok(Math.abs(time - DECISION_SIGNAL_SECONDS) < 0.051, `0.3초쯤 뒤에 판정해야 합니다: ${time}`);
  assert.equal(decider.decision, 'ch1');
  assert.ok(decider.accumulatedSignalSeconds >= DECISION_SIGNAL_SECONDS - 1e-9);
}
{
  const { result } = feed(new ChannelDecider(), [-120, -27]);
  assert.equal(result, 'ch2');
}
{
  // 진짜 모노 장치(양쪽에 같은 신호)는 합침을 유지한다.
  const { result } = feed(new ChannelDecider(), [-27, -27]);
  assert.equal(result, 'sum');
}
{
  // 경계: 14.9 dB 는 합침, 15.1 dB 는 한쪽만(두 방향 모두).
  assert.equal(feed(new ChannelDecider(), [-20, -34.9]).result, 'sum');
  assert.equal(feed(new ChannelDecider(), [-20, -35.1]).result, 'ch1');
  assert.equal(feed(new ChannelDecider(), [-34.9, -20]).result, 'sum');
  assert.equal(feed(new ChannelDecider(), [-35.1, -20]).result, 'ch2');
}
{
  // 장치 잡음(−60 dBFS)이 있는 빈 채널 + 연주(−20 dBFS): 40 dB 차 → 한쪽만.
  assert.equal(feed(new ChannelDecider(), [-20, -60]).result, 'ch1');
}
{
  // 신호 문턱 아래(−55 dBFS)는 아무리 오래 와도 판정하지 않는다. 그 뒤 연주가 시작되면 '신호 시간'으로 300 ms 뒤에 판정한다.
  const decider = new ChannelDecider();
  const quiet = feed(decider, [-55, -120], { seconds: 10 });
  assert.equal(quiet.result, null);
  assert.equal(decider.accumulatedSignalSeconds, 0);
  const played = feed(decider, [-25, -120], { start: 10.05, seconds: 1 });
  assert.equal(played.result, 'ch1');
  assert.ok(played.time - 10.05 < 0.4, `연주 시작 뒤 0.4초 안에 판정해야 합니다: ${played.time - 10.05}`);
}
{
  // 문턱은 큰 쪽 채널로 본다: 한쪽이 −49 dBFS 면 신호, 둘 다 −51 dBFS 면 신호 아님.
  assert.equal(feed(new ChannelDecider(), [-49, -120]).result, 'ch1');
  assert.equal(feed(new ChannelDecider(), [-51, -120]).result, null);
}
{
  // 판정은 세션마다 한 번: 이후 입력이 반대로 바뀌어도 결과·반환값이 그대로다.
  const decider = new ChannelDecider();
  assert.equal(feed(decider, [-27, -120]).result, 'ch1');
  for (let i = 0; i < 100; i += 1) assert.equal(decider.push(5 + i * 0.05, [-120, -20]), null);
  assert.equal(decider.decision, 'ch1');
  decider.reset();
  assert.equal(decider.decision, null);
  assert.equal(feed(decider, [-120, -20]).result, 'ch2');
}
{
  // 폴링이 오래 끊겼다 돌아와도 한 번의 측정이 판정을 끝내지 못한다(MAX_STEP_SECONDS).
  const decider = new ChannelDecider();
  assert.equal(decider.push(0, [-20, -120]), null);
  assert.equal(decider.push(100, [-20, -120]), null);
  assert.ok(Math.abs(decider.accumulatedSignalSeconds - MAX_STEP_SECONDS) < 1e-9);
  assert.equal(decider.push(100.05, [-20, -120]), 'ch1');
}
{
  // 신호가 끊겼다 이어져도 신호 시간은 쌓인다(스트럼 사이 쉼). 문턱 아래 구간은 세지 않고, 거꾸로 가는 시각은 건너뛴다.
  const decider = new ChannelDecider();
  decider.push(0, [-20, -120]);
  decider.push(0.1, [-20, -120]); // +0.1
  decider.push(0.2, [-20, -120]); // +0.1 → 0.2
  decider.push(0.25, [-90, -120]); // 문턱 아래: 세지 않는다
  decider.push(1, [-90, -120]);
  assert.ok(Math.abs(decider.accumulatedSignalSeconds - 0.2) < 1e-9);
  assert.equal(decider.push(0.5, [-20, -120]), null, '거꾸로 간 시각은 건너뛴다');
  assert.ok(Math.abs(decider.accumulatedSignalSeconds - 0.2) < 1e-9);
  assert.equal(decider.push(1.05, [-20, -120]), null); // 0.25
  assert.equal(decider.push(1.1, [-20, -120]), 'ch1'); // 0.30
}
{
  // 에너지 평균: 왼쪽 0.2초, 오른쪽 0.1초 같은 크기로 번갈아 오면 3 dB 차 → 합침.
  const decider = new ChannelDecider();
  decider.push(0, [-20, -120]);
  decider.push(0.1, [-20, -120]);
  decider.push(0.2, [-20, -120]);
  assert.equal(decider.push(0.3, [-120, -20]), 'sum'); // 신호 0.3초가 차는 이 측정에서 판정: 에너지 비 2:1 = 3 dB
}
{
  // 이상한 값(NaN, ±Infinity)은 무음으로 본다.
  const decider = new ChannelDecider();
  for (let t = 0; t < 1; t += 0.05) decider.push(t, [Number.NaN, Number.NEGATIVE_INFINITY]);
  assert.equal(decider.decision, null);
  assert.equal(feed(new ChannelDecider(), [-20, Number.NaN]).result, 'ch1');
}
assert.equal(describeDecision('ch1'), '1번 입력에서만 소리가 들어와 1번 입력을 씁니다');
assert.equal(describeDecision('ch2'), '2번 입력에서만 소리가 들어와 2번 입력을 씁니다');
assert.equal(describeDecision('sum'), '양쪽 입력에 비슷한 소리가 들어와 합쳐서 씁니다');
assert.equal(describeDecision('pending'), '기타 소리가 들어오면 어느 입력을 쓸지 자동으로 정합니다');

// ---------------------------------------------------------------------------------------------
// 2) InputStage 그래프(가짜 오디오 컨텍스트로 연결·게인·램프를 기록)
// ---------------------------------------------------------------------------------------------
const stageModule = await load('../src/audio/engine/InputStage.ts');
const { InputStage, CHANNEL_RAMP_SECONDS, PATH_FADE_SECONDS, isInputChannelMode, isChannelDecision } = stageModule;

class FakeParam {
  constructor(value = 1) {
    this.value = value;
    this.events = [];
  }

  cancelAndHoldAtTime(time) {
    this.events.push({ type: 'hold', time });
  }

  cancelScheduledValues(time) {
    this.events.push({ type: 'cancel', time });
  }

  setValueAtTime(value, time) {
    this.value = value;
    this.events.push({ type: 'set', value, time });
  }

  linearRampToValueAtTime(value, time) {
    this.events.push({ type: 'ramp', value, time });
    this.value = value;
  }

  /** 마지막 램프 */
  get lastRamp() {
    return [...this.events].reverse().find((event) => event.type === 'ramp') ?? null;
  }
}

class FakeNode {
  constructor(context, kind) {
    this.context = context;
    this.kind = kind;
    this.connections = [];
    this.disconnected = false;
    this.gain = kind === 'gain' ? new FakeParam(1) : undefined;
    this.channelCount = 2;
    this.channelCountMode = 'max';
    this.fftSize = 2048;
    this.smoothingTimeConstant = 0.8;
    this.data = null;
  }

  connect(destination, output = 0) {
    this.connections.push({ destination, output });
    return destination;
  }

  disconnect(destination) {
    if (destination === undefined) {
      this.connections = [];
      this.disconnected = true;
    } else {
      this.connections = this.connections.filter((connection) => connection.destination !== destination);
    }
  }

  getFloatTimeDomainData(target) {
    target.fill(0);
    if (this.data !== null) target.fill(this.data);
  }
}

class FakeContext {
  constructor() {
    this.currentTime = 0;
    this.nodes = [];
  }

  create(kind) {
    const node = new FakeNode(this, kind);
    this.nodes.push(node);
    return node;
  }

  createGain() {
    return this.create('gain');
  }

  createChannelSplitter() {
    return this.create('splitter');
  }

  createAnalyser() {
    return this.create('analyser');
  }
}

function build2ch(options = {}, channelCount = 2) {
  const context = new FakeContext();
  const source = new FakeNode(context, 'source');
  const stage = new InputStage(context, source, channelCount, options);
  const byKind = (kind) => context.nodes.filter((node) => node.kind === kind);
  const [output, gainL, gainR, mono, monoGate, stereoGate] = byKind('gain');
  return { context, source, stage, output, gainL, gainR, mono, monoGate, stereoGate, splitter: byKind('splitter')[0] };
}

const connectsTo = (from, to, output = 0) => from.connections.some((connection) => connection.destination === to && connection.output === output);

{
  // 연결 모양
  const { context, source, stage, output, gainL, gainR, mono, monoGate, stereoGate, splitter } = build2ch();
  assert.equal(stage.selectable, true);
  assert.equal(stage.output, output);
  assert.ok(connectsTo(source, splitter) && connectsTo(source, stereoGate));
  assert.ok(connectsTo(splitter, gainL, 0), '왼쪽 출력 → gainL');
  assert.ok(connectsTo(splitter, gainR, 1), '오른쪽 출력 → gainR');
  assert.ok(connectsTo(gainL, mono) && connectsTo(gainR, mono));
  assert.equal(mono.channelCount, 1);
  assert.equal(mono.channelCountMode, 'explicit');
  assert.ok(connectsTo(mono, monoGate) && connectsTo(monoGate, output) && connectsTo(stereoGate, output));
  // S1.5: 채널별 레벨은 level-meter#in 워클릿이 잰다. InputStage 는 분석 노드를 만들지 않는다.
  assert.equal(context.nodes.filter((node) => node.kind === 'analyser').length, 0, '분석 노드가 없다');
  assert.equal(splitter.connections.length, 2, '분할기는 gainL·gainR 로만 간다');
  // 자동 판정 전에는 0.5/0.5 로 합치고 모노 경로를 쓴다.
  assert.equal(stage.mode, 'auto');
  assert.equal(stage.decision, 'pending');
  assert.deepEqual([gainL.gain.value, gainR.gain.value], [0.5, 0.5]);
  assert.deepEqual([monoGate.gain.value, stereoGate.gain.value], [1, 0]);
}

for (const [mode, expected] of [['ch1', [1, 0]], ['ch2', [0, 1]]]) {
  const { gainL, gainR, monoGate, stereoGate } = build2ch({ mode });
  assert.deepEqual([gainL.gain.value, gainR.gain.value], expected, `${mode} 게인`);
  assert.deepEqual([monoGate.gain.value, stereoGate.gain.value], [1, 0]);
}
{
  const { monoGate, stereoGate } = build2ch({ mode: 'stereo' });
  assert.deepEqual([monoGate.gain.value, stereoGate.gain.value], [0, 1], '스테레오는 소스를 그대로');
}
{
  // 지난 세션의 판정으로 시작: 자동일 때만 적용한다.
  const remembered = build2ch({ rememberedDecision: 'ch2' });
  assert.equal(remembered.stage.decision, 'ch2');
  assert.deepEqual([remembered.gainL.gain.value, remembered.gainR.gain.value], [0, 1]);
  const manual = build2ch({ mode: 'ch1', rememberedDecision: 'ch2' });
  assert.deepEqual([manual.gainL.gain.value, manual.gainR.gain.value], [1, 0]);
  assert.equal(manual.stage.decision, 'pending');
  const invalid = build2ch({ rememberedDecision: 'bogus' });
  assert.equal(invalid.stage.decision, 'pending');
}
{
  // setMode: 모노 모드 사이는 20 ms 램프, 같은 모드는 아무 일도 없음.
  const { context, stage, gainL, gainR, monoGate, stereoGate } = build2ch();
  context.currentTime = 1;
  stage.setMode('ch1');
  assert.deepEqual([gainL.gain.lastRamp.value, gainR.gain.lastRamp.value], [1, 0]);
  assert.ok(Math.abs(gainL.gain.lastRamp.time - (1 + CHANNEL_RAMP_SECONDS)) < 1e-9);
  assert.equal(CHANNEL_RAMP_SECONDS, 0.02);
  const before = gainL.gain.events.length;
  stage.setMode('ch1');
  assert.equal(gainL.gain.events.length, before, '같은 모드는 램프를 다시 걸지 않는다');
  stage.setMode('ch2');
  assert.deepEqual([gainL.gain.lastRamp.value, gainR.gain.lastRamp.value], [0, 1]);

  // 모노 → 스테레오: 8 ms 경로 맞바꿈, 게인은 건드리지 않는다.
  context.currentTime = 2;
  const gainEvents = gainL.gain.events.length;
  stage.setMode('stereo');
  assert.equal(PATH_FADE_SECONDS, 0.008);
  assert.deepEqual([monoGate.gain.lastRamp.value, stereoGate.gain.lastRamp.value], [0, 1]);
  assert.ok(Math.abs(monoGate.gain.lastRamp.time - (2 + PATH_FADE_SECONDS)) < 1e-9);
  assert.equal(gainL.gain.events.length, gainEvents);

  // 스테레오 → 1번: 닫힌 모노 경로의 게인을 바로 맞춘 뒤 8 ms 로 연다(게인이 움직이는 소리가 없다).
  context.currentTime = 3;
  stage.setMode('ch1');
  assert.deepEqual([gainL.gain.value, gainR.gain.value], [1, 0]);
  const afterSwitch = gainL.gain.events.slice(-2).map((event) => event.type);
  assert.deepEqual(afterSwitch, ['cancel', 'set']);
  assert.deepEqual([monoGate.gain.lastRamp.value, stereoGate.gain.lastRamp.value], [1, 0]);
  assert.ok(Math.abs(monoGate.gain.lastRamp.time - (3 + PATH_FADE_SECONDS)) < 1e-9);
}
{
  // 자동 판정: 신호가 300 ms 쌓이면 20 ms 크로스페이드로 그 채널만, 리스너는 한 번만 받는다.
  const { context, stage, gainL, gainR } = build2ch();
  const heard = [];
  stage.onDecision((decision) => heard.push(decision));
  for (let step = 0; step < 20; step += 1) {
    context.currentTime = step * 0.05;
    stage.onChannelLevels([-27, -120]);
  }
  assert.deepEqual(heard, ['ch1']);
  assert.equal(stage.decision, 'ch1');
  assert.deepEqual([gainL.gain.lastRamp.value, gainR.gain.lastRamp.value], [1, 0]);
  assert.ok(gainL.gain.lastRamp.time - context.currentTime <= 1 && gainL.gain.lastRamp.time > 0.25);
  // 판정 뒤 들어온 반대쪽 신호는 무시한다(세션마다 한 번).
  for (let step = 20; step < 40; step += 1) {
    context.currentTime = step * 0.05;
    stage.onChannelLevels([-120, -20]);
  }
  assert.deepEqual(heard, ['ch1']);
  assert.deepEqual([gainL.gain.lastRamp.value, gainR.gain.lastRamp.value], [1, 0]);
}
{
  // 수동 모드에서 난 판정은 표시용 상태만 바꾸고 게인은 사용자가 고른 모드를 따른다. 자동으로 돌아오면 판정이 적용된다.
  const { context, stage, gainL, gainR } = build2ch({ mode: 'ch2' });
  for (let step = 0; step < 12; step += 1) {
    context.currentTime = step * 0.05;
    stage.onChannelLevels([-27, -120]);
  }
  assert.equal(stage.decision, 'ch1');
  assert.deepEqual([gainL.gain.value, gainR.gain.value], [0, 1], '수동 2번은 판정과 무관하게 유지');
  stage.setMode('auto');
  assert.deepEqual([gainL.gain.lastRamp.value, gainR.gain.lastRamp.value], [1, 0]);
}
{
  // 진짜 모노 장치(양쪽 같은 신호): 합침을 유지하고 게인은 0.5/0.5 그대로.
  const { context, stage, gainL, gainR } = build2ch();
  const heard = [];
  stage.onDecision((decision) => heard.push(decision));
  for (let step = 0; step < 20; step += 1) {
    context.currentTime = step * 0.05;
    stage.onChannelLevels([-27, -27]);
  }
  assert.deepEqual(heard, ['sum']);
  assert.deepEqual([gainL.gain.value, gainR.gain.value], [0.5, 0.5]);
}
{
  // S1.5: 판정 시각은 측정이 끝난 오디오 시계(MonitorService 가 frame ÷ sampleRate 로 넘긴다)다. 컨텍스트의 currentTime 과 무관하다.
  const { context, stage } = build2ch();
  const heard = [];
  stage.onDecision((decision) => heard.push(decision));
  context.currentTime = 99; // 메인 스레드의 시계가 앞서 있어도(탭이 멈췄다 돌아온 경우 등) 판정은 넘겨 받은 시각을 따른다.
  for (let step = 0; step < 20; step += 1) stage.onChannelLevels([-27, -120], step * 0.05);
  assert.deepEqual(heard, ['ch1']);
  assert.equal(stage.decision, 'ch1');
}
{
  // 시각을 생략하면 컨텍스트 시계를 쓴다(오프라인 렌더·옛 호출).
  const { context, stage } = build2ch();
  for (let step = 0; step < 20; step += 1) {
    context.currentTime = step * 0.05;
    stage.onChannelLevels([-27, -120]);
  }
  assert.equal(stage.decision, 'ch1');
}
{
  // 표시할 채널: 소리가 실제로 흘러 들어가는 채널만(1번만 쓰는 중에 2번의 잡음이 막대를 흔들지 않는다).
  const auto = build2ch();
  assert.equal(auto.stage.meteredChannels, 'all', '자동 판정 전(0.5/0.5 합침)');
  for (let step = 0; step < 20; step += 1) auto.stage.onChannelLevels([-27, -120], step * 0.05);
  assert.equal(auto.stage.meteredChannels, 0, '자동 판정이 ch1 이면 1번 채널');
  auto.stage.setMode('ch2');
  assert.equal(auto.stage.meteredChannels, 1, '수동 2번');
  auto.stage.setMode('stereo');
  assert.equal(auto.stage.meteredChannels, 'all', '스테레오는 모두');
  auto.stage.setMode('ch1');
  assert.equal(auto.stage.meteredChannels, 0);
  assert.equal(build2ch({ mode: 'ch2' }).stage.meteredChannels, 1);
  const summed = build2ch();
  for (let step = 0; step < 20; step += 1) summed.stage.onChannelLevels([-27, -27], step * 0.05);
  assert.equal(summed.stage.decision, 'sum');
  assert.equal(summed.stage.meteredChannels, 'all', '합치는 중이면 모두');
  assert.equal(build2ch({}, 1).stage.meteredChannels, 'all', '채널 1개 장치');
  assert.equal(build2ch({ passthrough: true }).stage.meteredChannels, 'all', '파일 재생');
}
{
  // 구독 해제, 정리(분석 노드·경로 끊기, 폴링 중지)
  const { context, source, stage, output, splitter, monoGate, stereoGate } = build2ch();
  const heard = [];
  const unsubscribe = stage.onDecision((decision) => heard.push(decision));
  unsubscribe();
  for (let step = 0; step < 20; step += 1) {
    context.currentTime = step * 0.05;
    stage.onChannelLevels([-27, -120]);
  }
  assert.deepEqual(heard, []);
  stage.dispose();
  assert.ok(!connectsTo(source, splitter) && !connectsTo(source, stereoGate), '소스와의 연결을 끊는다');
  assert.ok([output, splitter, monoGate, stereoGate].every((node) => node.disconnected));
  stage.dispose();
  stage.setMode('ch2');
  stage.onChannelLevels([-20, -120]);
}
{
  // 정리한 뒤에는 늦게 도착한 측정이 판정을 만들지 않는다(세션이 끝난 뒤 남은 포트 메시지 등).
  const { stage } = build2ch();
  stage.dispose();
  for (let step = 0; step < 20; step += 1) stage.onChannelLevels([-27, -120], step * 0.05);
  assert.equal(stage.decision, 'pending');
}
for (const [label, build] of [
  ['채널 1개 장치', () => build2ch({}, 1)],
  ['파일 재생(통과)', () => build2ch({ passthrough: true })],
]) {
  const { context, source, stage, output } = build();
  assert.equal(stage.selectable, false, `${label}: 메뉴를 숨긴다`);
  assert.ok(connectsTo(source, output), `${label}: 소스를 그대로 통과`);
  assert.equal(context.nodes.filter((node) => node.kind === 'splitter' || node.kind === 'analyser').length, 0, `${label}: 분할·분석 노드가 없다`);
  stage.setMode('ch2');
  assert.equal(stage.mode, 'ch2');
  stage.onChannelLevels([-20, -120]);
  assert.equal(stage.decision, 'pending');
  stage.dispose();
  assert.ok(!connectsTo(source, output));
}

assert.equal(isInputChannelMode('auto') && isInputChannelMode('ch1') && isInputChannelMode('ch2') && isInputChannelMode('stereo'), true);
assert.equal(isInputChannelMode('1') || isInputChannelMode('') || isInputChannelMode(null), false);
assert.equal(isChannelDecision('sum') && isChannelDecision('ch1') && isChannelDecision('ch2'), true);
assert.equal(isChannelDecision('pending') || isChannelDecision('auto') || isChannelDecision(undefined), false);

console.log('Input stage regression passed: decision rule (300 ms · 15 dB · −50 dBFS), graph shape, mode gains, 20 ms/8 ms ramps, one-shot decision, pass-through and cleanup.');
