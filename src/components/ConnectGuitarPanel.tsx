import { useEffect, useRef, useState } from 'react';
import { safeStorage, STORAGE_KEYS } from '../persistence';
import { useAudioStore } from '../store/audioStore';
import { DeviceSelector, InputChannelFields } from './DeviceSelector';
import { InputLevelNotice } from './InputLevelNotice';
import { MidiAdvancedControls } from './MidiAdvancedControls';
import { ToggleSwitch } from './ToggleSwitch';

/** 모바일 안내를 닫았는지. 저장소를 못 써도(읽기 실패) 던지지 않고 '아직 안 닫음'으로 본다. 값은 문자열 'true' 그대로 저장된다. */
function readMobileNoticeDismissed(): boolean {
  return safeStorage.getRaw(STORAGE_KEYS.mobileAudioNotice) === 'true';
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
  const devices = useAudioStore((state) => state.devices);
  const selectedDeviceId = useAudioStore((state) => state.selectedDeviceId);
  const latency = useAudioStore((state) => state.latency);
  const hasUploadedFile = inputMode === 'file' && Boolean(uploadedFileName);
  const fileControlsDisabled = isLoading || !hasUploadedFile;

  // S1.8: 데스크톱에서 기타(장치 입력)를 연결하면 이 패널이 한 줄 상태 표시줄로 줄어든다. 장치·채널·지연·입력 트림·연결 해제·Panic 만
  // 남기고 나머지(장치 고르기·MIDI·음원 파일·하울링 보호·안내)는 '입력 설정' 버튼으로 펼친다. 모바일 도크와 음원 파일 재생은 그대로 둔다.
  const isLiveConnected = isRunning && inputMode === 'device';
  const compact = !isMobile && isLiveConnected;
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [previousLive, setPreviousLive] = useState(isLiveConnected);
  // 연결이 끝나면(해제·Panic·하울링 차단·장치 분실) 다음 연결은 다시 접힌 채로 시작한다.
  if (previousLive !== isLiveConnected) {
    setPreviousLive(isLiveConnected);
    if (!isLiveConnected) setDetailsOpen(false);
  }
  const deviceLabel = selectedDeviceId
    ? (devices.find((device) => device.deviceId === selectedDeviceId)?.label || '선택한 입력 장치')
    : '기본 입력 장치';
  const latencyTotal = latency.base !== null && latency.output !== null ? latency.base + latency.output : null;
  const latencyText = latency.sampleRate > 0 && latencyTotal !== null ? `${latencyTotal.toFixed(1)}ms` : '측정 대기';
  useEffect(() => {
    void loadDevices();
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.addEventListener) return;
    const handleDeviceChange = () => { void loadDevices(); };
    mediaDevices.addEventListener('devicechange', handleDeviceChange);
    return () => mediaDevices.removeEventListener('devicechange', handleDeviceChange);
  }, [loadDevices]);

  // 연결 실패 안내는 '기타 연결하기' 바로 아래에 둔다. 그래도 스크롤되는 좁은 패널(휴대폰 도크)에서는 버튼이 아래쪽에 있으면 안내가 밖으로 밀리므로,
  // 새 오류가 생기면 보이는 곳까지만(block: 'nearest') 스크롤한다. 안 그러면 휴대폰에서는 '눌렀는데 아무 일도 없다'로 보인다(S2.3, REFACTOR_LOG L-93).
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: 'nearest' });
  }, [error]);
  const errorNotice = error ? (
    <p ref={errorRef} className="error-message" role="alert">{error}</p>
  ) : null;

  const dismissMobileNotice = () => {
    setIsMobileNoticeDismissed(true);
    // 저장하지 못해도(차단·가득 참) 이번 방문 동안은 닫힌 채로 있다 — SafeStorage 가 메모리에 값을 들고 있고 안내는 한 번만 띄운다.
    safeStorage.setRaw(STORAGE_KEYS.mobileAudioNotice, 'true');
  };

  const trimControl = (
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
  );

  const disconnectControl = (
    <button
      type="button"
      className="danger-button"
      disabled={isLoading}
      onClick={() => void stop()}
    >
      연결 해제
    </button>
  );

  const panicControl = (
    <button type="button" className="panic-button" onClick={panic}>
      Panic
    </button>
  );

  const detailsContent = (
    <>
      <div className="panel-title">
        <p className="eyebrow">Audio Input</p>
        <h2>기타 입력 연결</h2>
      </div>

      <DeviceSelector hideChannelMenu={compact} />
      <MidiAdvancedControls />

      {!compact && inputMode !== 'file' && (
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
            disconnectControl
          )}
        </div>
      )}

      {!compact && errorNotice}

      {!compact && isRunning && panicControl}

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
          <label className="io-slider-control">
            <span>재생 위치 · 반복 재생</span>
            <input type="range" min={0} max={fileDuration || 0} step="0.1"
              value={Math.min(fileCurrentTime, fileDuration || 0)}
              disabled={fileControlsDisabled || !fileDuration}
              aria-label="음원 재생 위치"
              aria-valuetext={`${formatPlaybackTime(fileCurrentTime)} / ${formatPlaybackTime(fileDuration)}`}
              onChange={(event) => seekFile(Number(event.currentTarget.value) - fileCurrentTime)} />
          </label>
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
        {!compact && trimControl}
        <div className="howl-protection-control">
          <ToggleSwitch
            label="하울링 보호"
            checked={howlProtectionEnabled}
            onChange={setHowlProtectionEnabled}
          />
          <span>입력에서 같은 높이의 소리가 줄지 않고 1초 넘게 이어지면 하울링으로 보고 차단합니다. 기타의 긴 서스테인에 반응하거나 일부 피드백을 놓칠 수 있으므로 헤드폰을 사용하세요.</span>
        </div>
      </div>
    </>
  );

  return (
    <section className={`side-panel connect-panel${compact ? ' is-connected' : ''}`}>
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

      {compact ? (
        <div className="connect-status-bar" role="group" aria-label="입력 연결 상태">
          <span className="connect-status-dot" aria-hidden="true" />
          <span className="connect-status-device" title={deviceLabel}>
            <span className="connect-status-key">입력</span>
            <span className="connect-status-value">{deviceLabel}</span>
          </span>
          <div className="connect-status-channel">
            <InputChannelFields />
          </div>
          <span className="connect-status-latency" title="출력 지연 추정(이펙터 처리 시간은 빠져 있습니다)">
            <span className="connect-status-key">지연</span>
            <span className="connect-status-value">{latencyText}</span>
          </span>
          {trimControl}
          {disconnectControl}
          {panicControl}
          <button
            type="button"
            className="secondary-button connect-status-more"
            aria-expanded={detailsOpen}
            aria-controls="connect-panel-details"
            onClick={() => setDetailsOpen((open) => !open)}
          >
            {detailsOpen ? '입력 설정 접기' : '입력 설정'}
          </button>
        </div>
      ) : null}

      {compact ? errorNotice : null}

      {compact ? (
        <div id="connect-panel-details" className="connect-panel-details" hidden={!detailsOpen}>
          {detailsContent}
        </div>
      ) : (
        detailsContent
      )}

      {/* 입력 레벨 경고(4.12): 판정은 MonitorService 가 한다. 여기서는 결과를 보이기만 한다(S2.5). */}
      <InputLevelNotice />

      {!compact ? (
        <p className="panel-copy">
          초기 테스트는 헤드폰 사용을 권장합니다. 오디오 인터페이스의 Direct Monitor가 켜져 있으면
          원음과 처리음이 함께 들릴 수 있습니다.
        </p>
      ) : null}

    </section>
  );
}
