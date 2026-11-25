// S4.5 중 찾은 기존 결함(F-7)의 회귀 시험: 768~1279 px 의 오른쪽 서랍에서 프리셋 브라우저가 높이 2 px 로 접혀
// 프리셋 저장·불러오기 UI 가 통째로 보이지 않았다(서랍이 화면 높이로 고정이라 행이 자동 크기면 min-height 0 + overflow hidden 칸이 0 이 된다).
// 폭 세 개(서랍이 열리는 최소·중간·최대)에서 ① 칸 높이가 충분하고 ② 저장·내보내기 단추가 실제로 눌릴 수 있게(다른 요소가 가리지 않게) 보이는지 본다.
import { connectGuitar, openApp, setSidebar } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';

const MIN_BROWSER_HEIGHT = 400;

for (const width of [768, 1024, 1279]) {
  test.describe(`S4.5 서랍 프리셋 ${width}px`, () => {
    test.use({ viewport: { width, height: 800 } });

    test(`서랍 안 프리셋 브라우저가 접히지 않고 단추가 눌린다 (${width}px)`, async ({ page }) => {
      await openApp(page);
      await connectGuitar(page);
      await setSidebar(page, true);

      const browser = page.locator('#desktop-sidebar.is-drawer .preset-browser');
      await expect(browser).toBeVisible();
      const height = (await browser.boundingBox())?.height ?? 0;
      expect(height, `프리셋 브라우저 높이 ${height}px`).toBeGreaterThanOrEqual(MIN_BROWSER_HEIGHT);

      for (const name of ['저장', '내보내기']) {
        const button = browser.getByRole('button', { name, exact: true });
        await button.scrollIntoViewIfNeeded();
        const reachable = await button.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return hit !== null && (el === hit || el.contains(hit));
        });
        expect(reachable, `'${name}' 단추 가운데가 다른 요소에 가려져 있다`).toBe(true);
      }
    });
  });
}
