// Crunch 왜곡 곡선의 0점 연속성 시험(S1.1, 보고서 R1-6).
//
// 곡선이 입력 0 에서 계단처럼 뛰면 앞단 증폭이 미세 잡음을 그 계단 위로 올려, 연주하지 않을 때도 큰 잡음이 나오고
// 음이 사라져도 출력이 줄지 않는다. 지금 곡선(createCrunchCurve)은 입력에 곱하는 방식이라 0 에서 이어진다.
// 이 시험은 그 상태를 지키고, 시험이 결함을 실제로 잡는지(수정 전 곡선은 반드시 실패해야 함)도 함께 확인한다.
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { build } from 'esbuild';

async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, platform: 'node', format: 'esm', write: false });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { createCrunchCurve } = await load('src/audio/utils/curves.ts');

/** 앱이 쓰는 기본 표본 수(짝수). 가운데 두 표본이 입력 0 의 양쪽에 놓인다. */
const APP_SAMPLES = 4096;
/** 홀수 표본 수. 가운데(입력 0)가 표본 하나에 정확히 놓여 f(0) 을 직접 볼 수 있다. */
const SAMPLES = 4097;
const MID = (SAMPLES - 1) / 2;
/** 설계서 S1.1 수용 기준: 가운데 인접 표본 차 |y[N/2] − y[N/2 − 1]| < 0.01 */
const JUMP_LIMIT = 0.01;
/** 짝수 배음(비대칭)이 남아 있는지 볼 때의 최소 크기: max |f(x) + f(−x)| */
const MIN_ASYMMETRY = 1e-3;
const GAINS = Array.from({ length: 21 }, (_, index) => index * 5);

/**
 * 수정 전 곡선(커밋 859a11c 이전). 입력에 고정값을 더해 0 에서 불연속이었다.
 * 이 시험이 그 결함을 실제로 잡는지 확인하는 용도로만 쓰며, 앱 코드가 아니다.
 */
function legacyCrunchCurve(gain, samples = SAMPLES) {
  const curve = new Float32Array(samples);
  const drive = 1.6 + (gain / 100) * 34;
  const hardClip = 0.86 - (gain / 100) * 0.36;
  const sag = 0.08 + (gain / 100) * 0.12;
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    const asymmetrical = x + (x > 0 ? sag * 0.18 : -sag * 0.08);
    const soft = Math.tanh(asymmetrical * drive) / Math.tanh(drive);
    const clipped = Math.max(-hardClip, Math.min(hardClip, soft)) / hardClip;
    curve[i] = Math.max(-1, Math.min(1, Math.tanh((soft * 0.7 + clipped * 0.3) * 1.08)));
  }
  return curve;
}

/**
 * 입력 0 둘레의 계단. 표본 수가 짝수면 가운데 두 표본의 차(설계서의 |y[N/2] − y[N/2 − 1]|),
 * 홀수면 0 표본과 양옆 표본의 차 중 큰 쪽이다.
 */
function centerJump(curve) {
  const length = curve.length;
  if (length % 2 === 0) return Math.abs(curve[length / 2] - curve[length / 2 - 1]);
  const mid = (length - 1) / 2;
  return Math.max(Math.abs(curve[mid] - curve[mid - 1]), Math.abs(curve[mid + 1] - curve[mid]));
}

function largestStep(curve) {
  let largest = 0;
  for (let i = 1; i < curve.length; i += 1) largest = Math.max(largest, Math.abs(curve[i] - curve[i - 1]));
  return largest;
}

function asymmetry(curve) {
  let largest = 0;
  for (let offset = 1; offset <= MID; offset += 1) largest = Math.max(largest, Math.abs(curve[MID + offset] + curve[MID - offset]));
  return largest;
}

for (const gain of GAINS) {
  const curve = createCrunchCurve(gain, SAMPLES);
  assert.equal(curve.length, SAMPLES, `gain ${gain}: 표본 수`);
  assert.ok(curve.every(Number.isFinite), `gain ${gain}: 모든 표본이 유한한 값이어야 한다`);
  assert.ok(curve.every((value) => value >= -1 && value <= 1), `gain ${gain}: 표본이 −1~1 범위 안이어야 한다`);

  // 무연주(입력 0)는 0 으로 나와야 한다.
  assert.ok(curve[MID] === 0, `gain ${gain}: f(0) 은 0 이어야 한다(실제 ${curve[MID]})`);
  // 설계서 수용 기준: 가운데 인접 표본 차 < 0.01 (앱이 쓰는 짝수 표본 수와 0 표본이 있는 홀수 표본 수 모두)
  assert.ok(centerJump(curve) < JUMP_LIMIT, `gain ${gain}: 0 근처 계단 ${centerJump(curve)} (한계 ${JUMP_LIMIT})`);
  const appCurve = createCrunchCurve(gain, APP_SAMPLES);
  assert.ok(centerJump(appCurve) < JUMP_LIMIT, `gain ${gain}(${APP_SAMPLES}점): 0 근처 계단 ${centerJump(appCurve)} (한계 ${JUMP_LIMIT})`);
  // 곡선 어디에도 계단이 없어야 한다(0 만 아니라 전 구간).
  assert.ok(largestStep(curve) < JUMP_LIMIT, `gain ${gain}: 인접 표본 최대 차 ${largestStep(curve)} (한계 ${JUMP_LIMIT})`);
  // 입력이 커지면 출력도 줄지 않아야 한다(단조 증가).
  for (let i = 1; i < curve.length; i += 1) {
    assert.ok(curve[i] >= curve[i - 1], `gain ${gain}: 표본 ${i} 에서 곡선이 줄어듦(${curve[i - 1]} → ${curve[i]})`);
  }
  // 연속으로 바꾸면서 비대칭(짝수 배음 성격)을 잃으면 안 된다.
  assert.ok(asymmetry(curve) > MIN_ASYMMETRY, `gain ${gain}: 비대칭이 사라짐(${asymmetry(curve)})`);
}

// 시험이 결함을 잡는지: 수정 전 곡선은 모든 gain 에서 한계를 넘는 계단이 있어야 한다.
// 수정 전 곡선은 0 표본이 음수 쪽 식을 따라 f(0) ≠ 0 이었고, 계단은 0 표본과 그 다음(양수 쪽) 표본 사이에 있었다.
for (const gain of GAINS) {
  for (const samples of [APP_SAMPLES, SAMPLES]) {
    const legacy = legacyCrunchCurve(gain, samples);
    assert.ok(
      centerJump(legacy) >= JUMP_LIMIT,
      `gain ${gain}(${samples}점): 수정 전 곡선의 계단(${centerJump(legacy)})이 한계 ${JUMP_LIMIT} 이상이어야 이 시험이 결함을 잡는다`,
    );
  }
  assert.ok(legacyCrunchCurve(gain)[MID] !== 0, `gain ${gain}: 수정 전 곡선은 f(0) ≠ 0 이었다`);
}

console.log(`Crunch curve continuity passed (gain ${GAINS[0]}~${GAINS[GAINS.length - 1]} ${GAINS.length}점, 수정 전 곡선은 실패함을 확인)`);
