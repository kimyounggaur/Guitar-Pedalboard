// E-04 휴대폰 도달성 — 기록 모드(@record). 15개 페달 스위치를 손가락이 누를 수 있는지 잰다.
// 지금은 도달하지 못하는 것이 정상이라 단언하지 않고 값만 기록한다. S1.6 에서 정식 단언(모두 도달)으로 바꾼다.
// 값에는 두 가지를 같이 적는다: 있는 그대로(asIs), 그리고 REFACTOR_LOG F-1 의 투명 입력을 걷어 낸 경우(withoutFaderOverlay).
import { openApp, PEDAL_COUNT, setMobileDock } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { PHONE_PROFILES } from '../helpers/screens';
import { recordMeasurement, recordScreenshot } from '../helpers/record';
import { describeSwitchReport, ignoreHiddenFaderInputs, measureSwitches } from '../helpers/switches';

for (const screen of PHONE_PROFILES) {
  test.describe(`E-04 휴대폰 스위치 도달성 ${screen.name}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height }, isMobile: true, hasTouch: true });

    for (const dock of ['collapsed', 'expanded'] as const) {
      test(`E-04 휴대폰 스위치 도달성 ${screen.name} 도크 ${dock === 'collapsed' ? '접힘' : '펼침'}`, { tag: '@record' }, async ({ page }) => {
        await openApp(page);
        await setMobileDock(page, dock === 'expanded');
        await recordScreenshot(page, { id: 'E-04', profile: screen.name, condition: `dock-${dock}` });

        const asIs = await measureSwitches(page);
        await ignoreHiddenFaderInputs(page);
        const withoutFaderOverlay = await measureSwitches(page);

        expect(asIs.count).toBe(PEDAL_COUNT);
        recordMeasurement({
          id: 'E-04',
          profile: screen.name,
          condition: `dock-${dock}`,
          summary: `${describeSwitchReport(asIs)} | 투명 입력 제외 시 ${withoutFaderOverlay.reachable}/${withoutFaderOverlay.count}(${Math.round(withoutFaderOverlay.reachableRatio * 100)}%)`,
          values: { asIs, withoutFaderOverlay },
        });
      });
    }
  });
}
