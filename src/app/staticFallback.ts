// React 가 아예 뜨지 못했을 때 `#root` 에 넣는 정적 안내(S1.7, 설계서 4.8절 — 흰 화면 0).
// React·스토어·CSS 에 기대지 않는다. DOM API 만으로 만들고 스타일은 인라인으로 둔다.
export const STATIC_FALLBACK_TITLE = '앱을 시작하지 못했습니다';

export function showStaticFallback(root: HTMLElement | null): void {
  if (!root) return;

  const main = document.createElement('main');
  main.setAttribute('role', 'alert');
  main.setAttribute('data-static-fallback', 'true');
  main.style.cssText = 'padding:2rem;color:#e8edf4;background:#0b0f16;min-height:100vh;font-family:system-ui,sans-serif;line-height:1.6';

  const title = document.createElement('h1');
  title.textContent = STATIC_FALLBACK_TITLE;

  const body = document.createElement('p');
  body.textContent = '브라우저가 이 앱을 실행하지 못했습니다. 페이지를 다시 불러오고, 계속 안 되면 브라우저를 최신 버전으로 업데이트하거나 다른 브라우저(Chrome, Edge, Safari)로 열어 보세요.';

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.textContent = '페이지 다시 불러오기';
  reload.style.cssText = 'min-height:44px;padding:8px 16px;font:inherit;cursor:pointer';
  reload.addEventListener('click', () => window.location.reload());

  main.append(title, body, reload);
  root.replaceChildren(main);
}
