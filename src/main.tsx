import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { installGlobalErrorHandlers } from './app/globalErrors';
import { showStaticFallback } from './app/staticFallback';
import { AudioEngine } from './audio/AudioEngine';
import { usePedalStore } from './store/pedalStore';
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
} catch (error) {
  // React 가 아예 뜨지 못한 경우: 흰 화면 대신 정적 안내를 넣는다.
  console.error('앱을 시작하지 못했습니다.', error);
  showStaticFallback(rootElement);
}
