// S2.2 조절기 이름·범위·기능 바로잡기(파라미터 스키마, R2-3) — 브라우저에서 눈에 보이는 결과.
//   · 화면에 그려진 모든 슬라이더에 스키마(src/audio/params)의 정의가 있고, 이름·범위·간격·표시가 같다(기본값·최솟값·최댓값에서).
//   · 스키마의 숫자 정의는 화면에 그려진 조절기를 하나도 빠뜨리지 않는다(정의가 쓰이지 않으면 실패).
//   · Fuzz: 이름은 'Gate'(옛 이름 '출력 감쇠'는 어디에도 없다), 0 = '끔', 1~100 = 문턱 −80 ~ −30 dB.
//   · EQ: Level 페이더가 0~200 이고 공장 프리셋 Solo Boost 의 108 이 그대로 보인다.
//   · Delay: Sync 를 켜면 D.Time 을 조작할 수 없고(disabled·aria-disabled) 동기된 값('1/4 · 500 ms')이 보인다. Slapback 은 Sync 를 무시한다.
//   · Reverb: Decay 는 6초까지이고, 6초를 넘던 옛 저장본(픽스처 05: 7.5초)과 공장 프리셋(6.2·7.5초였던 둘)도 6초로 열린다.
//   · 프리셋 패널에 고정 수치 막대(Peak·RMS)와 Store 탭이 없다.
// 소리가 실제로 어떻게 달라지는지(Fuzz Gate 0 은 변화 0·50 은 무연주 잡음 −30 dB 이상, Reverb 6초 변환의 널 테스트)는 오프라인 렌더 프로브 P-24·P-20 이 잰다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { effectSchemas, formatParamValue, type ChoiceDef, type ParamDef } from '../../src/audio/params';
import { paramNames } from '../../src/i18n/paramName';
import { knobKoName, pedalRegionName } from '../helpers/ko-names';
import type { EffectType } from '../../src/audio/types';
import { openApp } from '../helpers/app';
import { fixturesDir } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';

/** 화면의 카드 이름(`<이름> 이펙터` 그룹) → 이펙트 종류. 기본 페달 순서다. */
const PEDALS: ReadonlyArray<{ name: string; type: EffectType }> = [
  { name: 'Noise Gate', type: 'noiseGate' },
  { name: 'Compressor', type: 'compressor' },
  { name: 'Auto Wah', type: 'autoWah' },
  { name: 'Drive', type: 'drive' },
  { name: 'Crunch', type: 'crunch' },
  { name: 'Fuzz', type: 'fuzz' },
  { name: 'Graphic EQ', type: 'graphicEQ' },
  { name: 'EQ', type: 'eq' },
  { name: 'Cab', type: 'cab' },
  { name: 'Chorus', type: 'chorus' },
  { name: 'Flanger', type: 'flanger' },
  { name: 'Phaser', type: 'phaser' },
  { name: 'Tremolo', type: 'tremolo' },
  { name: 'Delay', type: 'delay' },
  { name: 'Reverb', type: 'reverb' },
];

/** 카드 이름은 한국어 전체 이름이고(S4.6), 화면에 인쇄된 얼굴 이름과 노브 약어는 영어 그대로다. 시험은 영어 이름을 적고 도우미가 한국어로 바꾼다. */
const pedalGroup = (page: Page, name: string): Locator => page.getByRole('region', { name: pedalRegionName(name), exact: true });
/** 노브의 접근성 이름은 스키마 `name` 의 괄호 앞 부분이다(예: Threshold → 문턱값). `label` 은 화면에 인쇄된 약어. */
const sliderOf = (card: Locator, type: EffectType, label: string): Locator => card.getByRole('slider', { name: knobKoName(type, label), exact: true });
const nameOf = (type: EffectType, label: string): string => paramNames(type, label).name;
/** 슬라이더와 같은 조절기 안에 있는 값 표시(<output>). */
const outputOf = (slider: Locator): Locator => slider.locator('xpath=ancestor::div[1]').locator('output');

interface RenderedControl {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  valuetext: string;
  output: string | null;
  disabled: boolean;
}

/** 카드 안의 모든 슬라이더 입력(range)을 읽는다. */
async function readControls(card: Locator): Promise<RenderedControl[]> {
  return card.locator('input[type="range"]').evaluateAll((inputs) =>
    inputs.map((node) => {
      const input = node as HTMLInputElement;
      return {
        label: input.getAttribute('aria-label') ?? '',
        min: Number(input.min),
        max: Number(input.max),
        step: Number(input.step),
        value: Number(input.value),
        valuetext: input.getAttribute('aria-valuetext') ?? '',
        output: input.closest('div')?.querySelector('output')?.textContent ?? null,
        disabled: input.disabled,
      };
    }),
  );
}

const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-9;

/** 브라우저가 range 입력의 값을 간격(step)의 눈금에 맞추는 방식: min 에서 step 씩 센 가장 가까운 눈금, max 를 넘지 않는다. */
function snapToStep(value: number, min: number, max: number, step: number): number {
  const snapped = min + Math.round((value - min) / step) * step;
  return Number(Math.min(max, Math.max(min, snapped)).toFixed(6));
}

/**
 * 스크린 리더용 문구(aria-valuetext)가 화면에 보이는 값과 같은 숫자·단위를 말하는지 본다.
 * 대부분은 '<이름> <보이는 값>' 그대로이고, 일부러 풀어 쓴 두 곳만 다르다: Reverb Tone('7.2k' → '7.2 kHz'), 그래픽 EQ 밴드('100 Hz 100 헤르츠, 0 dB').
 */
function valuetextMatches(label: string, valuetext: string, shown: string): boolean {
  if (valuetext === `${label} ${shown}`) return true;
  if (valuetext === `${label} ${shown.replace(/k$/, ' kHz')}`) return true;
  return valuetext.startsWith(`${label} `) && valuetext.endsWith(`, ${shown}`);
}

/**
 * 화면의 조절기 하나가 스키마와 같은지 본다. 같지 않은 곳마다 한 줄씩 돌려준다.
 *   · 숫자 정의: 범위·간격은 저장값 × sliderScale, 표시는 formatParamValue(정의, 저장값).
 *   · 고르는 값(enum)을 슬라이더로 돌리는 노브(Delay Mode 등): 0 ~ 선택지 수 − 1, 표시는 선택지의 이름.
 *   · mode 'default': 처음 켠 그대로인 화면이다. 슬라이더의 값은 스키마 기본값을 간격의 눈금에 맞춘 값이어야 하고,
 *     보이는 값은 눈금에 맞추지 않은 스키마 기본값 그대로다(EQ Treble 기본 1.8 은 0.5 간격에 놓이지 않아, 입력은 2.0 으로 읽히지만 화면은 1.8dB 다 — 기록 L-82).
 *   · mode 'moved': 슬라이더를 직접 옮긴 뒤다. 눈금 위의 값이므로 입력이 읽는 값을 그대로 저장값으로 본다.
 */
function checkControl(type: EffectType, control: RenderedControl, mode: 'default' | 'moved'): string[] {
  const schema = effectSchemas[type];
  const where = `${type}.${control.label}`;
  const numeric: ParamDef | undefined = schema.params.find((definition) => nameOf(type, definition.label) === control.label && !definition.hidden);
  if (numeric) {
    const scale = numeric.sliderScale ?? 1;
    const problems: string[] = [];
    if (!near(control.min, numeric.min * scale)) problems.push(`${where}: min 화면 ${control.min} ≠ 스키마 ${numeric.min * scale}`);
    if (!near(control.max, numeric.max * scale)) problems.push(`${where}: max 화면 ${control.max} ≠ 스키마 ${numeric.max * scale}`);
    if (!near(control.step, numeric.step * scale)) problems.push(`${where}: step 화면 ${control.step} ≠ 스키마 ${numeric.step * scale}`);
    let stored = control.value / scale;
    if (mode === 'default') {
      stored = numeric.default;
      const onGrid = snapToStep(numeric.default * scale, control.min, control.max, control.step);
      if (!near(control.value, onGrid)) problems.push(`${where}: 처음 값 ${control.value} ≠ 스키마 기본값 ${numeric.default * scale}(눈금에 맞추면 ${onGrid})`);
    }
    const shown = formatParamValue(numeric, stored);
    if (!valuetextMatches(control.label, control.valuetext, shown)) problems.push(`${where}: aria-valuetext '${control.valuetext}' 가 보이는 값 '${shown}' 과 다르다`);
    if (control.output !== null && control.output !== shown) problems.push(`${where}: 보이는 값 '${control.output}' ≠ '${shown}'`);
    return problems;
  }
  const choice: ChoiceDef | undefined = schema.choices.find((definition) => nameOf(type, definition.label) === control.label && definition.kind === 'enum' && !definition.hidden);
  if (choice?.options) {
    const problems: string[] = [];
    if (control.min !== 0 || control.max !== choice.options.length - 1 || control.step !== 1) {
      problems.push(`${where}: 선택 노브 범위 ${control.min}~${control.max}/${control.step} ≠ 0~${choice.options.length - 1}/1`);
    }
    const option = choice.options[control.value];
    if (!option || control.valuetext !== `${control.label} ${option.label}`) {
      problems.push(`${where}: 선택 노브 표시 '${control.valuetext}' ≠ '${control.label} ${option?.label}'`);
    }
    return problems;
  }
  return [`${where}: 스키마에 정의가 없는 조절기가 화면에 있다`];
}

/** 스위치(Sync 등)를 원하는 상태로 맞춘다. 체크박스는 겉보기 스위치 뒤에 숨어 있어 직접 누를 수 없고, 라벨(글자)을 눌러야 한다. */
async function setSwitch(card: Locator, type: EffectType, label: string, on: boolean): Promise<void> {
  const input = card.getByRole('checkbox', { name: knobKoName(type, label), exact: true });
  if ((await input.isChecked()) !== on) await card.locator('label.toggle-switch', { hasText: label }).click();
  if (on) await expect(input, `${label} 스위치가 켜진다`).toBeChecked();
  else await expect(input, `${label} 스위치가 꺼진다`).not.toBeChecked();
}

/** 슬라이더를 값으로 옮긴다(React 가 변화를 알아채도록 입력 이벤트가 나간다). */
async function setSlider(slider: Locator, value: number): Promise<void> {
  await slider.fill(String(value));
}

test.describe('S2.2 파라미터 스키마와 화면', () => {
  test('S2.2 화면의 모든 슬라이더에 스키마 정의가 있고 이름·범위·표시가 같다(기본값)', async ({ page }) => {
    await openApp(page);
    const problems: string[] = [];
    let checked = 0;
    for (const { name, type } of PEDALS) {
      const controls = await readControls(pedalGroup(page, name));
      expect(controls.length, `${name} 카드에 슬라이더가 있다`).toBeGreaterThan(0);
      for (const control of controls) {
        problems.push(...checkControl(type, control, 'default'));
        checked += 1;
      }
      // 거꾸로: 화면에 보이는 숫자 정의는 하나도 빠지지 않고 그려져 있다(숨긴 정의 제외). Sync 를 켜야 나오는 BPM 은 아래 시험에서 본다.
      const labels = new Set(controls.map((control) => control.label));
      // 한 카드 안에서 접근성 이름이 겹치면 스크린 리더로 둘을 구별할 수 없다(S4.6).
      expect(labels.size, `${name} 카드의 슬라이더 이름이 서로 다르다`).toBe(controls.length);
      for (const definition of effectSchemas[type].params) {
        if (definition.hidden) continue;
        if (labels.has(nameOf(type, definition.label))) continue;
        if (definition.label === 'BPM') continue;
        problems.push(`${type}.${definition.label}: 스키마에는 있으나 화면에 슬라이더가 없다`);
      }
    }
    expect(problems).toEqual([]);
    expect(checked, '슬라이더를 충분히 확인했는지').toBeGreaterThanOrEqual(100);
  });

  test('S2.2 슬라이더를 최솟값·최댓값으로 옮겨도 표시가 스키마를 따른다', async ({ page }) => {
    await openApp(page);
    const problems: string[] = [];
    let moved = 0;
    for (const { name, type } of PEDALS) {
      const card = pedalGroup(page, name);
      const controls = await readControls(card);
      for (const control of controls) {
        if (control.disabled) continue;
        const schema = effectSchemas[type];
        // 고르는 값 노브(Mode 등)는 선택지 이름이 바뀌는 것을 위에서 봤다. 여기서는 숫자 조절기의 양 끝만 본다.
        if (!schema.params.some((definition) => nameOf(type, definition.label) === control.label && !definition.hidden)) continue;
        for (const target of [control.min, control.max]) {
          const slider = card.getByRole('slider', { name: control.label, exact: true });
          await setSlider(slider, target);
          const [after] = (await readControls(card)).filter((candidate) => candidate.label === control.label);
          if (after.value !== target) {
            problems.push(`${type}.${control.label}: ${target} 로 옮겼는데 ${after.value} 이다`);
            continue;
          }
          problems.push(...checkControl(type, after, 'moved'));
          moved += 1;
        }
      }
    }
    expect(problems).toEqual([]);
    expect(moved, '양 끝을 충분히 확인했는지').toBeGreaterThanOrEqual(180);
  });

  test('S2.2 Fuzz 의 Gate: 이름은 Gate, 0 은 끔, 1~100 은 문턱(dB)이고 옛 이름 \'출력 감쇠\' 는 어디에도 없다', async ({ page }) => {
    await openApp(page);
    const card = pedalGroup(page, 'Fuzz');
    const gate = sliderOf(card, 'fuzz', 'Gate');
    await expect(gate).toHaveAttribute('min', '0');
    await expect(gate).toHaveAttribute('max', '100');
    await expect(gate).toHaveAttribute('step', '1');
    await expect(gate).toHaveValue('15');
    await expect(page.getByText('출력 감쇠'), "옛 이름 '출력 감쇠' 가 화면에 없다").toHaveCount(0);
    await expect(page.locator('[aria-label*="출력 감쇠"], [title*="출력 감쇠"]'), "옛 이름 '출력 감쇠' 가 접근 가능한 이름에도 없다").toHaveCount(0);

    // 스키마가 아니라 글자로 적어 둔 값: 0 = 끔, 1 = −80 dBFS, 50 = −55 dBFS(−55.25 를 반올림), 100 = −30 dBFS. 기본 15 는 −72.9 를 반올림해 −73.
    const expected: Array<[number, string]> = [
      [0, '끔'],
      [1, '-80 dB'],
      [15, '-73 dB'],
      [50, '-55 dB'],
      [100, '-30 dB'],
    ];
    for (const [value, shown] of expected) {
      await setSlider(gate, value);
      await expect(gate).toHaveValue(String(value));
      await expect(outputOf(gate), `Gate ${value} 의 표시`).toHaveText(shown);
      await expect(gate).toHaveAttribute('aria-valuetext', `${knobKoName('fuzz', 'Gate')} ${shown}`);
    }
  });

  test('S2.2 EQ 의 Level 페이더는 0~200 이고 공장 프리셋 Solo Boost 의 108 이 그대로 보인다', async ({ page }) => {
    await openApp(page);
    const level = sliderOf(pedalGroup(page, 'EQ'), 'eq', 'Level');
    await expect(level).toHaveAttribute('min', '0');
    await expect(level).toHaveAttribute('max', '200');
    await page.locator('.preset-load-button', { hasText: 'Solo Boost' }).first().click();
    await expect(level, 'Solo Boost 의 EQ Level 108 이 100 으로 잘리지 않는다').toHaveValue('108');
  });

  test('S2.2 Delay: Sync 를 켜면 D.Time 을 조작할 수 없고 동기된 값이 보이며, Slapback 은 Sync 를 무시한다', async ({ page }) => {
    await openApp(page);
    const card = pedalGroup(page, 'Delay');
    const time = sliderOf(card, 'delay', 'D.Time');
    const timeNumber = card.getByLabel(`${knobKoName('delay', 'D.Time')} 값 직접 입력`, { exact: true });
    const sync = card.getByRole('checkbox', { name: knobKoName('delay', 'Sync'), exact: true });
    const division = card.locator('label.select-control', { hasText: 'Division' }).locator('select');
    const mode = card.locator('label.select-control', { hasText: 'Mode' }).locator('select');

    await expect(sync).not.toBeChecked();
    await expect(time).toBeEnabled();
    await expect(time).not.toHaveAttribute('aria-disabled', 'true');
    await expect(outputOf(time)).toHaveText('280 ms');

    await setSwitch(card, 'delay', 'Sync', true);
    await expect(time, 'Sync 중에는 D.Time 을 막는다').toBeDisabled();
    await expect(time).toHaveAttribute('aria-disabled', 'true');
    await expect(timeNumber, '직접 입력도 막는다').toBeDisabled();
    await expect(outputOf(time), '동기된 값').toHaveText('1/4 · 500 ms');
    await expect(time).toHaveAttribute('aria-valuetext', `${knobKoName('delay', 'D.Time')} 1/4 · 500 ms`);

    await division.selectOption('1/8');
    await expect(outputOf(time)).toHaveText('1/8 · 250 ms');
    await division.selectOption('dotted1/8');
    await expect(outputOf(time)).toHaveText('Dotted 1/8 · 375 ms');
    await division.selectOption('1/16');
    await expect(outputOf(time)).toHaveText('1/16 · 125 ms');

    // Slapback 은 Sync 를 무시하고 D.Time 으로 시간을 정하므로 노브가 풀린다.
    await mode.selectOption('slapback');
    await expect(time, 'Slapback 에서는 D.Time 을 돌릴 수 있다').toBeEnabled();
    await expect(outputOf(time)).toHaveText('280 ms');
    await mode.selectOption('digital');
    await expect(time).toBeDisabled();

    await setSwitch(card, 'delay', 'Sync', false);
    await expect(time).toBeEnabled();
    await expect(outputOf(time)).toHaveText('280 ms');
  });

  test('S2.2 BPM 은 Sync 를 켜면 나타나고 스키마와 같다(Tremolo·Delay)', async ({ page }) => {
    await openApp(page);
    for (const { name, type } of [
      { name: 'Tremolo', type: 'tremolo' as const },
      { name: 'Delay', type: 'delay' as const },
    ]) {
      const card = pedalGroup(page, name);
      await setSwitch(card, type, 'Sync', true);
      const bpm = sliderOf(card, type, 'BPM');
      await expect(bpm, `${name} Sync 를 켜면 BPM 슬라이더가 있다`).toBeVisible();
      const [control] = (await readControls(card)).filter((candidate) => candidate.label === knobKoName(type, 'BPM'));
      expect(checkControl(type, control, 'moved')).toEqual([]);
    }
  });

  test('S2.2 Reverb Decay 는 6초까지이고, 6초를 넘던 옛 저장본·공장 프리셋도 6초로 열린다', async ({ page }) => {
    // 옛 저장본(픽스처 05): Reverb 를 켠 채 decay 7.5초. 불러올 때 6초로 맞춰진다(M3).
    const fixture = JSON.parse(readFileSync(join(fixturesDir, 'storage-v1', '05-reverb-decay-7.5.json'), 'utf8')) as {
      storage: Record<string, string>;
    };
    await page.addInitScript((storage) => {
      if (window.sessionStorage.getItem('__fixture-loaded')) return;
      window.sessionStorage.setItem('__fixture-loaded', '1');
      window.localStorage.clear();
      for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
    }, fixture.storage);
    await openApp(page);

    const decay = sliderOf(pedalGroup(page, 'Reverb'), 'reverb', 'Decay');
    await expect(decay).toHaveAttribute('max', '6');
    await expect(decay, '저장돼 있던 7.5초가 6초로 열린다').toHaveValue('6');
    await expect(decay).toHaveAttribute('aria-valuetext', `${knobKoName('reverb', 'Decay')} ${formatParamValue(effectSchemas.reverb.params.find((definition) => definition.key === 'decay')!, 6)}`);

    // 예전에 6.2초·7.5초였던 공장 프리셋 둘
    for (const preset of ['Ambient Delay', 'Tape Swell']) {
      await page.locator('.preset-load-button', { hasText: preset }).first().click();
      await expect(decay, `${preset} 의 Reverb Decay`).toHaveValue('6');
    }
  });

  test('S2.2 프리셋 패널에 고정 수치 막대(Peak·RMS)와 Store 탭이 없다', async ({ page }) => {
    await openApp(page);
    const panel = page.locator('.preset-panel');
    await expect(panel).toHaveCount(1);
    await expect(panel.locator('.preset-tabs button'), '탭은 라이브러리 하나').toHaveText(['라이브러리']);
    await expect(page.getByRole('tab', { name: 'Store' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Store' })).toHaveCount(0);
    await expect(panel.getByText(/^(Peak|RMS)$/)).toHaveCount(0);
  });
});
