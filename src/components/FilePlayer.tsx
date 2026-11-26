import { useRef, useState } from 'react';
import { useAudioStore } from '../store/audioStore';
import { ToggleSwitch } from './ToggleSwitch';

function formatPlaybackTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60)
    .toString()
    .padStart(2, '0');

  return `${minutes}:${remainingSeconds}`;
}

/**
 * 음원 파일 모드의 파일 열기와 플레이어(설계서 4.11 '파일 재생', S2.6).
 *
 * - 파일 열기는 숨긴 `input type=file`(`#audio-file`)과 한국어 버튼 '음원 파일 열기'다. 브라우저 기본 'Choose File' 이 화면에 나오지 않는다.
 * - 열어 둔 파일은 재생이 끝나거나 정지해도 남는다. 다른 파일을 열거나 '파일 닫기'(또는 기타 연결)를 해야 놓는다.
 *   세션이 끝나 있을 때의 '재생' 은 같은 파일로 새 세션(새 `<audio>` 요소·Object URL)을 열어 처음부터 튼다.
 * - '반복 재생' 은 기본 켜짐이다. 끄면 끝에서 멈춘다.
 */
export function FilePlayer() {
  const inputRef = useRef<HTMLInputElement>(null);
  // 탐색 막대를 마우스·손가락으로 잡고 있는 동안만 쓰는 값. 재생 위치가 막대를 밀어내지 않게 한다(놓으면 다시 재생 위치를 따라간다).
  const [scrubValue, setScrubValue] = useState<number | null>(null);
  const pointerHeld = useRef(false);

  const inputMode = useAudioStore((state) => state.inputMode);
  const uploadedFileName = useAudioStore((state) => state.uploadedFileName);
  const fileCurrentTime = useAudioStore((state) => state.fileCurrentTime);
  const fileDuration = useAudioStore((state) => state.fileDuration);
  const isFilePaused = useAudioStore((state) => state.isFilePaused);
  const fileLoop = useAudioStore((state) => state.fileLoop);
  const isLoading = useAudioStore((state) => state.isLoading);
  const startFile = useAudioStore((state) => state.startFile);
  const playFile = useAudioStore((state) => state.playFile);
  const pauseFile = useAudioStore((state) => state.pauseFile);
  const seekFile = useAudioStore((state) => state.seekFile);
  const seekFileTo = useAudioStore((state) => state.seekFileTo);
  const setFileLoop = useAudioStore((state) => state.setFileLoop);
  const closeFile = useAudioStore((state) => state.closeFile);
  const stop = useAudioStore((state) => state.stop);

  const hasFile = uploadedFileName !== null;
  // 파일 세션이 열려 있을 때만 위치 이동·일시정지·정지를 쓸 수 있다. 세션이 없을 때는 '재생' 만 켜진다(새 세션을 연다).
  const inFileSession = inputMode === 'file';
  const transportDisabled = isLoading || !inFileSession;
  const position = Math.min(scrubValue ?? fileCurrentTime, fileDuration || 0);
  const timeText = `${formatPlaybackTime(position)} / ${formatPlaybackTime(fileDuration)}`;

  return (
    <div className="audio-file-upload">
      <p className="file-section-title">음원 파일</p>
      <div className="file-open-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={isLoading}
          onClick={() => inputRef.current?.click()}
        >
          음원 파일 열기
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={isLoading || !hasFile}
          onClick={() => void closeFile()}
        >
          파일 닫기
        </button>
        <input
          ref={inputRef}
          id="audio-file"
          className="hidden-file-input"
          type="file"
          accept="audio/*"
          disabled={isLoading}
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            if (file) {
              void startFile(file);
            }
            // 같은 파일을 다시 골라도 change 가 오도록 비운다.
            event.currentTarget.value = '';
          }}
        />
      </div>

      <div className="file-player" role="group" aria-label="음원 파일 플레이어">
        <div className="file-playback-row">
          <span title={uploadedFileName ?? undefined}>{uploadedFileName ?? '열린 음원 없음'}</span>
          <span className="file-playback-time">{timeText}</span>
        </div>
        <label className="io-slider-control">
          <span>재생 위치</span>
          <input
            type="range"
            min={0}
            max={fileDuration || 0}
            step="0.1"
            value={position}
            disabled={transportDisabled || !fileDuration}
            aria-label="음원 재생 위치"
            aria-valuetext={timeText}
            onPointerDown={() => {
              pointerHeld.current = true;
              // 막대 밖에서 놓아도 잡고 있던 상태가 풀리도록 놓는 순간은 창에서 듣는다.
              const release = () => {
                pointerHeld.current = false;
                setScrubValue(null);
                window.removeEventListener('pointerup', release);
                window.removeEventListener('pointercancel', release);
              };
              window.addEventListener('pointerup', release);
              window.addEventListener('pointercancel', release);
            }}
            onChange={(event) => {
              const seconds = Number(event.currentTarget.value);
              if (pointerHeld.current) setScrubValue(seconds);
              seekFileTo(seconds);
            }}
          />
        </label>
        <div className="file-transport-controls">
          <button
            type="button"
            className="secondary-button"
            disabled={transportDisabled}
            onClick={() => seekFile(-10)}
          >
            뒤로 10초
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={isLoading || !hasFile || (inFileSession && !isFilePaused)}
            onClick={() => void playFile()}
          >
            재생
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={transportDisabled || isFilePaused}
            onClick={pauseFile}
          >
            일시정지
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={transportDisabled}
            onClick={() => void stop()}
          >
            정지
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={transportDisabled}
            onClick={() => seekFile(10)}
          >
            앞으로 10초
          </button>
        </div>
        <div className="file-loop-control">
          <ToggleSwitch label="반복 재생" checked={fileLoop} onChange={setFileLoop} />
        </div>
      </div>
    </div>
  );
}
