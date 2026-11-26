// E-06 데스크톱 배치 — 정식 단언(설계서 S1.8, 6.3절). S0.4 에서는 겹침 5~7곳·가려진 스위치가 '고치기 전' 값으로만 기록되었고, S1.8 이 판정으로 바꿨다.
//   · 768 · 1024 · 1280 · 1366 · 1440 · 1536 · 1680 · 1920 px 에서 오른쪽 오디오 패널을 펼치거나 접은 채,
//     페달 카드 15개 안의 글자 상자끼리 겹침 0, 스위치 15개 모두 닿고 100% 보임, 문서가 가로로 넘치지 않음, 카드 폭은 300 px 이상.
//   · 오른쪽 패널: 1280 px 이상은 보드 옆에 붙은 패널(기본 열림, 접은 선택을 새로고침 뒤에도 기억), 768~1279 px 는 화면 위에 뜨는 서랍(기본 닫힘).
//     서랍을 연 상태에서는 서랍과 막이 보드를 덮는 것이 설계라 스위치 노출은 단언하지 않고, 보드 배치가 그대로인지(겹침 0·가로 넘침 0·카드 위치 불변)를 본다.
//   · 기타를 연결하면 입력 줄이 한 줄 상태 막대로 줄어 1280×800 에서 첫 페달 카드 윗선이 320 px 이하다.
//   · 카드 안쪽 폭이 340 px 이하이면 Tremolo 의 Shape 가 선택 상자로 바뀐다(컨테이너 쿼리).
// 값은 지금도 기준선(docs/baseline/e2e.json)에 남긴다(E2E_UPDATE_BASELINE=1 일 때만 갱신).
// 설계서의 '900 px 높이에서 첫 줄 스위치가 스크롤 없이 보임'은 카드 속을 다시 짜야만 가능해서(REFACTOR_LOG L-71) 단언하지 않고 첫 화면 노출 수만 기록한다.
import type { Page } from '@playwright/test';
import { audioInputMenuToggle, audioInputPopover, connectButton, connectGuitar, disconnectButton, horizontalOverflow, openApp, panicButton, pedalCards, PEDAL_COUNT, setSidebar } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { overlapsInCard, type OverlapPair } from '../helpers/geometry';
import { recordMeasurement, recordScreenshot } from '../helpers/record';
import { DESKTOP_PROFILES } from '../helpers/screens';
import { describeSwitchReport, measureSwitches } from '../helpers/switches';
import { pedalRegionName } from '../helpers/ko-names';

/** useSidebar.ts 의 SIDEBAR_DOCK_MIN_WIDTH. 이 폭 이상이면 오른쪽 패널이 보드 옆에 붙고, 미만이면 서랍이다. */
const DOCK_MIN_WIDTH = 1280;
/** 설계서 S1.8 수용 기준: 연결한 뒤 1280×800 에서 첫 페달 카드 윗선(문서 위에서 px) */
const FIRST_PEDAL_TOP_LIMIT = 320;
/** 설계서 S1.8: 페달 격자의 한 칸 최소 폭(px). auto-fill 이라 이보다 좁은 카드는 생기지 않는다. */
const MIN_CARD_WIDTH = 300;
/** 설계서 S1.8: 카드 안쪽 폭이 이 값 이하이면 좁은 카드 규칙(컨테이너 쿼리)이 켜진다. */
const NARROW_CARD_CONTENT_PX = 340;
const UI_STORAGE_KEY = 'guitar-pedalboard:ui';

interface CardOverlap {
  card: string;
  count: number;
  boxes: number;
  pairs: OverlapPair[];
}

interface BoardGeometry {
  columns: number;
  cardWidthMin: number;
  cardWidthMax: number;
  boardWidth: number;
  firstCardLeft: number;
  /** 문서 위에서부터 첫 페달 카드 윗선까지(px) */
  firstCardTop: number;
}

/** 지금 스크롤 위치와 상관없이 페달 보드의 칸 수·카드 폭·첫 카드 위치를 읽는다. */
async function boardGeometry(page: Page): Promise<BoardGeometry> {
  return page.evaluate(() => {
    const board = document.querySelector('.pedal-board');
    const cards = Array.from(document.querySelectorAll('.pedal-board .pedal-card'));
    if (!board || cards.length === 0) throw new Error('페달 보드나 카드가 없다');
    const rects = cards.map((card) => card.getBoundingClientRect());
    const firstTop = rects[0].top;
    const widths = rects.map((rect) => rect.width);
    const round = (value: number) => Math.round(value * 10) / 10;
    return {
      columns: rects.filter((rect) => Math.abs(rect.top - firstTop) < 2).length,
      cardWidthMin: round(Math.min(...widths)),
      cardWidthMax: round(Math.max(...widths)),
      boardWidth: round(board.getBoundingClientRect().width),
      firstCardLeft: round(rects[0].left),
      firstCardTop: round(firstTop + window.scrollY),
    };
  });
}

async function overlapReport(page: Page): Promise<{ total: number; cards: string[]; overlaps: CardOverlap[]; detail: string }> {
  const cards = pedalCards(page);
  const overlaps: CardOverlap[] = [];
  for (let index = 0; index < PEDAL_COUNT; index += 1) {
    const card = cards.nth(index);
    const name = (await card.getAttribute('aria-label'))?.replace(/ 이펙터$/, '') ?? `card-${index}`;
    const report = await overlapsInCard(card);
    overlaps.push({ card: name, count: report.count, boxes: report.boxes, pairs: report.pairs });
  }
  const total = overlaps.reduce((sum, item) => sum + item.count, 0);
  const withOverlap = overlaps.filter((item) => item.count > 0);
  return {
    total,
    cards: withOverlap.map((item) => `${item.card}:${item.count}`),
    overlaps,
    detail: withOverlap.map((item) => `${item.card} [${item.pairs.map((pair) => `"${pair.a}"↔"${pair.b}" ${pair.width}×${pair.height}px`).join(', ')}]`).join(' | '),
  };
}

/**
 * 스크롤하지 않은 첫 화면에서, 첫 줄 페달 카드들의 스위치가 통째로 화면 안에 있고 다른 요소가 덮지 않았는지 센다(기록용).
 * 스위치는 카드 아래쪽에 있어서 카드가 큰 화면에서도 첫 줄 스위치는 대개 첫 화면 밖이다(L-71).
 */
async function firstScreenSwitches(page: Page): Promise<{ rowCards: number; visible: number; firstCardTop: number; firstSwitchBottom: number; viewportHeight: number }> {
  return page.evaluate(async () => {
    window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    const cards = Array.from(document.querySelectorAll('.pedal-board .pedal-card'));
    const firstTop = cards[0].getBoundingClientRect().top;
    const row = cards.filter((card) => Math.abs(card.getBoundingClientRect().top - firstTop) < 2);
    let visible = 0;
    let firstSwitchBottom = 0;
    row.forEach((card, index) => {
      const toggle = card.querySelector('.stomp-toggle-switch');
      if (!toggle) return;
      const rect = toggle.getBoundingClientRect();
      if (index === 0) firstSwitchBottom = rect.bottom;
      if (rect.top < 0 || rect.bottom > window.innerHeight || rect.left < 0 || rect.right > window.innerWidth) return;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (hit && (hit === toggle || toggle.contains(hit))) visible += 1;
    });
    return { rowCards: row.length, visible, firstCardTop: Math.round(firstTop), firstSwitchBottom: Math.round(firstSwitchBottom), viewportHeight: window.innerHeight };
  });
}

const sidebarToggle = (page: Page) => page.locator('.sidebar-toggle');
const sidebarPanel = (page: Page) => page.locator('#desktop-sidebar');
const drawerScrim = (page: Page) => page.locator('.sidebar-scrim');
const drawerCloseButton = (page: Page) => page.locator('#desktop-sidebar .sidebar-drawer-close');

async function storedUi(page: Page): Promise<unknown> {
  return page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as unknown);
  }, UI_STORAGE_KEY);
}

// ───────────────────────── 화면 폭 × 오디오 패널 펼침/접힘 ─────────────────────────
for (const screen of DESKTOP_PROFILES) {
  const docked = screen.width >= DOCK_MIN_WIDTH;
  test.describe(`E-06 데스크톱 배치 ${screen.name}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    for (const sidebar of ['open', 'collapsed'] as const) {
      // 서랍(768~1279 px)을 연 상태는 서랍과 막이 보드를 덮는 것이 설계다.
      const drawerOpen = !docked && sidebar === 'open';
      const panelLabel = docked ? '붙은 패널' : '서랍';
      test(`E-06 데스크톱 배치 ${screen.name} 오디오 패널 ${sidebar === 'open' ? '펼침' : '접힘'}`, async ({ page }) => {
        await openApp(page);
        const initial = await boardGeometry(page);
        await setSidebar(page, sidebar === 'open');
        if (sidebar === 'open') await expect(sidebarPanel(page)).toBeVisible();
        else await expect(sidebarPanel(page)).toBeHidden();
        const geometry = await boardGeometry(page);
        await recordScreenshot(page, { id: 'E-06', profile: screen.name, condition: `sidebar-${sidebar}` });

        const overlap = await overlapReport(page);
        const overflow = await horizontalOverflow(page);
        const switches = await measureSwitches(page);

        recordMeasurement({
          id: 'E-06',
          profile: screen.name,
          condition: `sidebar-${sidebar}`,
          summary: `${panelLabel} ${sidebar === 'open' ? '펼침' : '접힘'}: 글자 겹침 ${overlap.total}곳, ${describeSwitchReport(switches)}${drawerOpen ? '(서랍이 덮는 것은 설계)' : ''}, 카드 ${geometry.columns}칸 × 폭 ${geometry.cardWidthMin}px 이상, 가로 넘침 ${overflow}px`,
          values: {
            panel: docked ? 'docked' : 'drawer',
            overlapTotal: overlap.total,
            overlapCards: overlap.cards,
            overlaps: overlap.overlaps,
            switches,
            horizontalOverflowPx: overflow,
            columns: geometry.columns,
            cardWidthMin: geometry.cardWidthMin,
            cardWidthMax: geometry.cardWidthMax,
            boardWidth: geometry.boardWidth,
            firstCardTop: geometry.firstCardTop,
          },
        });

        expect(overlap.total, `${screen.name} ${panelLabel} ${sidebar}: 카드 안 글자 겹침 — ${overlap.detail}`).toBe(0);
        expect(overflow, `${screen.name} ${panelLabel} ${sidebar}: 문서 가로 넘침(px)`).toBe(0);
        expect(geometry.cardWidthMin, `${screen.name} ${panelLabel} ${sidebar}: 가장 좁은 카드 폭(px). 격자 최소 칸 폭은 ${MIN_CARD_WIDTH}px`).toBeGreaterThanOrEqual(MIN_CARD_WIDTH);
        expect(switches.count, `${screen.name}: 페달 스위치 수`).toBe(PEDAL_COUNT);
        if (drawerOpen) {
          // 서랍은 보드 위에 뜬다. 보드 배치(칸 수·카드 폭·위치)는 서랍을 열기 전과 같아야 한다.
          expect(geometry, `${screen.name}: 서랍을 열어도 보드 배치가 바뀌면 안 된다(열기 전 ${JSON.stringify(initial)})`).toEqual(initial);
        } else {
          expect(switches.reachable, `${screen.name} ${panelLabel} ${sidebar}: ${describeSwitchReport(switches)}`).toBe(PEDAL_COUNT);
          expect(switches.visibleRatioMin, `${screen.name} ${panelLabel} ${sidebar}: 가장 덜 보이는 스위치의 노출 비율`).toBe(1);
        }
      });
    }
  });
}

// ───────────────────────── 기타를 연결한 뒤 위쪽 압축 ─────────────────────────
for (const screen of DESKTOP_PROFILES) {
  test.describe(`E-06 연결한 뒤 ${screen.name}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    test(`E-06 연결한 뒤 ${screen.name}: 헤더 메뉴 줄에 상태가 모이고 보드는 밀리지 않으며 메뉴는 보드 위에 뜬다`, async ({ page }) => {
      await openApp(page);
      const idleGeometry = await boardGeometry(page);
      const idleTop = idleGeometry.firstCardTop;
      const idleScreen = await firstScreenSwitches(page);
      const logo = await page.locator('.app-logo-title img').boundingBox();

      // 연결 전: 헤더에는 메뉴 단추와 '기타 연결하기'만 있고, 입력 설정 패널은 접혀 있다(보드를 밀지 않는다).
      const toggle = audioInputMenuToggle(page);
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(audioInputPopover(page)).toBeHidden();
      await expect(connectButton(page)).toBeVisible();

      await connectGuitar(page);
      const bar = page.locator('.audio-input-menu-bar');
      await expect(bar.locator('.connect-status-device')).toBeVisible();
      await expect(bar.locator('.connect-status-latency')).toBeVisible();
      await expect(disconnectButton(page)).toBeVisible();
      await expect(panicButton(page)).toBeVisible();
      await expect(audioInputPopover(page)).toBeHidden();

      const geometry = await boardGeometry(page);
      const barBox = await bar.boundingBox();
      const connectedScreen = await firstScreenSwitches(page);
      const overflow = await horizontalOverflow(page);
      await recordScreenshot(page, { id: 'E-06', profile: screen.name, condition: 'connected' });
      recordMeasurement({
        id: 'E-06',
        profile: screen.name,
        condition: 'connected',
        summary: `연결한 뒤: 첫 페달 카드 윗선 ${geometry.firstCardTop}px(연결 전 ${idleTop}px), 메뉴 줄 높이 ${Math.round(barBox?.height ?? 0)}px, 첫 화면에서 첫 줄 스위치 ${connectedScreen.visible}/${connectedScreen.rowCards}개 보임(연결 전 ${idleScreen.visible}/${idleScreen.rowCards}), 가로 넘침 ${overflow}px`,
        values: {
          firstCardTop: geometry.firstCardTop,
          firstCardTopBeforeConnect: idleTop,
          statusBarHeight: Math.round(barBox?.height ?? 0),
          logoHeight: Math.round(logo?.height ?? 0),
          firstScreen: connectedScreen,
          firstScreenBeforeConnect: idleScreen,
          horizontalOverflowPx: overflow,
        },
      });

      expect(overflow, `${screen.name} 연결한 뒤: 문서 가로 넘침(px)`).toBe(0);
      // 연결해도 헤더 높이가 달라지면 안 된다(상태가 같은 줄에 들어간다). 1px 안쪽의 반올림은 허용.
      expect(Math.abs(geometry.firstCardTop - idleTop), `${screen.name}: 연결 전후 첫 페달 카드 윗선 차이(px)`).toBeLessThanOrEqual(2);
      if (screen.name === '1280x800') {
        expect(geometry.firstCardTop, `1280×800 연결한 뒤 첫 페달 카드 윗선(px). 설계서 S1.8 수용 기준 ≤ ${FIRST_PEDAL_TOP_LIMIT}px`).toBeLessThanOrEqual(FIRST_PEDAL_TOP_LIMIT);
      }

      // 메뉴를 열면 장치·채널·입력 트림 등 설정이 보이고, 보드 배치는 그대로이며, 가로로 넘치지 않는다.
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(audioInputPopover(page)).toBeVisible();
      await expect(audioInputPopover(page).locator('#input-channel')).toBeVisible();
      await expect(audioInputPopover(page).locator('label.io-slider-control', { hasText: '입력 트림' })).toBeVisible();
      expect(await boardGeometry(page), `${screen.name}: 메뉴를 열어도 보드 배치가 바뀌면 안 된다`).toEqual(geometry);
      expect(await horizontalOverflow(page), `${screen.name}: 메뉴를 연 뒤 가로 넘침(px)`).toBe(0);
      const popoverBox = await audioInputPopover(page).boundingBox();
      expect(popoverBox && popoverBox.x >= 0 && popoverBox.x + popoverBox.width <= screen.width, `${screen.name}: 메뉴가 화면 안에 들어와야 한다`).toBe(true);
      // 단추를 다시 누르면 닫힌다.
      await toggle.click();
      await expect(audioInputPopover(page)).toBeHidden();
    });
  });
}

// ───────────────────────── 오른쪽 오디오 패널 동작 ─────────────────────────
test.describe('E-06 오른쪽 오디오 패널 서랍(768~1279 px)', () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test('E-06 서랍: 처음엔 닫혀 있고, 열어도 보드 배치가 그대로이며, 닫기 버튼·Esc·바깥 막으로 닫히고 열림은 저장하지 않는다', async ({ page }) => {
    await openApp(page);
    const toggle = sidebarToggle(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('오디오 패널 펼치기');
    await expect(toggle).toHaveAttribute('aria-controls', 'desktop-sidebar');
    await expect(sidebarPanel(page)).toBeHidden();
    await expect(drawerScrim(page)).toHaveCount(0);
    const closed = await boardGeometry(page);

    for (const how of ['닫기 버튼', 'Esc', '바깥 막'] as const) {
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(toggle).toHaveText('오디오 패널 접기');
      await expect(sidebarPanel(page)).toBeVisible();
      await expect(sidebarPanel(page)).toHaveClass(/is-drawer/);
      await expect(drawerScrim(page)).toBeVisible();
      // 열리면 키보드 사용자가 길을 잃지 않게 포커스가 서랍 안(닫기 버튼)으로 간다.
      await expect(drawerCloseButton(page)).toBeFocused();
      expect(await boardGeometry(page), `${how}: 서랍이 열려도 보드 배치는 그대로`).toEqual(closed);
      const box = await sidebarPanel(page).boundingBox();
      expect(box, '서랍 상자').not.toBeNull();
      expect(Math.round((box?.x ?? 0) + (box?.width ?? 0)), '서랍은 화면 오른쪽 끝에 붙는다').toBeGreaterThanOrEqual(1023);
      expect(box?.width ?? 0, '서랍 폭은 화면의 90% 이하').toBeLessThanOrEqual(1024 * 0.9 + 1);
      expect(await horizontalOverflow(page), '서랍을 열어도 가로로 넘치지 않는다').toBe(0);

      if (how === '닫기 버튼') await drawerCloseButton(page).click();
      else if (how === 'Esc') await page.keyboard.press('Escape');
      else await drawerScrim(page).click({ position: { x: 24, y: 300 } });

      await expect(toggle, `${how}으로 닫은 뒤`).toHaveAttribute('aria-expanded', 'false');
      await expect(sidebarPanel(page)).toBeHidden();
      await expect(drawerScrim(page)).toHaveCount(0);
      // 닫은 뒤 포커스는 여는 버튼으로 돌아온다(바깥 막을 눌러 닫을 때도 같다).
      await expect(toggle, `${how}으로 닫은 뒤 포커스`).toBeFocused();
    }

    // 서랍은 화면을 덮는 임시 창이라 열림을 저장하지 않는다. 새로고침하면 다시 닫혀 있다.
    expect(await storedUi(page), '서랍을 여닫아도 guitar-pedalboard:ui 는 쓰이지 않는다').toBeNull();
    await toggle.click();
    await expect(sidebarPanel(page)).toBeVisible();
    await page.reload();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await expect(sidebarToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebarPanel(page)).toBeHidden();
  });

  test('E-06 서랍: 서랍 안의 글자 칸·선택 상자에서 누른 Esc 는 서랍을 닫지 않는다', async ({ page }) => {
    await openApp(page);
    await sidebarToggle(page).click();
    await expect(sidebarPanel(page)).toBeVisible();
    // 서랍 안의 선택 상자(프리셋 불러오기 등)는 Esc 로 자기 목록을 닫는 것이 먼저다.
    const select = sidebarPanel(page).locator('select:visible').first();
    await expect(select, '서랍 안에 선택 상자가 있어야 이 시험이 의미가 있다').toBeVisible();
    await select.focus();
    await expect(select).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sidebarPanel(page)).toBeVisible();
    await expect(sidebarToggle(page)).toHaveAttribute('aria-expanded', 'true');
  });
});

test.describe('E-06 오른쪽 오디오 패널 붙은 패널(1280 px 이상)', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('E-06 붙은 패널: 처음엔 열려 있고, 접은 선택을 새로고침 뒤에도 기억한다', async ({ page }) => {
    await openApp(page);
    const toggle = sidebarToggle(page);
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(toggle).toHaveText('오디오 패널 접기');
    await expect(sidebarPanel(page)).toBeVisible();
    await expect(sidebarPanel(page)).not.toHaveClass(/is-drawer/);
    await expect(drawerScrim(page)).toHaveCount(0);
    await expect(drawerCloseButton(page)).toHaveCount(0);
    expect(await storedUi(page), '아무것도 고르지 않았으면 저장도 없다').toBeNull();
    const openGeometry = await boardGeometry(page);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveText('오디오 패널 펼치기');
    await expect(sidebarPanel(page)).toBeHidden();
    expect(await storedUi(page)).toEqual({ sidebarOpen: false });
    expect((await boardGeometry(page)).boardWidth, '패널을 접으면 보드가 넓어진다').toBeGreaterThan(openGeometry.boardWidth);

    await page.reload();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await expect(sidebarToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebarPanel(page)).toBeHidden();

    await sidebarToggle(page).click();
    await expect(sidebarPanel(page)).toBeVisible();
    expect(await storedUi(page)).toEqual({ sidebarOpen: true });
    await page.reload();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await expect(sidebarToggle(page)).toHaveAttribute('aria-expanded', 'true');
    await expect(sidebarPanel(page)).toBeVisible();
  });

  test('E-06 창 폭이 1280 px 경계를 넘나들면 붙은 패널과 서랍이 서로의 선택을 건드리지 않고 바뀐다', async ({ page }) => {
    await openApp(page);
    await sidebarToggle(page).click(); // 붙은 패널을 접어 둔다(저장됨)
    await expect(sidebarPanel(page)).toBeHidden();

    await page.setViewportSize({ width: 1024, height: 768 });
    await expect(sidebarToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await sidebarToggle(page).click();
    await expect(sidebarPanel(page)).toBeVisible();
    await expect(sidebarPanel(page)).toHaveClass(/is-drawer/);
    await expect(drawerScrim(page)).toBeVisible();

    // 서랍이 열린 채 넓은 화면으로 돌아오면, 서랍은 닫히고 붙은 패널은 저장해 둔 대로(접힘)다.
    await page.setViewportSize({ width: 1440, height: 900 });
    await expect(sidebarToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebarPanel(page)).toBeHidden();
    await expect(drawerScrim(page)).toHaveCount(0);
    expect(await storedUi(page), '서랍이 붙은 패널의 저장값을 바꾸면 안 된다').toEqual({ sidebarOpen: false });

    // 붙은 패널을 펴 두고 좁은 화면으로 가면 서랍은 닫혀 있다(붙은 패널의 '열림'이 서랍을 열어 두지 않는다).
    await sidebarToggle(page).click();
    await expect(sidebarPanel(page)).toBeVisible();
    await page.setViewportSize({ width: 1100, height: 800 });
    await expect(sidebarToggle(page)).toHaveAttribute('aria-expanded', 'false');
    await expect(sidebarPanel(page)).toBeHidden();
    expect(await storedUi(page)).toEqual({ sidebarOpen: true });
  });

  // 붙은 패널/서랍을 고르는 기준이 두 곳에 있다 — useSidebar.ts 의 matchMedia(JS)와 layout.css 의 @media(CSS). 둘의 기준 폭이 어긋나면
  // 1279~1280 px 사이에서 한쪽은 서랍, 한쪽은 붙은 패널로 그려진다. 경계의 양쪽 정확한 폭에서 JS 가 고른 방식과 CSS 가 그린 방식이 같은지 본다.
  for (const edge of [
    { width: DOCK_MIN_WIDTH - 1, mode: 'drawer' },
    { width: DOCK_MIN_WIDTH, mode: 'docked' },
  ] as const) {
    test(`E-06 경계 ${edge.width}px: JS 가 고른 방식(${edge.mode})과 CSS 가 그린 방식이 같다`, async ({ page }) => {
      await page.setViewportSize({ width: edge.width, height: 800 });
      await openApp(page);
      const toggle = sidebarToggle(page);
      const panel = sidebarPanel(page);
      if (edge.mode === 'drawer') {
        await expect(toggle, '서랍은 처음에 닫혀 있다').toHaveAttribute('aria-expanded', 'false');
        const closed = await boardGeometry(page);
        await toggle.click();
        await expect(panel).toBeVisible();
        await expect(panel).toHaveClass(/is-drawer/);
        await expect(drawerScrim(page)).toBeVisible();
        expect(await panel.evaluate((el) => getComputedStyle(el).position), 'CSS 가 서랍을 화면에 띄워(fixed) 그렸는지').toBe('fixed');
        expect(await boardGeometry(page), '서랍을 열어도 보드 배치가 그대로다').toEqual(closed);
      } else {
        await expect(toggle, '붙은 패널은 처음에 열려 있다').toHaveAttribute('aria-expanded', 'true');
        await expect(panel).toBeVisible();
        await expect(panel).not.toHaveClass(/is-drawer/);
        await expect(drawerScrim(page)).toHaveCount(0);
        expect(await panel.evaluate((el) => getComputedStyle(el).position), 'CSS 가 붙은 패널을 보드 옆 격자 칸에 그렸는지').not.toBe('fixed');
        const boardRight = await page.evaluate(() => Math.round(document.querySelector('.pedal-board')?.getBoundingClientRect().right ?? Number.NaN));
        const panelLeft = await panel.evaluate((el) => Math.round(el.getBoundingClientRect().left));
        expect(panelLeft, '붙은 패널은 보드의 오른쪽 옆에 놓인다(보드 위에 겹치지 않는다)').toBeGreaterThanOrEqual(boardRight);
      }
      expect(await horizontalOverflow(page), `${edge.width}px 문서의 가로 넘침`).toBe(0);
    });
  }
});

// ───────────────────────── 좁은 카드(컨테이너 쿼리) ─────────────────────────
test.describe('E-06 좁은 카드', () => {
  const cases = [
    { width: 1024, height: 768, panel: 'closed' },
    { width: 1440, height: 900, panel: 'open' },
    { width: 1440, height: 900, panel: 'closed' },
    { width: 1920, height: 1080, panel: 'closed' },
  ] as const;

  test('E-06 카드 안쪽 폭이 340 px 이하이면 Tremolo Shape 가 선택 상자로, 넓으면 세 버튼으로 보인다', async ({ page }) => {
    const seen = { narrow: 0, wide: 0 };
    for (const item of cases) {
      await page.setViewportSize({ width: item.width, height: item.height });
      await openApp(page);
      await setSidebar(page, item.panel === 'open');
      const card = page.locator(`.pedal-card[aria-label="${pedalRegionName('Tremolo')}"]`);
      await expect(card).toHaveCount(1);
      const contentWidth = await card.evaluate((element) => {
        const style = getComputedStyle(element);
        return element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
      });
      const label = `${item.width}×${item.height} 패널 ${item.panel}: Tremolo 카드 안쪽 폭 ${contentWidth.toFixed(1)}px`;
      const select = card.locator('.tremolo-shape-select');
      const buttons = card.locator('.tremolo-shape-selector button');
      if (Math.abs(contentWidth - NARROW_CARD_CONTENT_PX) <= 1) continue; // 경계 근처의 반올림은 판정하지 않는다.
      if (contentWidth <= NARROW_CARD_CONTENT_PX) {
        seen.narrow += 1;
        await expect(select, `${label} → 선택 상자가 보여야 한다`).toBeVisible();
        await expect(buttons.first(), `${label} → 세 버튼은 숨겨진다`).toBeHidden();
        // 선택 상자로 고른 값이 실제 파라미터(숨은 버튼의 눌림 상태)에 반영된다.
        await select.selectOption('square');
        await expect(card.locator('.tremolo-shape-selector button[aria-pressed="true"]')).toHaveText('square');
        await select.selectOption('sine');
        await expect(card.locator('.tremolo-shape-selector button[aria-pressed="true"]')).toHaveText('sine');
      } else {
        seen.wide += 1;
        await expect(select, `${label} → 선택 상자는 숨겨진다`).toBeHidden();
        await expect(buttons, `${label} → 세 버튼이 보여야 한다`).toHaveCount(3);
        await expect(buttons.first()).toBeVisible();
      }
      // 좁든 넓든 노브 이름은 한 줄이고 카드 밖으로 나가지 않는다(글자 겹침은 위 표에서 본다).
      expect(await horizontalOverflow(page), `${label}: 가로 넘침`).toBe(0);
    }
    expect(seen.narrow, '좁은 카드 사례가 하나 이상 있어야 이 시험이 의미가 있다').toBeGreaterThan(0);
    expect(seen.wide, '넓은 카드 사례가 하나 이상 있어야 이 시험이 의미가 있다').toBeGreaterThan(0);
  });
});
