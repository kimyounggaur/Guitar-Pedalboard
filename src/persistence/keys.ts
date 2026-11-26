// 앱이 브라우저 저장소에 쓰는 키 전부(S1.7).
//
// S2.4 에서 저장 형식이 v2 로 바뀌었다. 작업 상태와 사용자 프리셋은 `v2:` 키에 쓰고, 옛 v1 키는 변환한 뒤에도 지우지 않고
// 백업으로 남긴다 — 앱은 v1 키를 다시 쓰지 않는다(옛 방식 모드는 예외: persistence/bootstrap 참고).
// 새 키가 필요하면 여기에 먼저 적고, `SafeStorage` 의 `StorageKey` 타입이 그 키만 받게 한다.

export const STORAGE_KEYS = {
  /**
   * 저장 형식 버전(문자열 `2`, S2.4). 이 키가 있어야 v2 키를 읽는다. 변환이 끝난 뒤에 맨 마지막으로 쓴다.
   * 설정 초기화가 지우지 않는다(지우면 다음 시작이 옛 v1 백업에서 다시 변환해 새 프리셋을 덮어쓴다).
   */
  schema: 'guitar-pedalboard:schema',
  /** v2 작업 상태: 페달 순서·켜짐(`active`)·노브 값·프리셋 음량 보정(JSON, S2.4) */
  v2State: 'guitar-pedalboard:v2:state',
  /** v2 사용자 프리셋(JSON, S2.4). 설정 초기화가 지우지 않는다. */
  v2Presets: 'guitar-pedalboard:v2:presets',
  /** v1 작업 상태(JSON, 스키마 버전 11). v2 로 옮긴 뒤에는 읽지도 쓰지도 않는 백업이다. */
  v1Pedals: 'guitar-pedalboard:pedals',
  /** v1 사용자 프리셋(JSON 페이로드). 접두사가 다른 옛 이름이다. v2 로 옮긴 뒤에는 읽지도 쓰지도 않는 백업이다. */
  v1Presets: 'web-guitar-pedalboard-presets',
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
  /**
   * 화면 설정(JSON, S1.8). 지금은 넓은 화면(1280px 이상)에서 오른쪽 오디오 패널을 펴 두었는지(`sidebarOpen`)만 담는다.
   * 좁은 화면의 서랍은 화면을 덮으므로 열림 여부를 저장하지 않는다.
   */
  ui: 'guitar-pedalboard:ui',
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** 앱 키는 대부분 이 접두사로 시작한다(`v1Presets` 만 예외). 설정 초기화가 이 접두사의 키를 지운다(아래 보존 키는 빼고). */
export const APP_STORAGE_PREFIX = 'guitar-pedalboard:';

/** 깨진 값을 보관하는 키의 가운데 부분: `{키}:corrupt-{시각}` */
export const CORRUPT_KEY_INFIX = ':corrupt-';

/**
 * 설정 초기화가 지우지 않는 키(S2.4). 사용자 프리셋은 '설정'이 아니라 사용자가 만든 자료라서 초기화해도 남는다(S1.7 부터 그랬다).
 * 사용자 프리셋이 v2 에서 `guitar-pedalboard:` 접두사 아래로 옮겨 왔으므로 이제는 이 목록으로 지킨다.
 * `schema` 도 함께 남긴다 — 없으면 다음 시작이 v1 백업에서 다시 변환해 v2 프리셋을 옛 값으로 덮어쓴다.
 */
export const KEPT_ON_RESET_KEYS: readonly string[] = [STORAGE_KEYS.schema, STORAGE_KEYS.v2Presets];
