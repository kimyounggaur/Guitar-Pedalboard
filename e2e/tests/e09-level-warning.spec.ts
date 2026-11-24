// E-09 입력 레벨 경고(설계서 S2.5, 4.12 표·R2-8·부록 A). 가짜 마이크로 신호를 흘려, 실제 브라우저의 오디오 스레드(level-meter#in)가 재고
// MonitorService 가 판정한 경고가 4.12 표의 시간대로 화면에 뜨는지 본다.
//   · 신호 4종: 정상(REF-PC, 경고 없음) · 작은 신호(LVL-SMALL, 모든 타건 −40 dBFS → '작습니다') · 큰 신호(LVL-HOT, 0 dBFS → '너무 큽니다') ·
//     무음(LVL-SILENT → '신호가 없습니다'). 4종 모두 데스크톱에서, 휴대폰에서는 큰 신호를 4개 탭(페달·입력·미터·프리셋) 각각에서 본다.
//     나머지 3종은 가장 불리한 '페달' 탭(도크가 접혀 패널이 하나도 안 보임)에서 판정시킨 뒤, 판정이 끝나고 4개 탭을 모두 돌며 어디에 보이는지 확인한다.
//   · R2-8 회귀: 연주를 멈추면(LVL-STOP: 한 번 치고 여운이 줄어듦) '작습니다' 가 뜨지 않는다. 옛 앱은 3.9초부터 11.6초까지(오디오 시계) 뜬 채 남았다.
//   · 판정은 장치(마이크·인터페이스) 입력만 한다. 파일 모드에서는 작은 파일·0 dBFS 파일·무음 파일을 재생해도, 재생하다 일시정지해도 경고하지 않는다.
//   · 연결을 끊으면 경고가 사라지고, 다시 연결하면 처음부터(연결 직후 1초는 판단하지 않음) 판정한다.
// 시간은 벽시계가 아니라 **오디오 시계**로 잰다(helpers/level-notice.ts). 판정이 쓰는 시간과 같은 기준이고 마이크를 여는 시간·Playwright 왕복이 섞이지 않는다.
// 기대 시각은 부록 B 의 판정 시간(연결 직후 1초 제외 + 3초·5초)을 따르되, 보고 간격(≈35 ms)과 가짜 마이크의 시작 지연을 담아 범위로 둔다.
// 경고 문구는 설계서 4.12 표의 문장 그대로다. 문구를 바꾸면 src/i18n/ko.ts·`npm run test:level-warning` 과 이 시험을 같이 바꾼다.
// 문턱값(−70·−60·−36·−30·−0.5 dBFS 와 1·3·5초 등)을 시험하는 쪽은 Node 시험(scripts/level-warning-regression.mjs)이고, 여기서는 '실제 브라우저에서 그 시간대로 화면에 뜬다' 를 본다.
import type { BrowserContextOptions, Locator, Page } from '@playwright/test';
import { connectGuitar, disconnectButton, openApp, selectMobileTab, setMobileDock, type MobileTab } from '../helpers/app';
import { fixturePath } from '../helpers/env';
import { expect, test, type MicSession } from '../helpers/fixtures';
import { describeEvents, observeLevelNotice, readLevelNotice, waitForAudioClock, type NoticeEvent } from '../helpers/level-notice';

type Warning = 'silent' | 'low' | 'high';
type Launch = (wavName?: string, contextOptions?: BrowserContextOptions) => Promise<MicSession>;

/** 설계서 4.12 표의 표시 문장 */
const TEXT: Record<Warning, string> = {
  silent: '입력 신호가 없습니다. 케이블과 입력 채널(1번/2번)을 확인하세요.',
  low: '입력이 작습니다. 인터페이스 게인이나 입력 트림을 올리세요.',
  high: '입력이 너무 큽니다. 인터페이스 게인을 낮추세요.',
};

interface Scenario {
  label: string;
  wav: string;
  /** 4.12 표대로 기대하는 경고. 정상 신호는 null(끝까지 경고 없음) */
  state: Warning | null;
  /** 경고가 처음 뜨는 오디오 시각의 범위(초). state 가 null 이면 쓰지 않는다. */
  between: readonly [number, number];
  /** 이 오디오 시각까지 기다린 뒤 판정한다. 그 뒤에도 같은 경고가 유지되는지 보는 여유를 포함한다. */
  until: number;
}

const NORMAL: Scenario = {
  label: '정상 신호(REF-PC)',
  wav: 'ref-pc.wav',
  state: null,
  between: [0, 0],
  // 가장 이른 거짓 경고는 '작습니다' 4초·'신호 없음' 6초다. 6초를 넘겨 7초까지 한 번도 안 뜨면 된다.
  until: 7,
};
const SMALL: Scenario = {
  label: '작은 신호(LVL-SMALL, −40 dBFS)',
  wav: 'lvl-small.wav',
  state: 'low',
  // 연결 직후 1초 + 3초 관찰이 차야 한다(≈4.0초). 연주가 꾸준하니 그 뒤 곧 뜬다.
  between: [3.8, 7],
  until: 7.5,
};
const HOT: Scenario = {
  label: '큰 신호(LVL-HOT, 0 dBFS)',
  wav: 'lvl-hot.wav',
  state: 'high',
  // 연결 직후 1초가 지난 첫 타건(2.0초)에 바로 뜬다. 1초 안의 타건(0초)은 판단하지 않는다.
  between: [1, 3],
  // 2초마다 0 dBFS 타건이 이어지므로 4.5초에도 그대로여야 한다(3초 동안 깨짐 없음이 아니다).
  until: 4.5,
};
const SILENT: Scenario = {
  label: '무음(LVL-SILENT)',
  wav: 'lvl-silent.wav',
  state: 'silent',
  // 연결 직후 1초 + 5초 무신호(≈6.0초).
  between: [5.8, 7.5],
  until: 8,
};

const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } as const;
const PHONE_TABS: readonly { id: MobileTab; label: string }[] = [
  { id: 'pedals', label: '페달' },
  { id: 'input', label: '입력' },
  { id: 'meter', label: '미터' },
  { id: 'preset', label: '프리셋' },
];

/** 관찰 장치를 심고 앱을 연다. 연결은 시험마다 따로 한다. */
async function openDesktop(launchWithMic: Launch, wav: string): Promise<Page> {
  const { page } = await launchWithMic(wav);
  await observeLevelNotice(page);
  await openApp(page);
  return page;
}

/** 휴대폰으로 열고 연결한 뒤 `tab` 으로 옮긴다. 연결 버튼은 '입력' 탭에 있어서 연결을 마친 다음에 옮긴다(첫 1초 판단 보류 안에 옮겨 둔다). */
async function openPhoneOnTab(launchWithMic: Launch, wav: string, tab: MobileTab): Promise<Page> {
  const { page } = await launchWithMic(wav, PHONE);
  await observeLevelNotice(page);
  await openApp(page);
  await setMobileDock(page, true);
  await connectGuitar(page);
  await selectMobileTab(page, tab);
  return page;
}

/** 시나리오의 시각까지 기다려, 화면의 경고 변화가 4.12 표의 시간대와 맞는지 단언한다. */
async function expectTimeline(page: Page, scenario: Scenario, where: string): Promise<NoticeEvent[]> {
  const observation = await waitForAudioClock(page, scenario.until);
  const events = observation.events;
  test.info().annotations.push({ type: 'timeline', description: `${where} ${scenario.label}: ${describeEvents(events)}` });
  if (scenario.state === null) {
    expect(events, `${where} ${scenario.label}: ${scenario.until}초가 되도록 경고가 한 번도 뜨지 않아야 합니다 — ${describeEvents(events)}`).toEqual([]);
    return events;
  }
  expect(
    events.map((entry) => entry.state),
    `${where} ${scenario.label}: 경고는 '${scenario.state}' 하나만, 한 번 뜨고 유지되어야 합니다 — ${describeEvents(events)}`,
  ).toEqual([scenario.state]);
  const [from, to] = scenario.between;
  expect(events[0].audioSeconds, `${where} ${scenario.label}: ${from}초보다 일찍 떴습니다(연결 직후 1초·3초/5초 관찰 규칙)`).toBeGreaterThanOrEqual(from);
  expect(events[0].audioSeconds, `${where} ${scenario.label}: ${to}초 안에 떠야 합니다`).toBeLessThanOrEqual(to);
  return events;
}

/** 경고 한 줄이 보이고, 문구·역할이 4.12 표와 같다. */
async function expectNoticeText(notice: Locator, state: Warning): Promise<void> {
  await expect(notice).toBeVisible();
  await expect(notice).toHaveText(TEXT[state]);
  // '너무 큼'은 인터페이스에서 이미 깨진 상태라 바로 알린다(alert). 나머지는 조용한 안내(status)다.
  await expect(notice).toHaveAttribute('role', state === 'high' ? 'alert' : 'status');
}

/** 데스크톱: 입력 패널과 미터 패널에 같은 경고가 둘 다 보인다(없으면 둘 다 없다). */
async function expectDesktopNotices(page: Page, state: Warning | null): Promise<void> {
  const notices = page.locator('[data-level-warning]');
  if (state === null) {
    await expect(notices).toHaveCount(0);
    return;
  }
  await expect(notices).toHaveCount(2);
  await expectNoticeText(notices.nth(0), state);
  await expectNoticeText(notices.nth(1), state);
  await expect(page.locator(`[data-level-warning="${state}"]`)).toHaveCount(2);
}

/**
 * 휴대폰: 네 탭을 모두 돌며 경고가 있어야 할 곳에서만 보인다.
 * 입력·미터 탭은 그 패널의 한 줄이 보이고, 프리셋·페달(도크 접힘) 탭은 요소가 있어도(두 패널은 늘 그려져 있다) 보이지 않는다. 마지막은 '입력' 탭이다.
 */
async function expectPhoneNotices(page: Page, state: Warning | null): Promise<void> {
  for (const tab of ['meter', 'preset', 'pedals', 'input'] as const) {
    await selectMobileTab(page, tab);
    // 요소는 탭과 상관없이 두 패널에 같은 상태로 있다(판정은 화면이 아니라 서비스가 한다).
    await expect(page.locator('[data-level-warning]'), `${tab} 탭에서 두 패널의 경고 요소 수`).toHaveCount(state === null ? 0 : 2);
    if (state === null) continue;
    if (tab === 'input' || tab === 'meter') {
      await expectNoticeText(page.locator(`#mobile-panel-${tab} [data-level-warning="${state}"]`), state);
    } else {
      await expect(page.locator('[data-level-warning]:visible'), `${tab} 탭에서는 경고가 보이지 않아야 합니다`).toHaveCount(0);
    }
  }
}

test.describe('E-09 입력 레벨 경고', () => {
  // ----- 데스크톱: 신호 4종 -----
  for (const scenario of [NORMAL, SMALL, HOT, SILENT]) {
    test(`E-09 데스크톱: ${scenario.label} → ${scenario.state ? `'${scenario.state}'` : '경고 없음'}`, async ({ launchWithMic }) => {
      const page = await openDesktop(launchWithMic, scenario.wav);
      await connectGuitar(page);
      await expectTimeline(page, scenario, '데스크톱');
      await expectDesktopNotices(page, scenario.state);
      if (scenario.state === 'high') {
        // 미터의 '클리핑' 표시는 입력 막대의 순간값이 아니라 판정된 '너무 큼'을 따른다(S2.5). 경고와 같은 근거로 켜진다.
        await expect(page.locator('.clip-indicator')).toHaveText('클리핑 발생');
        await expect(page.locator('.clip-indicator')).toHaveClass(/is-active/);
      }
    });
  }

  // ----- 휴대폰: 큰 신호 × 4개 탭 -----
  for (const tab of PHONE_TABS) {
    test(`E-09 휴대폰 '${tab.label}' 탭: 큰 신호는 어느 탭에서나 2초쯤에 '너무 큽니다'`, async ({ launchWithMic }) => {
      const page = await openPhoneOnTab(launchWithMic, HOT.wav, tab.id);
      await expect(page.locator(`#mobile-tab-${tab.id}`)).toHaveAttribute('aria-selected', 'true');
      if (tab.id === 'pedals') await expect(page.locator('#mobile-control-panels'), '페달 탭은 도크가 접혀 패널이 하나도 보이지 않는다').toBeHidden();
      await expectTimeline(page, HOT, `휴대폰 ${tab.label}`);
      // 판정이 끝났을 때도 같은 탭이 선택되어 있다(탭이 바뀌어서 맞은 것이 아니다).
      await expect(page.locator(`#mobile-tab-${tab.id}`)).toHaveAttribute('aria-selected', 'true');
      await expectPhoneNotices(page, 'high');
    });
  }

  // ----- 휴대폰 '페달' 탭(가장 불리한 탭): 나머지 신호 3종 -----
  for (const scenario of [NORMAL, SMALL, SILENT]) {
    test(`E-09 휴대폰 '페달' 탭(도크 접힘): ${scenario.label} → ${scenario.state ? `'${scenario.state}'` : '경고 없음'}`, async ({ launchWithMic }) => {
      const page = await openPhoneOnTab(launchWithMic, scenario.wav, 'pedals');
      await expect(page.locator('#mobile-control-panels')).toBeHidden();
      await expectTimeline(page, scenario, '휴대폰 페달');
      await expectPhoneNotices(page, scenario.state);
    });
  }

  // ----- R2-8: 연주를 멈추면 '작습니다' 가 뜨면 안 된다 -----
  test("E-09 연주를 멈춰도 '작습니다' 경고가 뜨지 않는다(R2-8)", async ({ launchWithMic }) => {
    // LVL-STOP: 한 번 치고(−12 dBFS) 여운이 7 dB/s 로 줄어들다 사라진다. 옛 앱은 3.9초부터 11.6초까지(오디오 시계) '입력이 너무 작습니다' 를 띄워 둔 채 두었다.
    // 새 판정은 '최근 2초 안의 연주'가 있을 때만 '작음'을 판정하므로, 여운이 줄어드는 동안에는 아무 경고도 없고 완전히 조용해진 뒤(≈13초)에야 '신호 없음' 이 된다.
    const page = await openDesktop(launchWithMic, 'lvl-stop.wav');
    await connectGuitar(page);
    const observation = await waitForAudioClock(page, 12);
    test.info().annotations.push({ type: 'timeline', description: `연주 멈춤(LVL-STOP): ${describeEvents(observation.events)}` });
    expect(observation.events, `12초가 되도록 어떤 경고도 뜨지 않아야 합니다 — ${describeEvents(observation.events)}`).toEqual([]);
    await expectDesktopNotices(page, null);
  });

  // ----- 파일 모드는 판정하지 않는다 -----
  const fileCases = [
    // 마스터링된 파일은 0 dBFS 근처까지 가도 깨진 것이 아니다. '인터페이스 게인을 낮추세요' 는 맞지 않는다.
    { label: '0 dBFS 파일', file: 'lvl-hot.wav', until: 3.5 },
    // 일시정지·끝난 파일은 조용하다. 케이블을 확인하라는 말은 맞지 않는다.
    { label: '무음 파일(일시정지와 같은 조용함)', file: 'lvl-silent.wav', until: 7 },
    // 작게 녹음된 파일은 인터페이스 게인과 무관하다.
    { label: '작은 파일(−40 dBFS)', file: 'lvl-small.wav', until: 6.5 },
  ] as const;
  for (const fileCase of fileCases) {
    test(`E-09 파일 모드: ${fileCase.label}을 재생해도 경고하지 않는다`, async ({ launchWithMic }) => {
      const page = await openDesktop(launchWithMic, 'ref-pc.wav');
      await page.setInputFiles('#audio-file', fixturePath(fileCase.file));
      // 파일이 입력에 들어와 레벨 보고가 흐르기 시작해야 시험이 의미가 있다(보고가 없으면 경고가 없는 것도 당연하다).
      const observation = await waitForAudioClock(page, fileCase.until);
      expect(observation.inputLevelMessages, '파일 소리는 입력 레벨 미터로 흐른다').toBeGreaterThan(fileCase.until * 20);
      test.info().annotations.push({ type: 'timeline', description: `파일 ${fileCase.file}: ${describeEvents(observation.events)}` });
      expect(observation.events, `${fileCase.until}초가 되도록 경고가 없어야 합니다 — ${describeEvents(observation.events)}`).toEqual([]);
      await expectDesktopNotices(page, null);
    });
  }

  test('E-09 파일 모드: 재생하다 일시정지해도 경고하지 않는다(설계서 S2.5 수용 기준)', async ({ launchWithMic }) => {
    const page = await openDesktop(launchWithMic, 'ref-pc.wav');
    await page.setInputFiles('#audio-file', fixturePath('ref-pc.wav'));
    await waitForAudioClock(page, 1.5);
    await page.getByRole('button', { name: '일시정지', exact: true }).click();
    await expect(page.getByRole('button', { name: '재생', exact: true }), '일시정지 상태: 재생 버튼이 켜진다').toBeEnabled();
    // 일시정지한 파일은 조용하다. 입력 장치였다면 '신호 없음'(마지막 소리 뒤 5초 + 연결 직후 1초의 판단 보류)이 뜰 시간을 지나서까지 본다.
    const observation = await waitForAudioClock(page, 9.5);
    test.info().annotations.push({ type: 'timeline', description: `파일 일시정지: ${describeEvents(observation.events)}` });
    expect(observation.events, `일시정지한 채 9.5초가 되도록 경고가 없어야 합니다 — ${describeEvents(observation.events)}`).toEqual([]);
    await expectDesktopNotices(page, null);
  });

  // ----- 연결 해제·재연결 -----
  test('E-09 연결을 끊으면 경고가 사라지고, 다시 연결하면 처음부터 판정한다', async ({ launchWithMic }) => {
    const page = await openDesktop(launchWithMic, HOT.wav);
    await connectGuitar(page);
    await expectTimeline(page, HOT, '첫 연결');
    await expectDesktopNotices(page, 'high');

    await disconnectButton(page).click();
    await expect(page.locator('[data-level-warning]'), '연결을 끊으면 경고가 바로 사라진다').toHaveCount(0);

    await connectGuitar(page);
    // 새 세션의 오디오 시계는 0 에서 다시 시작한다. 처음 0.8초(연결 직후 1초 안)에는 옛 경고가 남아 있거나 새로 뜨면 안 된다.
    const early = await waitForAudioClock(page, 0.8);
    expect(early.events.map((entry) => entry.state), `다시 연결한 직후에는 경고가 없다 — ${describeEvents(early.events)}`).toEqual(['high', null]);
    // 같은 신호이므로 새 세션에서도 첫 타건 뒤 곧 '너무 큼' 이 다시 뜬다.
    const later = await waitForAudioClock(page, HOT.until);
    test.info().annotations.push({ type: 'timeline', description: `재연결: ${describeEvents(later.events)}` });
    expect(later.events.map((entry) => entry.state), describeEvents(later.events)).toEqual(['high', null, 'high']);
    expect(later.events[2].audioSeconds, '새 세션의 판정은 새 시계로 1~3초 사이').toBeGreaterThanOrEqual(1);
    expect(later.events[2].audioSeconds).toBeLessThanOrEqual(3);
    await expectDesktopNotices(page, 'high');
  });

  // 도우미가 기록을 믿을 만한지(보고가 실제로 흐르는 것)는 위 시험들의 waitForAudioClock 이 이미 확인한다. 아래는 기록 도구 자체의 점검이다.
  test('E-09 관찰 도구: 오디오 시계는 연결 전에는 없고 연결하면 흐른다', async ({ launchWithMic }) => {
    const page = await openDesktop(launchWithMic, 'ref-pc.wav');
    const before = await readLevelNotice(page);
    expect(before.audioSeconds, '연결 전에는 입력 보고가 없다').toBeNull();
    expect(before.events).toEqual([]);
    await connectGuitar(page);
    const first = await waitForAudioClock(page, 1);
    const second = await waitForAudioClock(page, (first.audioSeconds ?? 0) + 0.5);
    expect(second.audioSeconds as number).toBeGreaterThan(first.audioSeconds as number);
    expect(second.sampleRate).toBeGreaterThan(8000);
  });
});
