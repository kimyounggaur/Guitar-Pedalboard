import { useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';
import { DeviceSelector } from './DeviceSelector';

export function ConnectGuitarPanel() {
  const pedals = usePedalStore((state) => state.pedals);
  const isRunning = useAudioStore((state) => state.isRunning);
  const isLoading = useAudioStore((state) => state.isLoading);
  const error = useAudioStore((state) => state.error);
  const start = useAudioStore((state) => state.start);
  const stop = useAudioStore((state) => state.stop);
  const loadDevices = useAudioStore((state) => state.loadDevices);

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  return (
    <section className="side-panel connect-panel">
      <div className="panel-title">
        <p className="eyebrow">Audio</p>
        <h2>기타 연결</h2>
      </div>

      <DeviceSelector />

      <div className="connect-actions">
        {!isRunning ? (
          <button
            type="button"
            className="primary-button"
            disabled={isLoading}
            onClick={() => void start(pedals)}
          >
            {isLoading ? '연결 중...' : 'Connect Guitar'}
          </button>
        ) : (
          <button
            type="button"
            className="danger-button"
            disabled={isLoading}
            onClick={() => void stop()}
          >
            Disconnect
          </button>
        )}
      </div>

      <p className="panel-copy">
        버튼을 누른 뒤 브라우저 권한 창에서 오디오 인터페이스 입력을 허용하세요.
      </p>

      {error && <p className="error-message">{error}</p>}
    </section>
  );
}
