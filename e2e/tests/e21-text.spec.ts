// E-21 글자·대비(설계서 S4.5, 수용 기준 E-21)
//   ① 화면 11종 × 여러 상태에서 계산된 글자 크기 11 px 미만 0개, 값(숫자 칸·노브 값) 13 px 이상,
//      12 px 이상 글자가 글자 수의 60 % 이상(Lighthouse 글꼴 크기 감사와 같은 기준)
//   ② 같은 화면·상태에서 글자·배경 대비 4.5:1 미만(큰 글자 3:1 미만) 0개 — 화면을 찍어 픽셀 표본으로 잰다
//   ③ 상태 표시(LED): 켜진 LED 는 둘레와 3:1 이상, 꺼진 LED 와 3:1 이상 차이, 글자(ON/OFF)·aria-pressed 로도 구분
//   ④ 페달 카드는 이름 있는 region(section), 모바일 안내는 중첩 aside 가 아닌 note
//   ⑤ 글자 크기 토큰(--fs-min·--fs-label·--fs-value)이 11·12·13 px 이상
// axe-core 는 의존성에 없으므로(설계서 D16) 같은 기준을 e2e/helpers/text-metrics.ts 로 직접 계산한다.
import type { Page } from '@playwright/test';
import { connectGuitar, openApp, pedalCards, pedalSwitches, selectMobileTab, setSidebar } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { SCREEN_PROFILES } from '../helpers/screens';
import {
  collectTextItems,
  contrastRatio,
  describeItem,
  legibleShare,
  measureContrast,
  samplePixels,
  sizeHistogram,
  smallerThan,
} from '../helpers/text-metrics';

const MIN_PX = 11;
const LABEL_PX = 12;
const VALUE_PX = 13;
const LEGIBLE_SHARE = 0.6;
/** 라벨(매개변수 이름)로 보는 자리: `where` 의 마지막 조각에 이 이름이 들어 있으면 12 px 이상이어야 한다. */
const LABEL_LEAVES = ['knob-control-head > span', 'tube-knob-label', 'vertical-fader-label', 'compressor-knob > span', 'reverb-knob > span', 'graphic-eq-fader > span'];

/**
 * 화면마다 사람이 보게 되는 상태들을 차례로 만든다.
 * `skip` 에 든 이름의 상태는 만들기만 하고 `visit` 은 부르지 않는다(대비 측정은 오래 걸려 화면이 겹치는 상태를 뺀다).
 */
async function states(
  page: Page,
  phone: boolean,
  width: number,
  visitAll: (label: string) => Promise<void>,
  skip: readonly string[] = [],
): Promise<void> {
  const visit = async (label: string): Promise<void> => {
    if (!skip.includes(label)) await visitAll(label);
  };
  await visit('연결 전');
  if (phone) {
    // 휴대폰은 연결 단추가 도크의 '입력' 탭 안에 있다.
    await selectMobileTab(page, 'input');
    await visit('도크 input 연결 전');
    await connectGuitar(page);
    await visit('도크 input 연결 후');
    for (const tab of ['meter', 'preset', 'pedals'] as const) {
      await selectMobileTab(page, tab);
      await visit(`도크 ${tab}`);
    }
    return;
  }
  await connectGuitar(page);
  await visit('연결 후');
  if (width < 1280) {
    await setSidebar(page, true);
    await visit('서랍');
  }
}

for (const profile of SCREEN_PROFILES) {
  test.describe(`E-21 ${profile.name}`, () => {
    test.use({ viewport: { width: profile.width, height: profile.height }, isMobile: profile.phone, hasTouch: profile.phone });

    test(`E-21 ① ${profile.name} 글자 크기`, async ({ page }) => {
      await openApp(page);
      const small: string[] = [];
      const values: string[] = [];
      const shares: string[] = [];
      let total = 0;
      await states(page, profile.phone, profile.width, async (label) => {
        const items = await collectTextItems(page);
        const bad = smallerThan(items, MIN_PX);
        const share = legibleShare(items, LABEL_PX);
        total += items.length;
        console.log(
          `[E-21 크기] ${profile.name} ${label}: 글자 ${items.length}개, ${MIN_PX}px 미만 ${bad.length}개 (${sizeHistogram(bad)}), ${LABEL_PX}px 이상 ${(share * 100).toFixed(1)} %`,
        );
        for (const item of bad) small.push(`${label}: ${describeItem(item)}`);
        // 값 글자: 숫자 입력 칸과 노브 머리의 값 표시는 13 px 이상, 라벨: 노브·페이더 이름은 12 px 이상
        for (const item of items) {
          const leaf = item.where.split('›').pop() ?? '';
          const isValue =
            leaf.includes('knob-number-input') ||
            leaf.includes('knob-control-head > output') ||
            leaf.trim().endsWith('tremolo-division-control > select');
          const isLabel = LABEL_LEAVES.some((name) => leaf.includes(name));
          if (isValue && item.fontPx < VALUE_PX - 0.01) values.push(`${label}: ${describeItem(item)}`);
          if (isLabel && item.fontPx < LABEL_PX - 0.01) values.push(`${label}: ${describeItem(item)}`);
        }
        if (share < LEGIBLE_SHARE) shares.push(`${label}: ${(share * 100).toFixed(1)} %`);
      });
      test.info().annotations.push({ type: '글자 수', description: String(total) });
      expect(small.slice(0, 15), `${MIN_PX} px 미만 글자 ${small.length}개`).toEqual([]);
      expect(values.slice(0, 15), `값 13 px·라벨 12 px 미만 글자 ${values.length}개`).toEqual([]);
      expect(shares, `${LABEL_PX} px 이상 글자가 ${LEGIBLE_SHARE * 100} % 미만인 상태`).toEqual([]);
    });

    test(`E-21 ② ${profile.name} 글자 대비`, async ({ page }) => {
      test.setTimeout(420_000);
      await openApp(page);
      const failures: string[] = [];
      let measured = 0;
      let unsampled = 0;
      let exempt = 0;
      // 휴대폰의 '입력 탭 연결 전'(연결 단추만 다르다)과 '페달 탭'(연결 전 화면과 같은 보드)은 대비 측정에서 뺀다.
      const skip = ['도크 input 연결 전', '도크 pedals'];
      await states(page, profile.phone, profile.width, async (label) => {
        const report = await measureContrast(page);
        measured += report.measured;
        unsampled += report.unsampled.length;
        exempt += report.exempt;
        console.log(
          `[E-21 대비] ${profile.name} ${label}: 잰 글자 ${report.measured}개, 못 잰 글자 ${report.unsampled.length}개, 비활성 제외 ${report.exempt}개, 위반 ${report.failures.length}개`,
        );
        for (const item of report.failures) failures.push(`${label}: ${describeItem(item)}`);
      }, skip);
      test.info().annotations.push({ type: '잰 글자', description: `${measured} (못 잰 ${unsampled}, 비활성 ${exempt})` });
      expect(measured, '대비를 잰 글자가 너무 적다(측정이 돌지 않았다)').toBeGreaterThan(300);
      expect(failures.slice(0, 15), `대비 위반 ${failures.length}개`).toEqual([]);
    });
  });
}

// ③ 상태 표시(LED): 대표 화면 둘(데스크톱·휴대폰)에서 15장 모두.
for (const size of [
  { name: '1280x800', width: 1280, height: 800, phone: false },
  { name: '390x844', width: 390, height: 844, phone: true },
] as const) {
  test.describe(`E-21 LED ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, isMobile: size.phone, hasTouch: size.phone });

    test(`E-21 ③ ${size.name} 상태 표시(LED)는 3:1 이상이고 색만으로 구분하지 않는다`, async ({ page }) => {
      test.setTimeout(180_000);
      await openApp(page);
      const problems: string[] = [];
      const cards = pedalCards(page);
      const count = await cards.count();
      expect(count).toBeGreaterThan(0);
      for (let i = 0; i < count; i += 1) {
        const card = cards.nth(i);
        const name = (await card.getAttribute('aria-label')) ?? `카드 ${i}`;
        const stomp = card.locator('.stomp-toggle-switch');
        await stomp.scrollIntoViewIfNeeded();
        // 켜진 상태와 꺼진 상태를 모두 본다.
        const fills: Record<'on' | 'off', [number, number, number] | null> = { on: null, off: null };
        const rims: Record<'on' | 'off', [number, number, number] | null> = { on: null, off: null };
        const labels: Record<'on' | 'off', string> = { on: '', off: '' };
        const pressed: Record<'on' | 'off', string> = { on: '', off: '' };
        for (let pass = 0; pass < 2; pass += 1) {
          const key: 'on' | 'off' = (await stomp.getAttribute('aria-pressed')) === 'true' ? 'on' : 'off';
          const led = stomp.locator('.stomp-toggle-led');
          await led.scrollIntoViewIfNeeded();
          // 화면 가장자리의 도크·머리글에 가려지지 않게 가운데로 가져온다.
          await led.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' }));
          await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
          const box = await led.boundingBox();
          if (!box) {
            problems.push(`${name}: LED 상자를 못 찾음`);
            break;
          }
          const cx = box.x + box.width / 2;
          const cy = box.y + box.height / 2;
          const [fill, rim] = await samplePixels(page, [
            { x: cx, y: cy },
            { x: box.x + 1, y: cy },
          ]);
          fills[key] = fill;
          rims[key] = rim;
          labels[key] = ((await stomp.locator('output').textContent()) ?? '').trim();
          pressed[key] = (await stomp.getAttribute('aria-pressed')) ?? '';
          await stomp.click();
        }
        if (!fills.on || !fills.off || !rims.on) {
          problems.push(`${name}: LED 색을 읽지 못함(켜짐 ${String(fills.on)}, 꺼짐 ${String(fills.off)})`);
          continue;
        }
        const lit = contrastRatio(fills.on, rims.on);
        const gap = contrastRatio(fills.on, fills.off);
        if (lit < 3) problems.push(`${name}: 켜진 LED 와 둘레 대비 ${lit.toFixed(2)}:1`);
        if (gap < 3) problems.push(`${name}: 켜진 LED 와 꺼진 LED 대비 ${gap.toFixed(2)}:1`);
        if (labels.on !== 'ON' || labels.off !== 'OFF') problems.push(`${name}: 글자 ON/OFF 가 상태를 따라가지 않음(${labels.on}/${labels.off})`);
        if (pressed.on !== 'true' || pressed.off !== 'false') problems.push(`${name}: aria-pressed 가 상태를 따라가지 않음`);
      }
      expect(problems, 'LED 위반').toEqual([]);
      expect(await pedalSwitches(page).count()).toBe(count);
    });
  });
}

// ⑤ 크기 토큰(tokens.css): 11 px 바닥·12 px 라벨·13 px 값. 화면에 11 px 글자가 마침 없어도 토큰 값이 줄어들면 잡아낸다.
test('E-21 ⑤ 글자 크기 토큰이 설계 수치(11·12·13 px) 이상이다', async ({ page }) => {
  await openApp(page);
  const tokens = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    const px = (name: string) => parseFloat(root.getPropertyValue(name));
    return { min: px('--fs-min'), label: px('--fs-label'), value: px('--fs-value') };
  });
  expect(tokens.min, '--fs-min').toBeGreaterThanOrEqual(MIN_PX);
  expect(tokens.label, '--fs-label').toBeGreaterThanOrEqual(LABEL_PX);
  expect(tokens.value, '--fs-value').toBeGreaterThanOrEqual(VALUE_PX);
});

// ④ 카드 이름과 안내 상자의 의미
test.describe('E-21 의미 구조', () => {
  test('E-21 ④-1 페달 카드는 이름 있는 section(region)이고 group·article 이 아니다', async ({ page }) => {
    await openApp(page);
    const cards = pedalCards(page);
    const count = await cards.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const card = cards.nth(i);
      expect(await card.evaluate((el) => el.tagName)).toBe('SECTION');
      expect(await card.getAttribute('role')).toBeNull();
      const label = (await card.getAttribute('aria-label')) ?? '';
      expect(label).toMatch(/ 이펙터$/);
      await expect(page.getByRole('region', { name: label, exact: true })).toHaveCount(1);
    }
    await expect(page.locator('.pedal-board article')).toHaveCount(0);
    await expect(page.locator('.pedal-board .pedal-card[role="group"]')).toHaveCount(0);
  });

  test.describe('휴대폰', () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

    test('E-21 ④-2 모바일 오디오 안내는 중첩 aside 가 아니라 note 이다', async ({ page }) => {
      await openApp(page);
      await selectMobileTab(page, 'input');
      const notice = page.getByRole('note', { name: '모바일 오디오 안내' });
      await expect(notice).toBeVisible();
      expect(await notice.evaluate((el) => el.tagName)).toBe('DIV');
      await expect(page.locator('aside aside')).toHaveCount(0);
      await expect(page.locator('aside.mobile-audio-notice')).toHaveCount(0);
      // 닫기 단추는 그대로 쓸 수 있다.
      await notice.getByRole('button', { name: '모바일 오디오 안내 닫기' }).click();
      await expect(notice).toHaveCount(0);
    });
  });
});
