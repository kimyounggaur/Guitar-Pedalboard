// 새 버전 알림(S2.4 변경 5): 새 서비스 워커가 이 탭을 넘겨받으면 '연주를 마친 뒤 새로고침' 안내만 띄운다.
// 자동으로 새로고침하지 않는다 — 연주 중에 페이지가 다시 불러와지면 소리가 끊기고 기타 연결이 풀린다. 누를지는 사람이 정한다.
//
//   · 서비스 워커는 `skipWaiting` + `clientsClaim` 으로 새 버전이 설치되자마자 이 탭을 넘겨받는다(vite.config.ts). 그러면 `controllerchange` 가 온다.
//   · 처음 설치할 때도 넘겨받기는 일어난다(그전에는 이 탭을 제어하는 서비스 워커가 없었다). 그것은 업데이트가 아니므로 알리지 않는다.
//   · 이 탭은 이미 내려받은 옛 스크립트로 계속 돈다. 새 버전은 다음에 새로고침할 때부터 쓰인다.
//   · 이 앱은 새 버전을 찾으러 다니지 않는다(연주 중에 새 네트워크 요청이 생기지 않게). 브라우저가 알아챌 때(탭을 새로 열거나 새로고침할 때,
//     브라우저의 주기 확인)에만 이 알림이 온다. 이 알림이 처음 들어간 배포 이전부터 열려 있던 탭은 옛 스크립트라서 알림을 띄우지 못한다.
import { showToast, type ToastInput } from '../store/toastStore';

export const UPDATE_NOTICE_MESSAGE = '새 버전이 있습니다 — 연주를 마친 뒤 새로고침';
export const UPDATE_NOTICE_ACTION_LABEL = '새로고침';
export const UPDATE_NOTICE_TOAST_KEY = 'app:update-available';

export type ServiceWorkerContainerLike = Pick<ServiceWorkerContainer, 'controller' | 'addEventListener' | 'removeEventListener'>;

export interface UpdateNoticeOptions {
  /** 기본은 `navigator.serviceWorker`. 없으면(보안 연결이 아니거나 지원하지 않는 브라우저) 아무것도 하지 않는다. */
  serviceWorker?: ServiceWorkerContainerLike | undefined;
  show?: (input: ToastInput) => unknown;
  /** 사람이 '새로고침' 을 눌렀을 때만 부른다. */
  reload?: () => void;
}

function browserServiceWorker(): ServiceWorkerContainerLike | undefined {
  try {
    return typeof navigator === 'undefined' ? undefined : navigator.serviceWorker;
  } catch {
    // 쿠키·저장을 막은 설정에서는 접근하는 것만으로 예외를 던지는 브라우저가 있다.
    return undefined;
  }
}

/** 서비스 워커 교체를 듣기 시작한다. 돌려주는 함수를 부르면 듣기를 멈춘다. */
export function installUpdateNotice(options: UpdateNoticeOptions = {}): () => void {
  const container = 'serviceWorker' in options ? options.serviceWorker : browserServiceWorker();
  if (!container) return () => undefined;
  const show = options.show ?? showToast;
  const reload = options.reload ?? (() => window.location.reload());

  // 이 탭을 이미 제어하는 서비스 워커가 있었는가. 처음 설치의 넘겨받기와 진짜 업데이트를 가른다.
  let hadController = Boolean(container.controller);
  const onControllerChange = (): void => {
    const isUpdate = hadController;
    hadController = true; // 처음 설치로 넘겨받은 뒤의 교체는 업데이트다.
    if (!isUpdate) return;
    try {
      show({
        message: UPDATE_NOTICE_MESSAGE,
        kind: 'info',
        key: UPDATE_NOTICE_TOAST_KEY,
        durationMs: 0,
        action: { label: UPDATE_NOTICE_ACTION_LABEL, onAction: reload },
      });
    } catch (error) {
      console.warn('새 버전 알림을 띄우지 못했습니다.', error);
    }
  };

  container.addEventListener('controllerchange', onControllerChange);
  return () => container.removeEventListener('controllerchange', onControllerChange);
}
