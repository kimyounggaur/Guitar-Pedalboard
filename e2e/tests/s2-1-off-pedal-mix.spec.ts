// S2.1 꺼진 페달의 Mix 0% 바로잡기(R2-2) — 브라우저에서 눈에 보이는 결과.
//   · 옛 저장본(픽스처 04: Delay·Reverb·Chorus 가 꺼져 있고 Mix 0%)을 열면 세 페달의 Mix 가 기본값(30·25·35%)으로 열리고 꺼진 채다.
//   · 그 페달을 켜도 Mix 는 기본값 그대로다(켠 뒤에도 0% 로 돌아가지 않는다).
//   · 저장돼 있던 사용자 프리셋을 불러와도 같다.
//   · 공장 프리셋을 불러온 뒤 꺼져 있는 페달 가운데 Mix 가 0% 인 것이 없다.
// 소리가 실제로 바뀌는지(켜면 출력이 달라지는지, 불러온 직후 소리가 같은지)는 오프라인 렌더 프로브 P-18 이 잰다.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { openApp, pedalCards } from '../helpers/app';
import { fixturesDir } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';

const fixture = JSON.parse(readFileSync(join(fixturesDir, 'storage-v1', '04-disabled-pedal-mix0.json'), 'utf8')) as {
  storage: Record<string, string>;
};

/** 기본 Mix(%). `src/store/pedalStore.ts` 의 기본 페달 값이다. */
const DEFAULT_MIX = { Delay: 30, Reverb: 25, Chorus: 35 } as const;

const pedalGroup = (page: Page, name: string): Locator => page.getByRole('region', { name: `${name} 이펙터`, exact: true });
const stompOf = (page: Page, name: string): Locator => pedalGroup(page, name).locator('.stomp-toggle-switch');
/** Mix 노브의 화면 이름. Delay 는 'E.Level'(에코 레벨)이 Mix 값이다. */
const MIX_LABEL: Record<string, string> = { Delay: 'E.Level' };
const mixOf = (page: Page, name: string): Locator =>
  pedalGroup(page, name).getByRole('slider', { name: MIX_LABEL[name] ?? 'Mix', exact: true });

/** 새로고침할 때 덮어쓰지 않도록 sessionStorage 로 한 번만 넣는다(픽스처 README 의 방법). */
async function seedFixture(page: Page): Promise<void> {
  await page.addInitScript((storage) => {
    if (window.sessionStorage.getItem('__fixture-loaded')) return;
    window.sessionStorage.setItem('__fixture-loaded', '1');
    window.localStorage.clear();
    for (const [key, value] of Object.entries(storage)) window.localStorage.setItem(key, value);
  }, fixture.storage);
}

test.describe('S2.1 꺼진 페달의 Mix 0% 바로잡기', () => {
  test('S2.1 옛 저장본(픽스처 04)을 열면 꺼진 Delay·Reverb·Chorus 의 Mix 가 기본값이고, 켜도 그대로', async ({ page }) => {
    await seedFixture(page);
    await openApp(page);

    for (const [name, mix] of Object.entries(DEFAULT_MIX)) {
      await expect(stompOf(page, name), `${name} 는 꺼진 채로 열린다`).toHaveAttribute('aria-pressed', 'false');
      await expect(mixOf(page, name), `${name} 의 Mix 는 0% 가 아니라 기본 ${mix}%`).toHaveValue(String(mix));
    }
    // 저장된 값이 그대로여야 하는 페달: Flanger·Phaser 는 원래 꺼져 있고 Mix 가 0 이 아니었다.
    await expect(mixOf(page, 'Flanger')).toHaveValue('35');
    await expect(mixOf(page, 'Phaser')).toHaveValue('45');

    // 켜면 효과가 들리는 Mix 로 켜진다.
    for (const [name, mix] of Object.entries(DEFAULT_MIX)) {
      await stompOf(page, name).click();
      await expect(stompOf(page, name)).toHaveAttribute('aria-pressed', 'true');
      await expect(mixOf(page, name)).toHaveValue(String(mix));
    }
  });

  test('S2.1 저장돼 있던 사용자 프리셋(픽스처 04)을 불러와도 꺼진 페달의 Mix 가 기본값', async ({ page }) => {
    await seedFixture(page);
    await openApp(page);
    // 작업 상태를 일부러 바꿔 두어, 프리셋을 불러온 결과가 작업 상태 복원과 따로 확인되게 한다.
    for (const name of Object.keys(DEFAULT_MIX)) await stompOf(page, name).click();
    for (const name of Object.keys(DEFAULT_MIX)) await expect(stompOf(page, name)).toHaveAttribute('aria-pressed', 'true');

    await page.locator('.preset-load-button', { hasText: 'Off Pedals Mix 0' }).click();
    for (const [name, mix] of Object.entries(DEFAULT_MIX)) {
      await expect(stompOf(page, name), `${name} 는 프리셋대로 꺼진다`).toHaveAttribute('aria-pressed', 'false');
      await expect(mixOf(page, name), `${name} 의 Mix 는 기본 ${mix}%`).toHaveValue(String(mix));
    }
  });

  test('S2.1 공장 프리셋을 불러온 뒤 꺼져 있는 페달 가운데 Mix 가 0% 인 것이 없다', async ({ page }) => {
    await openApp(page);
    const presets = ['Direct Clean', 'Studio Clean', 'Classic Rock', 'Ambient Delay'];
    let checked = 0;
    for (const preset of presets) {
      await page.locator('.preset-load-button', { hasText: preset }).first().click();
      const cards = pedalCards(page);
      const count = await cards.count();
      for (let index = 0; index < count; index += 1) {
        const card = cards.nth(index);
        const pressed = await card.locator('.stomp-toggle-switch').getAttribute('aria-pressed');
        if (pressed !== 'false') continue;
        const mix = card.getByRole('slider', { name: 'Mix', exact: true });
        if ((await mix.count()) === 0) continue;
        const name = await card.getAttribute('aria-label');
        expect(await mix.inputValue(), `${preset} 의 꺼진 ${name} 는 Mix 0% 로 저장돼 있다`).not.toBe('0');
        checked += 1;
      }
    }
    expect(checked, '꺼진 페달의 Mix 를 충분히 확인했는지').toBeGreaterThanOrEqual(20);
  });
});
