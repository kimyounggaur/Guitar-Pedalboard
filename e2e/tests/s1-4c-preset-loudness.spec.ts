// S1.4c 프리셋 음량 정렬. 소리의 크기 자체(−20 dBFS 근처, 리미터 감소량)는 오디오 렌더 프로브 P-05 가 재고,
// 여기서는 실제 브라우저에서 화면과 저장이 맞게 이어지는지를 본다.
//   · 프리셋을 불러오면 그 프리셋의 보정값(src/presets/factoryTrims.json)이 패널에 보인다
//   · '음량 맞추기' 버튼이 같은 렌더 코드로 보정값을 정한다(팩토리 값과 ±1 dB 안)
//   · 보정값은 새로고침해도 남고, 실행 취소가 페달과 함께 되돌린다
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PEDAL_COUNT, openApp, pedalCards } from '../helpers/app';
import { repoRoot } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';

interface FactoryTrims {
  targetRmsDbfs: number;
  trims: Record<string, number>;
}
const factory = JSON.parse(readFileSync(join(repoRoot, 'src', 'presets', 'factoryTrims.json'), 'utf8')) as FactoryTrims;

const trimOf = (id: string): number => {
  const value = factory.trims[id];
  if (typeof value !== 'number') throw new Error(`factoryTrims.json 에 ${id} 가 없습니다.`);
  return value;
};

/** 화면에 보이는 모양('+3.4 dB', '−2.0 dB', '0.0 dB'; 빼기는 U+2212). src/audio/offline/loudnessSpec.ts 의 formatTrimDb 와 같다. */
function label(db: number): string {
  if (db === 0) return '0.0 dB';
  return `${db > 0 ? '+' : '−'}${Math.abs(db).toFixed(1)} dB`;
}

/** '음량 보정 −10.9 dB' 같은 화면 글에서 숫자를 읽는다. */
function parseTrim(text: string): number {
  const match = /([+−-]?)(\d+(?:\.\d+)?)\s*dB/.exec(text);
  if (!match) throw new Error(`음량 보정 값을 읽지 못했습니다: ${text}`);
  const value = Number(match[2]);
  return match[1] === '+' || match[1] === '' ? value : -value;
}

// S2.4: 작업 상태는 v2 키에 쓴다. 음량 보정은 `trimDb` 이다.
const PEDAL_KEY = 'guitar-pedalboard:v2:state';
const TEXAS_PUSH = 'factory-texas-push';
const FUNK_COMP = 'factory-funk-comp';

test.describe('S1.4c 프리셋 음량 보정', () => {
  test('프리셋을 불러오면 그 프리셋의 보정값이 보이고, 기본 페달 설정은 0 으로 되돌린다', async ({ page }) => {
    await openApp(page);
    const value = page.getByTestId('preset-trim-value');
    await expect(value).toContainText('0.0 dB');

    // 드라이브 프리셋은 줄이고, 클린 프리셋은 키운다(보정 전에는 둘이 약 20 dB 차이였다).
    await page.locator('.preset-load-button', { hasText: 'Texas Push' }).click();
    await expect(value).toContainText(label(trimOf(TEXAS_PUSH)));
    expect(trimOf(TEXAS_PUSH)).toBeLessThan(0);

    await page.locator('.preset-load-button', { hasText: 'Funk Comp' }).click();
    await expect(value).toContainText(label(trimOf(FUNK_COMP)));
    expect(trimOf(FUNK_COMP)).toBeGreaterThan(0);

    // '기본 페달 설정' 은 window.confirm 으로 한 번 묻는다. 확인을 누른다.
    page.once('dialog', (dialog) => void dialog.accept());
    await page.locator('.preset-reset-button').click();
    await expect(value).toContainText('0.0 dB');
  });

  test("'음량 맞추기' 가 같은 렌더로 보정값을 정한다(팩토리 값과 ±1 dB)", async ({ page }) => {
    await openApp(page);
    const value = page.getByTestId('preset-trim-value');
    // Texas Push 를 불러온 다음 보정을 0 으로 되돌려 둔다 — 버튼은 현재 체인을 보정 0 으로 재서 새 값을 정한다.
    await page.locator('.preset-load-button', { hasText: 'Texas Push' }).click();
    await expect(value).toContainText(label(trimOf(TEXAS_PUSH)));

    const button = page.getByRole('button', { name: '음량 맞추기' });
    await button.click();
    // 4초 렌더 + 렌더 코드 불러오기. 끝나면 안내 글이 바뀌고 버튼이 다시 켜진다.
    await expect(page.locator('.preset-message')).toContainText('음량 보정을', { timeout: 30_000 });
    await expect(button).toBeEnabled();

    const measured = parseTrim((await value.textContent()) ?? '');
    expect(Math.abs(measured - trimOf(TEXAS_PUSH)), `버튼 ${measured} dB 와 팩토리 ${trimOf(TEXAS_PUSH)} dB`).toBeLessThanOrEqual(1);
  });

  test('보정값은 새로고침해도 남는다', async ({ page }) => {
    await openApp(page);
    const value = page.getByTestId('preset-trim-value');
    await page.locator('.preset-load-button', { hasText: 'Funk Comp' }).click();
    await expect(value).toContainText(label(trimOf(FUNK_COMP)));

    // 저장은 조금 늦춰서 하므로 저장본에 들어갈 때까지 기다린 뒤 다시 연다.
    await expect
      .poll(() => page.evaluate((key) => window.localStorage.getItem(key) ?? '', PEDAL_KEY), { timeout: 5_000 })
      .toContain('"trimDb"');
    const saved = JSON.parse(await page.evaluate((key) => window.localStorage.getItem(key) ?? '{}', PEDAL_KEY)) as { schemaVersion?: number; trimDb?: number };
    expect(saved.schemaVersion).toBe(2);
    expect(saved.trimDb).toBe(trimOf(FUNK_COMP));

    await page.reload();
    await expect(pedalCards(page)).toHaveCount(PEDAL_COUNT);
    await expect(page.getByTestId('preset-trim-value')).toContainText(label(trimOf(FUNK_COMP)));
  });

  test('실행 취소·다시 실행이 페달과 보정을 함께 되돌린다', async ({ page }) => {
    await openApp(page);
    const value = page.getByTestId('preset-trim-value');
    await page.locator('.preset-load-button', { hasText: 'Texas Push' }).click();
    await expect(value).toContainText(label(trimOf(TEXAS_PUSH)));
    await page.locator('.preset-load-button', { hasText: 'Funk Comp' }).click();
    await expect(value).toContainText(label(trimOf(FUNK_COMP)));

    await page.getByRole('button', { name: '실행 취소' }).click();
    await expect(value).toContainText(label(trimOf(TEXAS_PUSH)));
    await page.getByRole('button', { name: '다시 실행' }).click();
    await expect(value).toContainText(label(trimOf(FUNK_COMP)));
  });
});
