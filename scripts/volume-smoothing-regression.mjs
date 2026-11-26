// S5.2 마스터 볼륨 스무딩 — MIDI 볼륨 CC 와 슬라이더가 지퍼 잡음 없이 움직이는지 본다(설계서 S5.2: 값 스무딩 20 ms, 지퍼 잡음 없음).
//
// 왜 필요한가: 예전 `setMasterVolume` 은 `rampParam`(cancelAndHoldAtTime 뒤 linearRamp)을 썼는데, Chrome 157 의 실제 렌더에서 이 방식은
// 20 ms 램프가 아니라 한 표본 만에 거의 목표로 건너뛰는 계단이었다(1 → 0.2 로 바꾸면 첫 표본 차 0.67, REFACTOR_LOG L-222 의 F-5 와 같은 원인).
// CC 는 초당 100개 넘게 오므로 계단이 연달아 생기면 지퍼 잡음이 된다. 그래서 `smoothVolume`(setTargetAtTime)으로 바꿨다.
//
// 검사 두 가지:
//   1. (가짜 오디오) 진짜 AudioEngine 의 setMasterVolume 이 smoothVolume 으로 예약한다 — 램프(linear)·직접 대입 없이 setTargetAtTime 만,
//      시간 상수는 20 ms / 4, 범위는 0~1 로 자른다. 연달아 128번 불러도 같다.
//   2. (실제 Chrome) smoothVolume 을 OfflineAudioContext 에서 렌더 중간에(suspend) 불러 출력의 표본 간 변화를 잰다.
//      한 번 크게 바꿀 때·CC 0~127 전 범위를 8 ms 간격으로 쓸 때 모두 표본 간 변화가 작고, 되돌아가거나 넘치지 않고, 목표에 닿는다.
// Chrome 이 없으면 2 는 건너뛴다(CI 에서는 실패 — scripts/lib/chrome.mjs 의 requireChrome).
import assert from 'node:assert/strict';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { requireChrome, startChrome } from './lib/chrome.mjs';
import { createEngineHarness } from './lib/engine-harness.mjs';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const equal = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

// ── 1. 엔진이 smoothVolume 으로 예약한다(가짜 오디오) ──────────────────────────────────────────
{
  const h = await createEngineHarness({ extraExports: ["{ VOLUME_SMOOTHING_SECONDS } from './audio/utils/smoothing.ts'"] });
  try {
    const { engine, context, exports } = h;
    // 마스터 게인은 출력 단계(outputStage)의 입력 노드다. 그 자리에 가짜 게인을 둔다.
    engine.outputStage = { input: context.createGain() };
    const gain = engine.outputStage.input.gain;
    const timeConstant = exports.VOLUME_SMOOTHING_SECONDS / 4;
    equal(exports.VOLUME_SMOOTHING_SECONDS, 0.02, '설계서의 스무딩 20 ms');

    const writes = () => gain.automation.filter((entry) => entry.kind !== 'cancel' && entry.kind !== 'hold');
    engine.setMasterVolume(0.4);
    equal(writes().length, 1, '한 번 부르면 예약 한 번');
    equal(writes()[0].kind, 'target', 'setTargetAtTime 으로 예약한다(램프가 아니다)');
    equal(writes()[0].value, 0.4);
    equal(writes()[0].timeConstant, timeConstant, '시간 상수는 20 ms / 4');
    equal(gain.directAssignments, 0, '.value 를 직접 쓰지 않는다');
    ok(gain.automation.some((entry) => entry.kind === 'cancel'), '앞선 예약을 먼저 지운다');

    engine.setMasterVolume(-3);
    equal(writes().at(-1).value, 0, '0 아래는 0');
    engine.setMasterVolume(7);
    equal(writes().at(-1).value, 1, '1 위는 1');

    gain.automation.length = 0;
    for (let cc = 127; cc >= 0; cc -= 1) engine.setMasterVolume(cc / 127);
    equal(writes().length, 128, 'CC 128개가 모두 예약된다');
    ok(writes().every((entry) => entry.kind === 'target' && entry.timeConstant === timeConstant), '전부 같은 방식의 스무딩');
    equal(writes()[0].value, 1, 'CC 127 은 1');
    equal(writes().at(-1).value, 0, 'CC 0 은 0');
    ok(writes().every((entry, index, all) => index === 0 || entry.value <= all[index - 1].value), '내려갈 때 값이 거꾸로 가지 않는다');

    // 컨텍스트가 없으면(오디오 시작 전) 값만 기억하고 예약하지 않는다.
    const before = gain.automation.length;
    engine.context = null;
    engine.setMasterVolume(0.25);
    equal(gain.automation.length, before, '컨텍스트 없이는 예약하지 않는다');
    equal(engine.masterVolume, 0.25, '값은 기억해 두었다가 시작할 때 쓴다');
  } finally {
    h.restore();
  }
}

// ── 2. 실제 Chrome 에서 계단이 없다 ───────────────────────────────────────────────────────────
const chromePath = await requireChrome('Volume smoothing regression');
if (!chromePath) {
  console.warn('볼륨 스무딩 실제 Chrome 검사 건너뜀: Chrome 또는 WebSocket 을 쓸 수 없습니다. CHROME_PATH 를 지정하세요.');
} else {
  const bundle = await build({
    stdin: { contents: "export { smoothVolume, rampParam, VOLUME_SMOOTHING_SECONDS } from './audio/utils/smoothing.ts';", resolveDir: srcDir, sourcefile: 'volume-smoothing-entry.ts' },
    bundle: true,
    format: 'iife',
    globalName: 'Smoothing',
    platform: 'browser',
    write: false,
    logLevel: 'silent',
  });
  const experiment = `(async () => {
    const sampleRate = 48000;
    const quantum = 128;
    // 상수 1 을 게인에 넣어 출력이 곧 게인 곡선이 되게 하고, 렌더 중간에 멈춰(suspend) 볼륨을 바꾼다. 앱이 실행 중에 부르는 것과 같다.
    async function render(setter, updates, startGain) {
      const context = new OfflineAudioContext(1, 2 * sampleRate, sampleRate);
      const source = context.createConstantSource();
      const gain = context.createGain();
      gain.gain.value = startGain;
      source.connect(gain).connect(context.destination);
      source.start();
      for (const [frame, value] of updates) {
        context.suspend(frame / sampleRate).then(() => { setter(gain.gain, value, context); context.resume(); });
      }
      const data = (await context.startRendering()).getChannelData(0);
      let maxStep = 0;
      for (let i = 1; i < data.length; i += 1) maxStep = Math.max(maxStep, Math.abs(data[i] - data[i - 1]));
      return { data: Array.from(data), maxStep };
    }
    const smooth = (param, value, context) => Smoothing.smoothVolume(param, value, context);
    const ramp = (param, value, context) => Smoothing.rampParam(param, value, context, 0.02);
    const first = 38 * quantum;
    const single = await render(smooth, [[first, 0.2]], 1);
    const control = await render(ramp, [[first, 0.2]], 1);
    // CC 126 → 0 을 3퀀텀(약 8 ms)마다 하나씩(전 범위 내려가기), CC 1 → 127 올라가기도 같게
    const down = await render(smooth, Array.from({ length: 127 }, (_, k) => [first + k * 3 * quantum, (126 - k) / 127]), 1);
    const up = await render(smooth, Array.from({ length: 127 }, (_, k) => [first + k * 3 * quantum, (k + 1) / 127]), 0);
    const at = (run, frame) => run.data[frame];
    const reversals = (run, from, direction) => {
      let count = 0;
      for (let i = from + 1; i < run.data.length; i += 1) if ((run.data[i] - run.data[i - 1]) * direction < -1e-7) count += 1;
      return count;
    };
    return {
      userAgent: navigator.userAgent,
      single: { maxStep: single.maxStep, at2ms: at(single, first + 96), at20ms: at(single, first + 960), final: single.data.at(-1) },
      control: { maxStep: control.maxStep, at2ms: at(control, first + 96) },
      down: { maxStep: down.maxStep, final: down.data.at(-1), reversals: reversals(down, first, -1), max: Math.max(...down.data) },
      up: { maxStep: up.maxStep, final: up.data.at(-1), reversals: reversals(up, first, 1), max: Math.max(...up.data) },
    };
  })()`;

  const browser = await startChrome({ chromePath, profilePrefix: 'guitar-pedalboard-volume-', quiet: true });
  try {
    const { cdp } = browser;
    await cdp.send('Runtime.enable');
    const run = async (expression) => {
      const { result, exceptionDetails } = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
      return result.value;
    };
    await run(bundle.outputFiles[0].text);
    const m = await run(experiment);
    const agentStart = m.userAgent.indexOf('Chrome/');
    console.log(`볼륨 스무딩 — ${agentStart < 0 ? 'Chrome' : m.userAgent.slice(agentStart).split(' ')[0]}`);
    console.log(`  한 번 1 → 0.2: 표본 간 최대 변화 ${m.single.maxStep.toFixed(5)}, 2 ms 뒤 ${m.single.at2ms.toFixed(3)}, 20 ms 뒤 ${m.single.at20ms.toFixed(3)}`);
    console.log(`  (참고) rampParam 으로 같은 일: 표본 간 최대 변화 ${m.control.maxStep.toFixed(5)}, 2 ms 뒤 ${m.control.at2ms.toFixed(3)}`);
    console.log(`  CC 126→0 (8 ms 간격): 최대 변화 ${m.down.maxStep.toFixed(6)}, 끝 ${m.down.final.toFixed(4)}, 거꾸로 간 곳 ${m.down.reversals}`);
    console.log(`  CC 1→127 (8 ms 간격): 최대 변화 ${m.up.maxStep.toFixed(6)}, 끝 ${m.up.final.toFixed(4)}, 거꾸로 간 곳 ${m.up.reversals}`);

    // 한 번 크게 바꿀 때: 한 표본에 바뀌는 양이 변화량(0.8)의 1% 안이고, 2 ms 뒤에는 아직 도중이며, 20 ms 뒤에는 98% 근처다.
    ok(m.single.maxStep <= 0.008, `한 번 바꿀 때 표본 간 변화 ${m.single.maxStep} 가 변화량 0.8 의 1% 를 넘었습니다`);
    ok(m.single.at2ms > 0.7, `2 ms 뒤 값 ${m.single.at2ms}: 거의 다 와 버렸습니다(스무딩이 아니라 계단)`);
    ok(Math.abs(m.single.at20ms - 0.2) <= 0.8 * 0.03, `20 ms 뒤 값 ${m.single.at20ms}: 목표 0.2 의 3% 안이어야 합니다`);
    ok(Math.abs(m.single.final - 0.2) < 1e-4, '끝에는 목표에 닿는다');
    // CC 전 범위를 쓸 때: 한 표본 변화가 아주 작고(CC 한 칸 = 0.0079 의 6% 이내), 거꾸로 가지 않고, 넘치지 않고, 끝에 목표에 닿는다.
    for (const [name, run2, target, limit] of [['내려가기', m.down, 0, 1], ['올라가기', m.up, 1, 1]]) {
      ok(run2.maxStep <= 0.0005, `${name}: 표본 간 변화 ${run2.maxStep} 가 큽니다(지퍼 잡음)`);
      equal(run2.reversals, 0, `${name}: 값이 거꾸로 간 곳`);
      ok(run2.max <= limit + 1e-6, `${name}: 값이 ${limit} 를 넘었습니다(${run2.max})`);
      ok(Math.abs(run2.final - target) < 0.01, `${name}: 끝 값 ${run2.final} 이 목표 ${target} 에 닿지 않았습니다`);
    }
  } finally {
    await browser.close();
  }
}

console.log(`Volume smoothing regression passed: ${checks} checks (engine uses setTargetAtTime smoothing; real-Chrome CC sweep has no steps).`);
