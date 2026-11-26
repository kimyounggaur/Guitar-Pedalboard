import { describeDecision } from '../audio/engine/channelDecision';
import { isInputChannelMode } from '../audio/engine/InputStage';
import { ko } from '../i18n/ko';
import { useAudioStore } from '../store/audioStore';

/**
 * 입력 채널 메뉴와 자동 판정 한 줄(S1.3). 채널이 하나뿐인 장치와 파일 재생에서는 고를 것이 없어 아무것도 그리지 않는다.
 * 연결 전에는 '입력 장치' 묶음 안에서, 연결한 뒤 데스크톱에서는 한 줄 상태 표시줄 안에서 쓴다(S1.8). 한 화면에 하나만 그린다(id 가 하나).
 */
export function InputChannelFields() {
  const inputMode = useAudioStore((state) => state.inputMode);
  const inputChannelMode = useAudioStore((state) => state.inputChannelMode);
  const inputChannelDecision = useAudioStore((state) => state.inputChannelDecision);
  const inputChannelSelectable = useAudioStore((state) => state.inputChannelSelectable);
  const setInputChannelMode = useAudioStore((state) => state.setInputChannelMode);
  // 채널이 하나뿐인 장치와 파일 재생에서는 고를 것이 없다. 연결 전(null)에는 미리 고를 수 있게 보인다.
  if (inputMode === 'file' || inputChannelSelectable === false) return null;

  return (
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
        <p className="input-channel-note" role="status" aria-live="polite" title={describeDecision(inputChannelDecision)}>
          {describeDecision(inputChannelDecision)}
        </p>
      ) : null}
    </>
  );
}

interface DeviceSelectorProps {
  /** true 면 입력 채널 메뉴를 그리지 않는다(상태 표시줄이 대신 그린다). */
  hideChannelMenu?: boolean;
}

export function DeviceSelector({ hideChannelMenu = false }: DeviceSelectorProps) {
  const outputDevices = useAudioStore((state) => state.outputDevices);
  const selectedOutputDeviceId = useAudioStore((state) => state.selectedOutputDeviceId);
  const outputSelectionSupported = useAudioStore((state) => state.outputSelectionSupported);
  const setOutputDevice = useAudioStore((state) => state.setOutputDevice);
  const devices = useAudioStore((state) => state.devices);
  const selectedDeviceId = useAudioStore((state) => state.selectedDeviceId);
  const rememberedInput = useAudioStore((state) => state.rememberedInput);
  const rememberedOutput = useAudioStore((state) => state.rememberedOutput);
  const inputMode = useAudioStore((state) => state.inputMode);
  const setSelectedDevice = useAudioStore((state) => state.setSelectedDevice);
  const loadDevices = useAudioStore((state) => state.loadDevices);
  const isLoading = useAudioStore((state) => state.isLoading);
  const isFilePlaying = inputMode === 'file';
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
      useAudioStore.setState({ error: ko.devices.outputPickerFailed });
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
          {/* 저장해 둔 장치가 목록에 아직 없을 때(마이크 권한 전이라 목록이 비어 있거나 장치를 아직 꽂지 않았다)에도 고른 장치가 무엇인지 보인다. */}
          {selectedDeviceId && !devices.some((device) => device.deviceId === selectedDeviceId) ? (
            <option value={selectedDeviceId}>{rememberedInput?.label || ko.devices.savedInput}</option>
          ) : null}
          {/* 마이크 권한 전에는 브라우저가 장치마다 id 를 비워서 준다. 고를 수 없는 항목은 보이지 않는다. */}
          {devices.filter((device) => device.deviceId).map((device, index) => (
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
      {hideChannelMenu ? null : <InputChannelFields />}
      <label htmlFor="audio-output">출력 장치</label>
      {outputSelectionSupported ? (
        <select id="audio-output" value={selectedOutputDeviceId} disabled={isLoading}
          onChange={(event) => void setOutputDevice(event.currentTarget.value)}>
          <option value="">시스템 기본 출력</option>
          {selectedOutputDeviceId && !outputDevices.some((device) => device.deviceId === selectedOutputDeviceId) ? (
            <option value={selectedOutputDeviceId}>{rememberedOutput?.label || ko.devices.savedOutput}</option>
          ) : null}
          {outputDevices.filter((device) => device.deviceId).map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>{device.label || `출력 장치 ${index + 1}`}</option>
          ))}
        </select>
      ) : <p className="device-note">{ko.devices.outputUnsupported}</p>}
      {outputSelectionSupported && mediaDevices?.selectAudioOutput ? (
        <button type="button" className="secondary-button" disabled={isLoading} onClick={() => void chooseOutput()}>
          출력 장치 권한 및 선택
        </button>
      ) : null}
    </div>
  );
}
