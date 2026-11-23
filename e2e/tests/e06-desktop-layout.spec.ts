// E-06 데스크톱 배치 — 기록 모드(@record). 768~1920 px 에서 카드 안 글자 겹침과 스위치 노출을 잰다.
// 지금은 겹침이 있고 스위치가 가려지는 것이 정상이라 단언하지 않고 값만 기록한다. S1.8 에서 정식 단언(겹침 0, 스위치 100%)으로 바꾼다.
import { horizontalOverflow, openApp, pedalCards, PEDAL_COUNT, setSidebar } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { overlapsInCard, type OverlapPair } from '../helpers/geometry';
import { recordMeasurement, recordScreenshot } from '../helpers/record';
import { DESKTOP_PROFILES } from '../helpers/screens';
import { describeSwitchReport, ignoreHiddenFaderInputs, measureSwitches } from '../helpers/switches';

interface CardOverlap {
  card: string;
  count: number;
  boxes: number;
  pairs: OverlapPair[];
}

for (const screen of DESKTOP_PROFILES) {
  test.describe(`E-06 데스크톱 배치 ${screen.name}`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    for (const sidebar of ['open', 'collapsed'] as const) {
      test(`E-06 데스크톱 배치 ${screen.name} 오디오 패널 ${sidebar === 'open' ? '펼침' : '접힘'}`, { tag: '@record' }, async ({ page }) => {
        await openApp(page);
        await setSidebar(page, sidebar === 'open');
        await recordScreenshot(page, { id: 'E-06', profile: screen.name, condition: `sidebar-${sidebar}` });

        const cards = pedalCards(page);
        const overlaps: CardOverlap[] = [];
        for (let index = 0; index < PEDAL_COUNT; index += 1) {
          const card = cards.nth(index);
          const name = (await card.getAttribute('aria-label'))?.replace(/ 이펙터$/, '') ?? `card-${index}`;
          const report = await overlapsInCard(card);
          overlaps.push({ card: name, count: report.count, boxes: report.boxes, pairs: report.pairs });
        }
        const overlapTotal = overlaps.reduce((sum, item) => sum + item.count, 0);
        const cardsWithOverlap = overlaps.filter((item) => item.count > 0).map((item) => `${item.card}:${item.count}`);

        const asIs = await measureSwitches(page);
        await ignoreHiddenFaderInputs(page);
        const withoutFaderOverlay = await measureSwitches(page);
        const overflow = await horizontalOverflow(page);

        expect(asIs.count).toBe(PEDAL_COUNT);
        recordMeasurement({
          id: 'E-06',
          profile: screen.name,
          condition: `sidebar-${sidebar}`,
          summary: `글자 겹침 ${overlapTotal}곳(${cardsWithOverlap.length}개 카드), ${describeSwitchReport(asIs)} | 투명 입력 제외 시 ${withoutFaderOverlay.reachable}/${withoutFaderOverlay.count}, 가로 넘침 ${overflow}px`,
          values: { overlapTotal, overlapCards: cardsWithOverlap, overlaps, switches: asIs, switchesWithoutFaderOverlay: withoutFaderOverlay, horizontalOverflowPx: overflow },
        });
      });
    }
  });
}
