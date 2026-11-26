// 앱을 열고 조작하는 공통 도우미.
import { expect, type Locator, type Page } from '@playwright/test';

/** 기본 페달 수. 페달을 더하거나 빼는 Step 이 있으면 이 값과 시험을 같이 바꾼다. */
export const PEDAL_COUNT = 15;

/** 앱을 열고 페달 카드가 모두 그려질 때까지 기다린다(baseURL 은 `/Guitar-Pedalboard/`). */
export async function openApp(page: Page): Promise<void> {
  await page.goto('./');
  await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
}

export function pedalCards(page: Page): Locator {
  return page.locator('.pedal-board .pedal-card');
}

/** 페달 카드마다 하나씩 있는 '효과' 켜고 끄는 스위치(StompToggleSwitch) */
export function pedalSwitches(page: Page): Locator {
  return page.locator('.pedal-board .pedal-card .stomp-toggle-switch');
}

/** 모바일 하단 도크의 탭. '페달' 은 도크가 접힌 상태(탭 줄만 보임), 나머지는 그 탭의 패널을 펼친 상태다(S1.6). */
export type MobileTab = 'pedals' | 'input' | 'meter' | 'preset';

/** 모바일 하단 도크의 탭을 고른다(모바일 배치에서만 있다). 이미 선택된 탭이면 다시 누르지 않는다(다시 누르면 접히기 때문이다). */
export async function selectMobileTab(page: Page, tab: MobileTab): Promise<void> {
  const button = page.locator(`#mobile-tab-${tab}`);
  await expect(button).toBeVisible();
  if ((await button.getAttribute('aria-selected')) === 'true') return;
  await button.click();
  await expect(button).toHaveAttribute('aria-selected', 'true');
}

/**
 * 모바일 하단 도크를 펼치거나 접는다. 펼치면 `tab`(기본 '입력')의 패널이 열리고, 접으면 '페달' 탭이 선택된다.
 * 도크 높이를 `--dock-h` 에 적는 ResizeObserver 는 비동기라, 그 값이 도크의 실제 높이와 같아질 때까지 기다렸다가 돌아온다.
 */
export async function setMobileDock(page: Page, open: boolean, tab: Exclude<MobileTab, 'pedals'> = 'input'): Promise<void> {
  await selectMobileTab(page, open ? tab : 'pedals');
  await expect
    .poll(() =>
      page.evaluate(() => {
        const dock = document.querySelector('.mobile-control-dock');
        const published = document.documentElement.style.getPropertyValue('--dock-h');
        return dock ? published === `${Math.ceil(dock.getBoundingClientRect().height)}px` : false;
      }),
    )
    .toBe(true);
}

/**
 * 데스크톱 오른쪽 오디오 패널(사이드바)을 펼치거나 접는다(768 px 이상에서만 있다).
 * 1280 px 이상에서는 페달 보드 옆에 붙은 패널이고, 768~1279 px 에서는 화면 위에 뜨는 서랍이다(S1.8).
 * 서랍이 열려 있으면 여는 버튼이 서랍·막 뒤에 가려지므로 닫을 때는 서랍 안의 '오디오 패널 닫기' 버튼을 누른다.
 */
export async function setSidebar(page: Page, open: boolean): Promise<void> {
  const toggle = page.locator('.sidebar-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) === String(open)) return;
  if (!open && (await page.locator('#desktop-sidebar.is-drawer').count()) > 0) {
    await page.locator('#desktop-sidebar .sidebar-drawer-close').click();
  } else {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute('aria-expanded', String(open));
}

/** 가로로 넘치는 폭(px). 0 이면 문서가 화면 폭 안에 있다. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
}

/**
 * '기타 연결하기'를 마우스로 누르고 연결될 때까지 기다린다.
 * 한동안(REFACTOR_LOG F-1, S1.6 에서 고침) 그래픽 EQ 의 숫자 입력이 화면 전체를 덮는 투명 입력이 되어 이 버튼을 마우스로 누를 수 없었고,
 * 그동안은 포커스 + Enter 로 대신했다. 이제 실제 클릭으로 돌아왔으므로 같은 결함이 되살아나면(가려진 버튼) Playwright 가 클릭 단계에서 바로 실패한다.
 * 클릭도 신뢰할 수 있는 사용자 입력이라 AudioContext 가 정상으로 시작된다.
 */
export async function connectGuitar(page: Page): Promise<void> {
  await connectButton(page).click();
  await expect(disconnectButton(page)).toBeVisible({ timeout: 15_000 });
}

/** 상단 헤더의 '오디오 입력' 메뉴 단추 */
export const audioInputMenuToggle = (page: Page): Locator => page.locator('.audio-input-menu-toggle');
/** 메뉴 안(장치·채널·MIDI·음원 파일·입력 트림·하울링 보호)이 담긴 팝오버 */
export const audioInputPopover = (page: Page): Locator => page.locator('#audio-input-popover');

/** '오디오 입력' 메뉴를 연다(이미 열려 있으면 그대로 둔다). 기타 연결·연결 해제·긴급 정지는 메뉴 밖 헤더 줄에 있어 열지 않아도 된다. */
export async function openAudioInputMenu(page: Page): Promise<void> {
  const toggle = audioInputMenuToggle(page);
  // 휴대폰 배치(하단 도크)에는 메뉴가 없고 입력 패널이 '입력' 탭에 그대로 있다.
  if ((await toggle.count()) === 0) return;
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(audioInputPopover(page)).toBeVisible();
}

export const connectButton = (page: Page): Locator => page.getByRole('button', { name: '기타 연결하기' });
export const disconnectButton = (page: Page): Locator => page.getByRole('button', { name: '연결 해제' });
/** 연결되어 있을 때만 그려지는 긴급 정지 버튼 */
export const panicButton = (page: Page): Locator => page.locator('.panic-button');

export type RecordingFormat = 'wav' | 'webm';

/** 녹음 패널의 형식 메뉴를 고른다(S5.1: 처음 열면 'wav'. 'webm' 은 '작은 파일'). 데스크톱 화면 기준. */
export async function chooseRecordingFormat(page: Page, format: RecordingFormat): Promise<void> {
  await page.locator('.recording-panel label', { hasText: '녹음 형식' }).locator('select').selectOption(format);
}
