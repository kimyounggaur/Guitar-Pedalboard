import { useEffect, useRef, useState } from 'react';
import { safeStorage, STORAGE_KEYS } from '../persistence';
import { useAudioStore } from '../store/audioStore';
import { DeviceSelector } from './DeviceSelector';
import { FilePlayer } from './FilePlayer';
import { InputLevelNotice } from './InputLevelNotice';
import { MidiAdvancedControls } from './MidiAdvancedControls';
import { ToggleSwitch } from './ToggleSwitch';
import { ko } from '../i18n/ko';

/** 모바일 안내를 닫았는지. 저장소를 못 써도(읽기 실패) 던지지 않고 '아직 안 닫음'으로 본다. 값은 문자열 'true' 그대로 저장된다. */
function readMobileNoticeDismissed(): boolean {
  return safeStorage.getRaw(STORAGE_KEYS.mobileAudioNotice) === 'true';
}

interface ConnectGuitarPanelProps {
  isMobile?: boolean;
  /**
   * true 면 상단 헤더의 '오디오 입력' 메뉴 안의 내용이다(데스크톱). 연결·연결 해제·Panic·상태·오류·입력 레벨 경고는 헤더 줄이 맡으므로 여기서 그리지 않는다.
   * false 는 휴대폰 하단 도크의 '입력' 탭이다.
   */
  inMenu?: boolean;
}

export function ConnectGuitarPanel({ isMobile = false, inMenu = false }: ConnectGuitarPanelProps) {
  const [isMobileNoticeDismissed, setIsMobileNoticeDismissed] = useState(
    readMobileNoticeDismissed,
  );
  const isRunning = useAudioStore((state) => state.isRunning);
  const inputMode = useAudioStore((state) => state.inputMode);
  const isLoading = useAudioStore((state) => state.isLoading);
  const error = useAudioStore((state) => state.error);
  const inputGainDb = useAudioStore((state) => state.inputGainDb);
  const howlProtectionEnabled = useAudioStore((state) => state.howlProtectionEnabled);
  const start = useAudioStore((state) => state.start);
  const stop = useAudioStore((state) => state.stop);
  const panic = useAudioStore((state) => state.panic);
  const loadDevices = useAudioStore((state) => state.loadDevices);
  const setInputGainDb = useAudioStore((state) => state.setInputGainDb);
  const setHowlProtectionEnabled = useAudioStore((state) => state.setHowlProtectionEnabled);

  // 장치가 꽂히고 빠지는 것(`devicechange`)은 스토어가 지켜본다(audioStore.ts). 여기서는 패널이 나타날 때 목록을 한 번 읽을 뿐이다.
  useEffect(() => {
    void loadDevices();
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
      {ko.app.panic}
    </button>
  );

  const detailsContent = (
    <>
      <div className="panel-title">
        <p className="eyebrow">{ko.app.eyebrow.audioInput}</p>
        <h2>기타 입력 연결</h2>
      </div>

      <DeviceSelector />
      <MidiAdvancedControls />

      {inputMode !== 'file' && !inMenu && (
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

      {inMenu ? null : errorNotice}

      {!inMenu && isRunning && panicControl}

      <FilePlayer />

      <div className="input-safety-controls">
        {trimControl}
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
    <section className={`side-panel connect-panel${inMenu ? ' is-menu' : ''}`}>
      {isMobile && !isMobileNoticeDismissed ? (
        <div className="mobile-audio-notice" role="note" aria-label="모바일 오디오 안내">
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
        </div>
      ) : null}

      {detailsContent}

      {/* 입력 레벨 경고(4.12): 판정은 MonitorService 가 한다. 여기서는 결과를 보이기만 한다(S2.5). 메뉴에서는 헤더가 보인다. */}
      {inMenu ? null : <InputLevelNotice />}

      <p className="panel-copy">
        초기 테스트는 헤드폰 사용을 권장합니다. 오디오 인터페이스의 Direct Monitor가 켜져 있으면
        원음과 처리음이 함께 들릴 수 있습니다.
      </p>
    </section>
  );
}
