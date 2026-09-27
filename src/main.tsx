import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AudioEngine } from './audio/AudioEngine';
import { usePedalStore } from './store/pedalStore';
import './styles/globals.css';

AudioEngine.getInstance().setPedalsProvider(() => usePedalStore.getState().pedals);

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
