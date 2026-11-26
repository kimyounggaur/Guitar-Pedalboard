import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import console from 'node:console';
import { fileURLToPath, URL } from 'node:url';
import { build } from 'esbuild';
import { openApp } from './lib/app-browser.mjs';
import { createEngineHarness } from './lib/engine-harness.mjs';
import { workerUrlStub } from './lib/esbuild-plugins.mjs';
import { byClass, byRole, byTag, find, findAll, textContent } from './lib/html-tree.mjs';
import { createSsrHarness } from './lib/ssr-harness.mjs';

// S4.7: 이펙터·엔진 쪽 단언은 가짜 오디오 위에서 진짜 GraphicEQEffect·AudioEngine 을 돌려 확인한다(아래 '이펙터 동작').
// 화면 쪽 단언은 페달을 서버 렌더해 요소·접근성 속성을 묻고, 스타일은 실제 Chrome 의 계산된 값으로 확인한다(아래 '화면').
// 이펙터 동작: 진짜 GraphicEQEffect·AudioEngine 을 가짜 오디오 위에서 돌린다.
const harness = await createEngineHarness({
  extraExports: [
    `{
      GRAPHIC_EQ_BAND_KEYS,
      GRAPHIC_EQ_FREQUENCIES,
      GRAPHIC_EQ_Q,
      GraphicEQEffect,
      normalizeGraphicEQParams,
    } from './audio/nodes/GraphicEQEffect.ts'`,
  ],
});
const { fake, engine, context } = harness;
const { GRAPHIC_EQ_BAND_KEYS, GRAPHIC_EQ_FREQUENCIES, GRAPHIC_EQ_Q, GraphicEQEffect, normalizeGraphicEQParams } =
  harness.exports;

const defaultParams = {
  mix: 100,
  level: 100,
  band100: 0,
  band200: 0,
  band400: 0,
  band800: 0,
  band1600: 0,
  band3200: 0,
  band6400: 0,
};

const EXPECTED_FREQUENCIES = [100, 200, 400, 800, 1600, 3200, 6400];
assert.deepEqual([...GRAPHIC_EQ_FREQUENCIES], EXPECTED_FREQUENCIES);
assert.deepEqual([...GRAPHIC_EQ_BAND_KEYS], [
  'band100',
  'band200',
  'band400',
  'band800',
  'band1600',
  'band3200',
  'band6400',
]);
assert.equal(GRAPHIC_EQ_Q, 1.4);
assert.deepEqual(
  normalizeGraphicEQParams({
    mix: Number.NaN,
    level: Number.POSITIVE_INFINITY,
    band100: Number.NaN,
    band200: Number.POSITIVE_INFINITY,
    band400: Number.NEGATIVE_INFINITY,
    band800: Number.NaN,
    band1600: Number.POSITIVE_INFINITY,
    band3200: Number.NEGATIVE_INFINITY,
    band6400: Number.NaN,
  }),
  defaultParams,
);
assert.deepEqual(
  normalizeGraphicEQParams({
    mix: -1,
    level: 300,
    band100: -100,
    band200: 100,
    band400: -100,
    band800: 100,
    band1600: -100,
    band3200: 100,
    band6400: -100,
  }),
  {
    mix: 0,
    level: 200,
    band100: -12,
    band200: 12,
    band400: -12,
    band800: 12,
    band1600: -12,
    band3200: 12,
    band6400: -12,
  },
);

context.currentTime = 0.25;
const pedal = {
  id: 'graphic-eq',
  type: 'graphicEQ',
  name: 'Graphic EQ',
  active: true,
  color: '#4a5b7a',
  params: defaultParams,
};
const effect = new GraphicEQEffect(context, pedal);
const originalFilters = [...effect.filters];

// 밴드 일곱 개: 설계값(100·200·400·800·1600·3200·6400 Hz, Q 1.4)을 소스 상수가 아니라 따로 적은 값과 비교한다.
assert.equal(effect.filters.length, 7, 'BiquadFilterNode가 정확히 7개가 아닙니다.');
effect.filters.forEach((filter, index) => {
  assert.equal(filter.type, 'peaking', `${index}: peaking 타입`);
  assert.equal(filter.frequency.value, EXPECTED_FREQUENCIES[index], `${index}: 주파수 순서`);
  assert.equal(filter.frequency.initialValue, EXPECTED_FREQUENCIES[index], `${index}: 만들 때 주파수`);
  assert.equal(filter.Q.value, 1.4, `${index}: 고정 Q`);
  assert.equal(filter.gain.value, 0, `${index}: 기본 gain`);
  assert.equal(filter.gain.automation.at(-1).kind, 'target', `${index}: 초기 gain smoothParam`);
  // AudioParam 직접 대입 금지(클릭 소리): 주파수·Q·gain 은 `.value =` 를 받은 적이 없다.
  for (const param of [filter.frequency, filter.Q, filter.gain]) {
    assert.equal(param.directAssignments, 0, `${index}: ${param.name} AudioParam 직접 대입`);
  }
});
// 직렬 연결: 입력 → 100 → 200 → … → 6400 → 출력. 건너뛰는 길이 없다.
assert.ok(effect.effectInput.connectsTo(effect.filters[0]), 'effectInput → 첫 밴드');
for (let index = 0; index < effect.filters.length - 1; index += 1) {
  assert.ok(effect.filters[index].connectsTo(effect.filters[index + 1]), `${index}: 직렬 밴드 연결`);
  assert.equal(effect.filters[index].edges.length, 1, `${index}: 밴드는 다음 밴드로만 간다`);
}
assert.ok(effect.filters.at(-1).connectsTo(effect.effectOutput), '마지막 밴드 → effectOutput');
assert.ok(fake.pathExists(effect.effectInput, effect.effectOutput));

const nodesBeforeUpdate = fake.nodeCount;
const targetsBefore = effect.filters.map((filter) => filter.gain.automation.filter(({ kind }) => kind === 'target').length);
effect.update({
  ...pedal,
  params: {
    ...defaultParams,
    band100: -100,
    band200: 100,
    band400: -9,
    band800: 7,
    band1600: Number.NaN,
    band3200: Number.POSITIVE_INFINITY,
    band6400: 4.5,
  },
});
assert.deepEqual(effect.filters, originalFilters, 'update 중 필터가 재생성되었습니다.');
assert.equal(fake.nodeCount, nodesBeforeUpdate, 'update 중 노드를 재생성합니다.');
assert.deepEqual(
  effect.filters.map((filter) => filter.gain.value),
  [-12, 12, -9, 7, 0, 0, 4.5],
);
effect.filters.forEach((filter, index) => {
  const targets = filter.gain.automation.filter(({ kind }) => kind === 'target').length;
  assert.equal(targets, targetsBefore[index] + 1, `${index}: update 한 번에 gain 예약이 한 번이어야 합니다.`);
  assert.equal(filter.gain.directAssignments, 0, `${index}: update 가 gain 에 직접 대입했습니다.`);
  assert.equal(filter.frequency.value, EXPECTED_FREQUENCIES[index], `${index}: update 가 주파수를 바꿨습니다.`);
  assert.equal(filter.Q.value, 1.4, `${index}: update 가 Q 를 바꿨습니다.`);
});
assert.ok(effect.filters.every((filter) => Number.isFinite(filter.gain.value)), 'gain NaN 차단');

effect.dispose();
effect.dispose();
assert.ok(effect.filters.every((filter) => filter.disconnectCalls === 1), '필터 dispose 불완전');

// 엔진: 'graphicEQ' 페달은 GraphicEQEffect 로 만들어진다.
const engineEffect = engine.createEffect(pedal);
assert.ok(engineEffect instanceof GraphicEQEffect, "엔진이 'graphicEQ' 페달에 다른 이펙터를 만들었습니다.");
assert.equal(engineEffect.filters.length, 7);
engineEffect.dispose();
harness.restore();

// ── 화면 ─────────────────────────────────────────────────────────────────────────────────────────────────────────
// 소스 글자를 읽는 대신 그래픽 EQ 페달·페달 카드·아이콘을 실제로 그려(서버 렌더) 요소와 접근성 속성을 묻고, 처리기를 직접 부른다.
const uiHarness = await createSsrHarness({
  extraExports: [
    "{ GraphicEQPedal } from './components/effects/GraphicEQPedal.tsx'",
    "{ PedalCard } from './components/PedalCard.tsx'",
    "{ PedalIcon } from './components/PedalIcon.tsx'",
    "{ initialPedals } from './presets/initialPedals.ts'",
    "{ ko } from './i18n/ko.ts'",
  ],
  windowOverrides: { matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }) },
});
{
  const { GraphicEQPedal, PedalCard, PedalIcon, initialPedals, ko } = uiHarness.exports;
  const graphicEqPedal = initialPedals.find((candidate) => candidate.type === 'graphicEQ');
  assert.ok(graphicEqPedal, '처음 페달 목록에 그래픽 EQ 가 있다');

  // 일곱 칸 페이더: 범위·간격·접근성 이름과 값 문구가 밴드마다 맞는다.
  const bandRows = [
    ['band100', '100 Hz', 100, -12, '-12 dB'],
    ['band200', '200 Hz', 200, -3.5, '-3.5 dB'],
    ['band400', '400 Hz', 400, 0, '0 dB'],
    ['band800', '800 Hz', 800, 0.5, '+0.5 dB'],
    ['band1600', '1.6k Hz', 1600, 6, '+6 dB'],
    ['band3200', '3.2k Hz', 3200, 12, '+12 dB'],
    ['band6400', '6.4k Hz', 6400, -0.5, '-0.5 dB'],
  ];
  const shownParams = { ...graphicEqPedal.params, ...Object.fromEntries(bandRows.map(([key, , , value]) => [key, value])) };
  const changes = [];
  const pedalTree = uiHarness.render(GraphicEQPedal, { params: shownParams, onChange: (key, value) => changes.push([key, value]) });
  const group = find(pedalTree, byRole('group'));
  assert.equal(group.attrs['aria-label'], ko.pedal.graphicEQ.controls, '페달 전체를 묶는 그룹 이름');
  const faders = findAll(pedalTree, byClass('vertical-fader'));
  assert.equal(faders.length, 7, '밴드 일곱 개가 모두 세로 페이더다(기존 가로 슬라이더를 재사용하지 않는다)');
  assert.equal(findAll(find(pedalTree, byClass('graphic-eq7-fader-bank')), byClass('vertical-fader')).length, 7, '페이더는 페이더 뱅크 안에 있다');
  faders.forEach((fader, index) => {
    const [, label, frequency, value, shown] = bandRows[index];
    const range = find(fader, (node) => node.tag === 'input' && node.attrs.type === 'range');
    assert.deepEqual(
      [range.attrs.min, range.attrs.max, range.attrs.step, range.attrs.value],
      ['-12', '12', '0.5', String(value)],
      `${label}: 범위 ±12 dB, 간격 0.5`,
    );
    assert.equal(range.attrs['aria-orientation'], 'vertical', `${label}: 세로 방향`);
    assert.equal(range.attrs['aria-label'], label, `${label}: 접근성 이름`);
    assert.equal(range.attrs['aria-valuetext'], `${label} ${frequency} 헤르츠, ${shown}`, `${label}: 값 문구`);
    assert.equal('tabindex' in range.attrs, false, `${label}: 키보드 접근이 차단되면 안 된다`);
    assert.equal(textContent(find(fader, byTag('output'))), shown, `${label}: 눈에 보이는 값`);
  });
  // 처리기: 각 페이더의 변경이 자기 밴드 키로 숫자 값을 알린다.
  const verticalRanges = uiHarness.findHosts('input', (props) => props['aria-orientation'] === 'vertical');
  assert.equal(verticalRanges.length, 7);
  verticalRanges.forEach((host, index) => host.props.onChange({ currentTarget: { value: String(index - 3 + 0.5) } }));
  assert.deepEqual(changes, bandRows.map(([key], index) => [key, index - 3 + 0.5]));
  // 믹스·레벨은 가로 슬라이더이고 세로 방향 표시가 없다.
  const utilityRanges = findAll(find(pedalTree, byClass('graphic-eq7-utility-controls')), (node) => node.tag === 'input' && node.attrs.type === 'range');
  assert.deepEqual(utilityRanges.map((node) => [node.attrs.min, node.attrs.max, 'aria-orientation' in node.attrs]), [['0', '100', false], ['0', '200', false]]);

  // 페달 카드: 그래픽 EQ 카드만 전용 모양과 페달 화면을 갖는다.
  const eqCard = uiHarness.render(PedalCard, { pedal: graphicEqPedal });
  const eqRoot = find(eqCard, byClass('pedal-card-graphic-eq'));
  assert.ok(eqRoot, "'graphicEQ' 카드는 pedal-card-graphic-eq 모양이다");
  assert.equal(findAll(eqRoot, byClass('vertical-fader')).length, 7, '카드 안에 그래픽 EQ 페달(페이더 7개)이 그려진다');
  assert.ok(find(eqRoot, (node) => node.attrs?.role === 'group' && node.attrs['aria-label'] === ko.pedal.graphicEQ.controls));
  for (const other of initialPedals.filter((candidate) => candidate.type !== 'graphicEQ')) {
    const otherCard = uiHarness.render(PedalCard, { pedal: other });
    assert.equal(find(otherCard, byClass('pedal-card-graphic-eq')), null, `${other.type}: 그래픽 EQ 모양이 아니다`);
    assert.equal(find(otherCard, byClass('graphic-eq7-ui')), null, `${other.type}: 그래픽 EQ 화면을 그리지 않는다`);
  }

  // 아이콘: 그래픽 EQ 만의 그림이 있다(없으면 기본 네모 그림으로 떨어진다).
  const iconOf = (type) => uiHarness.html(PedalIcon, { type });
  const graphicIcon = iconOf('graphicEQ');
  assert.notEqual(graphicIcon, iconOf('not-a-pedal-type'), '그래픽 EQ 아이콘이 기본 그림이 아니다');
  for (const other of initialPedals.filter((candidate) => candidate.type !== 'graphicEQ')) {
    assert.notEqual(graphicIcon, iconOf(other.type), `${other.type} 아이콘과 같지 않다`);
  }
}
uiHarness.restore();

// 스타일은 브라우저가 계산한 값으로 본다. F-1: 레일 안의 range 입력만 투명 오버레이이고, 같은 칸의 숫자 입력은 칸 안에 머물며 포인터를 받지 않는다.
await verifyGraphicEqInBrowser();

async function verifyGraphicEqInBrowser() {
  const app = await openApp({ purpose: '그래픽 EQ 스타일', viewport: { width: 1280, height: 1000 }, waitFor: '.pedal-card-graphic-eq' });
  if (!app) return;
  try {
    await app.evaluate(`document.querySelector('.pedal-card-graphic-eq').scrollIntoView({ block: 'center' })`);
    const report = await app.evaluate(`(() => {
      const card = document.querySelector('.pedal-card-graphic-eq');
      const bank = card.querySelector('.graphic-eq7-fader-bank');
      const cardStyle = getComputedStyle(card);
      const bankStyle = getComputedStyle(bank);
      const center = (element) => {
        const rect = element.getBoundingClientRect();
        return [rect.left + rect.width / 2, rect.top + rect.height / 2];
      };
      const faders = [...bank.querySelectorAll('.vertical-fader')].map((fader) => {
        const rail = fader.querySelector('.vertical-fader-rail');
        const range = rail.querySelector('input');
        const number = fader.querySelector(':scope > .knob-number-input');
        const faderRect = fader.getBoundingClientRect();
        const numberRect = number.getBoundingClientRect();
        const numberStyle = getComputedStyle(number);
        const rangeStyle = getComputedStyle(range);
        const [x, y] = center(rail);
        return {
          faderPosition: getComputedStyle(fader).position,
          numberPosition: numberStyle.position,
          numberOpacity: numberStyle.opacity,
          numberPointerEvents: numberStyle.pointerEvents,
          numberInsideFader: numberRect.left >= faderRect.left - 1 && numberRect.right <= faderRect.right + 1 && numberRect.top >= faderRect.top - 1 && numberRect.bottom <= faderRect.bottom + 1,
          rangePosition: rangeStyle.position,
          rangeOpacity: rangeStyle.opacity,
          hitInRail: rail.contains(document.elementFromPoint(x, y)),
        };
      });
      const stomp = card.querySelector('.stomp-toggle-switch');
      const [sx, sy] = center(stomp);
      const hit = document.elementFromPoint(sx, sy);
      return {
        overflow: cardStyle.overflow,
        backgroundHasGradient: cardStyle.backgroundImage.includes('linear-gradient'),
        bankDisplay: bankStyle.display,
        bankColumns: bankStyle.gridTemplateColumns.split(' ').length,
        faders,
        stompHitInsideStomp: Boolean(hit) && stomp.contains(hit),
      };
    })()`);
    assert.equal(report.overflow, 'hidden');
    assert.equal(report.backgroundHasGradient, true);
    assert.equal(report.bankDisplay, 'grid');
    assert.equal(report.bankColumns, 7, '페이더 뱅크는 일곱 칸');
    assert.equal(report.faders.length, 7);
    for (const [index, fader] of report.faders.entries()) {
      assert.equal(fader.faderPosition, 'relative', `${index}: .vertical-fader 가 숫자 입력의 기준 상자다(F-1)`);
      assert.equal(fader.numberPosition, 'absolute', `${index}: 숫자 입력은 칸 안에 놓인다(F-1)`);
      assert.equal(fader.numberOpacity, '0', `${index}: 숫자 입력은 눈에 보이지 않는다`);
      assert.equal(fader.numberPointerEvents, 'none', `${index}: 숫자 입력은 포인터를 받지 않는다(F-1)`);
      assert.equal(fader.numberInsideFader, true, `${index}: 숫자 입력이 자기 칸 밖으로 나가 화면을 덮지 않는다(F-1)`);
      assert.equal(fader.rangePosition, 'absolute', `${index}: 레일 안 range 입력은 투명 오버레이`);
      assert.equal(fader.rangeOpacity, '0', `${index}: 레일 안 range 입력은 투명`);
      assert.equal(fader.hitInRail, true, `${index}: 레일 한가운데를 누르면 레일(끌기 처리기)이 포인터를 받고, 숫자 입력이 가로채지 않는다`);
    }
    assert.equal(report.stompHitInsideStomp, true, '스톰프 스위치 위의 클릭이 가려지지 않는다(F-1)');

    // 키보드로 포커스가 오면 레일 둘레에 눈에 띄는 테두리가 생긴다.
    await app.press('Tab');
    const focus = await app.evaluate(`(() => {
      const range = document.querySelector('.pedal-card-graphic-eq .vertical-fader-rail input');
      range.focus();
      const style = getComputedStyle(range);
      return {
        focusVisible: range.matches(':focus-visible'),
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        outlineColor: style.outlineColor,
        outlineOffset: style.outlineOffset,
        radius: style.borderTopLeftRadius,
      };
    })()`);
    assert.deepEqual(focus, {
      focusVisible: true,
      outlineStyle: 'solid',
      outlineWidth: '2px',
      outlineColor: 'rgb(246, 220, 148)',
      outlineOffset: '3px',
      radius: '6px',
    });
  } finally {
    await app.close();
  }
}

const migrationBundle = await build({
  plugins: [workerUrlStub],
  entryPoints: [fileURLToPath(new URL('../src/store/__migration_check.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node20',
  write: false,
});
const migrationUrl = `data:text/javascript;base64,${Buffer.from(migrationBundle.outputFiles[0].text).toString('base64')}`;
const { runMigrationChecks } = await import(migrationUrl);
runMigrationChecks();

console.log(
  'Graphic EQ regression passed: schema v10, seven fixed peaking bands, Q/gain bounds, smoothing, UI accessibility, factory bypass and lifecycle.',
);
