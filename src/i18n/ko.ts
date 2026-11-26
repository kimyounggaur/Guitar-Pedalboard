// 화면에 나오는 한국어 문구 카탈로그(설계서 4.13).
//
// 키 경로(`ko.connect.notAllowed`)로 쓰고, 없는 키는 타입 오류가 난다. 문구를 화면 코드에 흩어 두지 않으려는 곳이다.
// S2.3 이 연결 오류 문구부터 시작했고, S4.6 이 알림(토스트)·오류·상태 문구와 접근성 이름(aria-label·title·alt)을 여기로 모았다.
// 정해 둔 선(S4.6):
//   · 여기에 둔다 — 토스트·오류·안내·상태 문구, 그리고 페달·조절기의 **접근성 이름**(스크린 리더가 읽는 한국어 전체 이름).
//   · 화면에 그대로 둔다 — 페달 얼굴에 인쇄된 이름·노브 약어·단위(NOISE GATE, Threshold, dB …), 프리셋 이름, 이미 한국어인 제목·버튼 글자.
//   · 내부 ID(`noiseGate`, `graphicEQ` …)는 어디에도 보이지 않는다.
// 쓰지 않는 키는 `npm run test:ko-catalog` 가 잡는다(0개여야 한다). 키를 동적으로(`ko.pedal[type]`) 쓰면 그 아래 키 모두를 쓴 것으로 센다.
// 연결 오류 문구는 설계서 4.13 표의 글자 그대로다. 바꾸면 e2e E-07 과 `npm run test:connect-errors` 도 같이 바꿔야 한다.
import type { PedalType } from '../audio/types';

export const ko = {
  /** 입력 장치로 연결할 때 나는 오류의 안내(R2-7) */
  connect: {
    /** NotAllowedError — 마이크 권한 거부·차단 */
    notAllowed: '마이크 권한이 차단되어 있습니다. 주소창의 자물쇠 아이콘에서 마이크를 허용한 뒤 다시 연결해 주세요.',
    /** NotFoundError — 입력 장치 없음 */
    notFound: '입력 장치를 찾을 수 없습니다. 오디오 인터페이스나 마이크가 연결되어 있는지 확인해 주세요.',
    /** NotReadableError — 다른 프로그램이 쓰는 중이거나 하드웨어 오류 */
    notReadable: '입력 장치를 열 수 없습니다. 장치를 쓰는 다른 프로그램을 닫고 다시 시도해 주세요.',
    /** OverconstrainedError — 골라 둔 장치가 없어 기본 장치로 다시 연결했다(오류가 아니라 알림) */
    fellBackToDefault: '저장된 입력 장치를 찾지 못해 기본 장치로 연결했습니다.',
    /** SecurityError — 보안 출처(https)가 아님 */
    security: '이 주소에서는 마이크를 쓸 수 없습니다. https 주소로 접속해 주세요.',
    /** AbortError — 장치 시작 실패 */
    abort: '장치를 시작하지 못했습니다. 장치를 다시 꽂고 시도해 주세요.',
    /** 워클릿 로드 실패 — `audioWorklet.addModule` 예외 */
    workletLoad: '오디오 엔진을 시작하지 못했습니다. 브라우저를 최신 버전으로 업데이트해 주세요.',
    /** 그 밖의 오류. 오류 이름을 괄호 안에 적어 문의할 때 알려 줄 수 있게 한다. */
    other: (name: string) => `연결하지 못했습니다(오류: ${name}). 페이지를 새로 고친 뒤 다시 시도해 주세요.`,
  },
  /** 입출력 장치 안내(S2.13, 설계서 4.4). 입력 장치의 '기본 장치로 연결' 안내는 위 `connect.fellBackToDefault` 를 쓴다. */
  devices: {
    /** 저장해 둔 출력 장치를 쓸 수 없어 시스템 기본 출력으로 연결했다(오류가 아니라 알림) */
    outputFellBack: '저장된 출력 장치를 쓸 수 없어 시스템 기본 출력으로 연결했습니다.',
    /** setSinkId 가 없는 브라우저(Firefox·Safari): 출력 메뉴 대신 보이는 안내 */
    outputUnsupported: '출력 장치는 시스템 설정에서 바꿔 주세요.',
    /** 목록에 없는 저장된 입력 장치의 이름을 모를 때 메뉴에 쓰는 이름 */
    savedInput: '저장된 입력 장치',
    /** 목록에 없는 저장된 출력 장치의 이름을 모를 때 메뉴에 쓰는 이름 */
    savedOutput: '저장된 출력 장치',
    /** 출력 장치를 바꾸다가 실패했다(setSinkId 거부 등) */
    outputChangeFailed: '출력 장치를 변경할 수 없습니다. 장치 연결과 브라우저 권한을 확인해 주세요.',
    /** 브라우저의 출력 장치 선택 창(selectAudioOutput)을 열지 못했다 */
    outputPickerFailed: '출력 장치 선택 창을 열 수 없습니다. 브라우저 권한을 확인해 주세요.',
  },
  /** 연결이 아닌 오디오 작업(음원 파일·녹음·장치 목록)이 실패했을 때의 기본 안내 */
  audio: {
    startFailed: '오디오 장치를 시작하지 못했습니다.',
  },
  /** 입력 레벨 경고(설계서 4.12 표, R2-8). MonitorService 가 판정하고 입력·미터 패널이 같은 문구를 보인다. 바꾸면 e2e E-09 와 `npm run test:level-warning` 도 바꾼다. */
  level: {
    /** 장치 입력에서 5초 동안 피크가 −70 dBFS 미만 */
    silent: '입력 신호가 없습니다. 케이블과 입력 채널(1번/2번)을 확인하세요.',
    /** 최근 3초 안에 연주가 있었는데 그 3초의 최대 피크가 −36 dBFS 미만 */
    low: '입력이 작습니다. 인터페이스 게인이나 입력 트림을 올리세요.',
    /** 원신호 피크가 −0.5 dBFS 이상(인터페이스 단계에서 깨짐) */
    high: '입력이 너무 큽니다. 인터페이스 게인을 낮추세요.',
  },
  /** 페달 15종의 한국어 전체 이름. 화면의 제목(`Noise Gate`)은 얼굴에 인쇄된 이름이라 그대로 두고, 스크린 리더·툴팁은 이 이름을 쓴다. */
  pedal: {
    noiseGate: { name: '노이즈 게이트', controls: '노이즈 게이트 컨트롤' },
    compressor: { name: '컴프레서', controls: '컴프레서 컨트롤' },
    autoWah: { name: '오토 와우', controls: '오토 와우 컨트롤' },
    drive: { name: '드라이브', controls: '드라이브 컨트롤' },
    crunch: { name: '크런치', controls: '크런치 컨트롤' },
    fuzz: { name: '퍼즈', controls: '퍼즈 컨트롤' },
    graphicEQ: { name: '그래픽 이퀄라이저', controls: '7밴드 그래픽 이퀄라이저 컨트롤' },
    eq: { name: '이퀄라이저', controls: '이퀄라이저 컨트롤' },
    cab: { name: '캐비닛 시뮬레이터', controls: '캐비닛 시뮬레이터 컨트롤' },
    chorus: { name: '코러스', controls: '코러스 컨트롤' },
    flanger: { name: '플랜저', controls: '플랜저 컨트롤' },
    phaser: { name: '페이저', controls: '페이저 컨트롤' },
    tremolo: { name: '트레몰로', controls: '트레몰로 컨트롤' },
    delay: { name: '딜레이', controls: '딜레이 컨트롤' },
    reverb: { name: '리버브', controls: '리버브 컨트롤' },
  } satisfies Record<PedalType, { name: string; controls: string }>,
  /** 페달 얼굴 아래의 설명 한 줄(옛 영어 문구 → 한국어). 얼굴에 인쇄된 이름(`TREMOLO`)과 달리 설명이라 번역한다. */
  tagline: {
    autoWah: '연주 세기에 반응하는 필터',
    flanger: '되먹임이 있는 제트 소리 변조',
    chorus: '여러 목소리를 겹치는 변조',
    tremolo: '클릭 소리 없는 음량 변조',
    phaser: '여러 단의 올패스 위상 변조',
  },
  /** 화면 틀의 작은 제목·버튼 글자 */
  app: {
    /** 로고 그림의 대체 글자 */
    logoAlt: '기타 페달보드',
    /** 패널·화면 위쪽의 작은 제목(eyebrow) */
    eyebrow: {
      pedalboard: '페달보드',
      audioInput: '오디오 입력',
      monitor: '모니터',
      keyboard: '키보드',
    },
    /** 모든 소리를 바로 끄는 버튼(예전 글자: Panic) */
    panic: '긴급 정지',
    /** 입력·출력 파형 그림의 제목과 범례 */
    waveform: '파형',
    waveformInOut: '입력 / 출력',
    latencyPending: '지연시간 측정 대기',
  },
  /** 노이즈 게이트 상태 표시(워클릿 상태 'Open'·'Closed' 는 내부 값이라 화면에는 이 글자로 바꿔 보인다) */
  gate: {
    label: '게이트:',
    open: '열림',
    closed: '닫힘',
  },
  /** 여러 곳에서 같이 쓰는 짧은 글자 */
  common: {
    undo: '실행 취소',
  },
  /** 프리셋 패널·저장 대화상자·알림 */
  preset: {
    loaded: (name: string) => `${name} 프리셋을 불러왔습니다.`,
    slotCaptured: (slot: string) => `${slot} 슬롯에 현재 체인을 저장했습니다.`,
    slotActivated: (slot: string) => `${slot} 슬롯을 활성화했습니다.`,
    saved: '프리셋을 저장했습니다.',
    nameRequired: '프리셋 이름을 입력해 주세요.',
    /** 같은 이름 확인 대화상자를 여는 사이에 같은 이름이 새로 생겼다 */
    saveRaced: '같은 이름의 프리셋이 생겨 저장하지 못했습니다. 다시 저장해 주세요.',
    newNameRequired: '새 이름을 입력해 주세요.',
    newNameTaken: '그 이름의 프리셋도 이미 있습니다. 다른 이름을 입력해 주세요.',
    measuring: '현재 체인의 음량을 재는 중입니다…',
    inaudible: '소리가 거의 나오지 않아 음량을 맞출 수 없습니다. 노이즈 게이트와 볼륨 설정을 확인해 주세요.',
    /** 순간 피크가 커서 목표(−20 dBFS)까지 올리지 못했다 */
    trimSetLimited: (trim: string, rmsDb: string) =>
      `음량 보정을 ${trim} 로 맞췄습니다. 순간 소리가 커서 평균 ${rmsDb} dBFS 까지만 올렸습니다(리미터를 아끼려고 −20 dBFS 까지는 올리지 않았습니다). 프리셋으로 저장하면 이 값도 함께 저장됩니다.`,
    trimSet: (trim: string) => `음량 보정을 ${trim} 로 맞췄습니다. 프리셋으로 저장하면 이 값도 함께 저장됩니다.`,
    measureFailedWith: (reason: string) => `음량을 재지 못했습니다: ${reason}`,
    measureFailed: '음량을 재지 못했습니다.',
    deleted: (name: string) => `프리셋을 삭제했습니다: ${name}`,
    restoreFailed: '되돌리지 못했습니다. 같은 프리셋이 이미 있습니다.',
    restoredRenamed: (name: string) => `같은 이름의 프리셋이 있어 '${name}' 이름으로 되돌렸습니다.`,
    restored: (name: string) => `'${name}' 프리셋을 되돌렸습니다.`,
    alreadyDefault: '이미 기본 페달 설정입니다.',
    resetDone: '기본 페달 설정으로 되돌렸습니다.',
    resetToast: '모든 노브를 처음 값으로 되돌렸습니다',
    resetUndone: '기본 페달 설정 전으로 되돌렸습니다.',
    nothingToExport: '내보낼 내 프리셋이 없습니다.',
    exported: (count: number) => `내 프리셋 ${count}개를 내보냈습니다.`,
    importFailed: '프리셋을 가져오지 못했습니다.',
    fileReadFailed: '파일을 읽지 못했습니다.',
    importCancelled: '가져오기를 취소했습니다.',
    /** 공장 프리셋과 똑같은 사본이 사용자 목록에 있다(옛 버전이 만든 것) */
    duplicatesFound: (count: number) => `팩토리 프리셋과 똑같은 사본 ${count}개가 있습니다. 정리할까요?`,
    duplicatesClean: '정리',
    pasteJsonRequired: '가져올 JSON을 붙여 넣어 주세요.',
  },
  /** 프리셋 가져오기 파일을 읽다가 나는 오류 */
  importFile: {
    unreadable: 'JSON 파일을 읽을 수 없습니다. 형식을 확인해 주세요.',
    notOurs: '이 앱이 내보낸 프리셋 파일이 아닙니다.',
    unsupportedVersion: (version: string) => `지원하지 않는 프리셋 파일 버전입니다: ${version}. 더 새로운 앱에서 만든 파일일 수 있습니다.`,
    badFormat: '프리셋 JSON 형식이 올바르지 않습니다.',
    badEntry: '프리셋 항목이 올바르지 않습니다.',
    summary: (imported: number, skipped: number) => `${imported}개 가져옴 · ${skipped}개 건너뜀`,
  },
  /** 정지 이유별 안내(설계서 4.2절). `savedNote` 는 녹음이 저장됐을 때만 붙는 한 문장. */
  session: {
    savedNote: ' 녹음은 저장했습니다.',
    panic: (savedNote: string) => `긴급 정지했습니다. 마이크와 오디오를 모두 껐습니다.${savedNote}`,
    /** `where` 는 소리가 울린 주파수 '(약 800 Hz)' 이거나 빈 글자 */
    howl: (where: string, savedNote: string) => `하울링${where}이 감지되어 정지했습니다. 스피커 음량을 줄이거나 헤드폰을 쓰세요.${savedNote}`,
    deviceLost: (savedNote: string) => `입력 장치 연결이 끊겼습니다. 장치를 다시 연결한 뒤 연결하기를 누르세요.${savedNote}`,
    cleanupIncomplete: '정지하는 중 일부 정리가 끝나지 않았습니다. 소리가 계속 나면 페이지를 새로고침해 주세요.',
  },
  /** 녹음 */
  recording: {
    saved: '녹음을 저장했습니다.',
    fileFailed: '녹음 파일을 만들지 못했습니다.',
    wavSaveFailed: 'WAV 녹음을 저장하지 못했습니다.',
    stopFailed: '녹음을 안전하게 종료하지 못했습니다.',
    error: '녹음 중 오류가 발생했습니다.',
    wavUnsupported: '이 브라우저는 WAV 녹음을 지원하지 않습니다.',
    wavLimit: 'WAV 녹음 제한에 도달했거나 오디오를 시작할 수 없어 녹음을 종료했습니다.',
  },
  /** MIDI */
  midi: {
    thisPedal: '이 페달',
    modeToggle: (pedal: string) => `${pedal}: 누른 뒤 1초 안에 뗌이 이어져 '토글'(누를 때마다 전환)로 지정했습니다. 카드의 '방식' 버튼으로 바꿀 수 있습니다.`,
    modeLatch: (pedal: string) => `${pedal}: 1초 안에 뗌이 오지 않아 '래치'(스위치가 보내는 값을 따름)로 지정했습니다. 누를 때마다 전환하려면 카드의 '방식' 버튼으로 토글로 바꾸세요.`,
    signalInUse: '이 MIDI 신호는 익스프레션 또는 프리셋 전환에 이미 사용 중입니다.',
    reconnectFailed: '저장된 MIDI 매핑을 연결하지 못했습니다. MIDI 권한을 확인해 주세요.',
    permissionUnknown: 'MIDI 접근 권한을 확인할 수 없습니다.',
    unsupported: 'Web MIDI를 지원하지 않는 브라우저입니다.',
    /** 고급 MIDI 설정(프로그램 변경·볼륨·와우 CC) 저장·수신 안내 */
    advancedCollision: '선택한 채널과 CC가 페달 MIDI 스위치와 겹칩니다. 다른 CC를 선택하세요.',
    advancedSameCc: '볼륨과 와우에는 서로 다른 CC를 지정하세요.',
    advancedSaved: '설정을 저장했습니다.',
    programMissing: '지정된 프리셋을 찾을 수 없습니다. 매핑을 다시 설정하세요.',
    programLoaded: (name: string) => `MIDI: ${name} 프리셋을 불러왔습니다.`,
    wahMissing: '와우 페달이 없어 익스프레션을 적용할 수 없습니다.',
    /** 저장된 MIDI 풋스위치를 다시 잇지 못했을 때의 배너 */
    bannerNeedsPermissionTitle: '저장된 MIDI 풋스위치가 아직 연결되지 않았습니다.',
    bannerDeniedTitle: 'MIDI 연결이 막혀 있습니다.',
    bannerNeedsPermissionBody: '브라우저가 MIDI 사용을 묻는 창은 이 버튼을 눌렀을 때만 나옵니다.',
    bannerDeniedBody: '브라우저의 사이트 설정에서 이 사이트의 MIDI 접근을 허용한 뒤 다시 연결해 주세요.',
  },
  /** 출력 미터 아래 경고·녹음 상태 */
  meter: {
    outputClipping: '출력 클리핑이 발생했습니다. 마스터 볼륨이나 페달 레벨을 낮추세요.',
    /** 레벨 막대 이름(입력·출력). 이름 뒤에 '레벨'을 붙여 스크린 리더가 읽는다 */
    inputBar: '입력',
    outputBar: '출력',
    /** 막대의 읽기값 — `-12.0 dB, 최고 -3.0 dBpk` */
    valueText: (db: string, peak: string) => `${db}, 최고 ${peak}`,
    valueTextEmpty: '-inf dB, 최고 -inf dBpk',
    clipped: '클리핑 발생',
    headroomOk: '헤드룸 정상',
    outputNearFull: '마스터 출력이 0dBFS에 근접했습니다. 페달 레벨이나 인터페이스 출력을 낮추세요.',
    recordingUnsupported: '이 브라우저에서는 녹음을 지원하지 않습니다.',
    underrunUnavailable: '이 브라우저는 출력 끊김 통계(AudioContext.playbackStats)를 제공하지 않아 측정할 수 없습니다.',
  },
  /** 페달 체인 */
  chain: {
    gainExcessive: '왜곡 페달이 중첩되어 게인이 과도합니다',
    reordered: '페달 순서가 변경되었습니다.',
  },
  /** 앱 전체 안내(오프라인·다른 탭·예기치 못한 오류) */
  notice: {
    offlineTitle: '오프라인 상태입니다.',
    offlineBody: '기타 실시간 입력은 사용할 수 없습니다. 음원 파일 재생 모드로 톤을 확인해 주세요.',
    oldVersionTab: '다른 탭에서 이전 버전이 열려 있습니다. 그 탭을 닫고 새로고침해 주세요.',
    unexpectedError: '예기치 못한 오류가 생겼습니다',
    copyErrorInfo: '오류 정보 복사',
    updateAvailable: '새 버전이 있습니다 — 연주를 마친 뒤 새로고침',
    reload: '새로고침',
  },
  /** 저장 문제 안내(설계서 4.8절 표, unknown 만 S1.7 에서 더했다) */
  storage: {
    blocked: '브라우저 설정 때문에 설정을 저장할 수 없습니다. 이번 방문 동안만 유지됩니다.',
    quota:
      '저장 공간이 가득 차 설정이 저장되지 않았습니다. 같은 주소(kimyounggaur.github.io)에 올린 다른 앱의 데이터가 공간을 쓰고 있을 수 있습니다.',
    corrupt: '저장된 설정 일부를 읽지 못해 기본값으로 시작합니다.',
    unknown: '설정을 저장하지 못했습니다. 이번 방문 동안만 유지됩니다.',
  },
  /** 사용자 IR(WAV) 검사 오류 — 캐비닛 페달 아래에 그대로 보인다 */
  cabinetIr: {
    fileTooBig: 'IR 파일은 4 MB 이하의 WAV 파일이어야 합니다.',
    notWav: '올바른 WAV 파일이 아닙니다.',
    corrupted: 'WAV 파일이 손상되었습니다.',
    formatUnknown: 'WAV 형식을 확인할 수 없습니다.',
    dataInvalid: 'WAV 오디오 데이터가 올바르지 않습니다.',
    unsupportedFormat: '모노 또는 스테레오 PCM/32비트 float WAV 파일만 지원합니다.',
    tooLong: 'IR 파일은 10초 이하여야 합니다. (1초가 넘는 IR 은 앞 1초만 사용합니다.)',
    decodedShape: 'IR 은 모노 또는 스테레오 오디오여야 합니다.',
    badSample: 'IR에 사용할 수 없는 오디오 값이 있습니다.',
    silent: '무음 IR은 사용할 수 없습니다.',
    readFailed: 'WAV IR 파일을 읽지 못했습니다.',
    cancelled: 'IR 적용이 취소되었습니다.',
    loadFailed: 'IR을 불러오지 못했습니다.',
    storeFailed: 'IR 을 이 브라우저에 저장하지 못했습니다.',
    storeUnavailable: '이 브라우저는 IR 저장을 지원하지 않거나 막혀 있습니다.',
    /** Cab 화면의 안내 문구(S5.4). 오류가 아니라 상태와 사용 조건을 알리는 글이다. */
    ui: {
      loadButton: '내 IR 불러오기 (WAV)',
      fileLabel: '내 IR 파일(WAV)',
      deleteButton: '저장된 내 IR 지우기',
      inUse: (name: string) => `내 IR: ${name}`,
      cutNotice: (originalSeconds: number) => `원본은 ${originalSeconds.toFixed(2)}초여서 앞 1초만 사용합니다.`,
      missing: '저장된 내 IR 이 없어 기본 캐비닛(Modern 4×12)으로 재생 중입니다. WAV 파일을 불러와 주세요.',
      stored: '이 브라우저에 저장되어 새로고침해도 유지됩니다.',
      notPersisted: '이 브라우저에 저장하지 못해 이번 접속에서만 쓸 수 있습니다.',
      knobsNote: '마이크 위치와 거리 조절은 기본 캐비닛에만 적용됩니다.',
      limits: '모노·스테레오 PCM 또는 32비트 float WAV, 4 MB 이하. 1초가 넘으면 앞 1초만 사용합니다. 불러온 파일은 이 브라우저 안에만 저장되며 서버로 보내지 않습니다.',
      licenseNotice: '직접 녹음했거나 사용이 허용된 IR 만 쓰세요. 상용 캐비닛 IR 은 재배포·무료 사용이 허용되는지 판매처의 사용 조건을 먼저 확인하세요.',
    },
  },
  /** 오디오 엔진이 사용자 동작에 대한 답으로 던지는 오류 */
  engine: {
    outputSelectUnsupported: '이 브라우저는 출력 장치 선택을 지원하지 않습니다.',
    inputUnsupported: '이 브라우저는 오디오 입력을 지원하지 않습니다.',
    inputLost: '입력 장치 연결이 끊어졌습니다. 장치를 다시 연결해 주세요.',
    audioFileOnly: '오디오 파일만 업로드할 수 있습니다.',
    noUploadedSource: '재생할 업로드 음원이 없습니다.',
    contextNotReady: 'AudioContext가 아직 준비되지 않았습니다.',
    recorderNotReady: '녹음할 마스터 출력이 준비되지 않았습니다.',
    workletLoad: '오디오 워클릿 모듈을 불러오지 못했습니다.',
  },
} as const;
