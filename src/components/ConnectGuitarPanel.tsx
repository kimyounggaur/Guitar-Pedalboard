import { useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';
import { DeviceSelector } from './DeviceSelector';

export function ConnectGuitarPanel() {
  const pedals = usePedalStore((state) => state.pedals);
  const isRunning = useAudioStore((state) => state.isRunning);
  const inputMode = useAudioStore((state) => state.inputMode);
  const uploadedFileName = useAudioStore((state) => state.uploadedFileName);
  const isLoading = useAudioStore((state) => state.isLoading);
  const error = useAudioStore((state) => state.error);
  const inputLevel = useAudioStore((state) => state.inputLevel);
  const start = useAudioStore((state) => state.start);
  const startFile = useAudioStore((state) => state.startFile);
  const stop = useAudioStore((state) => state.stop);
  const loadDevices = useAudioStore((state) => state.loadDevices);
  const isClipping = isRunning && inputLevel.db > -1;

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  return (
    <section className="side-panel connect-panel">
      <div className="panel-title">
        <p className="eyebrow">Audio Input</p>
        <h2>기타 입력 연결</h2>
      </div>

      <DeviceSelector />

      {inputMode !== 'file' && (
        <div className="connect-actions">
          {!isRunning ? (
            <button
              type="button"
              className="primary-button"
              disabled={isLoading}
              onClick={() => void start(pedals)}
            >
              {isLoading ? '연결 중...' : '기타 연결하기'}
            </button>
          ) : (
            <button
              type="button"
              className="danger-button"
              disabled={isLoading}
              onClick={() => void stop()}
            >
              연결 해제
            </button>
          )}
        </div>
      )}

      <div className="audio-file-upload">
        <label htmlFor="audio-file">음원 파일</label>
        <input
          id="audio-file"
          type="file"
          accept="audio/*"
          disabled={isLoading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              void startFile(file, pedals);
            }
            event.currentTarget.value = '';
          }}
        />
        {inputMode === 'file' && uploadedFileName && (
          <div className="file-playback-row">
            <span>{uploadedFileName}</span>
            <button
              type="button"
              className="secondary-button"
              disabled={isLoading}
              onClick={() => void stop()}
            >
              정지
            </button>
          </div>
        )}
      </div>

      {isClipping && (
        <p className="warning-message">
          입력 신호가 너무 큽니다. 오디오 인터페이스의 input gain을 낮춰 clipping을 피하세요.
        </p>
      )}

      <p className="panel-copy">
        스피커 피드백을 막기 위해 헤드폰 사용을 권장합니다. 버튼을 누르면 브라우저 권한 승인 후
        입력 장치 목록을 다시 불러옵니다.
      </p>

      {error && <p className="error-message">{error}</p>}
    </section>
  );
}
