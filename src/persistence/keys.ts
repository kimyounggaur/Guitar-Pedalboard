// 앱이 브라우저 저장소(localStorage)에 쓰는 키 전부(S1.7).
//
// 문자열은 바꾸지 않는다. 저장 키 이름·값 형식을 바꾸는 일은 S2.4(v2 키·백업·변환)의 범위다.
// 새 키가 필요하면 여기에 먼저 적고, `SafeStorage` 의 `StorageKey` 타입이 그 키만 받게 한다.

export const STORAGE_KEYS = {
  /** 페달 15개의 켬/Bypass·노브 값과 프리셋 음량 보정(JSON, 스키마 버전 11) */
  pedals: 'guitar-pedalboard:pedals',
  /** 사용자 프리셋(JSON 페이로드). 접두사가 다른 옛 이름이다 */
  presets: 'web-guitar-pedalboard-presets',
  /** 입력 이득·마스터 볼륨·하울링 보호·튜닝 기준·장치별 입력 채널(JSON) */
  io: 'guitar-pedalboard:io',
  /** 출력 장치 id(JSON 아님, 문자열 그대로) */
  outputDevice: 'guitar-pedalboard:output-device',
  /** 페달별 MIDI 스위치 매핑(JSON) */
  midi: 'guitar-pedalboard:midi',
  /** MIDI 고급 설정: 채널·볼륨/와우 CC·프로그램 변경(JSON) */
  midiAdvanced: 'guitar-pedalboard:midi-advanced',
  /** 즐겨찾기 프리셋 id 목록(JSON 문자열 배열) */
  presetFavorites: 'guitar-pedalboard:preset-favorites',
  /** 최근 쓴 프리셋 id 목록(JSON 문자열 배열) */
  presetRecents: 'guitar-pedalboard:preset-recents',
  /** 모바일 오디오 안내를 닫았는지('true' 문자열) */
  mobileAudioNotice: 'guitar-pedalboard:mobile-audio-notice-dismissed',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** 앱 키는 대부분 이 접두사로 시작한다(`presets` 만 예외). 설정 초기화가 이 접두사의 키만 지운다. */
export const APP_STORAGE_PREFIX = 'guitar-pedalboard:';

/** 깨진 값을 보관하는 키의 가운데 부분: `{키}:corrupt-{시각}` */
export const CORRUPT_KEY_INFIX = ':corrupt-';
