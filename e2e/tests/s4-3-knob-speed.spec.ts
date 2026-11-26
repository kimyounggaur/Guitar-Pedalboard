// S4.3 노브 반응 속도(설계서 R4-3 '노브 한 칸마다 15개 다시 그리기·저장', 수용 기준 3개).
//   ① CPU 를 4배 느리게 한 조건에서 노브 한 칸 처리(입력 이벤트 → React 가 화면에 반영하기까지) 가 중앙값 ≤ 4 ms ★(설계서가 잰 옛 값 14 ms).
//      레이아웃(스타일 계산)까지 더한 값도 함께 재서 출력하고 따로 상한을 건다(≤ 8 ms).
//   ② 노브를 끄는 동안 해당 카드만 다시 그려진다 — 카드마다 다시 그려진 횟수를 센다(렌더 카운터, 아래 설명)
//   ③ 끌기 한 번에 저장 한 번 — 끄는 동안(마지막 변경 300 ms 뒤까지) 보드 저장 키에 쓰는 횟수
//   ④ 페달을 켜고 끌 때도 그 카드(와 '꺼짐' 표시가 있는 체인 패널)만 다시 그려진다
//   ⑤ 페달을 끌어 옮기는 동안 움직이지 않는 카드는 다시 그려지지 않는다(PedalCard memo)
// 렌더 카운터: 앱 코드(src/testing/renderCount.ts)는 페이지가 `window.__GPB_RENDER_COUNTS__` 를 먼저 만들어 둔 때만 센다.
// 이 시험이 addInitScript 로 만들어 준다. 제품 화면에서는 만들어지지 않으므로 아무것도 세지 않는다.
// 옛 코드와 비교하려면 옛 코드를 빌드한 폴더를 E2E_DIST_DIR 로 넘긴다(① 은 값만 출력하고 ②④ 는 카운터가 없어 실패한다).
import { join } from 'node:path';
import type { Page } from '@playwright/test';
import { PEDAL_COUNT, pedalCards } from '../helpers/app';
import { startDistServer, type DistServer } from '../helpers/dist-server';
import { repoRoot } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { PEDALS, idOfPedal, pedalGroup } from '../helpers/storage';
import { pedalRegionName } from '../helpers/ko-names';

const DIST_DIR = process.env.E2E_DIST_DIR ?? join(repoRoot, 'dist');
/** 설계서 수용 기준: CPU 4배 느림에서 한 칸 처리 ≤ 4 ms */
const CPU_SLOWDOWN = 4;
const MAX_STEP_MS = 4;
/** 레이아웃까지 더한 한 칸 */
const MAX_STEP_WITH_LAYOUT_MS = 8;
const BOARD_KEY = 'guitar-pedalboard:v2:state';
/** 한 번 측정에서 도는 칸 수(처음 40칸은 JIT 이 데워지는 동안이라 버린다) */
const STEPS = 60;
const WARMUP = 40;
/** 시간 측정을 되풀이하는 횟수 */
const ROUNDS = 3;

let server: DistServer;

test.beforeEach(async () => {
  server = await startDistServer({ distDir: DIST_DIR });
});

test.afterEach(async () => {
  await server.close();
});

/** 새 페이지를 열고 렌더 카운터·저장 기록을 켠다 */
async function openInstrumented(page: Page): Promise<void> {
  await page.addInitScript(
    ({ boardKey }) => {
      const win = window as unknown as { __GPB_RENDER_COUNTS__: Record<string, number>; __boardWrites: number[] };
      win.__GPB_RENDER_COUNTS__ = {};
      win.__boardWrites = [];
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function patched(this: Storage, key: string, value: string) {
        if (key === boardKey) win.__boardWrites.push(performance.now());
        return original.call(this, key, value);
      };
    },
    { boardKey: BOARD_KEY },
  );
  await page.goto(server.url);
  await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
  // 앱이 지연 시작하는 일(스토어 복원·IR 준비)이 끝날 시간
  await page.waitForTimeout(800);
}

async function throttleCpu(page: Page, rate: number): Promise<void> {
  const session = await page.context().newCDPSession(page);
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

async function renderCounts(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => ({ ...((window as unknown as { __GPB_RENDER_COUNTS__?: Record<string, number> }).__GPB_RENDER_COUNTS__ ?? {}) }));
}

async function resetRenderCounts(page: Page): Promise<void> {
  await page.evaluate(() => {
    const counts = (window as unknown as { __GPB_RENDER_COUNTS__: Record<string, number> }).__GPB_RENDER_COUNTS__;
    for (const key of Object.keys(counts)) delete counts[key];
  });
}

interface StepTime {
  /** 입력 이벤트 → React 가 화면(DOM)에 반영하기까지(ms) */
  commit: number;
  /** 거기에 스타일 계산·레이아웃을 끝낼 때까지 더한 값(ms) */
  withLayout: number;
}

/** 카드의 첫 노브(range 입력)를 `steps` 칸 움직이며 칸마다 걸린 시간을 잰다 */
async function measureKnobSteps(page: Page, pedalName: string, steps: number): Promise<StepTime[]> {
  return page.evaluate(
    async ({ regionName, name, count }) => {
      const card = document.querySelector(`.pedal-board section.pedal-card[aria-label="${regionName}"]`);
      const input = card?.querySelector('input[type="range"]') as HTMLInputElement | null;
      if (!input) throw new Error(`노브를 찾지 못했습니다: ${name}`);
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      const min = Number(input.min);
      const max = Number(input.max);
      const stepSize = Number(input.step) || 1;
      let value = Math.round((min + max) / 2 / stepSize) * stepSize;
      const times: StepTime[] = [];
      for (let i = 0; i < count; i += 1) {
        value += i % 2 === 0 ? stepSize : -stepSize;
        setValue.call(input, String(value));
        const start = performance.now();
        input.dispatchEvent(new Event('input', { bubbles: true }));
        // React 는 입력 이벤트의 갱신을 마이크로태스크에서 바로 반영한다. 두 번 기다리면 그 뒤다.
        await Promise.resolve();
        await Promise.resolve();
        const committed = performance.now();
        void document.body.offsetHeight; // 스타일·레이아웃까지 끝내 본다
        times.push({ commit: committed - start, withLayout: performance.now() - start });
        // 칸 사이에 한 틱을 둔다(앞 칸의 일이 다음 칸 측정에 섞이지 않게)
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      return times;
    },
    { regionName: pedalRegionName(pedalName), name: pedalName, count: steps },
  );
}

function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

test.describe('S4.3 노브 반응 속도', () => {
  test('S4.3 ① CPU 4배 느림에서 노브 한 칸 처리 ≤ 4 ms', async ({ browser }) => {
    test.setTimeout(180_000);
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await openInstrumented(page);
    await throttleCpu(page, CPU_SLOWDOWN);

    // 페달마다 ROUNDS 번 재서 라운드별 중앙값 가운데 가장 작은 값을 쓴다. 이 기계처럼 다른 일과 CPU 를 나눠 쓰면 순간순간 느려지는데,
    // 그런 방해는 시간을 늘리기만 하므로 '가장 조용했던 라운드'가 코드의 비용에 가장 가깝다(P-17 의 라운드 방식과 같은 생각).
    const names = ['Drive', 'Delay', 'Compressor'];
    const commitRounds: Record<string, number[]> = {};
    const layoutRounds: Record<string, number[]> = {};
    for (const name of names) await measureKnobSteps(page, name, WARMUP);
    for (let round = 0; round < ROUNDS; round += 1) {
      for (const name of names) {
        const times = await measureKnobSteps(page, name, STEPS);
        (commitRounds[name] ??= []).push(percentile(times.map((time) => time.commit), 50));
        (layoutRounds[name] ??= []).push(percentile(times.map((time) => time.withLayout), 50));
      }
    }
    const commitBest = names.map((name) => Math.min(...commitRounds[name]));
    const layoutBest = names.map((name) => Math.min(...layoutRounds[name]));
    names.forEach((name, index) => {
      console.log(
        `[S4.3] ${name}: 한 칸 중앙값 ${commitBest[index].toFixed(2)} ms(라운드 ${commitRounds[name].map((value) => value.toFixed(1)).join('·')}), 레이아웃까지 ${layoutBest[index].toFixed(2)} ms (CPU ${CPU_SLOWDOWN}배 느림, ${ROUNDS}라운드 × ${STEPS}칸 중 가장 조용한 라운드)`,
      );
    });
    expect(Math.max(...commitBest), `CPU ${CPU_SLOWDOWN}배 느림에서 노브 한 칸 처리(화면 반영까지) 중앙값이 ${MAX_STEP_MS} ms 를 넘었습니다`).toBeLessThanOrEqual(MAX_STEP_MS);
    expect(Math.max(...layoutBest), `레이아웃까지 더한 한 칸 중앙값이 ${MAX_STEP_WITH_LAYOUT_MS} ms 를 넘었습니다`).toBeLessThanOrEqual(MAX_STEP_WITH_LAYOUT_MS);
    await page.close();
  });

  test('S4.3 ② 노브를 끄는 동안 해당 카드만 다시 그려진다', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await openInstrumented(page);
    await resetRenderCounts(page);
    await measureKnobSteps(page, 'Drive', 12);
    await page.waitForTimeout(100);

    const counts = await renderCounts(page);
    const drive = counts[`PedalCard:${idOfPedal('Drive')}`] ?? 0;
    expect(drive, '노브를 12칸 움직이면 Drive 카드는 12번 그려져야 합니다(카운터가 없으면 0)').toBe(12);
    const others = Object.entries(counts).filter(([key]) => key !== `PedalCard:${idOfPedal('Drive')}`);
    expect(others, `Drive 카드 밖에서 다시 그려진 것: ${JSON.stringify(others)}`).toEqual([]);
    await page.close();
  });

  test('S4.3 ③ 끌기 한 번에 저장 한 번', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await openInstrumented(page);
    const knob = pedalGroup(page, 'Drive').locator('input[type="range"]').first();
    await knob.scrollIntoViewIfNeeded();
    const box = await knob.boundingBox();
    if (!box) throw new Error('Drive 노브의 위치를 알 수 없습니다');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;

    const before = await page.evaluate(() => (window as unknown as { __boardWrites: number[] }).__boardWrites.length);
    await page.mouse.move(x, y);
    await page.mouse.down();
    // 위로 끄는 동안 20번 움직인다(움직임 사이는 30 ms — 저장 지연 300 ms 보다 훨씬 짧다)
    for (let i = 1; i <= 20; i += 1) {
      await page.mouse.move(x, y - i * 3);
      await page.waitForTimeout(30);
    }
    await page.mouse.up();
    // 마지막 변경 300 ms 뒤에 한 번 써진다
    await page.waitForTimeout(900);
    const after = await page.evaluate(() => (window as unknown as { __boardWrites: number[] }).__boardWrites.length);
    expect(after - before, '끌기 한 번에 보드 저장이 한 번이어야 합니다').toBe(1);
    await page.close();
  });

  test('S4.3 ④ 페달을 켜고 끌 때 그 카드만 다시 그려진다', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await openInstrumented(page);
    const index = PEDALS.findIndex((pedal) => pedal.name === 'Chorus');
    const toggle = page.locator('.pedal-board .pedal-card .stomp-toggle-switch').nth(index);
    await resetRenderCounts(page);
    await toggle.click();
    await page.waitForTimeout(300);
    await toggle.click();
    await page.waitForTimeout(300);

    const counts = await renderCounts(page);
    const key = `PedalCard:${idOfPedal('Chorus')}`;
    expect(counts[key] ?? 0, 'Chorus 를 켜고 끄면 Chorus 카드가 두 번 그려져야 합니다(카운터가 없으면 0)').toBe(2);
    // 켜짐이 바뀌면 그 카드의 발스위치 줄과, '꺼짐' 표시가 있는 체인 패널(ChainText)이 그려지는 것이 맞다. 그 밖의 카드·보드는 그려지지 않는다.
    const footerKey = `PedalFooter:${idOfPedal('Chorus')}`;
    expect(counts[footerKey] ?? 0, '발스위치 줄은 켜고 끌 때만 다시 그려집니다').toBeLessThanOrEqual(2);
    expect(counts['ChainText'] ?? 0, '체인 패널은 켜고 끌 때만 다시 그려집니다').toBeLessThanOrEqual(2);
    const others = Object.entries(counts).filter(([name]) => name !== key && name !== footerKey && name !== 'ChainText');
    expect(others, `Chorus 카드·발스위치 줄·체인 패널 밖에서 다시 그려진 것: ${JSON.stringify(others)}`).toEqual([]);
    await page.close();
  });
  test('S4.3 ⑤ 페달을 끌어 옮기는 동안 움직이지 않는 카드는 다시 그려지지 않는다', async ({ browser }) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await openInstrumented(page);
    const driveIndex = PEDALS.findIndex((pedal) => pedal.name === 'Drive');
    const handle = pedalCards(page).nth(driveIndex).locator('.drag-handle');
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const target = await pedalCards(page).nth(driveIndex + 1).boundingBox();
    if (!from || !target) throw new Error('끌 자리를 알 수 없습니다');
    await resetRenderCounts(page);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    const steps = 20;
    for (let i = 1; i <= steps; i += 1) {
      await page.mouse.move(
        from.x + from.width / 2 + ((target.x + target.width / 2 - from.x - from.width / 2) * i) / steps,
        from.y + from.height / 2 + ((target.y + target.height / 2 - from.y - from.height / 2) * i) / steps,
      );
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await page.waitForTimeout(300);
    const counts = await renderCounts(page);
    // 끄는 동안 카드는 위치만 바뀌고 내용(페달·끌기 손잡이 속성)은 그대로라서 PedalCard 의 memo 가 다시 그리기를 막는다.
    // 놓는 순간 손잡이 속성이 한 번 바뀌어 한두 번은 그려질 수 있다. memo 가 없으면 끄는 내내 카드마다 십수 번, 끄는 카드는 수십 번 그려진다.
    const dragged = counts[`PedalCard:${idOfPedal('Drive')}`] ?? 0;
    expect(dragged, 'Drive 카드는 끌기가 시작·끝날 때만 그려집니다(카운터가 없으면 0)').toBeGreaterThan(0);
    expect(dragged, 'Drive 카드가 끄는 동안 거듭 그려졌습니다').toBeLessThanOrEqual(6);
    const busy = Object.entries(counts).filter(([name, count]) => name.startsWith('PedalCard:') && name !== `PedalCard:${idOfPedal('Drive')}` && count > 2);
    expect(busy, `끄는 동안 움직이지 않는 카드가 3번 이상 그려졌습니다: ${JSON.stringify(busy)}`).toEqual([]);
    await page.close();
  });

});
