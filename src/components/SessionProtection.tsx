import { useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';

/** Keep a playing session awake when supported, and guard unsaved recording. */
export function SessionProtection() {
  const isRunning = useAudioStore((state) => state.isRunning);
  const recordingStatus = useAudioStore((state) => state.recordingStatus);

  useEffect(() => {
    if (recordingStatus !== 'recording') return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [recordingStatus]);

  useEffect(() => {
    if (!isRunning || !('wakeLock' in navigator)) return;
    let active = true;
    let sentinel: WakeLockSentinel | null = null;
    const acquire = async () => {
      if (!active || document.visibilityState !== 'visible' || sentinel) return;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!active) { await lock.release(); return; }
        sentinel = lock;
        lock.addEventListener('release', () => { if (sentinel === lock) sentinel = null; });
      } catch {
        // Browsers may deny wake locks or release them when the page is hidden.
      }
    };
    void acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      active = false;
      document.removeEventListener('visibilitychange', acquire);
      if (sentinel) void sentinel.release();
    };
  }, [isRunning]);
  return null;
}
