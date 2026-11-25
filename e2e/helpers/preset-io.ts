// 프리셋 내보내기·가져오기(E-11, 설계서 S2.7) 시험 도우미.
// 화면의 글자(버튼 이름·안내 문구)로만 조작한다. 앱 코드를 import 하지 않는다(tsconfig.e2e.json).
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Download, type Locator, type Page } from '@playwright/test';
import { repoRoot } from './env';

/** 프리셋 패널의 한 줄 안내(저장·내보내기·가져오기 결과) */
export const presetMessage = (page: Page): Locator => page.locator('.preset-message');

/** 라이브러리 목록 위의 전체 프리셋 수(팩토리 + 내 프리셋) */
export async function totalPresetCount(page: Page): Promise<number> {
  return Number(await page.locator('.preset-tabs em').innerText());
}

/** 라이브러리 목록에서 이름이 `name` 인 줄의 개수 */
export async function libraryCount(page: Page, name: '전체 프리셋' | '내 프리셋'): Promise<number> {
  const row = page.locator('.preset-library-list li').filter({ has: page.getByText(name, { exact: true }) });
  return Number(await row.locator('em').innerText());
}

/** 지금 보드를 이 이름으로 저장한다(같은 이름을 두 번 저장하면 확인 창이 뜨므로 서로 다른 이름만 쓴다). */
export async function saveUserPreset(page: Page, name: string): Promise<void> {
  await page.getByLabel('프리셋 이름', { exact: true }).fill(name);
  await page.getByRole('button', { name: '저장', exact: true }).click();
  await expect(presetMessage(page)).toHaveText('프리셋을 저장했습니다.');
}

/** '내보내기'를 눌러 내려받은 파일을 돌려 준다. */
export async function exportToDownload(page: Page): Promise<{ download: Download; text: string }> {
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: '내보내기', exact: true }).click(),
  ]);
  const path = await download.path();
  return { download, text: readFileSync(path, 'utf8') };
}

/**
 * 가져올 파일을 쓰고 경로를 돌려 준다. 같은 이름으로 다시 쓰면 덮어쓴다.
 * 시험 제목이 들어 있는 출력 폴더(`testInfo.outputPath`)에는 쓰지 않는다 — 이 환경에서는 경로에 영문이 아닌 글자(한글, '·')가 있으면
 * 파일 선택 창에 건넨 파일이 앱에 닿지 않는다(`change` 가 오지 않는다. 영문·숫자·`:`·`-` 경로는 된다). S2.7 에서 만난 문제, 기록 L-147.
 * 그래서 글자가 영문뿐인 고정 폴더(`test-results/e11-import-files`)를 쓴다.
 */
export function writeImportFile(name: string, text: string): string {
  const directory = join(repoRoot, 'test-results', 'e11-import-files');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, name);
  writeFileSync(path, text);
  return path;
}

/** '파일 가져오기'를 눌러 뜬 파일 선택 창에 파일(경로)을 건넨다. 선택 창이 뜨지 않으면 시험이 실패한다. */
export async function importThroughChooser(page: Page, file: string): Promise<void> {
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: '파일 가져오기', exact: true }).click(),
  ]);
  await chooser.setFiles(file);
}

/** '텍스트로 붙여넣기' 대화상자 */
export const pasteDialog = (page: Page): Locator => page.getByRole('dialog', { name: '텍스트로 붙여넣기' });

/** 대화상자를 열고 글을 붙여 넣어 '가져오기'를 누른다. 대화상자가 닫히는지는 부르는 쪽이 본다. */
export async function pasteImport(page: Page, text: string): Promise<void> {
  await page.getByRole('button', { name: '텍스트로 붙여넣기', exact: true }).click();
  const dialog = pasteDialog(page);
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('가져올 프리셋 JSON').fill(text);
  await dialog.getByRole('button', { name: '가져오기', exact: true }).click();
}

/** 충돌을 묻는 대화상자 */
export const conflictDialog = (page: Page): Locator => page.getByRole('dialog', { name: '같은 프리셋이 이미 있습니다' });
