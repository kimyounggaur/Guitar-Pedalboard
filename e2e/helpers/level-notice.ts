// 입력 레벨 경고(E-09, 설계서 4.12)를 관찰하는 도우미. page.goto 전에 `observeLevelNotice` 를 부른다.
//
// 경고가 '언제' 떴는지를 벽시계가 아니라 **오디오 시계**로 잰다. 벽시계는 마이크를 여는 시간·Playwright 왕복이 섞이고,
// 판정(MonitorService)이 쓰는 시간도 오디오 시계(level-meter#in 보고의 frame / sampleRate)라서 같은 기준으로 맞춰야 4.12 표의 초 단위 기준을 잴 수 있다.
//   · 입력 쪽 레벨 미터(level-meter, tap 'in')의 보고를 앱과 나란히 엿보아 '지금의 오디오 시각'을 안다(앱의 수신기는 그대로 둔다).
//   · 화면의 입력 레벨 경고 요소(입력 패널·미터 패널의 InputLevelNotice, `data-level-warning`)가 바뀔 때마다 그때의 오디오 시각과 함께 기록한다.
//     상태는 그 속성의 값이다. S2.5 이전 앱의 입력 경고(속성이 없고 연결 패널 안의 `.level-warning`)도 'legacy' 로 같이 적어서, 옛 앱에서 같은 시험을
//     돌려 '경고가 떴다'를 같은 눈으로 볼 수 있다. 미터 패널의 **출력** 경고(클리핑·0 dBFS 근접, 같은 클래스에 숨김 속성)는 입력 경고가 아니므로 보지 않는다.
//     패널이 숨겨져(`hidden`) 있어도 요소는 있으므로 '탭과 무관하게 판정된다'를 같이 볼 수 있다. 두 패널이 서로 다른 상태를 보이면 'low+high' 처럼 '+' 로 이어 적는다.
// 이 도우미는 E-03 의 `observeGuard` 와 따로 쓴다(둘 다 심어도 서로 방해하지 않는다).
import { expect, type Page } from '@playwright/test';

export interface NoticeEvent {
  /** 이 시점에 화면에 있던 경고 상태('silent'·'low'·'high'). 없으면 null, 패널끼리 다르면 '+' 로 이은 값 */
  state: string | null;
  /** 화면이 바뀐 때의 오디오 시각(초): 그때까지 받은 마지막 입력 보고의 frame / sampleRate. 보고가 없었으면 0 */
  audioSeconds: number;
}

export interface NoticeObservation {
  sampleRate: number;
  /** 입력 레벨 미터의 마지막 보고 시각(오디오 시계, 초). 보고가 아직 없으면 null */
  audioSeconds: number | null;
  /** 입력 레벨 미터가 보낸 보고 수 */
  inputLevelMessages: number;
  /** 화면의 경고 상태가 바뀐 기록(오래된 것부터) */
  events: NoticeEvent[];
}

/** 앱 코드보다 먼저 심어야 하므로 page.goto 전에 부른다. */
export async function observeLevelNotice(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state = {
      sampleRate: 0,
      lastFrame: null as number | null,
      messages: 0,
      events: [] as { state: string | null; audioSeconds: number }[],
      current: null as string | null,
    };
    const audioSeconds = (): number | null => (state.lastFrame === null || state.sampleRate === 0 ? null : state.lastFrame / state.sampleRate);

    const Native = window.AudioWorkletNode;
    if (typeof Native === 'function') {
      const Wrapped = function (this: unknown, ...args: ConstructorParameters<typeof AudioWorkletNode>) {
        const instance = Reflect.construct(Native, args, new.target ?? Wrapped) as AudioWorkletNode;
        if (args[1] === 'level-meter') {
          state.sampleRate = instance.context.sampleRate;
          // 새 세션(연결 해제 뒤 다시 연결·파일 열기)의 오디오 시계는 0 에서 다시 시작한다. 옛 값이 남아 새 시계로 착각되지 않게
          // 입력 쪽 미터(tap 'in')가 새로 만들어질 때 비운다. 출력 쪽 미터는 같은 세션에서 함께 만들어지므로 건드리지 않는다.
          const options = args[2] as { processorOptions?: { tap?: string } } | undefined;
          if (options?.processorOptions?.tap === 'in') state.lastFrame = null;
          // 앱의 `port.onmessage =` 는 노드를 만든 뒤에 붙으므로 이 수신기가 먼저 불린다.
          // 그래서 앱이 그 보고로 화면을 바꾸는 시점에는 lastFrame 이 이미 그 보고의 시각이다.
          instance.port.addEventListener('message', (event: MessageEvent) => {
            const data = event.data as { type?: string; tap?: string; frame?: number } | null;
            if (data && typeof data === 'object' && data.type === 'level' && data.tap === 'in' && typeof data.frame === 'number') {
              state.lastFrame = data.frame;
              state.messages += 1;
            }
          });
          instance.port.start();
        }
        return instance;
      } as unknown as typeof AudioWorkletNode;
      Wrapped.prototype = Native.prototype;
      Object.setPrototypeOf(Wrapped, Native);
      window.AudioWorkletNode = Wrapped;
    }

    const snapshot = (): string | null => {
      const values = new Set<string>();
      document.querySelectorAll('[data-level-warning], .connect-panel .level-warning').forEach((element) => values.add(element.getAttribute('data-level-warning') ?? 'legacy'));
      return values.size === 0 ? null : Array.from(values).sort().join('+');
    };
    const record = (): void => {
      const now = snapshot();
      if (now === state.current) return;
      state.current = now;
      state.events.push({ state: now, audioSeconds: audioSeconds() ?? 0 });
    };
    new MutationObserver(record).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'data-level-warning'] });

    Object.defineProperty(window, '__levelNotice', {
      configurable: true,
      value: (): NoticeObservation => ({
        sampleRate: state.sampleRate,
        audioSeconds: audioSeconds(),
        inputLevelMessages: state.messages,
        events: state.events.map((entry) => ({ ...entry })),
      }),
    });
  });
}

export async function readLevelNotice(page: Page): Promise<NoticeObservation> {
  return page.evaluate(() => (window as unknown as { __levelNotice: () => NoticeObservation }).__levelNotice());
}

/**
 * 오디오 시계가 `seconds` 에 이를 때까지 기다린다. 시간 안에 이르지 못하면(마이크·파일이 흐르지 않는 경우) 그때까지의 관찰을 담아 실패한다.
 * 기다리는 한도는 오디오 시계로 남은 시간 + 15초다(느린 환경에서도 시계가 흐르는 한 끝까지 기다린다).
 */
export async function waitForAudioClock(page: Page, seconds: number): Promise<NoticeObservation> {
  let latest = await readLevelNotice(page);
  await expect
    .poll(
      async () => {
        latest = await readLevelNotice(page);
        return latest.audioSeconds ?? -1;
      },
      { timeout: seconds * 1000 + 15_000, intervals: [100, 200, 250], message: `오디오 시계가 ${seconds}초에 이르러야 합니다(입력 보고 ${latest.inputLevelMessages}개)` },
    )
    .toBeGreaterThanOrEqual(seconds);
  return readLevelNotice(page);
}

/** 기록을 보기 쉽게: `low@4.1 → null@9.8` */
export function describeEvents(events: NoticeEvent[]): string {
  return events.length === 0 ? '(변화 없음)' : events.map((entry) => `${entry.state ?? '없음'}@${entry.audioSeconds.toFixed(2)}`).join(' → ');
}
