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

/** 모바일 하단 도크를 펼치거나 접는다(모바일 배치에서만 있다). */
export async function setMobileDock(page: Page, open: boolean): Promise<void> {
  const toggle = page.locator('.mobile-dock-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) === String(open)) return;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', String(open));
}

/** 데스크톱 오른쪽 오디오 패널(사이드바)을 펼치거나 접는다(768 px 이상에서만 있다). */
export async function setSidebar(page: Page, open: boolean): Promise<void> {
  const toggle = page.locator('.sidebar-toggle');
  await expect(toggle).toBeVisible();
  if ((await toggle.getAttribute('aria-expanded')) === String(open)) return;
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', String(open));
}

/** 가로로 넘치는 폭(px). 0 이면 문서가 화면 폭 안에 있다. */
export async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth));
}

/**
 * '기타 연결하기'를 키보드(포커스 + Enter)로 누르고 연결될 때까지 기다린다.
 * 마우스 클릭 대신 키보드를 쓰는 이유: 현재 앱은 그래픽 EQ 의 숫자 입력이 페이지 전체를 덮는 투명 입력이 되어
 * (`.vertical-fader input` 규칙에 걸림, REFACTOR_LOG F-1) 데스크톱에서도 연결 버튼을 마우스로 누를 수 없다.
 * 키보드 Enter 는 신뢰할 수 있는 사용자 입력이라 AudioContext 도 정상으로 시작된다.
 * 겹침이 고쳐진 뒤에도 이 방식은 그대로 유효하다.
 */
export async function connectGuitar(page: Page): Promise<void> {
  const connect = page.getByRole('button', { name: '기타 연결하기' });
  await connect.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '연결 해제' })).toBeVisible({ timeout: 15_000 });
}

export const connectButton = (page: Page): Locator => page.getByRole('button', { name: '기타 연결하기' });
export const disconnectButton = (page: Page): Locator => page.getByRole('button', { name: '연결 해제' });
/** 연결되어 있을 때만 그려지는 긴급 정지 버튼 */
export const panicButton = (page: Page): Locator => page.locator('.panic-button');

/**
 * 버튼을 키보드(포커스 + Enter)로 누른다. 마우스 클릭을 쓰지 않는 이유는 connectGuitar 의 설명과 같다
 * (그래픽 EQ 숫자 입력이 화면을 덮는 문제 F-1). 키보드 입력도 신뢰할 수 있는 사용자 동작이다.
 */
export async function activate(page: Page, button: Locator): Promise<void> {
  await button.focus();
  await page.keyboard.press('Enter');
}
