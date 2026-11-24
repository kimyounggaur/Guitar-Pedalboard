// 입력 레벨 경고(설계서 4.12 표, S2.5, R2-8) 시험.
//   1. 판정 수치(LEVEL_WARNING_SPEC)가 4.12 표와 같다 — 승인 없이 바뀌는 것을 막는다.
//   2. LevelWarningJudge: 실제 시험 신호(REF-PC·LVL-*·G-1·G-2 …)를 level-meter 와 같은 간격(1664 프레임)의 블록 피크로 바꿔 흘려
//      '정상 → 경고 없음, 작음 → 작음, 한계 초과 → 큼, 무음 5초 → 신호 없음, 연주를 멈춤 → 작음 아님'을 확인한다.
//      표를 글자 그대로 읽은 판정(참조 모델)과 비교해, 설계서 표에 없는 보강(L-119)이 왜 필요한지도 기록한다.
//   3. 히스테리시스·우선순위·연결 직후 1초·판정 중단(파일·세션 정지)·시계 역행.
//   4. MonitorService: 워클릿 메시지로 판정이 돌고 바뀔 때만 sink 에 알린다. 화면 탭·DOM 과 무관하다.
//   5. monitorStore·화면 소스 단언: 판정은 한 곳(MonitorService)이고 화면은 읽기만 한다(옛 순간값 판정이 남아 있지 않다).
// 소리가 실제 브라우저의 가짜 마이크에서 어떻게 보이는지는 e2e E-09 가 잰다. 실제 기타로 수치를 맞추는 일은 사람이 한다(설계서 6.5).
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';

const root = (relative) => fileURLToPath(new URL(`../${relative}`, import.meta.url));
const read = (relative) => readFileSync(root(relative), 'utf8');
const plain = (value) => JSON.parse(JSON.stringify(value));
const near = (actual, expected, tolerance, message) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${message}: 기대 ${expected} ± ${tolerance}, 실제 ${actual}`);

async function loadModule(entry) {
  const bundle = await build({ entryPoints: [root(entry)], bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
}

const { LEVEL_WARNING_SPEC, LevelWarningJudge } = await loadModule('src/audio/monitor/levelWarning.ts');
const signals = await loadModule('src/audio/testing/signals.ts');
const harnessBundle = await build({
  stdin: {
    contents: `
      export { MonitorService } from './audio/monitor/MonitorService.ts';
      export { useMonitorStore, monitorSink } from './store/monitorStore.ts';
    `,
    resolveDir: root('src'),
    sourcefile: 'level-warning-harness.ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const harness = await import(`data:text/javascript;base64,${Buffer.from(harnessBundle.outputFiles[0].text).toString('base64')}`);

const SAMPLE_RATE = 48000;
/** level-meter 워클릿의 실제 보고 간격: 1/30 초 = 1600 프레임을 렌더 양자(128)로 끊으면 1664 프레임이다(약 34.7 ms). */
const BLOCK = 1664;
const BLOCK_SECONDS = BLOCK / SAMPLE_RATE;

// ---------------------------------------------------------------------------------------------
// 도우미: 신호 → 블록 피크(dBFS) → 판정 흐름
// ---------------------------------------------------------------------------------------------
/** 샘플을 반복해 seconds 초로 늘린다(가짜 마이크의 WAV 는 끝나면 처음부터 되풀이된다). */
function loopTo(samples, seconds) {
  const total = Math.round(seconds * SAMPLE_RATE);
  const out = new Float32Array(total);
  for (let i = 0; i < total; i += 1) out[i] = samples[i % samples.length];
  return out;
}

/** 워클릿이 보고하는 것과 같은 블록 단위 피크(dBFS). 무음은 −120. */
function blockPeaksDb(samples) {
  const out = [];
  for (let start = 0; start + BLOCK <= samples.length; start += BLOCK) {
    let peak = 0;
    for (let i = start; i < start + BLOCK; i += 1) {
      const magnitude = Math.abs(samples[i]);
      if (magnitude > peak) peak = magnitude;
    }
    out.push(peak > 0 ? Math.max(-120, 20 * Math.log10(peak)) : -120);
  }
  return out;
}

const timeOfBlock = (index) => ((index + 1) * BLOCK) / SAMPLE_RATE;

/** 블록 피크를 판정기에 순서대로 넣고 경고가 바뀐 때만 [시각, 경고] 로 모은다. */
function simulate(blockDb, judging = () => true) {
  const judge = new LevelWarningJudge();
  const timeline = [];
  let current = null;
  blockDb.forEach((db, index) => {
    const t = timeOfBlock(index);
    const warning = judge.update(t, db, judging(t));
    if (warning !== current) {
      timeline.push([t, warning]);
      current = warning;
    }
  });
  return timeline;
}

const kinds = (timeline) => timeline.map(([, warning]) => warning);
const firstAt = (timeline, kind) => timeline.find(([, warning]) => warning === kind)?.[0] ?? null;
const everShown = (timeline, kind) => timeline.some(([, warning]) => warning === kind);
const fmt = (timeline) => timeline.map(([t, w]) => `${t.toFixed(2)}s:${w}`).join(' ');

/**
 * 설계서 4.12 표를 글자 그대로 읽은 '작음' 판정(참조 모델): 최근 3초 창의 최대 피크만 본다.
 * 1초 버림·창이 다 찬 뒤부터는 같고, 창의 최대값이 얼마나 오래됐는지는 보지 않는다. 신호 없음·큼은 판정기와 같아서 여기서는 뺀다.
 */
function literalLowTimeline(blockDb) {
  const times = blockDb.map((_, index) => timeOfBlock(index));
  const start = times[0];
  const judgedFrom = start + LEVEL_WARNING_SPEC.graceSeconds;
  let low = false;
  const timeline = [];
  let current = false;
  blockDb.forEach((db, index) => {
    const t = times[index];
    if (t < judgedFrom || t - judgedFrom < LEVEL_WARNING_SPEC.lowWindowSeconds) return;
    let top = -Infinity;
    for (let j = index; j >= 0 && times[j] > t - LEVEL_WARNING_SPEC.lowWindowSeconds; j -= 1) top = Math.max(top, blockDb[j]);
    if (top >= LEVEL_WARNING_SPEC.playingDb) {
      if (!low && top < LEVEL_WARNING_SPEC.lowBelowDb) low = true;
      else if (low && top >= LEVEL_WARNING_SPEC.lowClearDb) low = false;
    }
    if (low !== current) {
      timeline.push([t, low ? 'low' : null]);
      current = low;
    }
  });
  return timeline;
}

let checks = 0;
const check = (name, body) => {
  body();
  checks += 1;
  console.log(`  ✓ ${name}`);
};

// ---------------------------------------------------------------------------------------------
// 1. 수치
// ---------------------------------------------------------------------------------------------
console.log('1. 판정 수치(설계서 4.12 표)');
check('표의 숫자가 그대로다', () => {
  assert.deepEqual(plain(LEVEL_WARNING_SPEC), {
    graceSeconds: 1,
    silentSeconds: 5,
    silentBelowDb: -70,
    silentClearDb: -60,
    playingDb: -60,
    lowWindowSeconds: 3,
    lowBelowDb: -36,
    lowClearDb: -30,
    lowFreshSeconds: 2,
    highDb: -0.5,
    highClearSeconds: 3,
  });
});

// ---------------------------------------------------------------------------------------------
// 2. 실제 시험 신호
// ---------------------------------------------------------------------------------------------
console.log('2. 신호 4종과 멈춘 연주');
const refPcLoop = (seconds) => loopTo(signals.refPc(SAMPLE_RATE), seconds);

check('정상 입력(REF-PC 피크 −12 dBFS): 60초 동안 경고가 한 번도 없다', () => {
  const timeline = simulate(blockPeaksDb(refPcLoop(60)));
  assert.deepEqual(timeline, [], fmt(timeline));
});

check('작은 입력(피크 −40 dBFS): 1초 버림 + 3초 창 뒤에 \'작음\'이 뜨고 끝까지 남는다. 신호 없음은 없다', () => {
  const timeline = simulate(blockPeaksDb(loopTo(signals.levelSmall(SAMPLE_RATE), 60)));
  assert.deepEqual(kinds(timeline), ['low'], fmt(timeline));
  const at = firstAt(timeline, 'low');
  assert.ok(at >= 4.0 && at <= 6.2, `'작음'이 4초(1초 버림 + 3초 창) 전에 뜨거나 6.2초 뒤에 뜸: ${at}`);
});

check('한계 초과(피크 0 dBFS): \'큼\'이 뜨고(첫 타건 1초 버림 뒤) 계속 이어진다', () => {
  const timeline = simulate(blockPeaksDb(loopTo(signals.levelHot(SAMPLE_RATE), 60)));
  assert.deepEqual(kinds(timeline), ['high'], fmt(timeline));
  // 첫 블록(0초)의 타건은 연결 직후 1초라 버린다. 다음 타건(2초)에서 뜬다.
  near(firstAt(timeline, 'high'), 2.0, 0.15, '\'큼\' 시각');
});

check('무음 5초: 1초 버림 뒤 5초가 지나 \'신호 없음\'이 뜬다(연결 직후의 0 을 5초에 넣지 않는다)', () => {
  const timeline = simulate(blockPeaksDb(loopTo(signals.levelSilent(SAMPLE_RATE), 30)));
  assert.deepEqual(kinds(timeline), ['silent'], fmt(timeline));
  near(firstAt(timeline, 'silent'), 6.0, 0.15, '\'신호 없음\' 시각(1초 + 5초)');
});

check('연주를 멈춤(LVL-STOP: 한 번 치고 여운이 끝까지 줄어듦): \'작음\'이 한 번도 뜨지 않고, 여운이 −70 dBFS 아래로 5초 이어진 뒤에야 \'신호 없음\'', () => {
  const blockDb = blockPeaksDb(signals.levelStop(SAMPLE_RATE, 14));
  const timeline = simulate(blockDb);
  assert.ok(!everShown(timeline, 'low'), `연주를 멈췄는데 '작음'이 뜸: ${fmt(timeline)}`);
  // 정의대로 직접 센 기대값: 마지막으로 −70 dBFS 이상이었던 블록 + 5초
  let lastAudible = 0;
  blockDb.forEach((db, index) => {
    if (db >= LEVEL_WARNING_SPEC.silentBelowDb) lastAudible = timeOfBlock(index);
  });
  assert.deepEqual(kinds(timeline), ['silent'], fmt(timeline));
  near(firstAt(timeline, 'silent'), lastAudible + LEVEL_WARNING_SPEC.silentSeconds, BLOCK_SECONDS + 1e-6, '\'신호 없음\' 시각');
});

check('멈췄다가 다시 치면(LVL-STOP 가 되풀이): \'신호 없음\'이 걷히고 \'작음\'은 끝내 뜨지 않는다', () => {
  const timeline = simulate(blockPeaksDb(loopTo(signals.levelStop(SAMPLE_RATE, 14), 60)));
  assert.ok(!everShown(timeline, 'low'), fmt(timeline));
  // 14초마다 새 타건(−12 dBFS)이 오면 신호 없음이 걷힌다. 60초 동안 4번 타건 → 신호 없음 4번 뜨고 걷힌다.
  assert.deepEqual(kinds(timeline), ['silent', null, 'silent', null, 'silent', null, 'silent', null], fmt(timeline));
});

check('표를 글자 그대로 읽으면(참조 모델) 멈춘 연주에서 \'작음\'이 오경고로 뜬다 — 보강(L-119)이 필요한 이유', () => {
  const literal = literalLowTimeline(blockPeaksDb(signals.levelStop(SAMPLE_RATE, 14)));
  assert.ok(everShown(literal, 'low'), '참조 모델이 오경고를 내지 않으면 보강이 필요 없다: 이 시험을 다시 본다');
  const at = firstAt(literal, 'low');
  // 한 번 친 −12 dBFS 의 여운이 초당 7.2 dB 씩 줄어, 3초 창이 첫 소리를 지나면 창의 최대값이 −36 dBFS 를 지나는 때(약 6.3초)
  assert.ok(at >= 6.0 && at <= 7.0, `참조 모델의 오경고 시각: ${at}`);
});

check('실제 연주에 가까운 G-1(서스테인 리드)·G-2(스트러밍): 60초 동안 경고 0', () => {
  for (const [name, samples] of [['G-1', signals.sustainLead(SAMPLE_RATE)], ['G-2', signals.strumming(SAMPLE_RATE)]]) {
    const timeline = simulate(blockPeaksDb(samples));
    assert.deepEqual(timeline, [], `${name}: ${fmt(timeline)}`);
  }
});

check('REF-DECAY(한 번 치고 55 dB 줄어듦, 4초): \'작음\'이 뜨지 않는다', () => {
  const timeline = simulate(blockPeaksDb(loopTo(signals.refDecay(SAMPLE_RATE), 30)));
  assert.ok(!everShown(timeline, 'low'), fmt(timeline));
});

// ---------------------------------------------------------------------------------------------
// 3. 히스테리시스·우선순위·중단
// ---------------------------------------------------------------------------------------------
console.log('3. 히스테리시스·우선순위·연결 직후 1초·판정 중단');
/** 일정한 피크 하나를 seconds 초 동안 내는 블록 배열 */
const constant = (db, seconds) => Array.from({ length: Math.round(seconds / BLOCK_SECONDS) }, () => db);

check('작음: −36 아래에서 뜨고, −36~−30 사이에서는 그대로, −30 이상에서 걷힌다', () => {
  const timeline = simulate([...constant(-40, 8), ...constant(-33, 8), ...constant(-28, 8), ...constant(-33, 8), ...constant(-40, 8)]);
  assert.deepEqual(kinds(timeline), ['low', null, 'low'], fmt(timeline));
  const [lowAt, clearAt, againAt] = timeline.map(([t]) => t);
  assert.ok(lowAt < 8 && clearAt > 16 && clearAt < 17 && againAt > 24, fmt(timeline));
});

check('큼: −0.5 dBFS 이상 한 블록으로 뜨고, 마지막 깨짐 뒤 3초가 지나야 걷힌다', () => {
  // 2초 정상 → 깨짐 한 블록 → 정상
  const blocks = [...constant(-12, 2), -0.2, ...constant(-12, 10)];
  const timeline = simulate(blocks);
  assert.deepEqual(kinds(timeline), ['high', null], fmt(timeline));
  const [highAt, clearAt] = timeline.map(([t]) => t);
  near(clearAt - highAt, LEVEL_WARNING_SPEC.highClearSeconds, BLOCK_SECONDS + 1e-6, '깨짐 뒤 해제까지');
});

check('큼은 −0.5 dBFS 기준이다: −0.6 은 큼이 아니다', () => {
  const timeline = simulate([...constant(-12, 3), -0.6, ...constant(-12, 5)]);
  assert.ok(!everShown(timeline, 'high'), fmt(timeline));
});

check('신호 없음: 피크 −60 dBFS 이상에서 걷히고, −70~−60 사이에서는 그대로다(걷힌 자리에는 그 소리가 \'작음\'인지 새로 판단한다)', () => {
  const timeline = simulate([...constant(-120, 8), ...constant(-65, 2), -55, ...constant(-120, 3)]);
  // −65 dBFS 는 걷지 못하고, −55 dBFS 한 블록이 걷는다. −55 는 연주(−60 이상)이면서 −36 보다 작으니 곧바로 '작음'이다(표의 정의 그대로).
  assert.deepEqual(kinds(timeline), ['silent', 'low'], fmt(timeline));
  const [, changedAt] = timeline.map(([t]) => t);
  assert.ok(changedAt > 10 && changedAt < 10.2, `−65 dBFS 로는 바뀌지 않고 −55 에서 바뀐다: ${changedAt}`);
});

check('걷힌 뒤 −70 dBFS 아래가 5초 이어지면 신호 없음이 다시 뜨고 작음은 내려간다(소리가 없는데 \'작다\'를 남기지 않는다)', () => {
  const timeline = simulate([...constant(-120, 8), -55, ...constant(-120, 8)]);
  assert.deepEqual(kinds(timeline), ['silent', 'low', 'silent'], fmt(timeline));
});

check('−70~−60 dBFS 사이의 일정한 소리는 신호 없음도 작음도 아니다(두 기준 사이의 완충 구간)', () => {
  const timeline = simulate(constant(-65, 30));
  assert.deepEqual(timeline, [], fmt(timeline));
});

check('신호 없음이 걷힌 뒤 작은 소리가 이어지면 \'작음\'을 새로 판단한다', () => {
  const timeline = simulate([...constant(-120, 8), ...constant(-45, 12)]);
  // 신호가 돌아온 첫 블록(−45)이 곧바로 '작음'이다. 사이에 '경고 없음'이 끼지 않는다.
  assert.deepEqual(kinds(timeline), ['silent', 'low'], fmt(timeline));
  assert.ok(firstAt(timeline, 'low') > 8 && firstAt(timeline, 'low') < 8.2, fmt(timeline));
});

check('우선순위: 큼 > 신호 없음 > 작음. 큼이 뜨면 작음·신호 없음은 내려간다', () => {
  const timeline = simulate([...constant(-45, 8), ...constant(-0.2, 1), ...constant(-45, 8)]);
  // 작음 → 큼(작음은 내려가고 화면에는 큼 하나만 보인다) → 큼이 걷히는 순간 작은 소리가 이어지고 있으니 작음을 새로 판단(사이에 '경고 없음'이 끼지 않는다)
  assert.deepEqual(kinds(timeline), ['low', 'high', 'low'], fmt(timeline));
  const [, highAt, lowAgainAt] = timeline.map(([t]) => t);
  near(lowAgainAt - highAt, 1 + LEVEL_WARNING_SPEC.highClearSeconds, BLOCK_SECONDS * 2, '큼이 걷히는 때(마지막 깨짐 + 3초)');
});

check('연결 직후 1초는 버린다: 첫 1초의 0 dBFS 튐이 경고가 되지 않는다', () => {
  const timeline = simulate([...constant(-0.1, 0.9), ...constant(-12, 10)]);
  assert.deepEqual(timeline, [], fmt(timeline));
});

check('judging=false(파일 재생·세션 밖)에서는 어떤 입력에도 null 이고, 다시 판정을 시작하면 1초 버림부터 새로 센다', () => {
  const judge = new LevelWarningJudge();
  let t = 0;
  const step = (db, judging) => {
    t += BLOCK_SECONDS;
    return judge.update(t, db, judging);
  };
  // 작은 소리로 '작음'까지 올린다
  let last = null;
  for (let i = 0; i < Math.round(8 / BLOCK_SECONDS); i += 1) last = step(-45, true);
  assert.equal(last, 'low');
  // 판정 중단(파일을 재생하거나 일시정지): 어떤 값이 와도 null
  for (const db of [-45, -0.1, -120]) assert.equal(step(db, false), null);
  // 판정 재개: 1초 버림 + 3초 창을 새로 센다. 이전의 '작음'이 남아 있지 않다.
  const resumedAt = t + BLOCK_SECONDS;
  const seen = [];
  for (let i = 0; i < Math.round(8 / BLOCK_SECONDS); i += 1) seen.push([t + BLOCK_SECONDS, step(-45, true)]);
  const firstLow = seen.find(([, warning]) => warning === 'low')?.[0];
  assert.ok(firstLow >= resumedAt + 4.0 - 1e-6, `재개 후 4초(1초 버림 + 3초 창) 전에 '작음'이 뜸: ${firstLow - resumedAt}`);
  assert.equal(seen[0][1], null);
});

check('시계가 거꾸로 가면 새 세션으로 본다(이전 창을 끌고 가지 않는다)', () => {
  const judge = new LevelWarningJudge();
  let t = 0;
  let last = null;
  for (let i = 0; i < Math.round(8 / BLOCK_SECONDS); i += 1) {
    t += BLOCK_SECONDS;
    last = judge.update(t, -45, true);
  }
  assert.equal(last, 'low');
  assert.equal(judge.update(BLOCK_SECONDS, -12, true), null, '시계가 되돌아간 첫 측정은 새 세션의 첫 1초다');
});

check('숫자가 아닌 값(NaN·Infinity)은 무시하고 지금 상태를 그대로 돌려준다', () => {
  const judge = new LevelWarningJudge();
  let t = 0;
  let last = null;
  for (let i = 0; i < Math.round(8 / BLOCK_SECONDS); i += 1) {
    t += BLOCK_SECONDS;
    last = judge.update(t, -45, true);
  }
  assert.equal(last, 'low');
  assert.equal(judge.update(t + BLOCK_SECONDS, Number.NaN, true), 'low');
  assert.equal(judge.update(Number.POSITIVE_INFINITY, -45, true), 'low');
});

check('같은 입력에는 같은 결과다(시계·난수에 기대지 않는다)', () => {
  const blockDb = blockPeaksDb(loopTo(signals.levelSmall(SAMPLE_RATE), 30));
  assert.deepEqual(simulate(blockDb), simulate(blockDb));
});

// ---------------------------------------------------------------------------------------------
// 4. MonitorService
// ---------------------------------------------------------------------------------------------
console.log('4. MonitorService: 메시지 → 판정 → sink');
const { MonitorService, useMonitorStore, monitorSink } = harness;
const makeNode = () => ({ port: { onmessage: null, sent: [], closed: false, postMessage(message) { this.sent.push(message); }, close() { this.closed = true; } } });
const makeSink = () => {
  const calls = [];
  const record = (name) => (...args) => calls.push([name, ...args]);
  return { calls, setInput: record('setInput'), setOutput: record('setOutput'), setLimiterGr: record('setLimiterGr'), setGuard: record('setGuard'), setInputWarning: record('setInputWarning'), reset: record('reset') };
};
const warningCalls = (sink) => sink.calls.filter((call) => call[0] === 'setInputWarning').map((call) => call[1]);
const levelMessage = (peakDb, frame, tap = 'in') => ({ type: 'level', tap, rmsDb: peakDb.map((db) => db - 6), peakDb, clipped: false, frame });
const deliverBlocks = (node, blockDb, channelsOf = (db) => [db], startBlock = 0) => {
  blockDb.forEach((db, index) => node.port.onmessage({ data: levelMessage(channelsOf(db), (startBlock + index + 1) * BLOCK) }));
};

check('장치 입력(inputJudging=true): 작은 입력이면 \'low\' 를 한 번만 알린다(30 Hz 로 되풀이하지 않는다)', () => {
  const sink = makeSink();
  const service = new MonitorService(sink, () => 0);
  const nodes = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  service.attach(nodes, { inputJudging: () => true }, SAMPLE_RATE);
  deliverBlocks(nodes.inputTap, constant(-45, 12));
  assert.deepEqual(warningCalls(sink), ['low']);
  // 출력 쪽 측정은 입력 경고에 영향이 없다
  nodes.outputTap.port.onmessage({ data: levelMessage([-0.1], 99 * BLOCK, 'out') });
  assert.deepEqual(warningCalls(sink), ['low']);
});

check('파일 재생 등 inputJudging 이 false 이거나 없으면 어떤 레벨에도 경고를 알리지 않는다', () => {
  for (const hooks of [{ inputJudging: () => false }, {}]) {
    const sink = makeSink();
    const service = new MonitorService(sink, () => 0);
    const nodes = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
    service.attach(nodes, hooks, SAMPLE_RATE);
    deliverBlocks(nodes.inputTap, [...constant(-45, 8), ...constant(-0.1, 4), ...constant(-120, 8)]);
    assert.deepEqual(warningCalls(sink), []);
  }
});

check('판정 중에 inputJudging 이 false 로 바뀌면(파일 일시정지 등) 경고가 즉시 내려간다', () => {
  const sink = makeSink();
  const service = new MonitorService(sink, () => 0);
  const nodes = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  let judging = true;
  service.attach(nodes, { inputJudging: () => judging }, SAMPLE_RATE);
  deliverBlocks(nodes.inputTap, constant(-45, 8));
  judging = false;
  deliverBlocks(nodes.inputTap, constant(-45, 1), (db) => [db], Math.round(8 / BLOCK_SECONDS));
  assert.deepEqual(warningCalls(sink), ['low', null]);
});

check('선택한 채널의 원신호로 판정한다: 1번 채널이 무음이면 2번이 커도 \'신호 없음\'', () => {
  const sink = makeSink();
  const service = new MonitorService(sink, () => 0);
  const nodes = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  service.attach(nodes, { inputJudging: () => true, inputSelection: () => 0 }, SAMPLE_RATE);
  deliverBlocks(nodes.inputTap, constant(-12, 8), (db) => [-120, db]);
  assert.deepEqual(warningCalls(sink), ['silent']);
  // 모든 채널을 보면 같은 입력이 정상이다
  const sinkAll = makeSink();
  const serviceAll = new MonitorService(sinkAll, () => 0);
  const nodesAll = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  serviceAll.attach(nodesAll, { inputJudging: () => true, inputSelection: () => 'all' }, SAMPLE_RATE);
  deliverBlocks(nodesAll.inputTap, constant(-12, 8), (db) => [-120, db]);
  assert.deepEqual(warningCalls(sinkAll), []);
});

check('세션이 끝나면(detach) 판정이 비워지고 sink 가 reset 되며, 다음 세션은 처음부터 센다', () => {
  const sink = makeSink();
  const service = new MonitorService(sink, () => 0);
  const nodes = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  service.attach(nodes, { inputJudging: () => true }, SAMPLE_RATE);
  deliverBlocks(nodes.inputTap, constant(-45, 8));
  assert.deepEqual(warningCalls(sink), ['low']);
  service.detach();
  assert.equal(sink.calls.at(-1)[0], 'reset');
  const next = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  service.attach(next, { inputJudging: () => true }, SAMPLE_RATE);
  deliverBlocks(next.inputTap, constant(-45, 2));
  assert.deepEqual(warningCalls(sink), ['low'], '새 세션의 처음 2초에는 새 경고가 없다(1초 버림 + 3초 창)');
  deliverBlocks(next.inputTap, constant(-45, 6), (db) => [db], Math.round(2 / BLOCK_SECONDS));
  assert.deepEqual(warningCalls(sink), ['low', 'low']);
});

check('detach 가 판정기를 직접 비운다: 새 세션의 시계가 옛 세션이 끝난 시각 뒤에서 시작해도 옛 상태를 이어받지 않는다', () => {
  // 컨텍스트를 새로 만들면 오디오 시계는 보통 0 에서 다시 시작해서 판정기의 '시계가 거꾸로 가면 처음부터' 규칙이 우연히 같은 일을 한다.
  // 그 규칙에 기대지 않고 detach 의 초기화가 제 몫을 하는지 보려고, 새 세션의 첫 보고를 옛 세션의 마지막 보고보다 뒤로 둔다.
  const sink = makeSink();
  const service = new MonitorService(sink, () => 0);
  const nodes = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  service.attach(nodes, { inputJudging: () => true }, SAMPLE_RATE);
  deliverBlocks(nodes.inputTap, constant(-45, 8));
  assert.deepEqual(warningCalls(sink), ['low']);
  service.detach();
  const next = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  service.attach(next, { inputJudging: () => true }, SAMPLE_RATE);
  deliverBlocks(next.inputTap, constant(-45, 2), (db) => [db], Math.round(8 / BLOCK_SECONDS));
  assert.deepEqual(warningCalls(sink), ['low'], '새 세션의 처음 2초에는 옛 \'작음\' 이 남아 있지도, 새 경고가 뜨지도 않는다');
});

check('판정은 오디오 시계(frame / sampleRate)로 한다: 서비스의 벽시계(now)가 멈춰 있어도 시간이 흐른다', () => {
  const sink = makeSink();
  const service = new MonitorService(sink, () => 123456);
  const nodes = { inputTap: makeNode(), outputTap: makeNode(), guard: makeNode(), limiter: makeNode() };
  service.attach(nodes, { inputJudging: () => true }, 44100);
  // 44.1 kHz 컨텍스트: 프레임 수를 44100 으로 나눠 센다
  const frames = Math.round(44100 / 30);
  for (let i = 1; i <= 30 * 8; i += 1) nodes.inputTap.port.onmessage({ data: levelMessage([-120], i * frames) });
  assert.deepEqual(warningCalls(sink), ['silent']);
});

// ---------------------------------------------------------------------------------------------
// 5. 저장소·화면 소스
// ---------------------------------------------------------------------------------------------
console.log('5. monitorStore·화면: 판정은 한 곳, 화면은 읽기만');
check('monitorStore: inputWarning 의 처음 값은 null 이고, 바뀐 값은 sink 로 들어가며, reset 이 비운다', () => {
  assert.equal(useMonitorStore.getState().inputWarning, null);
  monitorSink.setInputWarning('high');
  assert.equal(useMonitorStore.getState().inputWarning, 'high');
  monitorSink.reset();
  assert.equal(useMonitorStore.getState().inputWarning, null);
});

check('문구는 설계서 4.12 표의 글자 그대로이고, E-09 가 찾는 짧은 말(작습니다·너무 큽니다·신호가 없습니다)을 담는다', () => {
  const ko = read('src/i18n/ko.ts');
  const phrases = {
    silent: '입력 신호가 없습니다. 케이블과 입력 채널(1번/2번)을 확인하세요.',
    low: '입력이 작습니다. 인터페이스 게인이나 입력 트림을 올리세요.',
    high: '입력이 너무 큽니다. 인터페이스 게인을 낮추세요.',
  };
  for (const [kind, text] of Object.entries(phrases)) assert.ok(ko.includes(`${kind}: '${text}'`), `${kind} 문구`);
  assert.ok(phrases.low.includes('작습니다') && phrases.high.includes('너무 큽니다') && phrases.silent.includes('신호가 없습니다'));
});

check('입력 패널은 옛 순간값 판정(inputLevel.peakDb·클리핑·0dBFS 문구)을 더 이상 갖지 않고, 공용 안내(InputLevelNotice)를 보인다', () => {
  const panel = read('src/components/ConnectGuitarPanel.tsx');
  for (const gone of ['inputLevel', 'peakDb', 'isClipping', '입력이 너무 작습니다', '0dBFS에 근접', '클리핑 발생']) {
    assert.ok(!panel.includes(gone), `ConnectGuitarPanel.tsx 에 '${gone}' 가 남아 있음`);
  }
  assert.ok(panel.includes('<InputLevelNotice />'));
});

check('미터 패널도 같은 안내를 보이고, 입력 쪽 \'클리핑 발생\' 표시는 판정된 \'큼\'을 따른다', () => {
  const meter = read('src/components/Meter.tsx');
  assert.ok(meter.includes('<InputLevelNotice />'));
  assert.ok(meter.includes("useMonitorStore.getState().inputWarning === 'high'"));
  assert.ok(!meter.includes('inputLevel.isClipping'), '입력 막대의 순간 클립으로 헤드룸 표시를 정하지 않는다');
});

check('InputLevelNotice 는 monitorStore.inputWarning 만 읽고 ko 문구를 쓴다. \'큼\' 은 role=alert, 나머지는 status', () => {
  const notice = read('src/components/InputLevelNotice.tsx');
  assert.ok(notice.includes('useMonitorStore((state) => state.inputWarning)'));
  assert.ok(notice.includes('ko.level.silent') && notice.includes('ko.level.low') && notice.includes('ko.level.high'));
  assert.ok(notice.includes("role: 'alert'") && notice.includes("role: 'status'"));
  assert.ok(notice.includes('data-level-warning={warning}'));
  assert.ok(!notice.includes('useAudioStore'), '판정 결과는 audioStore 의 30 Hz 사본이 아니라 monitorStore 에서 읽는다');
});

check('AudioEngine 은 장치(마이크) 입력일 때만 판정하게 한다', () => {
  const engine = read('src/audio/AudioEngine.ts');
  assert.ok(engine.includes('inputJudging: () => this.stream !== null'));
  assert.ok(engine.includes('setInputWarning: () => undefined'), 'NOOP sink 도 새 메서드를 가진다');
});

check('판정기는 화면·시계 API 에 기대지 않는다(순수 계산)', () => {
  const source = read('src/audio/monitor/levelWarning.ts');
  for (const banned of ['document', 'window', 'performance.', 'Date.now', 'setTimeout', 'requestAnimationFrame', "from 'react'", 'zustand']) {
    assert.ok(!source.includes(banned), `levelWarning.ts 에 '${banned}' 가 있음`);
  }
});

console.log(`\n입력 레벨 경고 시험 ${checks}개 통과`);
