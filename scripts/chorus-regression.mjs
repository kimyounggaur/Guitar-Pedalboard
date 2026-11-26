import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';
import { installFakeAudio } from './lib/fake-audio.mjs';

// ---------------------------------------------------------------------------------------------
// LFO 는 지금 보이스 수만큼만 돈다(S4.2): 가짜 노드로 만들어진 오실레이터를 센다.
// ---------------------------------------------------------------------------------------------
{
  // 진짜 ChorusEffect 를 가짜 오디오 노드 위에서 돌린다(S4.7: 소스 글자 검사 대신 노드 그래프와 파라미터 기록을 본다).
  const fake = installFakeAudio();
  const context = fake.createContext({ currentTime: 2 });
  const oscillators = () => fake.created('OscillatorNode');

  const harness = await build({
    stdin: {
      contents: "export { ChorusEffect, CHORUS_VOICE_BANK_SIZE } from './audio/nodes/ChorusEffect.ts';\nexport { initialPedals } from './presets/initialPedals.ts';",
      resolveDir: fileURLToPath(new URL('../src', import.meta.url)),
      sourcefile: 'chorus-lfo-harness.ts',
    },
    bundle: true, format: 'esm', platform: 'node', target: 'node20', write: false,
  });
  const { ChorusEffect, CHORUS_VOICE_BANK_SIZE, initialPedals } = await import(`data:text/javascript;base64,${Buffer.from(harness.outputFiles[0].text).toString('base64')}`);
  const base = initialPedals.find((candidate) => candidate.id === 'chorus');
  assert.ok(base, '기본 Chorus 페달');
  const pedalWith = (overrides) => ({ ...JSON.parse(JSON.stringify(base)), params: { ...JSON.parse(JSON.stringify(base)).params, ...overrides } });

  const reset = () => { fake.registry.nodes.length = 0; };
  const lastWriteKinds = (param) => param.automation.map((entry) => entry.kind);

  // 고정 부분: 보이스 4개 틀(입력 → 지연 → 패너 → 게인 → 합 → 톤 필터 → 출력)이 항상 놓이고, 지금 보이스 수만큼만 소리가 난다.
  assert.equal(CHORUS_VOICE_BANK_SIZE, 4);
  {
    reset();
    const effect = new ChorusEffect(context, pedalWith({ voices: 4, depth: 100, spread: 60, tone: 60, rate: 0.8 }));
    assert.equal(effect.voices.length, CHORUS_VOICE_BANK_SIZE, '보이스 틀은 항상 4개');
    assert.equal(fake.created('DelayNode').length, CHORUS_VOICE_BANK_SIZE);
    for (const [index, voice] of effect.voices.entries()) {
      assert.ok(effect.effectInput.connectsTo(voice.delay), `입력 → 지연 ${index}`);
      assert.ok(voice.delay.connectsTo(voice.panner), `지연 → 패너 ${index}`);
      assert.ok(voice.panner.connectsTo(voice.gain), `패너 → 게인 ${index}`);
      assert.ok(voice.gain.connectsTo(effect.voiceSum), `게인 → 합 ${index}`);
    }
    assert.ok(effect.voiceSum.connectsTo(effect.tone), '합 → 톤 필터');
    assert.ok(effect.tone.connectsTo(effect.effectOutput), '톤 필터 → 출력');
    // 지연 시간은 12 ms ~ 28 ms 에 고르게 놓인다(보이스 4개).
    const delays = effect.voices.map((voice) => voice.delay.delayTime.value);
    for (const [index, delay] of delays.entries()) {
      assert.ok(Math.abs(delay - (0.012 + (index / 3) * 0.016)) < 1e-12, `보이스 ${index} 지연 ${delay}`);
    }
    // 변조 깊이: 노브 100 % 에서 4 ms, 45 % 에서 1.8 ms, 0 % 에서 0 (LFO 는 이 값만큼 지연 시간을 흔든다).
    assert.ok(effect.lfos.every((lfo) => Math.abs(lfo.depth.gain.value - 0.004) < 1e-12), '깊이 100 % 는 4 ms');
    effect.update(pedalWith({ voices: 4, depth: 45 }));
    assert.ok(effect.lfos.every((lfo) => Math.abs(lfo.depth.gain.value - 0.0018) < 1e-12), '깊이 45 % 는 1.8 ms');
    effect.update(pedalWith({ voices: 4, depth: 0 }));
    assert.ok(effect.lfos.every((lfo) => lfo.depth.gain.value === 0), '깊이 0 % 는 변조 없음');
    effect.update(pedalWith({ voices: 4, depth: 100 }));
    // LFO 는 보이스마다 하나씩 그 보이스의 지연 시간 파라미터를 흔들고, 위상은 보이스끼리 고르게 어긋난다.
    for (const lfo of effect.lfos) {
      assert.ok(lfo.oscillator.connectsTo(lfo.depth), 'LFO → 깊이 게인');
      assert.ok(lfo.depth.connectsTo(effect.voices[lfo.voiceIndex].delay.delayTime), '깊이 게인 → 그 보이스의 지연 시간');
      const phase = (Math.PI * 2 * lfo.voiceIndex) / 4;
      assert.ok(Math.abs(lfo.oscillator.periodicWave.real[1] - Math.sin(phase)) < 1e-6, `LFO ${lfo.voiceIndex} 위상(sin)`);
      assert.ok(Math.abs(lfo.oscillator.periodicWave.imag[1] - Math.cos(phase)) < 1e-6, `LFO ${lfo.voiceIndex} 위상(cos)`);
    }
    // 파라미터는 `.value =` 로 곧바로 쓰지 않는다. 직접 대입은 BaseEffect 가 연결 전에 초기값을 놓을 때 4개뿐이고,
    // 이 이펙터의 파라미터는 모두 setTargetAtTime(smoothParam)으로만 움직인다(setValueAtTime·선형 램프를 쓰면 클릭이 난다).
    assert.equal(fake.directAssignments(), 4, 'BaseEffect 초기값 4개 말고 직접 대입이 있다');
    const own = [
      ...effect.voices.flatMap((voice) => [voice.delay.delayTime, voice.panner.pan, voice.gain.gain]),
      effect.tone.frequency,
      ...effect.lfos.flatMap((lfo) => [lfo.oscillator.frequency, lfo.depth.gain]),
    ];
    for (const param of own) {
      assert.ok(lastWriteKinds(param).every((kind) => kind === 'target' || kind === 'cancel'), `${param.name}: smoothParam 말고 다른 예약을 썼다 (${lastWriteKinds(param)})`);
      assert.equal(param.automation.at(-1).kind, 'target', `${param.name}: 마지막 쓰기는 setTargetAtTime`);
    }
    // update 가 같은 보이스 수에서는 노드를 새로 만들지 않는다.
    const before = fake.nodeCount;
    effect.update(pedalWith({ voices: 4, rate: 3, tone: 20, spread: 0, mix: 10 }));
    assert.equal(fake.nodeCount, before, 'update 중 오디오 노드를 새로 만들었다');
    effect.dispose();
    // dispose 는 한 번만 일하고, 보이스·LFO 를 모두 끊는다.
    const disconnectCalls = fake.created().map((node) => node.disconnectCalls);
    effect.dispose();
    assert.deepEqual(fake.created().map((node) => node.disconnectCalls), disconnectCalls, '두 번째 dispose 가 노드를 또 끊었다');
    for (const voice of effect.voices) {
      assert.ok(voice.delay.disconnectedAll && voice.panner.disconnectedAll && voice.gain.disconnectedAll, '보이스 노드를 끊는다');
    }
    assert.ok(effect.lfos.every((lfo) => lfo.depth.disconnectedAll && lfo.oscillator.disconnectedAll), 'LFO 를 끊는다');
    assert.ok(effect.voiceSum.disconnectedAll && effect.tone.disconnectedAll);
  }

  // 처음부터 보이스 수만큼만 만든다(예전에는 항상 아홉 개).
  for (const voices of [2, 3, 4]) {
    reset();
    const effect = new ChorusEffect(context, pedalWith({ voices }));
    assert.equal(oscillators().length, voices, `보이스 ${voices}: 오실레이터 ${voices}개만 만든다`);
    assert.ok(oscillators().every((oscillator) => oscillator.started), '만든 것은 모두 시작한다');
    assert.equal(effect.lfos.length, voices);
    effect.dispose();
  }

  reset();
  const effect = new ChorusEffect(context, pedalWith({ voices: 3, rate: 5 }));
  assert.equal(oscillators().length, 3);
  assert.ok(oscillators().every((oscillator) => oscillator.options.frequency === 0.8), '처음 만들 때는 옛 구현처럼 기본 속도(0.8 Hz)로 시작해 update 가 옮긴다');
  assert.ok(effect.lfos.every((lfo) => lfo.oscillator.frequency.value === 5), 'update 가 정한 속도로 옮겼다');
  const firstSet = [...oscillators()];
  effect.update(pedalWith({ voices: 3, rate: 6, depth: 70 }));
  assert.equal(oscillators().length, 3, '보이스 수가 같으면 다른 노브를 돌려도 노드를 만들지 않는다');

  // 보이스 수를 바꾸면 새 묶음을 만들고 옛 묶음은 깊이를 0 으로 내린 뒤 끈다.
  effect.update(pedalWith({ voices: 4, rate: 6, depth: 70 }));
  assert.equal(oscillators().length, 7, '새 묶음 4개가 더해진다');
  const secondSet = oscillators().slice(3);
  assert.ok(secondSet.every((oscillator) => oscillator.options.frequency === 6), '새 묶음은 지금 속도로 시작한다');
  assert.equal(effect.lfos.length, 4);
  assert.equal(effect.retiring.size, 3, '옛 묶음 3개가 물러나는 중이다');
  for (const oscillator of firstSet) {
    assert.deepEqual(oscillator.stopTimes, [2.1], '옛 묶음은 0.1초 뒤에 끈다');
    assert.equal(typeof oscillator.onended, 'function');
  }
  assert.ok(secondSet.every((oscillator) => oscillator.stopTimes.length === 0), '새 묶음은 끄지 않는다');
  // 깊이 게이트: 옛 것은 0 으로, 새 것은 깊이로
  const depthOf = (oscillator) => oscillator.edges[0].node;
  assert.ok(firstSet.every((oscillator) => depthOf(oscillator).gain.value === 0), '옛 묶음의 깊이는 0 으로 내린다');
  assert.ok(secondSet.every((oscillator) => depthOf(oscillator).gain.value > 0), '새 묶음의 깊이는 올린다');
  // 끝났다는 알림이 오면 연결을 정리한다
  firstSet.forEach((oscillator) => oscillator.onended());
  assert.equal(effect.retiring.size, 0, '끝난 묶음은 목록에서 빠진다');
  assert.ok(firstSet.every((oscillator) => oscillator.disconnectedAll), '끝난 오실레이터는 연결을 끊는다');

  // 정리하면 지금 묶음과 물러나는 묶음을 모두 끈다
  effect.update(pedalWith({ voices: 2 }));
  assert.equal(effect.lfos.length, 2);
  assert.equal(effect.retiring.size, 4);
  const everything = [...oscillators()];
  effect.dispose();
  assert.equal(effect.retiring.size, 0);
  const current = everything.slice(-2);
  assert.ok(current.every((oscillator) => oscillator.stopTimes.includes('now') && oscillator.disconnectedAll), '정리하면 지금 묶음을 바로 끈다');
  assert.ok(secondSet.every((oscillator) => oscillator.stopTimes.includes('now') && oscillator.disconnectedAll), '물러나는 중이던 묶음도 정리한다');
  assert.ok([...secondSet, ...current].every((oscillator) => oscillator.onended === null), '정리한 뒤에는 알림이 없다');
  fake.restore();
}

const migrationBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [
    fileURLToPath(new URL('../src/store/__migration_check.ts', import.meta.url)),
  ],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const migrationCode = migrationBundle.outputFiles[0].text;
const migrationUrl = `data:text/javascript;base64,${Buffer.from(migrationCode).toString('base64')}`;
const { runMigrationChecks } = await import(migrationUrl);
runMigrationChecks();

console.log('Chorus regression passed: schema v5, bounds/NaN, fixed voice bank, LFOs follow the voice count, smoothing and lifecycle.');
