// E-22 한국어 문구 통일(S4.6, 설계서 4.6절 인수 기준).
//   ① 화면에 내부 이름(camelCase 이펙터 키: noiseGate·autoWah·graphicEQ 같은 것)이 한 글자도 나오지 않는다.
//   ② 못 박아 둔 영어 시스템 문구 목록이 화면 어디에도 나오지 않는다 — 토스트·오류·안내까지 포함(여러 상태에서 훑는다).
//   ③ 처음 화면에 브라우저 기본 영어 버튼(파일 입력의 'Choose File' / 'No file chosen')이 보이지 않는다.
//   ④ 슬라이더·숫자 입력·선택 상자·스위치는 모두 한글이 들어 있는 접근성 이름을 가진다(스크린 리더가 영어 약어만 읽지 않는다).
// 페달 얼굴에 인쇄된 이름·노브 약어(Drive, Tone, D.Time …)와 프리셋 이름은 영어로 남는다(설계서 4.6절) — 위 목록에 없다.
// '쓰지 않는 키 0개'와 '문구를 코드에 직접 쓰지 않음'은 정적 검사(npm run test:ko-catalog)가 본다.
import { expect, type Page } from '@playwright/test';
import { connectGuitar, openApp, pedalCards, pedalSwitches, selectMobileTab, setSidebar } from '../helpers/app';
import { test } from '../helpers/fixtures';
import { saveUserPreset } from '../helpers/preset-io';
import { toastOf } from '../helpers/storage';

interface Seen {
  kind: 'text' | 'aria-label' | 'title' | 'alt' | 'placeholder';
  text: string;
  where: string;
}

/** 이 글자가 통째로 나오면 안 되는 영어 시스템 문구(요소 하나의 글자·이름이 이것과 같을 때) */
const PINNED_EXACT = [
  'Audio Input',
  'Monitor',
  'Pedalboard',
  'Keyboard',
  'Panic',
  'Open',
  'Closed',
  'Waveform',
  'Input',
  'Output',
  'Choose File',
  'No file chosen',
  'Undo',
  'Dismiss',
  'Close',
  'Cancel',
];

/** 글자 안에 이것이 들어 있으면 안 되는 영어 시스템 문구 */
const PINNED_CONTAINS = [
  'Gate: ',
  'Preset saved',
  'Signal Chain Updated',
  'Click-Safe Amplitude Modulation',
  'Multi Stage All-Pass',
  'Multi Voice Modulation',
  'Regenerative Jet Modulation',
  'Touch Responsive Filter',
  'Choose File',
  'No file chosen',
];

/** 접근성 이름이 이 영어 꼬리로 끝나면 안 된다(예전에는 'Drive controls', 'Drive icon' 이었다) */
const PINNED_SUFFIX = / (controls|icon)$/;

/** camelCase 낱말: 앱 안의 이름(이펙터 키·상태 값)이 화면에 새면 이런 꼴이다. */
const INTERNAL_ID = /\b(?:[a-z]+(?:[A-Z][a-z0-9]*)+|[a-z]+[A-Z]{2,})\b/;
/** 대소문자가 섞여 있지만 단위 표기라 내부 이름이 아닌 것(dB·dBpk·dBFS·kHz) */
const UNITS = /\b(?:dB|dBpk|dBFS|kHz)\b/g;
const EFFECT_KEYS = ['noiseGate', 'compressor', 'autoWah', 'drive', 'crunch', 'fuzz', 'graphicEQ', 'eq', 'cab', 'chorus', 'flanger', 'phaser', 'tremolo', 'delay', 'reverb'];

/** 지금 화면에 보이는 글자와, 스크린 리더가 읽는 이름(aria-label·title·alt·placeholder)을 모은다. */
async function screenTexts(page: Page): Promise<Seen[]> {
  return page.evaluate(() => {
    const seen: Array<{ kind: string; text: string; where: string }> = [];
    const visible = (element: Element): boolean => {
      const check = (element as Element & { checkVisibility?: (options?: object) => boolean }).checkVisibility;
      if (typeof check === 'function') return check.call(element, { checkVisibilityCSS: true });
      const rect = (element as HTMLElement).getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const where = (element: Element): string => {
      const className = (element as HTMLElement).className;
      const classes = typeof className === 'string' ? className.split(' ').filter(Boolean).slice(0, 2).join('.') : '';
      return `${element.tagName.toLowerCase()}${classes ? `.${classes}` : ''}`;
    };
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = (node.textContent ?? '').trim();
      const parent = node.parentElement;
      if (!text || !parent || parent.closest('script,style,noscript') || !visible(parent)) continue;
      seen.push({ kind: 'text', text, where: where(parent) });
    }
    for (const element of Array.from(document.querySelectorAll('[aria-label],[title],[placeholder],img[alt]'))) {
      if (!visible(element)) continue;
      for (const kind of ['aria-label', 'title', 'alt', 'placeholder'] as const) {
        const value = element.getAttribute(kind);
        if (value) seen.push({ kind, text: value, where: where(element) });
      }
    }
    return seen;
  }) as Promise<Seen[]>;
}

/** 못 박은 목록과 내부 이름 검사. 걸린 것을 `상태 · 종류 · 글자` 로 돌려 준다. */
function violations(state: string, seen: Seen[]): string[] {
  const found: string[] = [];
  for (const { kind, text, where } of seen) {
    const label = `${state} · ${kind} · ${where} · ${JSON.stringify(text)}`;
    if (PINNED_EXACT.includes(text)) found.push(`영어 시스템 문구 — ${label}`);
    for (const phrase of PINNED_CONTAINS) if (text.includes(phrase)) found.push(`영어 시스템 문구 — ${label}`);
    if (kind !== 'text' && PINNED_SUFFIX.test(text)) found.push(`영어 꼬리(controls·icon) — ${label}`);
    if (INTERNAL_ID.test(text.replace(UNITS, ''))) found.push(`내부 이름 — ${label}`);
    for (const key of EFFECT_KEYS) {
      // 한 낱말로 단독 표기된 소문자 이펙터 키만 내부 이름으로 본다(페달 얼굴의 'Drive' 같은 대문자 표기는 얼굴 글자다).
      if (text === key && key !== key.toLowerCase()) found.push(`내부 이름 — ${label}`);
    }
  }
  return found;
}

/** 한글이 하나도 없는 접근성 이름을 가진 입력 요소를 찾는다. */
async function nameless(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const result: string[] = [];
    const selector = 'input[type=range],input[type=number],input[type=checkbox],input[type=text],input:not([type]),select,textarea,[role=switch],[role=slider],[role=spinbutton],[role=meter]';
    const nameOf = (element: Element): string => {
      const aria = element.getAttribute('aria-label');
      if (aria) return aria;
      const by = element.getAttribute('aria-labelledby');
      if (by) return by.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
      const id = element.getAttribute('id');
      const label = (id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null) ?? element.closest('label');
      if (label?.textContent) return label.textContent;
      return element.getAttribute('title') ?? '';
    };
    for (const element of Array.from(document.querySelectorAll(selector))) {
      const style = getComputedStyle(element);
      if (style.display === 'none') continue;
      if (element instanceof HTMLInputElement && element.type === 'file') continue;
      const name = nameOf(element).trim();
      if (!/[가-힣]/.test(name)) result.push(`${element.tagName.toLowerCase()}${element.getAttribute('type') ? `[${element.getAttribute('type')}]` : ''} ${JSON.stringify(name)}`);
    }
    return result;
  });
}

async function expectClean(page: Page, state: string): Promise<void> {
  const found = violations(state, await screenTexts(page));
  expect(found, `${state}: 영어 시스템 문구·내부 이름이 화면에 나온다`).toEqual([]);
  expect(await nameless(page), `${state}: 한글이 없는 접근성 이름`).toEqual([]);
}

test.describe('E-22 한국어 문구 통일', () => {
  test('E-22 ③ 처음 화면(데스크톱·연결 전)에 브라우저 기본 영어 파일 버튼이 없다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    // 파일 입력은 있어도 화면에 그려지지 않는다(눌리는 것은 한국어 버튼이다).
    const visibleFileInputs = await page.evaluate(() =>
      Array.from(document.querySelectorAll('input[type=file]')).filter((input) => {
        const style = getComputedStyle(input);
        const rect = input.getBoundingClientRect();
        return style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 1 && rect.height > 1;
      }).length,
    );
    expect(visibleFileInputs, '화면에 그려지는 파일 입력(브라우저 기본 영어 버튼)').toBe(0);
    await expectClean(page, '데스크톱·연결 전');
  });

  test('E-22 ①② 데스크톱: 연결 전·연결 후·사이드바 접힘 상태에 내부 이름과 영어 시스템 문구가 없다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    await expectClean(page, '데스크톱·연결 전');
    await connectGuitar(page);
    await expectClean(page, '데스크톱·연결 후');
    await setSidebar(page, false);
    await expectClean(page, '데스크톱·사이드바 접힘');
  });

  test('E-22 ①② 폰: 도크의 모든 탭에서 내부 이름과 영어 시스템 문구가 없다', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openApp(page);
    for (const tab of ['input', 'meter', 'preset', 'pedals'] as const) {
      await selectMobileTab(page, tab);
      await expectClean(page, `폰·연결 전·${tab} 탭`);
    }
    await selectMobileTab(page, 'input'); // 연결 버튼은 '입력' 탭 패널에 있다
    await connectGuitar(page);
    for (const tab of ['input', 'meter', 'preset', 'pedals'] as const) {
      await selectMobileTab(page, tab);
      await expectClean(page, `폰·연결 후·${tab} 탭`);
    }
  });

  test('E-22 ② 알림: 저장·삭제(되돌리기)·초기화·순서 변경 때 뜨는 문구가 모두 한국어다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);

    await saveUserPreset(page, 'E22');
    await expectClean(page, '프리셋 저장 직후');
    await expect(page.locator('.preset-message')).toHaveText('프리셋을 저장했습니다.');

    await page.getByRole('button', { name: 'E22 삭제', exact: true }).click();
    const deleted = page.locator('.toast[data-toast-key^="preset-deleted:"]');
    await expect(deleted).toHaveCount(1);
    await expect(deleted.getByRole('button', { name: '실행 취소', exact: true })).toBeVisible();
    await expectClean(page, '프리셋 삭제 알림');
    await deleted.getByRole('button', { name: '실행 취소', exact: true }).click();
    await expect(deleted).toHaveCount(0);
    await expectClean(page, '삭제 되돌린 직후');

    // 보드가 이미 처음 상태면 알림 없이 안내만 나온다 — 하나 바꾼 뒤 초기화한다.
    await pedalSwitches(page).nth(5).click();
    await page.locator('.preset-reset-button').click();
    const reset = toastOf(page, 'chain-reset');
    await expect(reset).toBeVisible();
    await expectClean(page, '초기화 알림');
    await reset.getByRole('button', { name: '실행 취소', exact: true }).click();

    // 페달을 끌어 순서를 바꾸면 '페달 순서가 변경되었습니다.' 가 뜬다.
    const handle = pedalCards(page).nth(3).locator('.drag-handle');
    await handle.scrollIntoViewIfNeeded();
    const from = await handle.boundingBox();
    const to = await pedalCards(page).nth(4).boundingBox();
    if (!from || !to) throw new Error('끌 자리를 알 수 없습니다');
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let step = 1; step <= 20; step += 1) {
      await page.mouse.move(
        from.x + from.width / 2 + ((to.x + to.width / 2 - from.x - from.width / 2) * step) / 20,
        from.y + from.height / 2 + ((to.y + to.height / 2 - from.y - from.height / 2) * step) / 20,
      );
      await page.waitForTimeout(16);
    }
    await page.mouse.up();
    await expect(page.locator('.chain-toast')).toHaveText('페달 순서가 변경되었습니다.');
    await expectClean(page, '순서 변경 알림');
  });

  test('E-22 ① 카드 이름: 모든 페달 카드·드래그 손잡이·MIDI 버튼이 한국어 이름을 가진다', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await openApp(page);
    const names = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.pedal-board .pedal-card')).map((card) => ({
        region: card.getAttribute('aria-label') ?? '',
        handle: card.querySelector('.drag-handle')?.getAttribute('aria-label') ?? '',
        midi: Array.from(card.querySelectorAll('.midi-learn-button')).map((button) => button.getAttribute('aria-label') ?? (button.textContent ?? '').trim()),
      })),
    );
    expect(names).toHaveLength(15);
    for (const { region, handle, midi } of names) {
      expect(region, '카드 이름').toMatch(/^[가-힣 ]+ 이펙터$/);
      expect(handle, '드래그 손잡이 이름').toMatch(/^[가-힣 ]+ 순서 변경$/);
      for (const label of midi) expect(label, 'MIDI 버튼 이름').toMatch(/^(?:[가-힣 ]+ MIDI (?:학습|메뉴)(?: 취소)?|MIDI 설정|방식: [가-힣]+)$/);
    }
    // 카드마다 다른 이름이어야 스크린 리더로 구별할 수 있다.
    expect(new Set(names.map((entry) => entry.region)).size, '카드 이름은 서로 다르다').toBe(15);
  });
});
