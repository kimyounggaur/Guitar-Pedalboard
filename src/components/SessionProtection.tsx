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
    // 요청이 끝나기 전에 '보임' 신호가 또 오면 겹쳐 요청해 앞의 잠금을 잃어버린다(풀 수 없는 잠금이 남아 화면이 계속 켜져 있다).
    let requesting = false;
    const acquire = async () => {
      if (!active || document.visibilityState !== 'visible' || sentinel || requesting) return;
      requesting = true;
      try {
        const lock = await navigator.wakeLock.request('screen');
        if (!active) { await lock.release(); return; }
        sentinel = lock;
        lock.addEventListener('release', () => { if (sentinel === lock) sentinel = null; });
      } catch {
        // Browsers may deny wake locks or release them when the page is hidden.
      } finally {
        requesting = false;
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
