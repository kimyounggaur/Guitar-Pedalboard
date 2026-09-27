import { useEffect, useState } from 'react';
import { useAudioStore } from '../store/audioStore';
import { DeviceSelector } from './DeviceSelector';
import { ToggleSwitch } from './ToggleSwitch';

const MOBILE_AUDIO_NOTICE_KEY = 'guitar-pedalboard:mobile-audio-notice-dismissed';

function readMobileNoticeDismissed(): boolean {
  if (typeof window === 'undefined') return false;

  try {
    return window.localStorage.getItem(MOBILE_AUDIO_NOTICE_KEY) === 'true';
  } catch {
    return false;
  }
}

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${remainingSeconds}`;
}

interface ConnectGuitarPanelProps {
  isMobile?: boolean;
}

export function ConnectGuitarPanel({ isMobile = false }: ConnectGuitarPanelProps) {
  const [isMobileNoticeDismissed, setIsMobileNoticeDismissed] = useState(
    readMobileNoticeDismissed,
  );
  const isRunning = useAudioStore((state) => state.isRunning);
  const inputMode = useAudioStore((state) => state.inputMode);
  const uploadedFileName = useAudioStore((state) => state.uploadedFileName);
  const fileCurrentTime = useAudioStore((state) => state.fileCurrentTime);
  const fileDuration = useAudioStore((state) => state.fileDuration);
  const isFilePaused = useAudioStore((state) => state.isFilePaused);
  const isLoading = useAudioStore((state) => state.isLoading);
  const error = useAudioStore((state) => state.error);
  const inputLevel = useAudioStore((state) => state.inputLevel);
  const inputGainDb = useAudioStore((state) => state.inputGainDb);
  const howlProtectionEnabled = useAudioStore((state) => state.howlProtectionEnabled);
  const start = useAudioStore((state) => state.start);
  const startFile = useAudioStore((state) => state.startFile);
  const playFile = useAudioStore((state) => state.playFile);
  const pauseFile = useAudioStore((state) => state.pauseFile);
  const seekFile = useAudioStore((state) => state.seekFile);
  const stop = useAudioStore((state) => state.stop);
  const panic = useAudioStore((state) => state.panic);
  const loadDevices = useAudioStore((state) => state.loadDevices);
  const setInputGainDb = useAudioStore((state) => state.setInputGainDb);
  const setHowlProtectionEnabled = useAudioStore((state) => state.setHowlProtectionEnabled);
  const hasUploadedFile = inputMode === 'file' && Boolean(uploadedFileName);
  const fileControlsDisabled = isLoading || !hasUploadedFile;
  const inputWarning = !isRunning
    ? null
    : inputLevel.isClipping
      ? {
          kind: 'danger',
          message: '클리핑 발생. 오디오 인터페이스 게인을 낮추세요',
        }
      : inputLevel.peakDb > -1
        ? { kind: 'warning', message: '입력이 0dBFS에 근접했습니다' }
        : inputLevel.peakDb < -40
          ? { kind: 'muted', message: '입력이 너무 작습니다. 게인을 올리세요' }
          : null;

  useEffect(() => {
    void loadDevices();
  }, [loadDevices]);

  const dismissMobileNotice = () => {
    setIsMobileNoticeDismissed(true);
    try {
      window.localStorage.setItem(MOBILE_AUDIO_NOTICE_KEY, 'true');
    } catch {
      // The notice remains dismissed for this session when storage is unavailable.
    }
  };

  return (
    <section className="side-panel connect-panel">
      {isMobile && !isMobileNoticeDismissed ? (
        <aside className="mobile-audio-notice" aria-label="모바일 오디오 안내">
          <p>
            <span>모바일은 입력 지연이 커서 실시간 연주에 적합하지 않습니다.</span>
            <span>
              음원 파일 재생 모드로 톤을 확인하거나, PC + 오디오 인터페이스 사용을 권장합니다.
            </span>
          </p>
          <button
            type="button"
            aria-label="모바일 오디오 안내 닫기"
            onClick={dismissMobileNotice}
          >
            닫기
          </button>
        </aside>
      ) : null}
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
              onClick={() => void start()}
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
              void startFile(file);
            }
            event.currentTarget.value = '';
          }}
        />

        <div className="file-player" role="group" aria-label="업로드 음원 플레이어">
          <div className="file-playback-row">
            <span>{uploadedFileName ?? '업로드된 음원 없음'}</span>
            <span className="file-playback-time">
              {formatPlaybackTime(fileCurrentTime)} / {formatPlaybackTime(fileDuration)}
            </span>
          </div>
          <div className="file-transport-controls">
            <button
              type="button"
              className="secondary-button"
              disabled={fileControlsDisabled}
              onClick={() => seekFile(-10)}
            >
              뒤로 10초
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={fileControlsDisabled || !isFilePaused}
              onClick={() => void playFile()}
            >
              재생
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={fileControlsDisabled || isFilePaused}
              onClick={pauseFile}
            >
              일시정지
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={fileControlsDisabled}
              onClick={() => void stop()}
            >
              정지
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={fileControlsDisabled}
              onClick={() => seekFile(10)}
            >
              앞으로 10초
            </button>
          </div>
        </div>
      </div>

      <div className="input-safety-controls">
        <label className="io-slider-control">
          <span className="control-row">
            <span>입력 트림</span>
            <output>
              {inputGainDb > 0 ? '+' : ''}
              {inputGainDb.toFixed(1)} dB
            </output>
          </span>
          <input
            type="range"
            min={-24}
            max={24}
            step={0.5}
            value={inputGainDb}
            aria-label="입력 트림"
            aria-valuetext={`입력 트림 ${inputGainDb > 0 ? '+' : ''}${inputGainDb.toFixed(1)} 데시벨`}
            onChange={(event) => setInputGainDb(Number(event.currentTarget.value))}
          />
        </label>
        <div className="howl-protection-control">
          <ToggleSwitch
            label="하울링 보호"
            checked={howlProtectionEnabled}
            onChange={setHowlProtectionEnabled}
          />
          <span>출력이 오래 과도하면 자동으로 차단합니다.</span>
        </div>
      </div>

      {inputWarning ? (
        <p
          className={`level-warning is-${inputWarning.kind}`}
          role={inputWarning.kind === 'danger' ? 'alert' : 'status'}
        >
          {inputWarning.message}
        </p>
      ) : null}

      <p className="panel-copy">
        초기 테스트는 헤드폰 사용을 권장합니다. 오디오 인터페이스의 Direct Monitor가 켜져 있으면
        원음과 처리음이 함께 들릴 수 있습니다.
      </p>

      {error && <p className="error-message">{error}</p>}
    </section>
  );
}
