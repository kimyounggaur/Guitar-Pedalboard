// 음원 파일 모드(E-10, 설계서 S2.6·4.11)를 관찰하는 도우미. 앱 코드보다 먼저 심어야 하므로 page.goto 전에 `trackFileMedia` 를 부른다.
//   · `new Audio()` 로 만들어지는 `<audio>` 요소를 모두 모아 두고 재생 상태(위치·멈춤·끝남·반복)를 읽게 한다.
//     '세션마다 새 `<audio>` 요소를 쓴다'(createMediaElementSource 는 요소마다 한 번만 부를 수 있다)를 요소 개수로 본다.
//   · `URL.createObjectURL` / `revokeObjectURL` 호출을 기록한다. 이전 Object URL 을 해제하는지, 옛 요소가 자원을 놓았는지 본다.
import type { Locator, Page } from '@playwright/test';

export interface FileMediaElement {
  /** 요소가 만들어질 때 받은 Object URL(`blob:`). 요소가 자원을 놓은 뒤에도 남겨 둔다. */
  url: string;
  /** 요소에 src 속성이 아직 있는지. 정리 때 `removeAttribute('src')` 로 놓으면 false 가 된다. */
  hasSrcAttribute: boolean;
  paused: boolean;
  ended: boolean;
  loop: boolean;
  currentTime: number;
  /** 길이를 모르면 0 */
  duration: number;
}

export interface FileMediaReading {
  /** 음원 파일로 만들어진 Object URL(오래된 것부터). 스크립트(워클릿)용 Blob 은 센 것이 아니다. */
  createdUrls: string[];
  /** 해제된 Object URL(위 createdUrls 안의 것만) */
  revokedUrls: string[];
  /** 만들어진 `<audio>` 요소(오래된 것부터). 가장 마지막 것이 지금 세션의 요소다. */
  elements: FileMediaElement[];
}

export interface PositionSample {
  /** 관찰을 시작한 뒤 흐른 시간(ms) */
  at: number;
  /** 가장 최근 요소의 재생 위치(초). 요소가 아직 없으면 -1 */
  currentTime: number;
  paused: boolean;
}

/** 앱 코드보다 먼저 심어야 하므로 page.goto 전에 부른다. */
export async function trackFileMedia(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const created: string[] = [];
    const revoked: string[] = [];
    const tracked: { element: HTMLAudioElement; url: string }[] = [];

    const nativeCreate = URL.createObjectURL.bind(URL);
    const nativeRevoke = URL.revokeObjectURL.bind(URL);
    // 앱은 워클릿 모듈 같은 스크립트도 Object URL 로 만든다. 음원 파일(오디오 Blob)이 아닌 것은 기록하지 않는다.
    URL.createObjectURL = (object: Blob | MediaSource): string => {
      const url = nativeCreate(object);
      if (object instanceof Blob && !/javascript|html|json/.test(object.type)) created.push(url);
      return url;
    };
    URL.revokeObjectURL = (url: string): void => {
      if (created.includes(url)) revoked.push(url);
      nativeRevoke(url);
    };

    const NativeAudio = window.Audio;
    window.Audio = new Proxy(NativeAudio, {
      construct(target, args: [string?], newTarget) {
        const element = Reflect.construct(target, args, newTarget) as HTMLAudioElement;
        tracked.push({ element, url: args[0] ?? '' });
        return element;
      },
    });

    Object.defineProperty(window, '__fileMedia', {
      configurable: true,
      value: () => ({
        createdUrls: [...created],
        revokedUrls: [...revoked],
        elements: tracked.map(({ element, url }) => ({
          url,
          hasSrcAttribute: element.hasAttribute('src'),
          paused: element.paused,
          ended: element.ended,
          loop: element.loop,
          currentTime: element.currentTime,
          duration: Number.isFinite(element.duration) ? element.duration : 0,
        })),
      }),
    });
  });
}

export async function readFileMedia(page: Page): Promise<FileMediaReading> {
  return page.evaluate(() => (window as unknown as { __fileMedia: () => FileMediaReading }).__fileMedia());
}

/** 지금 세션의 `<audio>` 요소(가장 마지막). 아직 하나도 없으면 null */
export async function currentFileElement(page: Page): Promise<FileMediaElement | null> {
  const { elements } = await readFileMedia(page);
  return elements.length === 0 ? null : elements[elements.length - 1];
}

/** 가장 최근 요소의 재생 위치를 `intervalMs` 마다 `durationMs` 동안 읽는다. 반복(처음으로 되감김)을 세는 데 쓴다. */
export async function sampleFilePosition(page: Page, durationMs: number, intervalMs = 40): Promise<PositionSample[]> {
  return page.evaluate(
    ({ spanMs, stepMs }) =>
      new Promise<PositionSample[]>((resolve) => {
        const read = (window as unknown as { __fileMedia: () => FileMediaReading }).__fileMedia;
        const samples: PositionSample[] = [];
        const started = performance.now();
        const tick = (): void => {
          const { elements } = read();
          const element = elements.length === 0 ? null : elements[elements.length - 1];
          const at = performance.now() - started;
          samples.push({ at, currentTime: element?.currentTime ?? -1, paused: element?.paused ?? true });
          if (at >= spanMs) resolve(samples);
          else setTimeout(tick, stepMs);
        };
        tick();
      }),
    { spanMs: durationMs, stepMs: intervalMs },
  );
}

/** 위치가 처음 쪽으로 되감긴 횟수(`dropSeconds` 이상 줄어든 표본). 1초짜리 파일을 반복 재생하면 1초마다 한 번씩 센다. */
export function countRewinds(samples: PositionSample[], dropSeconds = 0.3): number {
  let count = 0;
  for (let index = 1; index < samples.length; index += 1) {
    if (samples[index - 1].currentTime - samples[index].currentTime >= dropSeconds) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// 화면 요소
// ---------------------------------------------------------------------------------------------
/** 음원 파일 플레이어 묶음(녹음 패널에도 '정지' 버튼이 있으므로 버튼은 이 안에서 찾는다) */
export const filePlayer = (page: Page): Locator => page.getByRole('group', { name: '음원 파일 플레이어' });
export const fileButton = (page: Page, name: '뒤로 10초' | '재생' | '일시정지' | '정지' | '앞으로 10초'): Locator =>
  filePlayer(page).getByRole('button', { name, exact: true });
export const openFileButton = (page: Page): Locator => page.getByRole('button', { name: '음원 파일 열기', exact: true });
export const closeFileButton = (page: Page): Locator => page.getByRole('button', { name: '파일 닫기', exact: true });
export const positionSlider = (page: Page): Locator => page.getByRole('slider', { name: '음원 재생 위치' });
/** '반복 재생' 스위치(체크박스) */
export const loopSwitch = (page: Page): Locator => page.getByLabel('반복 재생');
/** 스위치의 그림 부분. 체크박스 자체는 투명해 직접 누를 수 없으므로 이쪽을 누른다. */
export const loopSwitchLabel = (page: Page): Locator => page.locator('label.toggle-switch', { hasText: '반복 재생' });
export const EMPTY_FILE_TEXT = '열린 음원 없음';

/** 사용자가 '음원 파일 열기' 버튼을 눌러 브라우저의 파일 선택 창에서 파일을 고르는 흐름 전체(숨긴 입력을 건드리지 않는다) */
export async function openFileThroughButton(page: Page, filePath: string): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await openFileButton(page).click();
  await (await chooser).setFiles(filePath);
}

/** 포커스가 컨트롤에 남아 있으면 Space·Esc 가 그 컨트롤의 일을 하므로, 전역 단축키를 시험하기 전에 비운다. */
export async function releaseFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  });
}
