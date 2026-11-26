// S5.3 실행 취소 때 소리에 클릭이 없는가 — 체인 재구성 페이드와 프리셋 음량 보정 램프(설계서 S5.3 수용 기준: 되돌릴 때 오디오 클릭이 없다).
//
// 왜 필요한가: 순서 바꾸기·켜고 끄기·프리셋 불러오기와 그 실행 취소는 체인 연결을 바꾸는데, 연결을 바꾸는 동안 마스터 게인을 8 ms 에 걸쳐
// 0 으로 내렸다 올린다. 이 페이드가 `rampParam`(cancelAndHoldAtTime 뒤 선형 램프)이면 실제 Chrome 에서 8 ms 를 기다리지 않고 한 표본에
// 목표로 건너뛴다(REFACTOR_LOG L-222 의 F-5 와 같은 원인). 내릴 때 한 번, 올릴 때 한 번 클릭이 난다. 프리셋 음량 보정(trim)의 30 ms 램프도 같다.
// 그래서 둘 다 `fadeParam`(지금 값을 읽어 못 박은 뒤 램프)으로 바꿨다. 이 시험이 그것을 지킨다.
//
// 검사 두 가지:
//   1. (가짜 오디오) 진짜 AudioEngine 이 연결이 바뀔 때만 마스터 게인을 `fadeParam` 꼴로 내렸다 올리고(취소 → 현재 값 못 박기 → 직선 램프,
//      cancelAndHoldAtTime 없음), 값만 바뀔 때는 마스터 게인을 건드리지 않는다. trim 도 같은 꼴이다.
//   2. (실제 Chrome) 같은 순서를 OfflineAudioContext 에서 렌더해 220 Hz 사인의 표본 간 변화가 신호 자체의 기울기를 넘지 않는지 잰다.
//      측정 도구가 클릭을 알아보는지 보려고 값을 바로 대입하는 대조(한 표본에 건너뜀)도 함께 재서 크게 나와야 한다.
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
const close = (actual, expected, message, tolerance = 1e-9) => ok(Math.abs(actual - expected) <= tolerance, `${message} (실제 ${actual}, 기대 ${expected})`);

const srcDir = fileURLToPath(new URL('../src', import.meta.url));
const wah = (id, overrides = {}) => ({
  id, type: 'autoWah', name: id, active: true, color: '#6fa83f',
  params: { mix: 100, level: 100, sensitivity: 55, range: 60, resonance: 45, mode: 'auto', manual: 50, ...overrides },
});
const writes = (param) => param.automation.filter((entry) => entry.kind !== 'cancel' && entry.kind !== 'hold');
const kinds = (param) => param.automation.map((entry) => entry.kind);

// ── 1. 엔진이 fadeParam 꼴로 예약한다(가짜 오디오) ───────────────────────────────────────────
{
  const h = await createEngineHarness({ extraExports: ["{ PRESET_TRIM_RAMP_SECONDS } from './audio/offline/loudnessSpec.ts'"] });
  try {
    const { engine, context, fake, exports } = h;
    let pedals = [wah('wah-1'), wah('wah-2')];
    engine.setPedalsProvider(() => pedals);
    engine.setPresetTrimProvider(() => 0);
    engine.createProcessingGraph(new fake.classes.GainNode(context));
    engine.rebuildChain();
    await engine.rebuildQueue;
    const master = engine.outputStage.input.gain;
    const trim = engine.outputStage.presetTrim.gain;
    engine.setMasterVolume(0.6);
    const directMaster = master.directAssignments;
    const directTrim = trim.directAssignments;

    // 순서만 바꾼다 → 연결이 바뀌므로 마스터 게인이 내려갔다 올라온다.
    const structural = async (label, change) => {
      master.automation.length = 0;
      context.currentTime += 1;
      const now = context.currentTime;
      pedals = change(pedals);
      engine.rebuildChain();
      await engine.rebuildQueue;
      const log = master.automation;
      equal(kinds(master).join(','), 'cancel,set,linear,cancel,set,linear', `${label}: 내릴 때와 올릴 때 각각 취소 → 현재 값 못 박기 → 직선 램프`);
      ok(!kinds(master).includes('hold'), `${label}: cancelAndHoldAtTime 을 쓰지 않는다(Chrome 에서 계단이 된다)`);
      close(log[1].value, 0.6, `${label}: 내리는 램프는 지금 값(0.6)에서 출발한다`);
      close(log[2].value, 0, `${label}: 0 으로 내린다`);
      close(log[2].time, now + 0.008, `${label}: 8 ms 에 걸쳐 내린다`);
      close(log[4].value, 0, `${label}: 올리는 램프는 0 에서 출발한다`);
      close(log[5].value, 0.6, `${label}: 사용자가 정한 마스터 볼륨(0.6)으로 올라온다`);
      close(log[5].time, now + 0.008, `${label}: 8 ms 에 걸쳐 올린다`);
      equal(master.directAssignments, directMaster, `${label}: .value 를 직접 쓰지 않는다`);
    };
    await structural('순서 바꾸기', (list) => [list[1], list[0]]);
    await structural('순서 되돌리기(실행 취소)', (list) => [list[1], list[0]]);

    // 연결이 그대로면 마스터 게인은 건드리지 않는다: 노브 값 되돌리기, 켜고 끄기(우회는 이펙터 안에서 처리한다)에는 체인 페이드가 없다.
    const untouched = async (label, change) => {
      master.automation.length = 0;
      pedals = change(pedals);
      engine.rebuildChain();
      await engine.rebuildQueue;
      equal(master.automation.length, 0, `${label}: 마스터 게인을 건드리지 않는다`);
    };
    await untouched('노브 값만 바뀜', (list) => list.map((pedal, index) => (index === 0 ? { ...pedal, params: { ...pedal.params, sensitivity: 80 } } : pedal)));
    await untouched('끄기(우회)', (list) => list.map((pedal, index) => (index === 0 ? { ...pedal, active: false } : pedal)));
    await untouched('다시 켜기', (list) => list.map((pedal) => ({ ...pedal, active: true })));

    // 프리셋 음량 보정: 취소 → 현재 값 → 직선 램프(30 ms), 직접 대입 없음, 허용 범위로 자른다.
    trim.automation.length = 0;
    context.currentTime = 10;
    engine.setPresetTrimDb(-6);
    equal(kinds(trim).join(','), 'cancel,set,linear', 'trim: 취소 → 현재 값 못 박기 → 직선 램프');
    close(trim.automation[1].value, 1, 'trim: 지금 값(0 dB = 1)에서 출발한다');
    close(trim.automation[2].value, 10 ** (-6 / 20), 'trim: −6 dB 로 간다');
    close(trim.automation[2].time, 10 + exports.PRESET_TRIM_RAMP_SECONDS, 'trim: 30 ms 램프');
    // 램프 도중에 또 바뀌면 그때 값에서 이어 간다(되돌리기를 연달아 눌러도 끊기지 않는다).
    context.currentTime = 10.015;
    engine.setPresetTrimDb(3);
    close(trim.automation.at(-2).value, 10 ** (-6 / 20), 'trim: 도중에 또 바꾸면 그때 값에서 이어 간다');
    equal(trim.directAssignments, directTrim, 'trim: .value 를 직접 쓰지 않는다');
    ok(!kinds(trim).includes('hold'), 'trim: cancelAndHoldAtTime 을 쓰지 않는다');
    ok(writes(trim).every((entry) => entry.kind === 'set' || entry.kind === 'linear'), 'trim: 예약은 set 과 linear 뿐');
  } finally {
    h.restore();
  }
}

// ── 2. 실제 Chrome 에서 클릭이 없다 ───────────────────────────────────────────────────────────
const chromePath = await requireChrome('Chain fade regression');
if (!chromePath) {
  console.warn('체인 페이드 실제 Chrome 검사 건너뜀: Chrome 또는 WebSocket 을 쓸 수 없습니다. CHROME_PATH 를 지정하세요.');
} else {
  const bundle = await build({
    stdin: { contents: "export { fadeParam, rampParam, smoothVolume } from './audio/utils/smoothing.ts';", resolveDir: srcDir, sourcefile: 'chain-fade-entry.ts' },
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
    const frequency = 220;
    // 사인이 거의 꼭대기인 자리(위상 0.293 바퀴)에서 바꿔야 계단이 크게 드러난다. 영점 근처에서 끊으면 계단이 작아 보인다.
    const first = 38 * quantum;
    // 앱의 체인 페이드와 같다: 내리고, 12 ms 남짓 기다렸다가(여기서는 5 퀀텀 = 13.3 ms) 올린다.
    const gap = 5 * quantum;
    async function render(steps, startGain, options = {}) {
      const context = new OfflineAudioContext(1, sampleRate, sampleRate);
      const oscillator = context.createOscillator();
      oscillator.frequency.value = frequency;
      const gain = context.createGain();
      gain.gain.value = startGain;
      oscillator.connect(gain).connect(context.destination);
      oscillator.start();
      for (const [frame, action] of steps) {
        context.suspend(frame / sampleRate).then(() => { action(gain.gain, context); context.resume(); });
      }
      const data = (await context.startRendering()).getChannelData(0);
      let maxStep = 0;
      let at = 0;
      for (let i = 1; i < data.length; i += 1) {
        const step = Math.abs(data[i] - data[i - 1]);
        if (step > maxStep) { maxStep = step; at = i; }
      }
      const peak = (from, to) => { let m = 0; for (let i = from; i < to; i += 1) m = Math.max(m, Math.abs(data[i])); return m; };
      return { maxStep, atMs: at / 48, peak, length: data.length };
    }
    const S = Smoothing;
    const chain = (fade) => (target) => [
      [first, (param, context) => fade(param, 0, context, 0.008)],
      [first + gap, (param, context) => fade(param, target, context, 0.008)],
    ];
    const out = { userAgent: navigator.userAgent, natural: 2 * Math.PI * frequency / sampleRate };
    // 체인 페이드 — 볼륨 1 에서, 그리고 볼륨 CC 가 오다가(setTargetAtTime 진행 중) 막 끝난 0.6 에서
    const fadeChain = await render(chain(S.fadeParam)(1), 1);
    out.chain = { maxStep: fadeChain.maxStep, atMs: fadeChain.atMs, floor: fadeChain.peak(first + 4 * quantum, first + gap), end: fadeChain.peak(24000, 48000) };
    const midVolume = [[first - 6 * quantum, (param, context) => S.smoothVolume(param, 0.6, context)], ...chain(S.fadeParam)(0.6)];
    const fadeMid = await render(midVolume, 1);
    out.chainMid = { maxStep: fadeMid.maxStep, atMs: fadeMid.atMs, end: fadeMid.peak(24000, 48000) };
    // 같은 일을 옛 방식(rampParam)으로 — 참고용. Chrome 이 고치면 이 수치는 작아진다.
    const oldChain = await render(chain((param, value, context, duration) => S.rampParam(param, value, context, duration))(1), 1);
    out.oldChain = { maxStep: oldChain.maxStep };
    // 대조: 값을 바로 대입하면(한 표본에 0) 측정이 크게 나와야 한다.
    const hard = await render([[first, (param) => { param.value = 0; }]], 1);
    out.hard = { maxStep: hard.maxStep };
    // 프리셋 음량 보정: 1 → 0.5 를 30 ms 로, 15 ms 지났을 때 다시 0.8 로(되돌리기를 연달아 누른 경우)
    const trim = await render([
      [first, (param, context) => S.fadeParam(param, 0.5, context, 0.03)],
      [first + 5 * quantum, (param, context) => S.fadeParam(param, 0.8, context, 0.03)],
    ], 1);
    out.trim = { maxStep: trim.maxStep, atMs: trim.atMs, end: trim.peak(24000, 48000) };
    const oldTrim = await render([[first, (param, context) => S.rampParam(param, 0.5, context, 0.03)]], 1);
    out.oldTrim = { maxStep: oldTrim.maxStep };
    return out;
  })()`;

  const browser = await startChrome({ chromePath, profilePrefix: 'guitar-pedalboard-chainfade-', quiet: true });
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
    console.log(`체인 페이드 — ${agentStart < 0 ? 'Chrome' : m.userAgent.slice(agentStart).split(' ')[0]} (220 Hz 사인, 신호 자체의 표본 간 최대 기울기 ${m.natural.toFixed(4)})`);
    console.log(`  fadeParam 체인 페이드(볼륨 1): 표본 간 최대 변화 ${m.chain.maxStep.toFixed(4)}, 내려간 바닥 ${m.chain.floor.toFixed(4)}, 올라온 뒤 ${m.chain.end.toFixed(3)}`);
    console.log(`  fadeParam 체인 페이드(볼륨 CC 직후 0.6): ${m.chainMid.maxStep.toFixed(4)}, 올라온 뒤 ${m.chainMid.end.toFixed(3)}`);
    console.log(`  fadeParam trim 1 → 0.5 → 0.8: ${m.trim.maxStep.toFixed(4)}, 끝 ${m.trim.end.toFixed(3)}`);
    console.log(`  (참고) 옛 rampParam 체인 페이드: ${m.oldChain.maxStep.toFixed(4)}, 옛 trim: ${m.oldTrim.maxStep.toFixed(4)}`);
    console.log(`  (대조) 값을 바로 대입: ${m.hard.maxStep.toFixed(4)}`);

    // 클릭의 기준: 신호 자체가 한 표본에 움직이는 최대치(0.0288)의 1.2 배. 계단은 이것의 수십 배다.
    const limit = m.natural * 1.2;
    ok(m.hard.maxStep > 0.5, `측정이 클릭을 알아보지 못합니다(바로 대입이 ${m.hard.maxStep} 로만 잡힘)`);
    ok(m.chain.maxStep <= limit, `체인 페이드의 표본 간 변화 ${m.chain.maxStep} 가 신호 기울기 ${m.natural} 를 넘었습니다(클릭)`);
    ok(m.chainMid.maxStep <= limit, `볼륨 CC 직후 체인 페이드의 표본 간 변화 ${m.chainMid.maxStep} 가 큽니다(클릭)`);
    ok(m.trim.maxStep <= limit, `trim 램프의 표본 간 변화 ${m.trim.maxStep} 가 큽니다(클릭)`);
    // 페이드가 실제로 내려갔다 올라온다(아무것도 안 해서 통과하는 것을 막는다).
    ok(m.chain.floor < 0.02, `체인 페이드가 0 까지 내려가지 않았습니다(바닥 ${m.chain.floor})`);
    ok(Math.abs(m.chain.end - 1) < 0.02, `체인 페이드 뒤 소리가 원래대로 돌아오지 않았습니다(${m.chain.end})`);
    ok(Math.abs(m.chainMid.end - 0.6) < 0.02, `볼륨 CC 직후 체인 페이드 뒤 소리가 0.6 으로 돌아오지 않았습니다(${m.chainMid.end})`);
    ok(Math.abs(m.trim.end - 0.8) < 0.02, `trim 이 마지막 목표 0.8 에 닿지 않았습니다(${m.trim.end})`);
  } finally {
    await browser.close();
  }
}

console.log(`Chain fade regression passed: ${checks} checks (chain fade and preset trim use fadeParam; real-Chrome sine has no click).`);
