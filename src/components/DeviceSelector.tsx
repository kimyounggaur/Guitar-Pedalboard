import { useAudioStore } from '../store/audioStore';

export function DeviceSelector() {
  const devices = useAudioStore((state) => state.devices);
  const selectedDeviceId = useAudioStore((state) => state.selectedDeviceId);
  const setSelectedDevice = useAudioStore((state) => state.setSelectedDevice);
  const loadDevices = useAudioStore((state) => state.loadDevices);

  return (
    <div className="device-selector">
      <label htmlFor="audio-device">Input</label>
      <div className="device-row">
        <select
          id="audio-device"
          value={selectedDeviceId}
          onChange={(event) => setSelectedDevice(event.currentTarget.value)}
        >
          <option value="">기본 입력 장치</option>
          {devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `Audio input ${index + 1}`}
            </option>
          ))}
        </select>
        <button type="button" className="secondary-button" onClick={() => void loadDevices()}>
          새로고침
        </button>
      </div>
    </div>
  );
}
