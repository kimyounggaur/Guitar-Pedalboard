import { describeDecision } from '../audio/engine/channelDecision';
import { isInputChannelMode } from '../audio/engine/InputStage';
import { useAudioStore } from '../store/audioStore';

export function DeviceSelector() {
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const selectedOutputDeviceId = useAudioStore((state) => state.selectedOutputDeviceId);
  const outputSelectionSupported = useAudioStore((state) => state.outputSelectionSupported);
  const setOutputDevice = useAudioStore((state) => state.setOutputDevice);
  const devices = useAudioStore((state) => state.devices);
  const selectedDeviceId = useAudioStore((state) => state.selectedDeviceId);
  const inputMode = useAudioStore((state) => state.inputMode);
  const setSelectedDevice = useAudioStore((state) => state.setSelectedDevice);
  const loadDevices = useAudioStore((state) => state.loadDevices);
  const isLoading = useAudioStore((state) => state.isLoading);
  const inputChannelMode = useAudioStore((state) => state.inputChannelMode);
  const inputChannelDecision = useAudioStore((state) => state.inputChannelDecision);
  const inputChannelSelectable = useAudioStore((state) => state.inputChannelSelectable);
  const setInputChannelMode = useAudioStore((state) => state.setInputChannelMode);
  const isFilePlaying = inputMode === 'file';
  // 채널이 하나뿐인 장치와 파일 재생에서는 고를 것이 없다. 연결 전(null)에는 미리 고를 수 있게 보인다.
  const showChannelMenu = !isFilePlaying && inputChannelSelectable !== false;
  const mediaDevices = typeof navigator !== 'undefined' ? navigator.mediaDevices as MediaDevices & {
    selectAudioOutput?: () => Promise<MediaDeviceInfo>;
  } : undefined;
  const chooseOutput = async () => {
    try {
      const device = await mediaDevices?.selectAudioOutput?.();
      if (!device) return;
      await setOutputDevice(device.deviceId);
      await loadDevices();
    } catch (error) {
      if (error instanceof DOMException && error.name === 'NotAllowedError') return;
      useAudioStore.setState({ error: '출력 장치 선택 창을 열 수 없습니다. 브라우저 권한을 확인해 주세요.' });
    }
  };

  return (
    <div className="device-selector">
      <label htmlFor="audio-device">입력 장치</label>
      <div className="device-row">
        <select
          id="audio-device"
          value={selectedDeviceId}
          disabled={isLoading || isFilePlaying}
          onChange={(event) => void setSelectedDevice(event.currentTarget.value)}
        >
          <option value="">기본 입력 장치</option>
          {devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Audio input ${index + 1}`}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="secondary-button"
          disabled={isLoading || isFilePlaying}
          onClick={() => void loadDevices()}
        >
          새로고침
        </button>
      </div>
      {showChannelMenu ? (
        <>
          <label htmlFor="input-channel">입력 채널</label>
          <select
            id="input-channel"
            value={inputChannelMode}
            onChange={(event) => {
              const mode = event.currentTarget.value;
              if (isInputChannelMode(mode)) setInputChannelMode(mode);
            }}
          >
            <option value="auto">자동</option>
            <option value="ch1">1번 입력</option>
            <option value="ch2">2번 입력</option>
            <option value="stereo">스테레오</option>
          </select>
          {inputChannelMode === 'auto' ? (
            <p className="input-channel-note" role="status" aria-live="polite">
              {describeDecision(inputChannelDecision)}
            </p>
          ) : null}
        </>
      ) : null}
      <label htmlFor="audio-output">출력 장치</label>
      {outputSelectionSupported ? (
        <select id="audio-output" value={selectedOutputDeviceId} disabled={isLoading}
          onChange={(event) => void setOutputDevice(event.currentTarget.value)}>
          <option value="">시스템 기본 출력</option>
          {selectedOutputDeviceId && !outputDevices.some((device) => device.deviceId === selectedOutputDeviceId) ? (
            <option value={selectedOutputDeviceId}>저장된 출력 장치</option>
          ) : null}
          {outputDevices.filter((device) => device.deviceId).map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>{device.label || `출력 장치 ${index + 1}`}</option>
          ))}
        </select>
      ) : <p>이 브라우저는 출력 장치 선택을 지원하지 않습니다. 시스템 기본 출력을 사용합니다.</p>}
      {outputSelectionSupported && mediaDevices?.selectAudioOutput ? (
        <button type="button" className="secondary-button" disabled={isLoading} onClick={() => void chooseOutput()}>
          출력 장치 권한 및 선택
        </button>
      ) : null}
    </div>
  );
}
