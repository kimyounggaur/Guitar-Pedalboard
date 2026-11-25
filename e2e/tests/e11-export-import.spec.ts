// E-11 프리셋 내보내기·가져오기(설계서 S2.7, 4.7 '내보내기 파일 형식 v2', R2-6). 실제 브라우저에서 수용 기준 4개를 본다.
//   1. 내 프리셋이 0개일 때 내보내기 → '내보낼 내 프리셋이 없습니다' 안내, 빈 파일을 만들지 않는다.
//   2. 내보낸 직후 가져오기 → 파일 선택 창이 뜨고, 같은 파일을 가져오면 '0개 가져옴 · N개 건너뜀', 전체 개수 변화 0.
//   3. 예전 형식 파일(팩토리 40개 포함)을 가져오면 팩토리는 추가되지 않고 내 프리셋만 추가된다.
//   4. 내보낸 파일에 팩토리 프리셋이 없다.
// 덧붙여, 같은 프리셋이 이미 있을 때 묻는 대화상자(덮어쓰기 / 사본으로 추가 / 건너뛰기)와 '텍스트로 붙여넣기' 대화상자를 본다.
// 파일의 모든 경우(예전 파일 40개 전체, 충돌 규칙, 틀린 파일)는 Node 시험(test:export-format)이 본다. 여기서는 화면과 브라우저가 하는 일이다.
import type { Page } from '@playwright/test';
import { horizontalOverflow, openApp, selectMobileTab } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import {
  conflictDialog,
  exportToDownload,
  importThroughChooser,
  libraryCount,
  pasteDialog,
  pasteImport,
  presetMessage,
  saveUserPreset,
  totalPresetCount,
  writeImportFile,
} from '../helpers/preset-io';
import { PRESETS_KEY, readLocal } from '../helpers/storage';

/** 팩토리 프리셋 수(코드에 있는 40개). 늘거나 줄면 이 값과 시험을 같이 바꾼다. */
const FACTORY_COUNT = 40;
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;

interface StoredPreset {
  id: string;
  name: string;
  origin: string;
  trimDb: number;
}

async function storedPresets(page: Page): Promise<StoredPreset[]> {
  const raw = await readLocal(page, PRESETS_KEY);
  return raw === null ? [] : (JSON.parse(raw) as { presets: StoredPreset[] }).presets;
}

/**
 * 팩토리 프리셋이 함께 든 예전 형식(v11) 내보내기 파일. 이전 앱은 팩토리 40개와 내 프리셋을 한 파일로 내보냈다(264 KB).
 * 페달 목록은 비워 둔다(가져올 때 기본 15개로 채운다). 팩토리 항목은 `factory-` id 를 가진다.
 */
function legacyExportWithFactory(userNames: string[]): { text: string; factoryEntries: number } {
  const presets: Array<Record<string, unknown>> = [];
  for (let n = 1; n <= FACTORY_COUNT; n += 1) {
    presets.push({ id: `factory-sound-${n}`, name: `Factory Sound ${n}`, libraryId: 'factory-clean', libraryName: 'Clean', updatedAt: 1767225600000, pedals: [] });
  }
  userNames.forEach((name, index) => presets.push({ id: `old-user-${index + 1}`, name, updatedAt: 1767225600000 + index, pedals: [] }));
  const factoryEntries = presets.filter((entry) => String(entry.id).startsWith('factory-')).length;
  return { text: JSON.stringify({ version: 11, exportedAt: 1767225600000, presets }, null, 2), factoryEntries };
}

test.describe('E-11 프리셋 내보내기·가져오기', () => {
  test('수용 기준 1: 내 프리셋이 0개면 안내만 하고 빈 파일을 만들지 않으며, 텍스트 칸도 채우지 않는다', async ({ page }) => {
    let downloads = 0;
    page.on('download', () => {
      downloads += 1;
    });
    await openApp(page);
    expect(await libraryCount(page, '내 프리셋')).toBe(0);

    await page.getByRole('button', { name: '내보내기', exact: true }).click();
    await expect(presetMessage(page)).toHaveText('내보낼 내 프리셋이 없습니다.');
    // 파일이 만들어졌다면 클릭 직후 곧 내려받기 이벤트가 온다. 잠깐 기다려도 오지 않는다.
    await page.waitForTimeout(600);
    expect(downloads, '빈 파일을 내려받으면 안 된다').toBe(0);
    // 예전에는 내보낼 때 화면의 텍스트 칸에 같은 내용을 채웠다. 이제 칸 자체가 화면에 없다.
    await expect(page.getByLabel('가져올 프리셋 JSON')).toHaveCount(0);
  });

  test('수용 기준 2·4: 내보낸 파일은 내 프리셋만 든 v2 파일이고, 바로 가져오면 선택 창이 뜨고 모두 건너뛴다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'E11 A');
    await saveUserPreset(page, 'E11 B');
    const total = await totalPresetCount(page);
    expect(total).toBe(FACTORY_COUNT + 2);
    expect(await libraryCount(page, '내 프리셋')).toBe(2);
    const storedBefore = await readLocal(page, PRESETS_KEY);

    const { download, text } = await exportToDownload(page);
    expect(download.suggestedFilename()).toMatch(/^guitar-pedalboard-presets-\d{4}-\d{2}-\d{2}\.json$/);
    await expect(presetMessage(page)).toHaveText('내 프리셋 2개를 내보냈습니다.');
    // 내보내도 화면에 텍스트 칸이 생기지 않는다.
    await expect(page.getByLabel('가져올 프리셋 JSON')).toHaveCount(0);

    // 수용 기준 4: 파일에는 내 프리셋만 있고, 팩토리 프리셋이 없다.
    const file = JSON.parse(text) as {
      format: string;
      schemaVersion: number;
      appVersion: string;
      exportedAt: string;
      presets: StoredPreset[];
    };
    expect(Object.keys(file).sort()).toEqual(['appVersion', 'exportedAt', 'format', 'presets', 'schemaVersion']);
    expect(file.format).toBe('guitar-pedalboard-presets');
    expect(file.schemaVersion).toBe(2);
    expect(file.appVersion).toMatch(/^\d+\.\d+\.\d+/);
    expect(Number.isFinite(Date.parse(file.exportedAt))).toBe(true);
    expect(file.presets.map((preset) => preset.name).sort()).toEqual(['E11 A', 'E11 B']);
    expect(file.presets.every((preset) => preset.origin === 'user')).toBe(true);
    expect(file.presets.some((preset) => preset.id.startsWith('factory-'))).toBe(false);
    expect(text.length, '팩토리 40개(264 KB)가 들어 있지 않다').toBeLessThan(60_000);

    // 수용 기준 2: 가져오기는 파일 선택 창을 연다(importThroughChooser 가 창이 뜨지 않으면 실패한다). 같은 파일은 모두 건너뛴다.
    await importThroughChooser(page, writeImportFile(download.suggestedFilename(), text));
    await expect(presetMessage(page)).toHaveText('0개 가져옴 · 2개 건너뜀');
    expect(await totalPresetCount(page), '전체 개수 변화 0').toBe(total);
    expect(await libraryCount(page, '내 프리셋')).toBe(2);
    expect(await readLocal(page, PRESETS_KEY), '저장본은 한 글자도 바뀌지 않는다').toBe(storedBefore);
    await expect(conflictDialog(page)).toHaveCount(0);
  });

  test('수용 기준 3: 예전 형식 파일(팩토리 40개 포함)은 팩토리를 더하지 않고 내 프리셋만 더한다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'E11 Mine');
    const total = await totalPresetCount(page);
    const { text, factoryEntries } = legacyExportWithFactory(['E11 Old 1', 'E11 Old 2']);
    expect(factoryEntries, '시험 파일에 팩토리 항목이 40개 든다').toBe(FACTORY_COUNT);

    await importThroughChooser(page, writeImportFile('guitar-pedalboard-presets-old.json', text));
    await expect(presetMessage(page)).toHaveText('2개 가져옴 · 40개 건너뜀');
    expect(await totalPresetCount(page), '내 프리셋 2개만 늘었다').toBe(total + 2);
    expect(await libraryCount(page, '내 프리셋')).toBe(3);

    const stored = await storedPresets(page);
    expect(stored.map((preset) => preset.name).sort()).toEqual(['E11 Mine', 'E11 Old 1', 'E11 Old 2']);
    expect(stored.some((preset) => preset.id.startsWith('factory-'))).toBe(false);
    expect(stored.every((preset) => preset.origin === 'user')).toBe(true);

    // 같은 파일을 다시: 모두 건너뛴다.
    await importThroughChooser(page, writeImportFile('guitar-pedalboard-presets-old.json', text));
    await expect(presetMessage(page)).toHaveText('0개 가져옴 · 42개 건너뜀');
    expect(await totalPresetCount(page)).toBe(total + 2);
  });

  test('같은 프리셋이 있고 내용이 다르면 묻는다: 덮어쓰기 · 사본으로 추가 · 건너뛰기', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'E11 A');
    const { download, text } = await exportToDownload(page);
    const changed = JSON.parse(text) as { presets: StoredPreset[] };
    changed.presets[0].trimDb = 6;
    const changedFile = writeImportFile(download.suggestedFilename(), JSON.stringify(changed));
    const total = await totalPresetCount(page);
    const storedBefore = await readLocal(page, PRESETS_KEY);

    // 건너뛰기
    await importThroughChooser(page, changedFile);
    await expect(conflictDialog(page)).toBeVisible();
    await expect(conflictDialog(page)).toContainText('E11 A');
    await conflictDialog(page).getByRole('button', { name: '건너뛰기', exact: true }).click();
    await expect(conflictDialog(page)).toHaveCount(0);
    await expect(presetMessage(page)).toHaveText('0개 가져옴 · 1개 건너뜀');
    expect(await readLocal(page, PRESETS_KEY), '건너뛰면 저장본이 그대로').toBe(storedBefore);

    // 사본으로 추가
    await importThroughChooser(page, changedFile);
    await conflictDialog(page).getByRole('button', { name: '사본으로 추가', exact: true }).click();
    await expect(presetMessage(page)).toHaveText('1개 가져옴 · 0개 건너뜀');
    expect(await totalPresetCount(page)).toBe(total + 1);
    const withCopy = await storedPresets(page);
    expect(withCopy.map((preset) => preset.name).sort()).toEqual(['E11 A', 'E11 A (가져옴)']);
    expect(withCopy.find((preset) => preset.name === 'E11 A')?.trimDb, '원래 프리셋은 그대로').toBe(0);
    expect(withCopy.find((preset) => preset.name === 'E11 A (가져옴)')?.trimDb).toBe(6);

    // 덮어쓰기
    await importThroughChooser(page, changedFile);
    await conflictDialog(page).getByRole('button', { name: '덮어쓰기', exact: true }).click();
    await expect(presetMessage(page)).toHaveText('1개 가져옴 · 0개 건너뜀');
    expect(await totalPresetCount(page), '덮어쓰기는 개수를 늘리지 않는다').toBe(total + 1);
    const afterOverwrite = await storedPresets(page);
    expect(afterOverwrite.find((preset) => preset.name === 'E11 A')?.trimDb).toBe(6);
  });

  test('충돌이 여럿이면 하나씩 묻고, "남은 것에도 적용"을 고르면 한 번에 처리한다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'E11 A');
    await saveUserPreset(page, 'E11 B');
    await saveUserPreset(page, 'E11 C');
    const { download, text } = await exportToDownload(page);
    const changed = JSON.parse(text) as { presets: StoredPreset[] };
    changed.presets.forEach((preset) => {
      preset.trimDb = 4;
    });
    const total = await totalPresetCount(page);

    await importThroughChooser(page, writeImportFile(download.suggestedFilename(), JSON.stringify(changed)));
    await expect(conflictDialog(page)).toContainText('1/3');
    await expect(conflictDialog(page).getByLabel('남은 2개에도 같은 선택 적용')).not.toBeChecked();
    await conflictDialog(page).getByLabel('남은 2개에도 같은 선택 적용').check();
    await conflictDialog(page).getByRole('button', { name: '사본으로 추가', exact: true }).click();
    await expect(conflictDialog(page)).toHaveCount(0);
    await expect(presetMessage(page)).toHaveText('3개 가져옴 · 0개 건너뜀');
    expect(await totalPresetCount(page)).toBe(total + 3);
  });

  test('Esc 는 대화상자만 닫고 가져오기를 통째로 취소한다. 포커스는 누르던 버튼으로 돌아온다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'E11 A');
    const { download, text } = await exportToDownload(page);
    const changed = JSON.parse(text) as { presets: StoredPreset[] };
    changed.presets[0].trimDb = 6;
    const storedBefore = await readLocal(page, PRESETS_KEY);

    await importThroughChooser(page, writeImportFile(download.suggestedFilename(), JSON.stringify(changed)));
    await expect(conflictDialog(page)).toBeVisible();
    await expect(conflictDialog(page).getByRole('button', { name: '덮어쓰기', exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(conflictDialog(page)).toHaveCount(0);
    await expect(presetMessage(page)).toHaveText('가져오기를 취소했습니다.');
    expect(await readLocal(page, PRESETS_KEY), '취소하면 아무것도 저장하지 않는다').toBe(storedBefore);
    await expect(page.getByRole('button', { name: '파일 가져오기', exact: true })).toBeFocused();
  });

  test('텍스트로 붙여넣기: 대화상자가 열리고, 잘못된 글은 대화상자 안에서 알리며, 잘 붙이면 닫히고 가져온다', async ({ page }) => {
    await openApp(page);
    await expect(page.getByLabel('가져올 프리셋 JSON'), '평소에는 텍스트 칸이 화면에 없다').toHaveCount(0);

    await page.getByRole('button', { name: '텍스트로 붙여넣기', exact: true }).click();
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('가져올 프리셋 JSON')).toBeFocused();

    // 포커스는 대화상자 안에서만 돈다.
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement)), `Tab ${step + 1}번째`).toBe(true);
    }
    for (let step = 0; step < 6; step += 1) {
      await page.keyboard.press('Shift+Tab');
      expect(await dialog.evaluate((element) => element.contains(document.activeElement)), `Shift+Tab ${step + 1}번째`).toBe(true);
    }

    // 빈 글, 깨진 글: 대화상자는 열려 있고 안에서 알린다. 목록은 그대로다.
    const total = await totalPresetCount(page);
    await dialog.getByRole('button', { name: '가져오기', exact: true }).click();
    await expect(dialog.getByRole('alert')).toHaveText('가져올 JSON을 붙여 넣어 주세요.');
    await dialog.getByLabel('가져올 프리셋 JSON').fill('{ 이건 JSON 이 아닙니다');
    await expect(dialog.getByRole('alert')).toHaveCount(0);
    await dialog.getByRole('button', { name: '가져오기', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('JSON 파일을 읽을 수 없습니다');
    await expect(dialog).toBeVisible();
    expect(await totalPresetCount(page)).toBe(total);

    // Esc 는 대화상자만 닫는다.
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('button', { name: '텍스트로 붙여넣기', exact: true })).toBeFocused();

    // 잘 붙이면 닫히고 가져온다.
    await pasteImport(page, JSON.stringify({ version: 11, presets: [{ id: 'e11-pasted', name: 'E11 붙여넣기', updatedAt: 1, pedals: [] }] }));
    await expect(dialog).toHaveCount(0);
    await expect(presetMessage(page)).toHaveText('1개 가져옴 · 0개 건너뜀');
    expect(await totalPresetCount(page)).toBe(total + 1);
    expect((await storedPresets(page)).map((preset) => preset.name)).toEqual(['E11 붙여넣기']);
  });

  test('틀린 파일은 한국어로 알리고 아무것도 바꾸지 않는다', async ({ page }) => {
    await openApp(page);
    await saveUserPreset(page, 'E11 A');
    const total = await totalPresetCount(page);
    const storedBefore = await readLocal(page, PRESETS_KEY);

    const cases: Array<{ label: string; text: string; message: RegExp }> = [
      { label: '깨진 JSON', text: '{ not json', message: /JSON 파일을 읽을 수 없습니다/ },
      { label: '다른 파일', text: JSON.stringify({ format: 'something-else', schemaVersion: 2, presets: [] }), message: /이 앱이 내보낸 프리셋 파일이 아닙니다/ },
      { label: '더 새로운 버전', text: JSON.stringify({ format: 'guitar-pedalboard-presets', schemaVersion: 3, presets: [] }), message: /지원하지 않는 프리셋 파일 버전입니다: 3/ },
      { label: '항목이 틀림', text: JSON.stringify([{ id: 1 }]), message: /프리셋 항목이 올바르지 않습니다/ },
    ];
    for (const { label, text, message } of cases) {
      await importThroughChooser(page, writeImportFile('bad.json', text));
      await expect(presetMessage(page), label).toHaveText(message);
      expect(await totalPresetCount(page), label).toBe(total);
      expect(await readLocal(page, PRESETS_KEY), label).toBe(storedBefore);
    }
  });

  test('휴대폰: 붙여넣기 대화상자가 화면 안에 들어오고 버튼을 손가락으로 누를 수 있다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic(undefined, PHONE);
    await openApp(page);
    await selectMobileTab(page, 'preset');
    await page.getByRole('button', { name: '텍스트로 붙여넣기', exact: true }).click();
    const dialog = pasteDialog(page);
    await expect(dialog).toBeVisible();

    const box = await dialog.boundingBox();
    expect(box, '대화상자 위치').not.toBeNull();
    const viewport = page.viewportSize();
    expect(box!.x, '왼쪽이 화면 안').toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width, '오른쪽이 화면 안').toBeLessThanOrEqual(viewport!.width + 0.5);
    expect(box!.y + box!.height, '아래가 화면 안').toBeLessThanOrEqual(viewport!.height + 0.5);
    expect(await horizontalOverflow(page), '가로 넘침 없음').toBe(0);
    for (const name of ['취소', '가져오기', '붙여넣기 창 닫기']) {
      const button = dialog.getByRole('button', { name, exact: true });
      const size = await button.boundingBox();
      expect(size!.height, `${name} 높이`).toBeGreaterThanOrEqual(42);
    }

    // 휴대폰에서도 파일 가져오기와 충돌 대화상자가 같다.
    await dialog.getByRole('button', { name: '취소', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await saveUserPreset(page, 'E11 폰');
    const { download, text } = await exportToDownload(page);
    const changed = JSON.parse(text) as { presets: StoredPreset[] };
    changed.presets[0].trimDb = 5;
    await importThroughChooser(page, writeImportFile(download.suggestedFilename(), JSON.stringify(changed)));
    await expect(conflictDialog(page)).toBeVisible();
    expect(await horizontalOverflow(page), '충돌 대화상자도 가로 넘침 없음').toBe(0);
    await conflictDialog(page).getByRole('button', { name: '건너뛰기', exact: true }).click();
    await expect(presetMessage(page)).toHaveText('0개 가져옴 · 1개 건너뜀');
  });
});
