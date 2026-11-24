import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installCrossTabNotice } from './app/crossTabNotice';
import { installGlobalErrorHandlers } from './app/globalErrors';
import { showStaticFallback } from './app/staticFallback';
import { installUpdateNotice } from './app/updateNotice';
import { AudioEngine } from './audio/AudioEngine';
import { getBoot } from './persistence/appData';
import { usePedalStore } from './store/pedalStore';
import { announceFactoryCopies } from './store/presetStore';
import './styles/globals.css';

// 오류 경계가 잡지 못하는 오류(이벤트 핸들러·비동기·타이머)는 토스트로 알리고 앱은 계속 둔다(S1.7).
installGlobalErrorHandlers();

const rootElement = document.getElementById('root');

try {
  const engine = AudioEngine.getInstance();
  engine.setPedalsProvider(() => usePedalStore.getState().pedals);

  // 프리셋 음량 보정(S1.4c): 그래프를 만들 때는 지금 값을 읽고, 값이 바뀌면(프리셋 불러오기·음량 맞추기·실행 취소) 엔진에 알린다.
  engine.setPresetTrimProvider(() => usePedalStore.getState().presetTrimDb);
  usePedalStore.subscribe((state, previous) => {
    if (state.presetTrimDb !== previous.presetTrimDb) engine.setPresetTrimDb(state.presetTrimDb);
  });

  if (import.meta.env.DEV) {
    void import('./store/__migration_check').then(({ runMigrationChecks }) => {
      runMigrationChecks();
    });
  }

  if (!rootElement) throw new Error('#root 요소를 찾을 수 없습니다.');
  createRoot(rootElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );

  // 저장 형식을 v2 로 처음 옮긴 방문에서만, 팩토리 프리셋과 똑같은 사본이 있으면 한 번 묻는다(M5). 실패해도 앱은 계속 둔다.
  try {
    announceFactoryCopies();
  } catch (error) {
    console.warn('팩토리 사본 안내를 띄우지 못했습니다.', error);
  }

  // 다른 탭에서 옛 버전이 v1 키에 쓰면 닫으라고 알린다(S2.4). v2 모드로 열렸을 때만 뜻이 있다 — 옛 방식(v1) 모드의 탭은 v1 키에 쓰는 것이 정상이다.
  try {
    if (getBoot().mode === 'v2') installCrossTabNotice();
  } catch (error) {
    console.warn('다른 탭 안내를 설치하지 못했습니다.', error);
  }

  // 새 서비스 워커가 이 탭을 넘겨받으면 '연주를 마친 뒤 새로고침' 안내만 띄운다(S2.4). 자동으로 새로고침하지 않는다.
  try {
    installUpdateNotice();
  } catch (error) {
    console.warn('새 버전 알림을 설치하지 못했습니다.', error);
  }
} catch (error) {
  // React 가 아예 뜨지 못한 경우: 흰 화면 대신 정적 안내를 넣는다.
  console.error('앱을 시작하지 못했습니다.', error);
  showStaticFallback(rootElement);
}
