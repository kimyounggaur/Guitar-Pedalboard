import { useEffect, useRef, useState } from 'react';
import { formatLatency } from '../audio/engine/latency';
import { useAudioStore } from '../store/audioStore';
import { ko } from '../i18n/ko';
import { ConnectGuitarPanel } from './ConnectGuitarPanel';
import { InputLevelNotice } from './InputLevelNotice';

/**
 * 상단 헤더의 '오디오 입력' 메뉴(데스크톱). 예전에는 헤더 안에 입력 패널이 항상 펼쳐져 있었다.
 * 이제는 단추 한 줄만 보이고, 누르면 입력 장치·채널·MIDI·음원 파일·입력 트림·하울링 보호가 아래로 열린다.
 * - '기타 연결하기'는 메뉴를 열지 않고도 누를 수 있게 헤더 줄에 둔다. 연결 중에는 장치·지연·'연결 해제'·긴급 정지를 같은 줄에 계속 보여 준다.
 * - 팝오버는 닫혀도 DOM 에 남긴다(hidden). 음원 파일 입력(#audio-file)·장치 목록 읽기가 메뉴를 여닫는 것과 상관없이 유지된다.
 * - Esc 는 긴급 정지(GlobalKeyboardShortcuts)라 닫기에 쓰지 않는다. 바깥을 누르거나 단추를 다시 누르면 닫힌다.
 */
export function AudioInputMenu() {
  const isRunning = useAudioStore((state) => state.isRunning);
  const inputMode = useAudioStore((state) => state.inputMode);
  const isLoading = useAudioStore((state) => state.isLoading);
  const error = useAudioStore((state) => state.error);
  const devices = useAudioStore((state) => state.devices);
  const selectedDeviceId = useAudioStore((state) => state.selectedDeviceId);
  const latency = useAudioStore((state) => state.latency);
  const start = useAudioStore((state) => state.start);
  const stop = useAudioStore((state) => state.stop);
  const panic = useAudioStore((state) => state.panic);

  const isLiveConnected = isRunning && inputMode === 'device';
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 연결이 시작돼도 메뉴를 닫지 않는다 — 설정을 고르다가 연결한 사람이 채널·트림을 바로 만질 수 있어야 한다.

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [open]);

  const deviceLabel = selectedDeviceId
    ? (devices.find((device) => device.deviceId === selectedDeviceId)?.label || '선택한 입력 장치')
    : '기본 입력 장치';
  const latencyDisplay = formatLatency(latency);
  const latencyText = latencyDisplay.totalMs !== null ? `${latencyDisplay.totalMs.toFixed(1)}ms` : '측정 대기';

  return (
    <div className={`audio-input-menu${isRunning ? ' is-running' : ''}`} ref={rootRef}>
      <div className="audio-input-menu-bar">
        <button
          type="button"
          className="secondary-button audio-input-menu-toggle"
          aria-expanded={open}
          aria-controls="audio-input-popover"
          aria-haspopup="true"
          onClick={() => setOpen((value) => !value)}
        >
          <span className={`connect-status-dot${isRunning ? '' : ' is-idle'}`} aria-hidden="true" />
          <span>오디오 입력</span>
          <span className="audio-input-menu-caret" aria-hidden="true">{open ? '▴' : '▾'}</span>
        </button>

        {!isRunning && inputMode !== 'file' ? (
          <button
            type="button"
            className="primary-button"
            disabled={isLoading}
            onClick={() => void start()}
          >
            {isLoading ? '연결 중...' : '기타 연결하기'}
          </button>
        ) : null}

        {isLiveConnected ? (
          <>
            <span className="connect-status-device">
              <span className="connect-status-key">입력</span>
              <span className="connect-status-value" title={deviceLabel}>{deviceLabel}</span>
            </span>
            <span className="connect-status-latency" title={latencyDisplay.items.map((item) => item.text).join(' · ') || ko.app.latencyPending}>
              <span className="connect-status-key">지연</span>
              <span className="connect-status-value">{latencyText}</span>
            </span>
            <button
              type="button"
              className="danger-button"
              disabled={isLoading}
              onClick={() => void stop()}
            >
              연결 해제
            </button>
          </>
        ) : null}
        {isRunning ? (
          <button type="button" className="panic-button" onClick={panic}>
            {ko.app.panic}
          </button>
        ) : null}
      </div>

      {/* 연결 실패 안내는 메뉴가 닫혀 있어도 헤더에서 바로 보인다(S2.3). */}
      {error ? <p className="error-message" role="alert">{error}</p> : null}

      <div
        id="audio-input-popover"
        className="audio-input-popover"
        role="group"
        aria-label="오디오 입력 설정"
        hidden={!open}
      >
        <ConnectGuitarPanel isMobile={false} inMenu />
      </div>

      {/* 입력 레벨 경고는 메뉴가 닫혀 있어도 보여야 한다(4.12). */}
      <InputLevelNotice />
    </div>
  );
}
