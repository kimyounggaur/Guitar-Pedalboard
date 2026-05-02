import { useEffect } from 'react';
import { useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';
import { DeviceSelector } from './DeviceSelector';

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${remainingSeconds}`;
}

export function ConnectGuitarPanel() {
  const pedals = usePedalStore((state) => state.pedals);
  const isRunning = useAudioStore((state) => state.isRunning);
  const inputMode = useAudioStore((state) => state.inputMode);
  const uploadedFileName = useAudioStore((state) => state.uploadedFileName);
  const fileCurrentTime = useAudioStore((state) => state.fileCurrentTime);
  const fileDuration = useAudioStore((state) => state.fileDuration);
  const isFilePaused = useAudioStore((state) => state.isFilePaused);
  const isLoading = useAudioStore((state) => state.isLoading);
  const error = useAudioStore((state) => state.error);
  const inputLevel = useAudioStore((state) => state.inputLevel);
  const start = useAudioStore((state) => state.start);
  const startFile = useAudioStore((state) => state.startFile);
  const playFile = useAudioStore((state) => state.playFile);
  const pauseFile = useAudioStore((state) => state.pauseFile);
  const seekFile = useAudioStore((state) => state.seekFile);
  const stop = useAudioStore((state) => state.stop);
  const panic = useAudioStore((state) => state.panic);
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

      {isRunning && (
        <button type="button" className="panic-button" onClick={panic}>
          Panic
        </button>
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
          <div className="file-player" aria-label="업로드 음원 플레이어">
            <div className="file-playback-row">
              <span>{uploadedFileName}</span>
              <span className="file-playback-time">
                {formatPlaybackTime(fileCurrentTime)} / {formatPlaybackTime(fileDuration)}
              </span>
            </div>
            <div className="file-transport-controls">
              <button
                type="button"
                className="secondary-button"
                disabled={isLoading}
                onClick={() => seekFile(-10)}
              >
                뒤로 10초
              </button>
              {isFilePaused ? (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isLoading}
                  onClick={() => void playFile()}
                >
                  재생
                </button>
              ) : (
                <button
                  type="button"
                  className="secondary-button"
                  disabled={isLoading}
                  onClick={pauseFile}
                >
                  일시정지
                </button>
              )}
              <button
                type="button"
                className="secondary-button"
                disabled={isLoading}
                onClick={() => void stop()}
              >
                정지
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={isLoading}
                onClick={() => seekFile(10)}
              >
                앞으로 10초
              </button>
            </div>
          </div>
        )}
      </div>

      {isClipping && (
        <p className="warning-message">
          입력 신호가 너무 큽니다. 오디오 인터페이스의 input gain을 낮춰 clipping을 피하세요.
        </p>
      )}

      <p className="panel-copy">
        초기 테스트는 헤드폰 사용을 권장합니다. 오디오 인터페이스의 Direct Monitor가 켜져 있으면
        원음과 처리음이 함께 들릴 수 있습니다.
      </p>

      {error && <p className="error-message">{error}</p>}
    </section>
  );
}
