// S5.2 MIDI 확장(설계서 5.5 S5.2, RX-2). 프로그램 체인지(PC)로 프리셋을 바꾸고, 익스프레션 CC 로 와우·마스터 볼륨을 움직인다.
//   ① PC 를 받으면 연결해 둔 프리셋이 바로 적용된다. 메시지를 받은 때부터 화면에 반영될 때까지 ≤ 50 ms ★(설계서 수용 기준).
//   ② 와우 CC 0·64·127 이 와우의 '수동 위치' 를 0·50·100(대상 범위 전체)으로 옮기고, 와우를 수동 모드로 바꾼다.
//   ③ 볼륨 CC 0·64·127 이 마스터 볼륨을 0·약 50·100% 로 옮긴다(화면 슬라이더가 따라온다).
//   ④ 연결하지 않은 PC 번호·다른 채널·설정하지 않은 CC 는 아무것도 바꾸지 않는다.
// 값 계산의 모든 경우(0~127 전부·경계)는 Node 시험(test:midi)이, 소리가 계단 없이 움직이는지는 test:volume-smoothing 이 본다.
// 여기서는 실제 브라우저의 화면 반영과 시간이다. 실제 MIDI 장치·익스프레션 페달은 사람이 본다(보고서 '사람 확인 필요').
import type { Page } from '@playwright/test';
import { connectGuitar, openApp, openAudioInputMenu } from '../helpers/app';
import { expect, test } from '../helpers/fixtures';
import { mockMidi, type MidiMock } from '../helpers/mocks';
import { pedalGroup, seedStorage } from '../helpers/storage';
import { knobKoName } from '../helpers/ko-names';

const ADVANCED_KEY = 'guitar-pedalboard:midi-advanced';
const PRESET_A = { id: 'factory-clean-practice', name: 'Clean Practice', program: 3 };
const PRESET_B = { id: 'factory-edge-breakup', name: 'Edge Breakup', program: 9 };
const PC_LIMIT_MS = 50;

const advancedConfig = (config: Record<string, unknown>) => JSON.stringify({ channel: 1, volumeCc: null, wahCc: null, programs: {}, ...config });
const notice = (page: Page) => page.locator('.midi-advanced-controls [role="status"]');
const wahKnob = (page: Page) => pedalGroup(page, 'Auto Wah').locator(`input[type="range"][aria-label="${knobKoName('Auto Wah', 'Manual')}"]`);
const wahMode = (page: Page, option: 'auto' | 'manual') => pedalGroup(page, 'Auto Wah').getByRole('group', { name: knobKoName('Auto Wah', 'Mode') }).getByRole('button', { name: option, exact: true });
const masterVolume = (page: Page) => page.getByRole('slider', { name: '마스터 볼륨' });

/** 모의 MIDI 와 저장된 고급 설정으로 앱을 열고 장치를 하나 꽂는다. */
async function openWithAdvanced(page: Page, config: Record<string, unknown>): Promise<{ midi: MidiMock; id: string }> {
  const midi = await mockMidi(page, { permission: 'granted' });
  await seedStorage(page, { [ADVANCED_KEY]: advancedConfig(config) });
  await openApp(page);
  await openAudioInputMenu(page);
  const id = await midi.connect('Foot Controller');
  // 저장된 설정(프로그램·CC)이 있으면 앱이 열 때 저절로 연결해 입력을 듣는다.
  await expect.poll(() => midi.listening()).toBe(1);
  return { midi, id };
}

/**
 * 장치가 PC 를 보낸 순간부터 안내 문구가 바뀌어 화면에 반영될 때까지(ms). 페이지 안에서 재서 DevTools 왕복 시간이 섞이지 않는다.
 * 문구는 프리셋을 적용한 뒤에 쓰이므로 이 시간에는 페달 목록 교체와 React 화면 갱신이 들어 있다.
 */
async function programChangeMs(page: Page, id: string, program: number, expectedText: string): Promise<number> {
  return page.evaluate(
    ({ id: deviceId, program: programNumber, text }) => new Promise<number>((resolve, reject) => {
      const status = document.querySelector('.midi-advanced-controls [role="status"]');
      if (!status) { reject(new Error('안내 문구 영역이 없습니다')); return; }
      const timer = window.setTimeout(() => { observer.disconnect(); reject(new Error(`1초 안에 '${text}' 가 나타나지 않았습니다: '${status.textContent}'`)); }, 1000);
      const observer = new MutationObserver(() => {
        if (!status.textContent?.includes(text)) return;
        const elapsed = performance.now() - start;
        observer.disconnect();
        window.clearTimeout(timer);
        resolve(elapsed);
      });
      observer.observe(status, { childList: true, characterData: true, subtree: true });
      const start = performance.now();
      (window as unknown as { __midiMock: { send(id: string, bytes: number[]): void } }).__midiMock.send(deviceId, [0xc0, programNumber]);
    }),
    { id, program, text: expectedText },
  );
}

test.describe('S5.2 MIDI 확장', () => {
  test('S5.2 PC 로 연결해 둔 프리셋이 바로 적용되고, 메시지부터 화면 반영까지 ≤ 50 ms 다', async ({ launchWithMic }) => {
    const { page } = await launchWithMic('ref-pc.wav');
    const { id } = await openWithAdvanced(page, { programs: { [PRESET_A.program]: PRESET_A.id, [PRESET_B.program]: PRESET_B.id } });
    await connectGuitar(page); // 오디오가 돌아가는 중에 바꾼다 — 체인 재구성(페이드)까지 같은 시간 안에 시작한다

    const times: number[] = [];
    // 두 프리셋을 번갈아 다섯 번씩(첫 번은 코드가 데워지는 시간이라 버린다)
    for (let round = 0; round < 6; round += 1) {
      const target = round % 2 === 0 ? PRESET_A : PRESET_B;
      const elapsed = await programChangeMs(page, id, target.program, `${target.name} 프리셋을 불러왔습니다`);
      if (round > 0) times.push(elapsed);
      await page.waitForTimeout(150); // 앞의 체인 재구성이 끝날 틈
    }
    times.sort((a, b) => a - b);
    const median = times[Math.floor(times.length / 2)];
    test.info().annotations.push({ type: 'PC 반영 시간(ms)', description: times.map((value) => value.toFixed(1)).join(', ') });
    expect(median, `PC → 화면 반영 중앙값 ${median.toFixed(1)} ms (모두: ${times.map((value) => value.toFixed(1)).join(', ')})`).toBeLessThanOrEqual(PC_LIMIT_MS);
    expect(Math.max(...times), `가장 느린 PC → 화면 반영 ${Math.max(...times).toFixed(1)} ms`).toBeLessThanOrEqual(PC_LIMIT_MS * 2);
    await expect(notice(page)).toContainText('프리셋을 불러왔습니다');
  });

  test('S5.2 PC 로 불러온 프리셋의 페달 켜짐 상태가 실제로 바뀐다', async ({ page }) => {
    const { midi, id } = await openWithAdvanced(page, { programs: { [PRESET_A.program]: PRESET_A.id, [PRESET_B.program]: PRESET_B.id } });
    const drive = pedalGroup(page, 'Drive').locator('.stomp-toggle-switch');
    await midi.send(id, [0xc0, PRESET_A.program]);
    await expect(notice(page)).toContainText(`${PRESET_A.name} 프리셋을 불러왔습니다`);
    const withA = await drive.getAttribute('aria-pressed');
    await midi.send(id, [0xc0, PRESET_B.program]);
    await expect(notice(page)).toContainText(`${PRESET_B.name} 프리셋을 불러왔습니다`);
    const withB = await drive.getAttribute('aria-pressed');
    expect(withA, '두 프리셋의 Drive 켜짐이 같으면 프리셋이 적용됐는지 알 수 없다').not.toBe(withB);
  });

  test('S5.2 와우 CC 0·64·127 이 수동 위치를 0·50·100 으로 옮기고 수동 모드로 바꾼다', async ({ page }) => {
    const { midi, id } = await openWithAdvanced(page, { wahCc: 11 });
    await expect(wahMode(page, 'auto')).toHaveAttribute('aria-pressed', 'true');
    for (const [cc, expected] of [[0, 0], [64, 50], [127, 100], [0, 0]] as const) {
      await midi.send(id, [0xb0, 11, cc]);
      await expect(wahKnob(page)).toHaveValue(String(expected));
    }
    await expect(wahMode(page, 'manual')).toHaveAttribute('aria-pressed', 'true');
  });

  test('S5.2 볼륨 CC 0·64·127 이 마스터 볼륨을 0·50·100% 로 옮긴다', async ({ page }) => {
    const { midi, id } = await openWithAdvanced(page, { volumeCc: 7 });
    for (const [cc, expected] of [[0, 0], [64, 0.5039], [127, 1], [32, 0.2520]] as const) {
      await midi.send(id, [0xb0, 7, cc]);
      await expect.poll(async () => Number(await masterVolume(page).inputValue()), { message: `CC ${cc}` }).toBeCloseTo(expected, 2);
    }
  });

  test('S5.2 연결하지 않은 PC 번호·다른 채널·설정하지 않은 CC 는 아무것도 바꾸지 않는다', async ({ page }) => {
    const { midi, id } = await openWithAdvanced(page, { channel: 2, volumeCc: 7, wahCc: 11, programs: { [PRESET_A.program]: PRESET_A.id } });
    const before = { wah: await wahKnob(page).inputValue(), volume: await masterVolume(page).inputValue(), status: await notice(page).textContent() };
    await midi.send(id, [0xc1, 99]); // 채널 2 지만 연결하지 않은 PC 번호
    await midi.send(id, [0xc0, PRESET_A.program]); // 연결한 번호지만 채널 1
    await midi.send(id, [0xb0, 11, 127]); // 채널 1 의 와우 CC
    await midi.send(id, [0xb0, 7, 0]); // 채널 1 의 볼륨 CC
    await midi.send(id, [0xb1, 20, 127]); // 채널 2 지만 설정하지 않은 CC
    // 메시지가 처리될 틈을 준 뒤에도 그대로여야 한다.
    await page.waitForTimeout(300);
    expect({ wah: await wahKnob(page).inputValue(), volume: await masterVolume(page).inputValue(), status: await notice(page).textContent() }).toEqual(before);
    // 같은 장치로 알맞은 채널의 CC 는 움직인다(위의 '그대로' 가 장치가 죽어서가 아님을 확인).
    await midi.send(id, [0xb1, 11, 127]);
    await expect(wahKnob(page)).toHaveValue('100');
  });
});
