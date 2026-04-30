import { useAudioStore } from '../store/audioStore';
import { usePedalStore } from '../store/pedalStore';

export function DeviceSelector() {
  const pedals = usePedalStore((state) => state.pedals);
  const devices = useAudioStore((state) => state.devices);
  const selectedDeviceId = useAudioStore((state) => state.selectedDeviceId);
  const setSelectedDevice = useAudioStore((state) => state.setSelectedDevice);
  const loadDevices = useAudioStore((state) => state.loadDevices);
  const isLoading = useAudioStore((state) => state.isLoading);

  return (
    <div className="device-selector">
      <label htmlFor="audio-device">입력 장치</label>
      <div className="device-row">
        <select
          id="audio-device"
          value={selectedDeviceId}
          disabled={isLoading}
          onChange={(event) => void setSelectedDevice(event.currentTarget.value, pedals)}
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
          disabled={isLoading}
          onClick={() => void loadDevices()}
        >
          새로고침
        </button>
      </div>
    </div>
  );
}
