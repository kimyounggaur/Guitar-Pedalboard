import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AudioEngine } from './audio/AudioEngine';
import { usePedalStore } from './store/pedalStore';
import './styles/globals.css';

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
