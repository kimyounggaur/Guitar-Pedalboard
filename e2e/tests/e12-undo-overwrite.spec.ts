// E-12 되돌릴 수 있는 안전장치(설계서 S2.8, R2-14). 실제 브라우저에서 수용 기준 4개를 본다.
//   1. 프리셋 삭제 → [실행 취소] → 프리셋이 원래 자리에 돌아온다(즐겨찾기·내용 포함).
//   2. '기본 페달 설정' → [실행 취소] → 모든 노브·켜짐·음량 보정(·캐비닛이 쓰던 '내 IR' 모델)이 되돌아온다. 되돌릴 게 없을 때 '되돌려졌다'고 속이지 않도록
//      처음 값으로 바뀌었다는 것도 함께 본다(공허한 시험 방지).
//   3. 같은 이름 저장은 묻지 않고 덮어쓰는 길이 없다 — 대화상자(덮어쓰기 / 새 이름으로 저장 / 취소)가 뜨고, 고르기 전에는 저장소가 그대로다.
//      브라우저 기본 대화상자(window.confirm)는 한 번도 뜨지 않는다.
//   4. 토스트의 '실행 취소' 는 키보드로 도달해 누를 수 있다(role="status", 포커스 가능).
// 순서·이름 겹침·IR 계산의 모든 경우는 Node 시험(test:safeguards)이 본다. 여기서는 화면과 브라우저가 하는 일이다.
import type { Locator, Page } from '@playwright/test';
import { connectGuitar, disconnectButton, horizontalOverflow, openApp, selectMobileTab } from '../helpers/app';
import { fixturePath } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { presetMessage, saveUserPreset } from '../helpers/preset-io';
import {
  DEFAULT_ACTIVE_NAMES,
  PRESETS_KEY,
  activeIdsOf,
  idOfPedal,
  pedalGroup,
  readLocal,
  readStoredBoard,
  sortedIdsOf,
  stompOf,
  storedParam,
  toastOf,
} from '../helpers/storage';
import { knobKoName } from '../helpers/ko-names';

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;
const FAVORITES_KEY = 'guitar-pedalboard:preset-favorites';
const RECENTS_KEY = 'guitar-pedalboard:preset-recents';
const SAME_NAME_TITLE = '같은 이름의 프리셋이 있습니다';

interface StoredPreset {
  id: string;
  name: string;
  updatedAt: string;
  pedals: Record<string, unknown>;
}

async function storedPresetList(page: Page): Promise<StoredPreset[]> {
  const raw = await readLocal(page, PRESETS_KEY);
  return raw === null ? [] : (JSON.parse(raw) as { presets: StoredPreset[] }).presets;
}

async function storedNames(page: Page): Promise<string[]> {
  return (await storedPresetList(page)).map((preset) => preset.name);
}

/** 화면의 프리셋 목록(지금 고른 라이브러리) 이름들 */
const listedNames = (page: Page): Promise<string[]> => page.locator('.preset-list .preset-load-button strong').allTextContents();

/** 브라우저 기본 대화상자(confirm·alert·prompt)가 뜨면 기록하고 닫는다. 시험 끝에서 기록이 비어 있어야 한다. */
function watchNativeDialogs(page: Page): string[] {
  const seen: string[] = [];
  page.on('dialog', (dialog) => {
    seen.push(`${dialog.type()}: ${dialog.message()}`);
    void dialog.dismiss();
  });
  return seen;
}

const deletedToasts = (page: Page): Locator => page.locator('.toast[data-toast-key^="preset-deleted:"]');
const undoButton = (toast: Locator): Locator => toast.getByRole('button', { name: '실행 취소', exact: true });
const deleteButton = (page: Page, name: string): Locator => page.getByRole('button', { name: `${name} 삭제`, exact: true });
const favoriteButton = (page: Page, name: string): Locator => page.getByRole('button', { name: `${name} 즐겨찾기`, exact: true });
const resetButton = (page: Page): Locator => page.locator('.preset-reset-button');
const sameNameDialog = (page: Page): Locator => page.getByRole('dialog', { name: SAME_NAME_TITLE });

async function storedIdList(page: Page, key: string): Promise<string[]> {
  const raw = await readLocal(page, key);
  return raw === null ? [] : (JSON.parse(raw) as string[]);
}
const storedFavorites = (page: Page): Promise<string[]> => storedIdList(page, FAVORITES_KEY);
const storedRecents = (page: Page): Promise<string[]> => storedIdList(page, RECENTS_KEY);

/** 같은 이름으로 저장 버튼을 눌러 대화상자를 띄운다. */
async function attemptSave(page: Page, name: string): Promise<void> {
  await page.getByLabel('프리셋 이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(sameNameDialog(page)).toBeVisible();
}

test.describe('E-12 되돌리기·덮어쓰기 안전장치', () => {
  test('수용 기준 1: 프리셋을 지우면 바로 사라지고, [실행 취소] 로 같은 자리·같은 내용·즐겨찾기까지 돌아온다', async ({ page }) => {
    const dialogs = watchNativeDialogs(page);
    await openApp(page);
    for (const name of ['P1', 'P2', 'P3']) await saveUserPreset(page, name);
    expect(await listedNames(page), '저장은 맨 앞에 붙는다').toEqual(['P3', 'P2', 'P1']);

    await favoriteButton(page, 'P2').click();
    await expect(favoriteButton(page, 'P2')).toHaveText('★');
    const before = await storedPresetList(page);
    const p2 = before.find((preset) => preset.name === 'P2');
    expect(p2, 'P2 가 저장돼 있다').toBeDefined();
    expect(await storedFavorites(page)).toContain(p2!.id);

    await deleteButton(page, 'P2').click();
    const toast = deletedToasts(page);
    await expect(toast).toHaveCount(1);
    await expect(toast).toContainText('프리셋을 삭제했습니다: P2');
    await expect(toast).toHaveAttribute('role', 'status');
    await expect(undoButton(toast)).toBeVisible();
    // 묻지 않고 바로 지운다. 저장소에도 바로 반영된다(되돌리기를 기다리는 동안 창을 닫아도 지운 채로다).
    expect(await listedNames(page)).toEqual(['P3', 'P1']);
    expect(await storedNames(page)).toEqual(['P3', 'P1']);
    expect(await storedFavorites(page), '즐겨찾기에서도 빠진다').not.toContain(p2!.id);

    await undoButton(toast).click();
    await expect(toast).toHaveCount(0);
    expect(await listedNames(page), '원래 자리').toEqual(['P3', 'P2', 'P1']);
    expect(await storedNames(page), '저장소에도 원래 자리').toEqual(['P3', 'P2', 'P1']);
    expect(await storedPresetList(page), '내용(시각·페달·음량 보정)이 지우기 전과 같다').toEqual(before);
    expect(await storedFavorites(page), '즐겨찾기도 돌아온다').toContain(p2!.id);
    await expect(favoriteButton(page, 'P2')).toHaveText('★');
    await expect(presetMessage(page)).toHaveText("'P2' 프리셋을 되돌렸습니다.");
    expect(dialogs, '브라우저 기본 대화상자가 뜨지 않았다').toEqual([]);
  });

  test("지운 프리셋이 '최근 사용' 목록에 있었다면 되돌릴 때 같은 자리에 다시 들어간다", async ({ page }) => {
    await openApp(page);
    for (const name of ['R1', 'R2', 'R3']) await saveUserPreset(page, name);
    const ids = new Map((await storedPresetList(page)).map((preset) => [preset.name, preset.id]));
    // 불러온 순서대로 쌓인다(가장 최근이 맨 앞).
    for (const name of ['R1', 'R2', 'R3']) await page.locator('.preset-load-button', { hasText: name }).click();
    const order = [ids.get('R3')!, ids.get('R2')!, ids.get('R1')!];
    expect(await storedRecents(page), '시험 준비: 최근 사용 순서').toEqual(order);

    await deleteButton(page, 'R2').click();
    expect(await storedRecents(page), '지우면 최근 사용에서도 빠진다').toEqual([ids.get('R3')!, ids.get('R1')!]);
    await undoButton(deletedToasts(page)).click();
    expect(await storedRecents(page), '되돌리면 같은 자리로 돌아온다').toEqual(order);
  });

  test('연달아 둘을 지워도 토스트가 따로 남고, 어느 순서로 되돌려도 원래 순서다', async ({ page }) => {
    await openApp(page);
    for (const name of ['Q1', 'Q2', 'Q3', 'Q4']) await saveUserPreset(page, name);
    expect(await listedNames(page)).toEqual(['Q4', 'Q3', 'Q2', 'Q1']);

    await deleteButton(page, 'Q3').click();
    await deleteButton(page, 'Q2').click();
    await expect(deletedToasts(page)).toHaveCount(2);
    expect(await listedNames(page)).toEqual(['Q4', 'Q1']);

    // 먼저 지운 Q3 부터 되돌린다(뒤 이웃 Q2 는 아직 없다 → Q1 앞).
    await undoButton(deletedToasts(page).filter({ hasText: 'Q3' })).click();
    expect(await listedNames(page)).toEqual(['Q4', 'Q3', 'Q1']);
    await undoButton(deletedToasts(page).filter({ hasText: 'Q2' })).click();
    expect(await listedNames(page), '둘 다 되돌리면 원래 순서').toEqual(['Q4', 'Q3', 'Q2', 'Q1']);
    expect(await storedNames(page)).toEqual(['Q4', 'Q3', 'Q2', 'Q1']);
  });

  test('되돌리기 알림은 약 8초 뒤 사라지고, 그 뒤에도 지운 상태이며 새로고침해도 그대로다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'T1');
    await saveUserPreset(page, 'T2');
    await deleteButton(page, 'T1').click();
    const toast = deletedToasts(page);
    await expect(toast).toBeVisible();
    const shownAt = Date.now();

    await page.waitForTimeout(3000);
    await expect(toast, '3초 뒤에도 남아 있다').toBeVisible();
    await expect(toast).toBeHidden({ timeout: 10_000 });
    const elapsed = Date.now() - shownAt;
    expect(elapsed, '사라지는 시간(약 8초)').toBeGreaterThan(7000);
    expect(elapsed, '사라지는 시간(약 8초)').toBeLessThan(9500);

    expect(await storedNames(page), '알림이 사라진 뒤에도 지운 상태').toEqual(['T2']);
    await page.reload();
    await expect(page.locator('.pedal-board .pedal-card').first()).toBeVisible();
    expect(await storedNames(page), '새로고침해도 지운 상태').toEqual(['T2']);
  });

  test('수용 기준 2: 기본 페달 설정은 묻지 않고 바로 되돌리고, [실행 취소] 로 노브·켜짐·음량 보정·불러 둔 프리셋 표시가 모두 돌아온다', async ({ page }) => {
    const dialogs = watchNativeDialogs(page);
    await openApp(page);
    await page.locator('.preset-load-button', { hasText: 'Texas Push' }).click();
    const trim = page.getByTestId('preset-trim-value');
    const trimBefore = await trim.innerText();
    expect(trimBefore, 'Texas Push 는 음량 보정이 0 이 아니다').not.toContain('0.0 dB');
    await expect(page.locator('.preset-item.is-active')).toContainText('Texas Push');

    const drive = pedalGroup(page, 'Drive').getByRole('slider', { name: knobKoName('Drive', 'Drive'), exact: true });
    await drive.fill('61');
    const chorus = stompOf(page, 'Chorus');
    const chorusBefore = await chorus.getAttribute('aria-pressed');
    await chorus.click();
    await expect(chorus).not.toHaveAttribute('aria-pressed', chorusBefore!);
    const chorusToggled = await chorus.getAttribute('aria-pressed');
    // 노브는 0.3초 뒤에 저장된다. 저장될 때까지 기다린 뒤의 저장소가 '되돌아와야 하는 값'이다.
    await expect.poll(async () => storedParam(await readStoredBoard(page), idOfPedal('Drive'), 'drive')).toBe(61);
    const board = await readStoredBoard(page);

    await resetButton(page).click();
    const toast = toastOf(page, 'chain-reset');
    await expect(toast).toContainText('모든 노브를 처음 값으로 되돌렸습니다');
    await expect(toast).toHaveAttribute('role', 'status');
    await expect(trim).toContainText('0.0 dB');
    await expect(page.locator('.preset-item.is-active')).toHaveCount(0);
    await expect(drive).not.toHaveValue('61');
    // 공허한 시험이 되지 않도록: 정말 처음 값으로 바뀌었다(저장소 기준).
    await expect.poll(async () => (await readStoredBoard(page))?.trimDb).toBe(0);
    const reset = await readStoredBoard(page);
    expect(JSON.stringify(reset), '처음 값은 되돌릴 값과 다르다').not.toBe(JSON.stringify(board));
    expect(activeIdsOf(reset!), '켜진 페달이 처음 값').toEqual(sortedIdsOf(DEFAULT_ACTIVE_NAMES));
    expect(storedParam(reset, idOfPedal('Drive'), 'drive')).not.toBe(61);

    await undoButton(toast).click();
    await expect(toast).toHaveCount(0);
    await expect.poll(async () => JSON.stringify(await readStoredBoard(page))).toBe(JSON.stringify(board));
    await expect(drive).toHaveValue('61');
    await expect(chorus).toHaveAttribute('aria-pressed', chorusToggled!);
    await expect(trim).toHaveText(trimBefore);
    await expect(page.locator('.preset-item.is-active')).toContainText('Texas Push');
    await expect(presetMessage(page)).toHaveText('기본 페달 설정 전으로 되돌렸습니다.');
    expect(dialogs, '브라우저 기본 대화상자가 뜨지 않았다').toEqual([]);
  });

  test('이미 기본 상태에서 누르면 알려 주기만 하고 되돌리기 알림을 만들지 않는다', async ({ page }) => {
    const dialogs = watchNativeDialogs(page);
    await openApp(page);
    await resetButton(page).click();
    await expect(presetMessage(page)).toHaveText('이미 기본 페달 설정입니다.');
    await expect(page.locator('.toast')).toHaveCount(0);

    // 한 번 바꾸고 되돌린 뒤 다시 누르면, 이전 알림을 지우지 않는다(이미 기본이므로 알림이 새로 생기지 않을 뿐).
    await stompOf(page, 'Chorus').click();
    await resetButton(page).click();
    const toast = toastOf(page, 'chain-reset');
    await expect(toast).toBeVisible();
    await resetButton(page).click();
    await expect(presetMessage(page)).toHaveText('이미 기본 페달 설정입니다.');
    await expect(toast, '앞의 되돌리기 알림이 그대로 남아 있다').toBeVisible();
    expect(dialogs).toEqual([]);
  });

  test('내 IR 을 쓰던 캐비닛도 [실행 취소] 로 돌아온다: 기본 설정은 모델만 기본으로 돌리고 저장된 IR 은 지우지 않는다', async ({ page }) => {
    await openApp(page);
    await connectGuitar(page);
    const cab = pedalGroup(page, 'Cab');
    await cab.locator('input[type="file"]').setInputFiles(fixturePath('ref-impulse.wav'));
    await expect(cab.getByText('내 IR: ref-impulse.wav')).toBeVisible({ timeout: 15_000 });
    await expect(cab.getByLabel('캐비닛 모델'), '올리자마자 모델이 내 IR 로 바뀐다').toHaveValue('my-ir');

    // 노브는 그대로 기본이어도 모델이 '내 IR' 이면 기본 설정이 모델을 바꾸므로 되돌릴 거리가 있다.
    await resetButton(page).click();
    const toast = toastOf(page, 'chain-reset');
    await expect(toast).toBeVisible();
    await expect(cab.getByLabel('캐비닛 모델')).toHaveValue('v30-4x12');
    await expect(cab.getByText('내 IR: ref-impulse.wav'), '저장된 IR 은 지워지지 않는다(다시 고르면 바로 쓴다)').toBeVisible();

    await undoButton(toast).click();
    await expect(cab.getByLabel('캐비닛 모델')).toHaveValue('my-ir');
    await expect(cab.getByText('내 IR: ref-impulse.wav')).toBeVisible();
    await expect(presetMessage(page)).toHaveText('기본 페달 설정 전으로 되돌렸습니다.');
  });

  test('오디오를 다시 시작한 뒤에도 내 IR 은 저장돼 있어 [실행 취소] 가 그대로 돌려 놓는다', async ({ page }) => {
    await openApp(page);
    await connectGuitar(page);
    const cab = pedalGroup(page, 'Cab');
    await cab.locator('input[type="file"]').setInputFiles(fixturePath('ref-impulse.wav'));
    await expect(cab.getByText('내 IR: ref-impulse.wav')).toBeVisible({ timeout: 15_000 });
    const chorus = stompOf(page, 'Chorus');
    await chorus.click();
    const chorusToggled = await chorus.getAttribute('aria-pressed');

    await resetButton(page).click();
    const toast = toastOf(page, 'chain-reset');
    await expect(toast).toBeVisible();

    await disconnectButton(page).click();
    await connectGuitar(page);
    await undoButton(toast).click();
    // 예전에는 세션에만 있던 IR 이 오디오를 다시 시작하면 사라져 '다시 불러와 주세요' 를 알려야 했다. 이제 IR 은 저장소에 있다.
    await expect(presetMessage(page)).toHaveText('기본 페달 설정 전으로 되돌렸습니다.');
    await expect(cab.getByLabel('캐비닛 모델')).toHaveValue('my-ir');
    await expect(cab.getByText('내 IR: ref-impulse.wav')).toBeVisible();
    await expect(chorus, '노브·켜짐은 돌아온다').toHaveAttribute('aria-pressed', chorusToggled!);
  });

  test('수용 기준 3: 같은 이름으로 저장하면 대화상자가 뜨고, 고르기 전에는 저장소를 건드리지 않는다. 취소·Esc 는 그대로 닫는다', async ({ page }) => {
    const dialogs = watchNativeDialogs(page);
    await openApp(page);
    await saveUserPreset(page, 'Lead');
    const stored = await readLocal(page, PRESETS_KEY);

    await stompOf(page, 'Chorus').click(); // 덮어쓰면 달라질 내용
    await attemptSave(page, 'Lead');
    const dialog = sameNameDialog(page);
    await expect(dialog).toContainText("'Lead' 이름의 프리셋이 이미 있습니다.");
    for (const name of ['덮어쓰기', '새 이름으로 저장', '취소']) {
      await expect(dialog.getByRole('button', { name, exact: true })).toBeVisible();
    }
    // 처음 포커스는 파괴적이지 않은 '새 이름' 칸이다.
    const newName = dialog.getByLabel('새 이름', { exact: true });
    await expect(newName).toBeFocused();
    await expect(newName).toHaveValue('Lead (2)');
    // 제안한 이름이 모두 선택돼 있어 바로 덮어 쓸 수 있다.
    const selection = await newName.evaluate((element) => {
      const input = element as HTMLInputElement;
      return [input.selectionStart, input.selectionEnd, input.value.length];
    });
    expect(selection, '제안한 이름 전체가 선택돼 있다').toEqual([0, 8, 8]);
    expect(await readLocal(page, PRESETS_KEY), '대화상자가 떠 있는 동안 저장소는 그대로').toBe(stored);

    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    expect(await readLocal(page, PRESETS_KEY), 'Esc 는 덮어쓰지 않는다').toBe(stored);

    await attemptSave(page, 'Lead');
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(await readLocal(page, PRESETS_KEY), '취소는 덮어쓰지 않는다').toBe(stored);
    expect(await storedNames(page)).toEqual(['Lead']);
    expect(dialogs, '브라우저 기본 대화상자가 뜨지 않았다').toEqual([]);
  });

  test('같은 이름 대화상자: 열자마자 Enter 를 눌러도 기존 프리셋은 남고, 제안한 새 이름으로 따로 저장된다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'Lead');
    const original = (await storedPresetList(page))[0];

    await stompOf(page, 'Chorus').click();
    await attemptSave(page, 'Lead');
    await page.keyboard.press('Enter');
    await expect(sameNameDialog(page)).toHaveCount(0);

    await expect(presetMessage(page)).toHaveText('프리셋을 저장했습니다.');
    expect(await storedNames(page)).toEqual(['Lead (2)', 'Lead']);
    const list = await storedPresetList(page);
    expect(list.find((preset) => preset.name === 'Lead'), '기존 프리셋의 내용·시각이 그대로').toEqual(original);
    await expect(page.getByLabel('프리셋 이름', { exact: true })).toHaveValue('Lead (2)');
  });

  test('같은 이름 대화상자: [덮어쓰기] 는 같은 프리셋을 지금 체인으로 바꾸고 개수는 그대로다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'Lead');
    const original = (await storedPresetList(page))[0];

    await stompOf(page, 'Chorus').click();
    await attemptSave(page, 'Lead');
    await sameNameDialog(page).getByRole('button', { name: '덮어쓰기', exact: true }).click();
    await expect(sameNameDialog(page)).toHaveCount(0);

    await expect(presetMessage(page)).toHaveText('프리셋을 저장했습니다.');
    const list = await storedPresetList(page);
    expect(list.map((preset) => preset.name)).toEqual(['Lead']);
    expect(list[0].id, '같은 프리셋(id 그대로)').toBe(original.id);
    expect(JSON.stringify(list[0].pedals), '내용이 지금 체인으로 바뀌었다').not.toBe(JSON.stringify(original.pedals));
  });

  test('같은 이름 대화상자: 새 이름이 비었거나 이미 쓰는 이름이면 저장하지 않고 이유를 알려 준다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'Lead');
    await saveUserPreset(page, 'Rhythm');
    const stored = await readLocal(page, PRESETS_KEY);

    await attemptSave(page, 'Lead');
    const dialog = sameNameDialog(page);
    const newName = dialog.getByLabel('새 이름', { exact: true });
    await newName.fill('Rhythm');
    await dialog.getByRole('button', { name: '새 이름으로 저장', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('그 이름의 프리셋도 이미 있습니다');
    await newName.fill('   ');
    await newName.press('Enter');
    await expect(dialog.getByRole('alert')).toContainText('새 이름을 입력해 주세요');
    await expect(dialog, '대화상자는 열려 있다').toBeVisible();
    await newName.fill('Lead B');
    await expect(dialog.getByRole('alert'), '이름을 고치면 오류 안내가 사라진다').toHaveCount(0);
    expect(await readLocal(page, PRESETS_KEY), '아무것도 저장하지 않았다').toBe(stored);

    await newName.fill('Lead B');
    await newName.press('Enter');
    await expect(dialog).toHaveCount(0);
    expect(await storedNames(page)).toEqual(['Lead B', 'Rhythm', 'Lead']);
  });

  test('수용 기준 4: 알림의 [실행 취소] 는 키보드만으로 도달해 Enter 로 누를 수 있다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'K1');
    await saveUserPreset(page, 'K2');

    // 키보드로 지운다: 삭제 버튼에 포커스 → Enter.
    await deleteButton(page, 'K1').focus();
    await page.keyboard.press('Enter');
    const toast = deletedToasts(page);
    await expect(toast).toBeVisible();
    await expect(toast).toHaveAttribute('role', 'status');
    const action = undoButton(toast);

    // Tab 으로 찾아간다. 알림 영역이 문서 맨 앞에 있어 한 바퀴 안에 반드시 닿아야 한다.
    let presses = 0;
    while (presses < 400 && !(await action.evaluate((element) => element === document.activeElement))) {
      await page.keyboard.press('Tab');
      presses += 1;
    }
    expect(presses, `Tab ${presses}번 만에 [실행 취소] 에 닿았다`).toBeLessThan(400);
    test.info().annotations.push({ type: 'tab-presses', description: String(presses) });
    await expect(action).toBeFocused();

    await page.keyboard.press('Enter');
    await expect(toast).toHaveCount(0);
    expect(await storedNames(page), '키보드로 되돌렸다').toEqual(['K2', 'K1']);
  });

  test('휴대폰: 같은 이름 대화상자가 화면 안에 들어오고 버튼을 손가락으로 누를 수 있으며, 알림의 [실행 취소] 도 눌린다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic(undefined, PHONE);
    await openApp(page);
    await selectMobileTab(page, 'preset');
    await saveUserPreset(page, 'Phone A');
    await attemptSave(page, 'Phone A');

    const dialog = sameNameDialog(page);
    const box = await dialog.boundingBox();
    expect(box, '대화상자 위치').not.toBeNull();
    const viewport = page.viewportSize();
    expect(box!.x, '왼쪽이 화면 안').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, '오른쪽이 화면 안').toBeLessThanOrEqual(viewport!.width + 0.5);
    expect(box!.y + box!.height, '아래가 화면 안').toBeLessThanOrEqual(viewport!.height + 0.5);
    expect(await horizontalOverflow(page), '가로 넘침 없음').toBe(0);
    for (const name of ['덮어쓰기', '새 이름으로 저장', '취소']) {
      const size = await dialog.getByRole('button', { name, exact: true }).boundingBox();
      expect(size!.height, `${name} 높이`).toBeGreaterThanOrEqual(42);
    }
    await dialog.getByRole('button', { name: '취소', exact: true }).tap();
    await expect(dialog).toHaveCount(0);

    // 지운 뒤 알림이 도크에 가려지지 않아 손가락으로 [실행 취소] 를 누를 수 있다(가려져 있으면 tap 이 실패한다).
    await deleteButton(page, 'Phone A').tap();
    const toast = deletedToasts(page);
    await expect(toast).toBeVisible();
    const toastBox = await toast.boundingBox();
    expect(toastBox!.x, '알림 왼쪽이 화면 안').toBeGreaterThanOrEqual(0);
    expect(toastBox!.x + toastBox!.width, '알림 오른쪽이 화면 안').toBeLessThanOrEqual(viewport!.width + 0.5);
    expect(await horizontalOverflow(page), '알림이 떠도 가로 넘침 없음').toBe(0);
    await undoButton(toast).tap();
    await expect(toast).toHaveCount(0);
    expect(await storedNames(page)).toEqual(['Phone A']);
  });
});
