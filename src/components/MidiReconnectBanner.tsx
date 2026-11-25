import { useAudioStore } from '../store/audioStore';

/**
 * 저장된 MIDI 풋스위치가 있는데 아직 연결되지 않았을 때 한 줄로 알리고 '다시 연결' 버튼을 준다(S2.9, 설계서 4.11).
 * 브라우저의 MIDI 권한이 이미 허용돼 있으면 페이지를 열 때 저절로 연결되므로 이 배너는 나오지 않는다.
 * 권한이 아직 허용되지 않았다면 페이지를 열자마자 권한 창이 뜨지 않도록 연결을 미뤘다가 이 버튼을 눌렀을 때만 연결한다.
 */
export function MidiReconnectBanner() {
  const link = useAudioStore((state) => state.midiLink);
  const mappingCount = useAudioStore((state) => Object.keys(state.midiMappings).length);
  const connectSavedMidi = useAudioStore((state) => state.connectSavedMidi);

  const needsPermission = link === 'needs-permission';
  const denied = link === 'denied' && mappingCount > 0;
  if (!needsPermission && !denied) return null;

  return (
    <div className="offline-notice midi-reconnect-notice" role="status" aria-live="polite">
      <strong>{needsPermission ? '저장된 MIDI 풋스위치가 아직 연결되지 않았습니다.' : 'MIDI 연결이 막혀 있습니다.'}</strong>
      <span>
        {needsPermission
          ? '브라우저가 MIDI 사용을 묻는 창은 이 버튼을 눌렀을 때만 나옵니다.'
          : '브라우저의 사이트 설정에서 이 사이트의 MIDI 접근을 허용한 뒤 다시 연결해 주세요.'}
      </span>
      <button type="button" className="secondary-button" onClick={() => void connectSavedMidi({ force: true, userAction: true })}>
        MIDI 풋스위치 다시 연결
      </button>
    </div>
  );
}
