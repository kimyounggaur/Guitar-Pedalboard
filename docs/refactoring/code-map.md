# 코드 지도 (S0.1)

> 설계서 5장의 모든 Step이 가리키는 코드를 **현재 저장소**와 맞춘 지도다. 이후 Step은 설계서의 옛 줄 번호가 아니라 이 문서를 우선한다.
> 이 Step에서는 앱 코드(`src/`)를 한 줄도 고치지 않았다.

## 0. 기준 커밋 — 설계서와 저장소가 어긋나 있다

| 항목 | 값 |
|---|---|
| 설계서가 읽은 커밋 | `4ac9cf7` |
| 지금 저장소 HEAD | `2a5ab81` (2026-11-13, `main`) |
| 차이 | 8커밋, 136파일, +3,418 / −869줄 (Codex PR #1 병합과 후속 수정) |
| 영향 | 설계서의 **44개 보고서 항목 중 상당수가 이미 고쳐져 있다**. 줄 번호는 거의 전부 어긋난다. |

**결론**: 설계서의 Step을 "새로 만들기"로 그대로 실행하면 이미 있는 기능을 두 번 만들게 된다.
그래서 각 Step을 **미착수 / 부분 구현 / 이미 구현**으로 나눠 아래 표에 적었고, 이미 구현된 Step은 "검증 + 테스트 추가"로 줄인다.
세부 판단과 편차는 `docs/REFACTOR_LOG.md`에 남긴다.

판정은 코드 읽기와 **실제 Chrome 실행 측정**(저장소 차단, 화면 크기 8종, 스크린샷)으로 했다. 측정 방법은 7절에 있다.

## 1. 요약

| 구분 | 개수 |
|---|---:|
| 보고서 항목 | 44 |
| 해결 | 21 |
| 부분 | 20 |
| 미해결 | 3 |
| 설계서 Step | 51 (S1.4는 a·b·c 3개) |
| Step 진행(3절) | 이미 구현 20 · 부분 21 · 미착수 9 · 이 Step 1 |
| Step 위치(3절) | `확인됨` 5 · `위치 다름` 26 · `없음`(신규 예정) 10 · 둘 이상 섞임 9 · 해당 없음 1 |

> 21 + 20 + 3 = 44, 20 + 21 + 9 + 1 = 51이다. 둘 다 표를 명령으로 세어 맞췄다(7절 "검산").
> "이미 구현"은 기능이 이미 있다는 뜻이다. 그래도 설계서의 수용 기준(프로브·E2E)이 없으므로 그 시험은 해당 Step에서 추가한다.

## 2. 보고서 44항목 판정 (현재 코드 기준)

판정 기준 — **해결**: 보고서가 말한 증상이 지금 코드에서 나타나지 않는다(남은 일은 구조 정리·시험 추가 수준). **부분**: 증상이 일부 남았거나, 설계서가 요구한 동작이 하나 이상 아직 없다(남은 것을 적었다). **미해결**: 증상이 그대로다.
줄 번호는 `2a5ab81` 기준이다. 파일 위치: 이펙트 클래스 `src/audio/nodes/`, 워클릿 `src/audio/worklets/`, 유틸 `src/audio/utils/`, 스토어 `src/store/`, 화면 `src/components/`(페달 화면은 `src/components/effects/`), 스타일 `src/styles/`.

### 2.1 1순위 — 안전과 핵심 조작 (R1)

| 항목 | 판정 | 근거 (파일:줄) | 남은 것 → Step |
|---|---|---|---|
| R1-1 휴대폰 하단 패널이 페달을 가림 | 해결 | `AppShell.tsx:31`(`mobileDockOpen` 초기값 `false`)·`:119-143`(도크 토글·탭·패널) — 도크 기본 접힘, 접힌 높이 110 px. 실측 390×844·360×640·412×915에서 15개 스위치 모두 도크 밖(0/15 가림). 펼쳐도 마지막 스위치가 도크 위에 있음 | 검증 테스트(E-04)만 → S1.6 축소 |
| R1-2 하울링 보호가 안 돎, 차단 시 녹음 폐기 | 부분 | 감시가 오디오 스레드 워클릿으로 이동(`howl-guard-processor.ts` 전체, `AudioEngine.ts:729-733`). 차단 시 녹음은 보존(`audioStore.ts:979-990` `panic()`→`finishActiveRecording('finalize')`) | 출력 측정(RMS > 0.08 ≈ −22 dBFS, 1.5 s)이라 작은 음량 하울링은 못 잡음. 입력 쪽 "줄지 않는 음" 방식 아님 → S1.5 |
| R1-3 Panic 뒤에도 마이크·엔진이 켜져 있음 | 부분 | `AudioEngine.ts:520-533` `panic()`이 마스터 0, 트랙 stop, 파일 pause. `audioStore.ts:979-990`이 녹음 마감 뒤 `dispose()` | `context.close()`를 기다리지 않음(`AudioEngine.ts:555-557`). 정지 경로가 `stop`/`panic`/`dispose`/`cleanupFailedSession` 4갈래 → S1.2 |
| R1-4 기타 소리가 왼쪽에서만 남 | 부분 | `AudioEngine.ts:126-129,753-766` 채널 분리기(1·2·스테레오), `ConnectGuitarPanel`/`DeviceSelector` 선택 UI. 기본은 `'1'`(`audioStore.ts:680`) | `auto` 모드 없음, 선택이 저장되지 않음(`IoSettings`에 없음, `audioStore.ts:42-47`), 튜너는 센 채널 선택 로직 따로 → S1.3 |
| R1-5 프리셋 음량 27 dB 차, Cab 끄면 +15 dB, 리미터 없음 | 부분 | 리미터 추가(`peak-limiter-processor.ts` 전체, `AudioEngine.ts:728,746-749`; 0.89 상한, 50 ms 해제, 룩어헤드 없음), 왜곡 페달 겹침 경고 문구(`audioStore.ts:757-776`) | Cab 끌 때 보정 없음(`CabEffect.ts:78-85`), 프리셋 음량 정렬·`presetTrim` 없음 → S1.4b, S1.4c |
| R1-6 Crunch 무연주 잡음 | 해결 | `curves.ts:38-55` 입력을 곱해 0점이 연속(주석 "both halves meet at zero"), `CrunchEffect.ts:24,41-42` DC 차단기(`utils/dcBlocker.ts`) | 숫자로 확인하는 프로브(P-01·P-02)만 → S1.1 축소 |
| R1-7 노트북에서 글자 겹침·Bypass 잘림 | 부분 | Bypass 스위치가 없어져 잘림은 사라짐(`PedalCard.tsx:313`). 실측 1024·1280·1366·1440 폭(와 모바일 390 폭)에서 15개 스위치 모두 카드 안 | 같은 폭들에서 Fuzz 카드 안 글자 겹침이 1~3건(예: "90%"↔"← OUTPUT", "Classic"↔"Fuzz"), Crunch·Reverb 카드에 가로로 잘린 요소가 각 1건 → S1.8 |

### 2.2 2순위 — 사용성 (R2)

| 항목 | 판정 | 근거 (파일:줄) | 남은 것 → Step |
|---|---|---|---|
| R2-1 저장소 막히면 앱이 멈춤 | 해결 | 실측: `localStorage` getter 예외, `setItem` QuotaExceeded, `getItem` 예외 3경우 모두 앱이 뜨고 안내문 표시(`StorageNotice.tsx`, `storageNotice.ts`). 저장 호출마다 try/catch(`pedalStore.ts:323-337`, `presetStore.ts:445-451`, `audioStore.ts:109-117`) | 호출 지점이 7개 파일 16곳에 흩어져 있음(7절 표) → `SafeStorage`로 통합, 오류 화면 문구·테스트 → S1.7 축소 |
| R2-2 꺼진 페달은 켜도 소리 안 바뀜(Mix 0) | 부분 | 팩토리 프리셋은 `off()`가 mix 0을 무시(`presetStore.ts:101`)해 기본 Mix 유지 | 불러올 때 정규화 없음 → 사용자·가져온 프리셋에 `꺼짐 + Mix 0` 그대로(픽스처 04) → S2.1 |
| R2-3 이름과 기능이 다른 조절기 9곳 | 부분 | Fuzz `Gate`→"출력 감쇠"(`FuzzPedal.tsx:136`), Reverb Decay 화면 상한 6 s(`ReverbPedal.tsx:74-78`) 등 일부 정정 | 파라미터 스키마 없음. Reverb는 화면만 6 s로 자르고 저장·엔진은 그대로(픽스처 05). Fuzz Gate가 진짜 게이트가 아님(D15) → S2.2 |
| R2-4 On/Off와 Bypass가 같은 일 | 해결 | 화면에 "효과" 스위치 하나(`PedalCard.tsx:313`, `StompToggleSwitch.tsx`), 활성 = `enabled && !bypassed`(`BaseEffect.ts:129`). 스키마 10→11이 `enabled=true`, `bypassed = !enabled \|\| bypassed`로 정리(`pedalStore.ts:808-816`). 실측 기본 LED 5개 = 실제 활성 5개 | 모델에 두 필드가 남음, v2 키(`guitar-pedalboard:v2:*`)·백업·다중 탭 감지 없음 → S2.4 축소 |
| R2-5 파일 모드가 한 번 재생하면 끝, Space | 해결 | 반복 `audioElement.loop = true`(`AudioEngine.ts:247`), ±10초·슬라이더(`ConnectGuitarPanel.tsx:182-200`), Space가 파일 모드에서 재생/일시정지(`GlobalKeyboardShortcuts.tsx:44-51`) | E-10 시나리오만 → S2.6 축소 |
| R2-6 Export 직후 Import 시 팩토리 40개 복제 | 해결 | `exportPresets()`는 사용자 프리셋만(`presetStore.ts:535-543`), `importPresets()`는 `factory-` id 재발급·이름 기준 병합(`presetStore.ts:544-562`) | E-11만 → S2.7 축소 |
| R2-7 오류 안내가 영어 원문이거나 없음 | 부분 | `audioStore.ts:619-628` `toErrorMessage()`가 권한·장치 없음·사용 중·중단을 한국어로 | 저장된 입력 장치가 없을 때 기본 장치로 다시 시도하지 않음(`AudioEngine.ts:197`이 `exact: deviceId`로만 요청, 실패하면 문구만 표시), `ko.ts` 없음 → S2.3 |
| R2-8 입력 레벨 경고가 사실과 다름 | 부분 | `Meter.tsx:102-113` 클리핑 표시, `ConnectGuitarPanel.tsx:63-74` 입력 레벨 문구 | 입력 레벨 판정 기준을 사실과 대조하지 않음(E-09 없음) → S2.5 |
| R2-9 MIDI가 새로고침 뒤 무반응, 방향 반대, 토글 없음 | 해결 | 마운트 시 `connectSavedMidi()`(`AppShell.tsx:51-54`), 토글/누름 유지(`audioStore.ts:219-236`, `midi.ts:5-12`), CC ≥ 64 = 켜짐(`midi.ts:127-134`) | MidiService 분리·E-13 → S2.9 축소 |
| R2-10 지연·글리치 숫자가 실제와 다름, ASIO 안내 | 부분 | 글리치는 브라우저 `playbackStats.underrunEvents`(`AudioEngine.ts:620-627`), 입력 지연은 장치가 알려 준 값만 따로 표시(`AudioEngine.ts:629-643`)하고 "실제 왕복 지연이 아님"을 명시(`Meter.tsx:283-287`), ASIO 문구는 소스·README 어디에도 없음 | 합계가 출력 지연뿐이다 — 입력 지연은 합계 밖, 처리 지연은 "추정 미지원"(`Meter.tsx:286`). `latency.ts` 분리·P-16 없음 → S2.10 |
| R2-11 앱 아이콘·파비콘 없음 | 부분 | `public/pwa-192x192.png`, `pwa-512x512.png`(purpose any), `apple-touch-icon.png`, `favicon.ico`, 매니페스트(`vite.config.ts:17-45`) | maskable·`favicon.svg` 없음, 매니페스트 `lang`·`id` 없음, `index.html:12-15`에 `<link>` 중복 → S2.14 |
| R2-12 단축키 3가지 문제 | 해결 | 물리 키(`event.code`) 사용 → 한글 IME에서 동작(`keyboardShortcuts.ts:27-29`), Esc=Panic(`:37`), 10~15번째는 `0 Q W E R Y`(`:30`) | 설계서의 `Shift+1~6`(D13)과 다른 방식으로 이미 해결 → S2.11은 도움말·테스트만 |
| R2-13 튜너가 옥타브를 구분 못 함 | 해결 | `octaveMismatch`·`targetNote`·`stringNumber`(`tunings.ts:124-126`, `types.ts` PitchReading), 하한 28 Hz(`tuner-processor.ts:4`), `chromatic` 프리셋 | P-22 → S2.12 축소 (S2.12 에서 `octaveMismatch` 는 `octavesAbove`·`checkString` 으로 바뀌고 줄 선택은 옥타브를 접지 않는다 — L-186~L-189) |
| R2-14 삭제·초기화 확인 없음, 묻지 않는 덮어쓰기 | 부분 | `window.confirm` 3곳: 덮어쓰기 `PresetPanel.tsx:170`, 삭제 `:178`, 초기화 `:193` | 가져오기(`presetStore.ts:544-562`)는 같은 이름의 사용자 프리셋을 묻지 않고 덮어쓴다(설계서 수용 기준 "묻지 않고 덮어쓰는 경로 0개"에 걸림). 삭제·초기화에 "실행 취소"가 없고 대화상자는 브라우저 기본이다 → S2.8 |
| R2-15 입출력 장치 관리가 수동 | 부분 | `devicechange`로 목록 갱신(`ConnectGuitarPanel.tsx:81`), 출력 장치 선택(`AudioEngine.ts:152-167`, `audioStore.ts:798-806`), 입력이 끊기면 정지(`audioStore.ts:1215-1221`) | 기본 장치 자동 추종·`device-lost` 처리·장치 id 안정화 없음 → S2.13 |

### 2.3 3순위 — 소리 품질 (R3)

| 항목 | 판정 | 근거 (파일:줄) | 남은 것 → Step |
|---|---|---|---|
| R3-1 Compressor Mix 빗살 | 해결 | `compressor-processor.ts` 워클릿 + `scripts/compressor-phase-regression.mjs`(위상 일치 검사) | P-08로 숫자 기준선 → S3.6 축소 |
| R3-2 Cab 좌우 음량 차 | 부분 | 시드 난수로 IR 고정(`cabinet.ts:82-90`), `scripts/cabinet-response-analysis.mjs` | 좌우 대칭 여부 미확인 → P-09 → S3.2 |
| R3-3 Delay Tape 음정 흔들림 | 해결 | 플러터 깊이 0.0002 s(0.2 ms), 4.2 Hz(`DelayEffect.ts:108-109`; 설계서가 읽은 값은 6 ms) | P-10으로 확인 → S3.3 축소 |
| R3-4 Flanger·Phaser 피드백 지연 | 해결 | `flanger-processor.ts`, `phaser-processor.ts` 워클릿, `FlangerEffect.ts`·`PhaserEffect.ts` 재작성, 회귀 테스트가 동작 검증으로 교체 | P-11·P-12 → S3.4 축소 |
| R3-5 Drive Distortion이 30%까지 무왜곡 | 미해결 | `curves.ts:3-36` `createDriveCurve`는 기준 커밋과 같음 | S3.5 |
| R3-6 Crunch Gain이 20~30%에서 이미 최대 | 미해결 | `CrunchEffect.ts:59` `preGain = 1 + gain/100*3` 그대로 | S3.5 |
| R3-7 Delay·Reverb Mix가 원음을 줄임 | 해결 | `BaseEffect.ts:132` 시간계열(delay·reverb)은 `dry = 1` 고정 | P-15로 확인 → S3.1 축소 |
| (참고·집계 제외) 3순위 본문의 처리 지연 +10 ms | 부분 | 왜곡 3종 오버샘플이 이미 `'2x'`(`DriveEffect.ts:18`, `CrunchEffect.ts:31`, `FuzzEffect.ts:30`) | P-16 실측, 지연 표시 → S3.7 축소 |

### 2.4 4순위 — 품질·유지보수 (R4)

| 항목 | 판정 | 근거 (파일:줄) | 남은 것 → Step |
|---|---|---|---|
| R4-1 로고 1.6 MB | 해결 | `public/logo.webp`(36 KB), `index.html:11` preload, `PedalBoard.tsx:22`, `vite.config.ts:17` | E-19 측정 → S4.1 축소 |
| R4-2 Phaser CPU | 부분 | Phaser가 워클릿으로 바뀜 | 꺼진 페달의 유휴 처리 없음(`sleep` 메시지는 튜너에만 있음), `noise-gate-processor.ts:93,106,109`가 샘플마다 `Math.log10`·`Math.pow`·`Math.exp`를 부름 → S4.2 |
| R4-3 노브 한 칸마다 15개 다시 그림 | 부분 | `updatePedalParam`은 바뀐 페달만 복제(`pedalStore.ts:959-`) | `togglePedal`·`setPedalBypass`는 15개 전부 `clonePedal`(`:941-957`) → S4.3 |
| R4-4 노브 조작 방식 | 해결 | `useKnobDrag.ts`, `KnobNumberInput.tsx`(숫자 입력), 값 표시 `<output>`(`SliderControl.tsx:30-33`); 투명 range는 남아 있으나(`controls.css:102-110`) 드래그 핸들러가 붙음 | E-20 확인 → S4.4 축소 |
| R4-5 글자 대비·크기 | 미해결 | 0.44~0.68rem 지정이 CSS에 **54곳**(0.68rem 14곳, 0.62rem 10곳, 0.44rem 3곳 …) | S4.5 |
| R4-6 한국어·영어 혼용 | 부분 | 오류 문구는 한국어(`audioStore.ts:619`) | 조절기 라벨은 영어 다수(`Low Cut`, `Mid Hz`, `Pre Delay`, `Feedback` … — `components/effects/*.tsx`), `ko.ts` 없음 → S4.6 |
| R4-7 테스트가 소스 문자열 검사, 배포 때 미실행 | 부분 | 배포 전 lint·test·responsive 실행(`deploy.yml:35-41`). 정규식 단언 337 → 312 | PR용 `verify.yml` 없음, Chrome 없으면 반응형 테스트를 조용히 건너뜀(`responsive-a11y-regression.mjs:256-259`), 프로브·E2E 없음 → S0.2~S0.4, S4.7 |
| R4-8 상표명·저작물 | 부분 | `Source/`의 참고 이미지는 제거됨(`README.md:130`; 옛 Git 기록에는 남음 — D8). 그러나 AI 기획 문서 3개(약 100 KB)는 아직 추적 중 | 'Plexi Lead' 프리셋(`presetStore.ts:218`), 'TS Clean'·'TS Boost'(`DrivePedal.tsx:15-16`), Cab 내부 id `v30`·`greenback`·`jensen`·`tweed`(저장값이라 이름 못 바꿈) → S4.8 |
| R4-9 저장소 정리 | 부분 | `esbuild`가 devDependency로 명시(`package.json:51`) | `assets/` 2파일이 추적 중(.gitignore에는 있음), `sourcemap: true`(`vite.config.ts:73`), `engines` 없음, `__migration_check.ts` 1,085줄 → S0.2, S4.9 |

### 2.5 보완 기능 (RX) — 전부 구현됨

| 항목 | 판정 | 근거 (파일:줄) | 남은 것 → Step |
|---|---|---|---|
| RX-1 WAV 녹음 | 해결 | `recording.ts:50` `WavRecorder`, `audioStore.ts:581,691-693` 형식 선택(기본 `webm`) | 기본 형식·E2E → S5.1 축소 |
| RX-2 MIDI 확장 | 해결 | `midiAdvanced.ts`(프로그램 체인지·볼륨 CC·와와 CC), `MidiAdvancedControls.tsx` | S5.2 축소 |
| RX-3 실행 취소·다시 실행 | 해결 | `historyStore.ts`, `HistoryControls.tsx`, `history-regression.mjs` | S5.3 축소 |
| RX-4 캐비닛 IR 불러오기 | 해결 | `cabinetIr.ts`, `AudioEngine.ts:380-424`, `CabPedal.tsx` | S5.4 축소 |
| RX-5 튜너 기준음 조정 | 해결 | `AudioEngine.ts:493-497`(400~480 Hz), `audioStore.ts:46,99-102` `tuningReferenceHz` 저장 | S5.5 축소 |
| RX-6 화면 꺼짐 방지·이탈 경고 | 해결 | `SessionProtection.tsx`, `App.tsx:7` 장착 | S5.6 축소 |

## 3. Step별 코드 지도

열 설명 — **위치**: `확인됨`(설계서가 말한 곳에 그대로 있음) / `위치 다름`(있으나 줄·이름이 바뀜) / `없음`(신규 파일 예정이거나 설계서가 말한 코드가 사라짐). **진행**: `미착수` / `부분` / `이미 구현`.

### Phase 0 — 안전망

| Step | 설계서의 대상 | 실제 경로·함수·줄 | 위치 | 진행 |
|---|---|---|---|---|
| S0.1 | — | 이 문서, `docs/refactoring/regex-assertions.md`, `e2e/fixtures/storage-v1/` | — | 이 Step |
| S0.2 | `package.json`, `scripts/run-all-tests.mjs`(신규), `deploy.yml` 32~35행, `verify.yml`(신규), `responsive-a11y-regression.mjs` 250~253행 | `package.json:28` `test`(23개를 `&&`로 이음 — `responsive-a11y`는 체인 밖), `engines` 없음; `deploy.yml:32-41` 설치→빌드→lint→test→반응형(이미 배포 앞 게이트); `responsive-a11y-regression.mjs:256-259` Chrome 없으면 건너뜀; `run-all-tests.mjs`·`verify.yml` 없음 | 위치 다름 | 부분 |
| S0.3 | `src/audio/testing/*`, `probe.html`, `scripts/audio-render-probe.mjs`, `docs/baseline/*`, `BaseEffect.ts:14,32` | `src/audio/testing/` 없음, `probe.html` 없음. 이펙트 생성자는 `AudioContext`를 받음(`BaseEffect.ts:14,32`) | 없음(신규) / 확인됨 | 미착수 |
| S0.4 | `e2e/`, `playwright.config.ts`, `e2e/fixtures/*.wav` | 없음. 기존 반응형 테스트가 Chrome을 직접 띄워 CDP로 측정(`responsive-a11y-regression.mjs:249-330`) | 없음(신규) | 미착수 |

### Phase 1 — 안전과 핵심 조작

| Step | 설계서의 대상 | 실제 경로·함수·줄 | 위치 | 진행 |
|---|---|---|---|---|
| S1.1 | `curves.ts` `createCrunchCurve` 38~55행(원인 46행) | `curves.ts:38-55` 동일 위치, 원인 줄이 "입력에 곱하기"로 이미 수정됨 | 확인됨 | 이미 구현 |
| S1.2 | `engine/AudioSession.ts`·`sessionStore.ts`(신규), `audioStore.ts` 1036~1068·1055행, `recording.ts`, `GlobalKeyboardShortcuts.tsx`(Esc), Panic 버튼(추정 `Meter`/`AppShell`) | `AudioEngine.ts:520-533` `panic`, `:535-578` `dispose`, `:585-592` `stop`, `:690-699` `cleanupFailedSession`; `audioStore.ts:965-990` `stop`·`panic`, `:411-464` `finishActiveRecording`; Esc `GlobalKeyboardShortcuts.tsx:61-63`; Panic 버튼 `ConnectGuitarPanel.tsx:154`(추정 정정); `AudioSession.ts`·`sessionStore.ts` 없음 | 위치 다름 | 부분 |
| S1.3 | `engine/InputStage.ts`(신규), `AudioEngine.ts` 121~135·127행, `DeviceSelector.tsx`, IO 저장, `tuner-processor.ts` 139~159행 | `AudioEngine.ts:126-129` `setInputChannelMode`, `:195-204` `getUserMedia({channelCount:{ideal:2}})`, `:753-766` `connectInput`; `audioStore.ts:571,680` 모드 상태; IO 저장 `audioStore.ts:33,42-47,72-117`; 튜너 채널 선택 `tuner-processor.ts:143~` | 위치 다름 | 부분 |
| S1.4a | `worklets/limiter.worklet.ts`·`engine/OutputStage.ts`(신규), `AudioEngine.ts` 554~577·574~575·314~325·499~513행, `vite.config.ts` | 리미터는 `worklets/peak-limiter-processor.ts`(문자열 워클릿); `AudioEngine.ts:719-751` `createProcessingGraph`(마스터→howlGuard→limiter→미터·destination), `:456-467` `createRecorderStream`(limiter에서 분기), `:659-678` `loadWorklets`(8개) | 위치 다름 | 부분 |
| S1.4b | `CabEffect.ts` 54~91행, `cabinet.ts` 17~68행 | `CabEffect.ts:57-103` `update`(사용자 IR `:68-76`, `model==='off'` `:78-85`), `cabinet.ts:16-75` 프로필, `:76-90` 시드 난수 | 위치 다름 | 미착수 |
| S1.4c | `scripts/compute-preset-trims.mjs`·`factoryTrims.json`(신규), `presetStore.ts`, `AudioEngine.ts`, 프리셋 패널 | `presetStore.ts:129-366` `defaultPresets`(40개), 불러오기 `AudioEngine`에 `presetTrim` 없음 | 없음(신규) / 위치 다름 | 미착수 |
| S1.5 | `worklets/output-guard`·`level-meter`, `monitor/MonitorService.ts`, `monitorStore.ts`, `OutputStage.ts`, `audioStore.ts` 33~34·1047~1068행, `Meter.tsx` 162~172행, `AppShell.tsx` 77행 | 하울링은 `howl-guard-processor.ts` 워클릿 + `audioStore.ts:1225-1230` 핸들러 + `AudioEngine.ts:729-733,746`; 차단 상수·rAF 감시는 삭제됨(스토어에 없음); `Meter.tsx:159` rAF는 그리기용; `MonitorService`·`monitorStore` 없음 | 위치 다름 / 없음 | 부분 |
| S1.6 | `AppShell.tsx` 14~18·102~150행, `responsive.css` 160~230·167~173행 | `AppShell.tsx:16-20` 탭 3개, `:31` 도크 상태, `:119-143` 도크·탭·패널; `responsive.css:1`(기본)·`:86`(≤767px 시작)·`:95`(도크 열림)·`:166`·`:180`(도크·토글)·`:219-225`(패널) | 위치 다름 | 이미 구현(탭에 '페달' 없음·`--dock-h` 없음) |
| S1.7 | `persistence/SafeStorage.ts`(신규), `pedalStore.ts` 307~327행, `presetStore.ts` 436~443행, `PresetPanel.tsx` 37~40행, `audioStore.ts`, `app/AppErrorBoundary.tsx`(신규), `main.tsx`, `Toast.tsx`, ESLint | 저장 호출 16곳·7개 파일(7절 표); 오류 경계는 `components/ErrorBoundary.tsx`(27줄)로 이미 존재, `App.tsx:7` 장착; 안내문 `StorageNotice.tsx`+`storageNotice.ts`; `SafeStorage`·`Toast`·ESLint 규칙 없음 | 위치 다름 | 부분 |
| S1.8 | `layout.css`, `pedals.css`, `PedalCard.tsx` 아래쪽, `AppShell.tsx`(오른쪽 패널 접기), `ConnectGuitarPanel.tsx`(한 줄 상태 바), `PedalBoard.tsx` 83~90행 로고 | 오른쪽 패널 접기는 `AppShell.tsx:101-114`에 이미 있음; 로고 `PedalBoard.tsx:22`; Fuzz·Crunch·Reverb 카드 겹침·잘림은 `pedals.css`(4,287줄) | 위치 다름 | 부분 |

### Phase 2 — 사용성과 저장 형식

| Step | 설계서의 대상 | 실제 경로·함수·줄 | 위치 | 진행 |
|---|---|---|---|---|
| S2.1 | `presetStore.ts`(팩토리 40개), `presets/normalize.ts`(신규), 기본 Mix | `presetStore.ts:101-103` `off()`/`on()`, `:129-366`; `normalize.ts` 없음; 불러오기 `normalizeImportedPreset` `:384` | 위치 다름 / 없음 | 부분 |
| S2.2 | `audio/params/`(신규), 각 페달 UI, `CompressorEffect.ts`(GR), `FuzzEffect.ts`(게이트), `ReverbEffect.ts`·`impulse.worker.ts`, `DelayEffect.ts`, `PresetPanel.tsx` | `src/audio/params/` 없음; 라벨은 각 `components/effects/*Pedal.tsx`에 문자열로 흩어짐; `CompressorEffect.ts`(59줄, 워클릿 사용), `getCompressorReduction` `AudioEngine.ts:437-440` | 없음 / 위치 다름 | 부분 |
| S2.3 | `i18n/ko.ts`·`engine/errors.ts`(신규), `AudioSession.start`, `ConnectGuitarPanel.tsx` | 오류 매핑은 `audioStore.ts:619-628` `toErrorMessage` | 없음 / 위치 다름 | 부분 |
| S2.4 | `types.ts`, `persistence/schema.ts`·`migrations/v1-to-v2.ts`(신규), `pedalStore.ts`, `presetStore.ts`, `BaseEffect.ts` 129행, `PedalCard.tsx` 150~160·320~330행, 단축키, MIDI, A/B, `vite.config.ts` | 단일 스위치 `PedalCard.tsx:313`; 마이그레이션 표 `pedalStore.ts:761-816`(10→11이 합침); 활성 조건 `BaseEffect.ts:129`; `persistence/` 없음, v2 키 없음, PWA 업데이트 배너 없음(`vite.config.ts:16,45-46`이 `autoUpdate`·`clientsClaim`·`skipWaiting`이라 새 버전이 조용히 바로 적용됨) | 위치 다름 / 없음 | 부분 |
| S2.5 | `MonitorService.ts`, `Meter.tsx`, 입력 패널, `ko.ts` | `ConnectGuitarPanel.tsx:48-66`, `Meter.tsx:102-113` | 위치 다름 | 부분 |
| S2.6 | `AudioEngine.ts` 148~225행, `ConnectGuitarPanel.tsx`, `FilePlayer.tsx`(신규), 단축키 | `AudioEngine.ts:226-306` `startFile`·`playUploadedFile`·`pauseUploadedFile`·`seekUploadedFile`, 반복 `:247`; 파일 UI는 `ConnectGuitarPanel.tsx:176-200` | 위치 다름 | 이미 구현 |
| S2.7 | `PresetPanel.tsx`, `presetStore.ts`, `exportFormat.ts`(신규) | `presetStore.ts` `exportPresets`·`importPresets`·`parsePresetJson`·`serializePresetPayload`; `PresetPanel.tsx:65-66,218,228` | 위치 다름 | 이미 구현(`exportFormat.ts` 없음) |
| S2.8 | `PresetPanel.tsx`, `pedalStore.ts`, `ConfirmDialog.tsx`(신규) | `window.confirm` 3곳 `PresetPanel.tsx:170,178,193` | 위치 다름 / 없음 | 부분 |
| S2.9 | `midi.ts` 115~150행 → `MidiService.ts`, `audioStore.ts` 259~262행, 학습 UI | `midi.ts:1-170` 전체(파싱 `:108-146`), `audioStore.ts:151-312` MIDI 런타임, `:187-237` 처리 | 위치 다름 | 이미 구현(서비스 분리만 남음) |
| S2.10 | `AudioEngine.ts` 472~482행 → `latency.ts`, `BaseEffect.ts`, `Meter.tsx` 262~287행, `noise-gate-processor.ts` 46~70행, `NoiseGateEffect.ts` 73~75행, `README.md` 103행 | `AudioEngine.ts:620-643` `readAudioGlitchCount`·`readLatency`, `Meter.tsx:283-301`, README `:111` | 위치 다름 | 부분 |
| S2.11 | `GlobalKeyboardShortcuts.tsx` → `input/ShortcutService.ts`, 도움말 | `keyboardShortcuts.ts:1-49`(명령 해석, 이미 분리), `GlobalKeyboardShortcuts.tsx:19-69`(실행), `ShortcutHelp.tsx`(도움말) | 위치 다름 | 이미 구현(`ShortcutService` 위치만 다름) |
| S2.12 | `tunings.ts` 80~120행, `tuner-processor.ts` 4행, 튜너 UI | `tunings.ts:81-133` `getPitchReading`, `tuner-processor.ts:4` 하한 28 Hz | 위치 다름 | 이미 구현 |
| S2.13 | `devices/DeviceManager.ts`(신규), `DeviceSelector.tsx`, `AudioSession.ts`, 저장 | `DeviceSelector.tsx`(76줄), `ConnectGuitarPanel.tsx:81`, `audioStore.ts:781-806,1215-1221`; `devices/` 없음 | 없음 / 위치 다름 | 부분 |
| S2.14 | `public/*` 아이콘, `vite.config.ts` 18~42행, `index.html`, `pwa-regression.mjs` 30~35행 | 아이콘 4종 있음, `vite.config.ts:17-45`, `index.html:12-15`, `pwa-regression.mjs:31-37` | 위치 다름 | 부분 |

### Phase 3 — 소리 품질

| Step | 설계서의 대상 | 실제 경로·함수·줄 | 위치 | 진행 |
|---|---|---|---|---|
| S3.1 | `DelayEffect.ts`, `ReverbEffect.ts`, `BaseEffect.ts` 53~62행 | `BaseEffect.ts:127-147` `applyRouting`(`:132`에서 `dry=1` 고정) | 위치 다름 | 이미 구현 |
| S3.2 | `cabinet.ts` 17~68행, `CabEffect.ts` 54~91행 | `cabinet.ts:16-90`(프로필·시드 난수), `CabEffect.ts:57-103` | 위치 다름 | 부분 |
| S3.3 | `DelayEffect.ts` 108~109행 | `DelayEffect.ts:108-109`(0.0002 s, 4.2 Hz) | 확인됨 | 이미 구현 |
| S3.4 | `FlangerEffect.ts`, `PhaserEffect.ts`, `flanger.worklet.ts`·`phaser.worklet.ts`, `loadWorklets`, 회귀 테스트 | `worklets/flanger-processor.ts`·`phaser-processor.ts`, `AudioEngine.ts:668-669`; 두 회귀 테스트는 동작 검증으로 교체됨(정규식 단언 0) | 위치 다름(이름 `*-processor`) | 이미 구현 |
| S3.5 | `curves.ts` 3~36행, `DriveEffect.ts`·`CrunchEffect.ts`, `DrivePedal.tsx` 78~86행 | `curves.ts:3-36` 그대로, `CrunchEffect.ts:59`, `DrivePedal.tsx:84` Bias | 확인됨 | 미착수 |
| S3.6 | `compressor.worklet.ts`, `CompressorEffect.ts`(전면 교체), `BaseEffect.ts`, 기능 플래그 | `worklets/compressor-processor.ts`(74줄), `CompressorEffect.ts`(59줄), 플래그 시스템 없음 | 위치 다름 / 없음 | 이미 구현(플래그만 없음) |
| S3.7 | `DriveEffect.ts`·`CrunchEffect.ts`·`FuzzEffect.ts` 오버샘플, `latency.json` | 세 곳 모두 `'2x'`(`DriveEffect.ts:18`, `CrunchEffect.ts:31`, `FuzzEffect.ts:30`) | 확인됨 | 이미 구현(프로브만 남음) |
| S3.8 | `compute-preset-trims.mjs`, `factoryTrims.json`, `docs/baseline/`, `docs/listening/` | 모두 없음(S1.4c 선행) | 없음 | 미착수 |

### Phase 4 — 품질과 정리

| Step | 설계서의 대상 | 실제 경로·함수·줄 | 위치 | 진행 |
|---|---|---|---|---|
| S4.1 | `public/logo.png`, `index.html` 11행, `PedalBoard.tsx` 83~90행, `vite.config.ts` | `public/logo.webp`(36 KB), `index.html:11`, `PedalBoard.tsx:22` | 위치 다름 | 이미 구현 |
| S4.2 | `BaseEffect.ts`, `ChorusEffect.ts` 134~146행, `noise-gate-processor.ts` 76~110행, 워클릿 `idle` | `noise-gate-processor.ts:93,106,109` 그대로(샘플마다 `log10`·`pow`·`exp`), 유휴 메시지 없음 | 확인됨 | 미착수 |
| S4.3 | `pedalStore.ts` 901~950행, `PedalCard.tsx`, `PedalBoard.tsx` | `pedalStore.ts:941-975`(`updatePedalParam`은 바뀐 것만 복제, 토글·바이패스는 전부 복제) | 위치 다름 | 부분 |
| S4.4 | `SliderControl.tsx` 48~57행 → `KnobControl.tsx`, `controls.css` 102~110행 | `SliderControl.tsx:1-41`, `useKnobDrag.ts`, `KnobNumberInput.tsx`, `controls.css:102-110` | 위치 다름 | 이미 구현 |
| S4.5 | `src/styles/*.css` 약 47곳, `PedalCard.tsx:162`, `ConnectGuitarPanel.tsx:89` | 54곳(0.44~0.68rem), `PedalCard.tsx:146` `role="group"`, `ConnectGuitarPanel.tsx:97` `<aside>` 중첩 | 위치 다름 | 미착수 |
| S4.6 | `ko.ts`, 영어 문구, 내부 이름 노출, `PedalBoard.tsx:96` | `ko.ts` 없음. 영어 라벨 다수(2.4절) | 없음 | 부분 |
| S4.7 | `scripts/*-regression.mjs` 정규식 단언, `pwa-regression.mjs`, 프로브·E2E | 정규식 단언 312곳(`regex-assertions.md`) | 위치 다름 | 부분 |
| S4.8 | Drive·Crunch UI·프리셋 이름, `cabinet.ts` 223~229행, `Source/`, `.gitignore`, `README.md` 118행 | `DrivePedal.tsx:15-16`, `presetStore.ts:218`, `CabPedal.tsx:15-19`, `README.md:130`; `Source/`에는 이미지가 없고 AI 기획 문서 3개만 남음(설계서 S4.8의 `git mv docs/planning/` 대상) | 위치 다름 | 부분 |
| S4.9 | `assets/`, `package.json`, `README.md`, `vite.config.ts` 73행, `__migration_check.ts` + `main.tsx` 10~14행, 문자열 워클릿 3개 | `assets/` 추적 2파일, `vite.config.ts:73`, `__migration_check.ts`(1,085줄), `main.tsx:10-14`, 문자열 워클릿은 8개로 늘었음(`worklets/*.ts`) | 위치 다름 | 미착수 |

### Phase 5 — 보완 기능

| Step | 설계서의 대상 | 실제 경로·함수·줄 | 위치 | 진행 |
|---|---|---|---|---|
| S5.1 | (WAV 녹음) | `recording.ts:50-94` `WavRecorder`, `audioStore.ts:411`(`finishActiveRecording`)·`:581,691-693`·`:1086`(시작)·`:1182`(정지) | 없음(대상 미지정) | 이미 구현(기본은 webm) |
| S5.2 | (MIDI 확장) | `midiAdvanced.ts:1-50`, `MidiAdvancedControls.tsx`, `audioStore.ts:181-185` | 없음(대상 미지정) | 이미 구현 |
| S5.3 | (실행 취소) | `historyStore.ts:1-88`, `HistoryControls.tsx`, `AppShell.tsx:2,92` | 없음(대상 미지정) | 이미 구현 |
| S5.4 | (IR 불러오기) | `cabinetIr.ts:1-63`, `AudioEngine.ts:376-424`, `CabEffect.ts:19,59-77`, `CabPedal.tsx` | 없음(대상 미지정) | 이미 구현 |
| S5.5 | (기준음 조정) | `AudioEngine.ts:493-497`, `tuner-processor.ts`, `audioStore.ts:744-755` | 없음(대상 미지정) | 이미 구현 |
| S5.6 | (화면 꺼짐 방지) | `SessionProtection.tsx:1-43`, `App.tsx:7` | 없음(대상 미지정) | 이미 구현 |

### 3.1 '없음'(설계서가 말하는 파일이 아직 없는 것) 목록

신규 파일 예정이라 정상인 것: `scripts/run-all-tests.mjs`, `.github/workflows/verify.yml`, `src/audio/testing/*`, `probe.html`, `scripts/audio-render-probe.mjs`, `docs/baseline/*`, `playwright.config.ts`, `e2e/*`,
`src/audio/engine/{AudioSession,InputStage,OutputStage,latency,errors}.ts`, `src/store/{sessionStore,monitorStore}.ts`, `src/audio/monitor/MonitorService.ts`, `src/audio/worklets/{output-guard,level-meter}` , `src/persistence/*`, `src/presets/{normalize.ts,factoryTrims.json}`, `src/audio/params/*`, `src/i18n/ko.ts`, `src/audio/devices/DeviceManager.ts`, `src/components/{Toast,ConfirmDialog,FilePlayer}.tsx`, `src/app/AppErrorBoundary.tsx`.

**설계서가 말한 기능·파일이 아예 사라진 곳은 없다.** 반대로 설계서에 없던 파일이 생겼다:
`peak-limiter-processor.ts`, `howl-guard-processor.ts`, `compressor-processor.ts`, `flanger-processor.ts`, `phaser-processor.ts`, `historyStore.ts`, `midiAdvanced.ts`, `cabinetIr.ts`, `SessionProtection.tsx`, `KnobNumberInput.tsx`, `useKnobDrag.ts`, `StorageNotice.tsx`.

## 4. 현황 (a~g)

### a. 저장 키 전부

`guitar-pedalboard:*` 접두사가 아닌 키가 하나 있다(`web-guitar-pedalboard-presets`). 키는 모두 `localStorage`다(`sessionStorage`·IndexedDB는 쓰지 않는다).

| 키 | 정의 위치 | 값 구조 | 예시 |
|---|---|---|---|
| `guitar-pedalboard:pedals` | `pedalStore.ts:5` | `{version, pedals:[{id, enabled, bypassed, params}]}` — 현재 `version` 11(`SCHEMA_VERSION`, `:7`), 300 ms 뒤 저장(`:339-348`)·`pagehide`에 즉시 저장 | `{"version":11,"pedals":[{"id":"noise-gate","enabled":true,"bypassed":false,"params":{"mix":100,"level":100,"thresholdDb":-54,…}}, …15개]}` |
| `web-guitar-pedalboard-presets` | `presetStore.ts:14` | `{version, exportedAt?, presets:[Preset]}`, `Preset = {id, name, libraryId?, libraryName?, description?, tags?, pedals:PedalState[], updatedAt}` — **사용자 프리셋만**(팩토리는 코드에 있음). 페달에 `type`·`name`·`color`까지 통째로 저장 | `픽스처 02·04` |
| `guitar-pedalboard:io` | `audioStore.ts:33` | `{inputGainDb(−24~24), masterVolume(0~1), howlProtectionEnabled, tuningReferenceHz(400~480)}`. **입력 채널 모드는 없음** | `{"inputGainDb":0,"masterVolume":0.9,"howlProtectionEnabled":true,"tuningReferenceHz":440}` |
| `guitar-pedalboard:output-device` | `audioStore.ts:34` | 문자열(출력 장치 id, 평문) | `"default"` |
| `guitar-pedalboard:midi` | `midi.ts:1` | `Record<페달id, {channel(1~16), cc\|note, value(0~127), mode?:'momentary'\|'toggle'}>` | `픽스처 06` |
| `guitar-pedalboard:midi-advanced` | `midiAdvanced.ts:1` | `{channel, volumeCc\|null, wahCc\|null, programs:{"0~127":프리셋id}}` | `{"channel":1,"volumeCc":null,"wahCc":null,"programs":{}}` |
| `guitar-pedalboard:preset-favorites` | `PresetPanel.tsx:13` | `string[]`(프리셋 id) | `["factory-clean-practice"]` |
| `guitar-pedalboard:preset-recents` | `PresetPanel.tsx:14` | `string[]`(프리셋 id) | `[]` |
| `guitar-pedalboard:mobile-audio-notice-dismissed` | `ConnectGuitarPanel.tsx:7` | 문자열 `"true"` | `"true"` |

> 템포(BPM)는 따로 저장하지 않고 `sync`가 켜진 템포 페달의 `bpm`에서 이어받는다(`audioStore.ts:488-497` `readInitialTempoBpm`).
> 설계서 D10의 `guitar-pedalboard:v2:*` 키는 **아직 없다**. 키 접두사가 한 곳만 다르므로(`web-guitar-pedalboard-presets`) v2 전환 때 함께 정리한다.

### b. `PedalState` 실제 타입

`src/audio/types.ts:193-200`

```ts
export interface PedalState extends Omit<Pedal, 'params'> {
  id: string;
  type: PedalType;       // 'noiseGate'|'compressor'|'autoWah'|'drive'|'crunch'|'fuzz'|'graphicEQ'|'eq'|'cab'|'chorus'|'flanger'|'phaser'|'tremolo'|'delay'|'reverb'
  name: string;
  enabled: boolean;      // 실제로는 항상 true(스키마 11이 고정). 저장 형식에는 남아 있음
  bypassed: boolean;     // 화면의 "효과" 스위치가 이 값을 움직인다(켜짐 = !bypassed)
  color: string;
  params: PedalParams;   // 이펙트별 인터페이스의 합집합(types.ts:176-191)
}
```

저장용 `StoredPedal`은 `{id, enabled, bypassed, params}`(`pedalStore.ts:9-14`)이고 `type`·`name`·`color`는 저장하지 않는다(불러올 때 `initialPedals`에서 채움 — `mergeStoredPedals`, `:855`).
공통 파라미터는 모든 이펙트에 `mix`·`level`(`BasePedalParams`, `types.ts:31-34`).

### c. 팩토리 프리셋 40개

- 정의: `src/store/presetStore.ts:129-366` `defaultPresets`(배열), 만드는 함수 `preset()`(`:118-127`)·`createPreset()`(`:76-99`), 도우미 `on()`·`off()`(`:101-105`), 공통 바탕 `baseTone`(`:107-116`).
- 구조: `PresetListItem = Preset & {isFactory?: boolean}`. 팩토리는 `id`가 `factory-…`, `updatedAt = 1767225600000` 고정, `pedals`는 `initialPedals` 15개를 복제한 뒤 프리셋이 지정한 페달의 `bypassed`·`params`만 덮어씀.
- 라이브러리 7개(`presetLibraries`, `:38-46`): essentials 8 · blues 5 · rock 6 · metal 5 · ambient 5 · fuzz 5 · utility 6 = 40.
- 사용자 프리셋은 같은 `Preset` 모양이고 `libraryId:'user'`, `tags:['user','custom']`.

### d. MIDI 매핑 저장 형식

`localStorage['guitar-pedalboard:midi']` = `Record<pedalId, MidiMapping>` (`midi.ts:3-18`)

```ts
type MidiMapping =
  | { channel: 1..16; cc: 0..127; value: 0..127; mode?: 'momentary' | 'toggle' }
  | { channel: 1..16; note: 0..127; value: 0..127; mode?: 'momentary' | 'toggle' };
```

- 검증: `validateMidiMappings`(`midi.ts:87-96`)가 키가 `__proto__` 등이면 버리고, 모양이 틀린 항목은 조용히 제외.
- 동작 대상: **효과 스위치**(`bypassed`). CC ≥ 64 또는 Note On(velocity > 0) = 켜짐(`midi.ts:127-134,137-144`). `toggle`이면 누를 때마다 뒤집음(`audioStore.ts:226-232`).
- 학습 중에는 확장 MIDI(프로그램 체인지·볼륨·와와)와 겹치는 신호를 거부(`audioStore.ts:189-192`).

### e. 단축키 1~9는 "체인 위치" 기준

`keyboardShortcuts.ts:30` `['Digit1'…'Digit9','Digit0','KeyQ','KeyW','KeyE','KeyR','KeyY']`의 **인덱스**가 `pedals[index]`(`GlobalKeyboardShortcuts.tsx:30-40`)로 들어간다. `pedals`는 사용자가 끌어서 바꾼 **현재 체인 순서**이므로 **위치 기준**이다. 즉 페달 순서를 바꾸면 같은 키가 다른 이펙트를 켠다(이펙트 종류 기준이 아님).
그 외: `Space` 입력 시작/정지(파일 모드면 재생/일시정지), `T` 탭 템포, `A`/`B` 슬롯, `Esc` Panic(도움말이 열려 있으면 도움말 닫기), `?` 도움말.

### f. 이펙트 15종의 기본 순서와 기본 상태

`pedalStore.ts:21-…` `initialPedals`. 실제 앱을 띄워 덤프한 값이다(`enabled`는 전부 `true`).

| # | id | type | 기본 | Mix | Level |
|---:|---|---|---|---:|---:|
| 1 | noise-gate | noiseGate | **켜짐** | 100 | 100 |
| 2 | compressor | compressor | **켜짐** | 75 | 100 |
| 3 | auto-wah | autoWah | 꺼짐 | 100 | 100 |
| 4 | drive | drive | **켜짐** | 88 | 95 |
| 5 | crunch | crunch | 꺼짐 | 85 | 90 |
| 6 | fuzz | fuzz | 꺼짐 | 90 | 90 |
| 7 | graphic-eq | graphicEQ | 꺼짐 | 100 | 100 |
| 8 | eq | eq | **켜짐** | 100 | 100 |
| 9 | cab | cab | **켜짐** | 100 | 100 |
| 10 | chorus | chorus | 꺼짐 | 35 | 100 |
| 11 | flanger | flanger | 꺼짐 | 35 | 100 |
| 12 | phaser | phaser | 꺼짐 | 45 | 100 |
| 13 | tremolo | tremolo | 꺼짐 | 100 | 100 |
| 14 | delay | delay | 꺼짐 | 30 | 100 |
| 15 | reverb | reverb | 꺼짐 | 25 | 100 |

켜짐 5개(Noise Gate·Compressor·Drive·EQ·Cab) = 화면의 켜진 LED 5개와 같다(설계서 E-08 기준 충족).

### g. Compressor 파라미터

`CompressorParams`(`types.ts:45-52`) + 화면 범위(`CompressorPedal.tsx`). 기본값은 `pedalStore.ts:40-56`.

| 키 | 화면 라벨 | 범위(step) | 기본 |
|---|---|---|---:|
| `threshold` | Threshold | −60 ~ −10 dB (1) | −24 |
| `ratio` | Ratio | 1 ~ 20 (0.5) | 4 |
| `attack` | Attack | 0.001 ~ 0.1 s (0.001) | 0.006 |
| `release` | Release | 0.05 ~ 1 s (0.01) | 0.18 |
| `knee` | Knee | 0 ~ 40 dB (1) | 18 |
| `sustain` | Sustain | 0 ~ 100 % (1) | 35 |
| `mix` | Mix | 0 ~ 100 % (1) | 75 |
| `level` | Level | 0 ~ 100 % (1) | 100 |

> 설계서가 예로 든 `Tone`은 없다. `Sustain`이 어떤 양을 움직이는지는 `CompressorEffect.ts`·`compressor-processor.ts`를 S2.2에서 읽어 확정한다.

## 5. 테스트 현황

`scripts/`에는 24개 파일이 있다. `npm test`는 이 중 23개(`cabinet-response-analysis.mjs` 포함, `responsive-a11y-regression.mjs` 제외)를 `&&`로 잇고(`package.json:28`), 반응형 테스트는 `npm run test:responsive-a11y`로 따로 돈다. 기준 커밋에는 14개였다. 이 샌드박스에서 `npm test` 15.0초, 반응형 5.2초, 모두 통과(7절).

### 5.1 동작 검증 / 소스 문자열 검사 분류

"동작 검증" = esbuild로 `src/`를 번들해 실제로 실행하거나 워클릿 프로세서를 시뮬레이션해 수치를 단언. "소스 문자열 검사" = `assert.match(소스, 정규식)`.

| 분류 | 스크립트 | 정규식 단언 |
|---|---|---:|
| **동작 검증 중심** | cabinet-ir, cabinet-response-analysis, compressor-phase, dsp-safety, flanger, phaser, history, howl-guard, knob, latency, output-device, tuner | 0 |
| 동작 검증 중심(소수 문자열) | peak-limiter | 3 |
| **혼합**(동작 + 문자열) | auto-wah 29, chorus 17, graphic-eq 31, midi 22, preset-ab 23, recording 31, shortcuts 31, tap-tempo 14, tremolo 16 | 214 |
| **문자열 중심** | pwa(빌드 결과 문자열) 4, responsive-a11y(소스 + 실제 Chrome 측정) 91 | 95 |
| 합계 | 24개 파일 | **312** |

※ 분류는 스크립트마다 `esbuild`로 `src/`를 번들해 실행하는지, 소스 텍스트를 읽는지, 어떤 단언을 쓰는지 훑은 것이다. 정규식 단언이 0이어도 `knob`(`includes` 4곳)·`output-device`·`howl-guard`·`tuner`(소스 텍스트 읽기 1~3곳)처럼 문자열 확인이 조금 섞인 것이 있다. S4.7에서 파일 단위로 다시 확정한다.

### 5.2 정규식 단언 합계: 보고서 337곳 vs 현재 312곳

- 보고서의 337은 기준 커밋에서 `assert.match(` 316 + `assert.doesNotMatch(` 21을 센 값과 **정확히 같다**.
- 현재는 `assert.match(` 293 + `assert.doesNotMatch(` 19 = **312곳**. 25곳 줄었다.
- 줄어든 이유: `flanger-regression.mjs`(27 → 0)와 `phaser-regression.mjs`(20 → 0)가 워클릿 시뮬레이션 기반 동작 검증으로 다시 쓰였다(−47). 그사이 `midi`(+3)·`preset-ab`(+4)·`recording`(+7)·`responsive-a11y`(+5)·`peak-limiter`(+3)에서 새 기능에 대한 문자열 단언이 늘어(+22) 순감소는 25다.
- 파일·줄 단위 목록: [`regex-assertions.md`](./regex-assertions.md) (`tools/list-regex-assertions.mjs`로 재생성).

### 5.3 CI

`.github/workflows/deploy.yml`은 `main` push에서만 돈다. 순서(Node 22, `deploy.yml:28`): `npm ci` → `npm run build` → `npm run lint` + `npm test` + `npm run test:responsive-a11y` → Pages 아티팩트 업로드 → 배포.
→ 배포 전 게이트는 이미 있다. **PR·브랜치에서는 아무것도 돌지 않는다**(S0.2가 `verify.yml`로 채운다).

## 6. 제품·브랜드를 떠올리게 하는 표현 (D3 검토용 — 판단하지 않음)

| 위치 | 표현 | 비고 |
|---|---|---|
| `presetStore.ts:218` | 프리셋 이름 **Plexi Lead** | 설명문에는 제품명 없음 |
| `presetStore.ts` (rock) | 프리셋 이름 **British Crunch**, Classic Rock | 일반 장르어일 수 있음 |
| `DrivePedal.tsx:15-16` | 프리셋 버튼 **TS Clean**, **TS Boost** | 설계서가 'TS-9'로 적은 곳의 현재 표현 |
| `CabPedal.tsx:15-19` | 화면 라벨 Modern 4×12 · Vintage 4×12 · Blue 1×12 · American 1×12 · **Tweed 1×10** | 화면은 이미 일반명, `Blue`·`Tweed`만 남음 |
| `types.ts:109-113`, `pedalStore.ts:175`, `cabinet.ts:17-53` | 저장되는 모델 id `v30-4x12`·`greenback-4x12`·`jensen-1x12`·`tweed-1x10`(`blue-1x12`) | **저장값이라 이름을 바꾸면 v2 마이그레이션 필요**(S4.8과 S2.4 조율) |
| `FuzzPedal.tsx` | Fuzz 모드 이름 `Velcro` | 일반어 가능성 |
| 프리셋 40개 이름 | Texas Push, Chicago Blues, Delta Slap(지명), Vintage Fuzz, Djent Gate, Liquid Metal Lead, Gated Velcro 등 | 제품명 아님(지명·장르어) |

`Source/`의 참고 이미지는 현재 트리에서 제거됨(`README.md:130`). 옛 Git 기록에는 남아 있다(D8: `filter-repo` 하지 않음). 지금 `Source/`에 남은 것은 AI 대화·기획 문서 3개(`Guitar Pedalboard(Chat_GPT).md`, `…(Claude).md`, `…(Gemini).md`, 합계 약 100 KB)이며 Git이 추적한다.
설계서가 지적한 'TS-9'·'Tube Screamer'·'Crunch Box' 문자열은 `src/`·`README.md`·`TESTING.md`·`index.html`에서 검색되지 않는다. Tube Screamer·Marshall·Fender·Vox·Boss·Ibanez·Big Muff·Celestion 등 제품명을 직접 쓴 곳도 없다. 남은 것은 위 표의 `TS`·`Plexi`뿐이다.

## 7. 측정 방법과 검산

### 측정 방법

- 빌드 기준선: `npm ci` → typecheck 4.0 s, lint 3.1 s, build 8.7 s, `npm test` 15.0 s(23개 모두 통과), `npm run test:responsive-a11y` 5.2 s(통과) — 2026-11-23 이 샌드박스에서 측정.
- 실제 화면·저장 측정은 로컬 Chrome(헤드리스)을 CDP로 띄워 개발 서버(`vite`)에 붙여 했다: 저장소 차단 3경우, 화면 8종(390×844·360×640·412×915·768×1024·1024×768·1280×720·1366×768·1440×900)에서 스위치 가림·가로 넘침·글자 겹침, 도크 펼침, Fuzz 카드 스크린샷. 측정 스크립트는 저장소 밖 작업 폴더에 있었고, 이후 Step에서 S0.4(E2E 하네스)가 같은 일을 하도록 만든다.
- 픽스처 6종은 **실제 앱이 쓴 localStorage 덤프**를 바탕으로 만들고(01), 나머지는 그 덤프를 프로그램으로 변형했다(02·04·05), 03은 덤프 문자열을 잘라 만들었고 06은 `midi.ts` 형식을 코드에서 읽어 직접 만들었다. 6종 모두 실제 앱에 넣어 흰 화면 없이 뜨는지 확인했다(`e2e/fixtures/storage-v1/README.md`).

### 검산

판정 열과 진행 열을 아래 명령으로 센 값이 1절과 같다. 이 문서를 고칠 때마다 다시 돌린다.

```bash
# 보고서 44항목 — 판정 열 (해결 21 · 부분 20 · 미해결 3 · 합계 44)
awk -F'|' '/^\| (R[1-4]-[0-9]+|RX-[0-9]+) / {gsub(/ /,"",$3); n[$3]++; t++} END {for (k in n) print k, n[k]; print "합계", t}' docs/refactoring/code-map.md

# Step 51개 — 진행 열(마지막 칸) (이미 구현 20 · 부분 21 · 미착수 9 · 이 Step 1)
awk -F'|' '/^\| S[0-9]+\.[0-9]+[abc]? / {s=$(NF-1); gsub(/^ +/,"",s); k=(index(s,"이미 구현")==1)?"이미구현":(index(s,"부분")==1)?"부분":(index(s,"미착수")==1)?"미착수":(index(s,"이 Step")==1)?"이Step":"기타"; n[k]++; t++} END {for (k in n) print k, n[k]; print "합계", t}' docs/refactoring/code-map.md
```

인용한 `파일:줄`이 실제 파일의 줄 범위 안에 있는지는 별도 스크립트로 확인했다(인용 168건). 줄 범위 안이라는 것과 내용이 맞다는 것은 다르므로, 이 문서의 줄 번호는 코드를 열어 대조해서 고쳤다(고친 곳은 `docs/REFACTOR_LOG.md`의 L-3).

### 저장 호출 지점 (S1.7 대상)

`localStorage`를 읽고 쓰는 곳은 7개 파일 16곳이다(`sessionStorage`·IndexedDB·`removeItem`은 쓰지 않는다). `isStorageAvailable` 같은 접근 가능 확인 함수가 `pedalStore.ts:309`, `presetStore.ts:369`, `PresetPanel.tsx:24`에 세 번 복제돼 있다.

| 파일 | 읽기 | 쓰기 | 키 |
|---|---|---|---|
| `store/pedalStore.ts` | 846 | 333 | `guitar-pedalboard:pedals` |
| `store/presetStore.ts` | 436 | 447 | `web-guitar-pedalboard-presets` |
| `store/audioStore.ts` | 36 · 76 · 163 | 113 · 173 · 802 | output-device · io · midi |
| `audio/midiAdvanced.ts` | 25 | — | midi-advanced |
| `components/MidiAdvancedControls.tsx` | — | 28 | midi-advanced |
| `components/PresetPanel.tsx` | 31 | 41 | preset-favorites · preset-recents |
| `components/ConnectGuitarPanel.tsx` | 13 | 88 | mobile-audio-notice-dismissed |

## 8. 설계서를 고쳐야 할 점

1. **기준 커밋을 `2a5ab81`로 바꾼다.** 설계서의 "현재" 서술과 줄 번호가 거의 모두 어긋난다. 이 문서의 3절로 대체한다.
2. **2.1절(결정)에 "이미 구현된 Step은 검증으로 줄인다" 원칙을 넣는다.** 44항목 중 21개가 해결, 20개가 부분, 3개가 미해결이다. Step 51개 중 20개는 이미 구현, 21개는 부분 구현, 9개만 미착수다(1절).
3. **진행 열이 "이미 구현"인 Step**(S1.1, S1.6, S2.6, S2.7, S2.9, S2.11, S2.12, S3.1, S3.3, S3.4, S3.6, S3.7, S4.1, S4.4, S5.1~S5.6)은 "신규 구현"이 아니라 "프로브·시나리오로 확인 + 남은 틈 메우기"로 바꾼다.
4. **S2.4 재설계.** On/Off·Bypass 통합이 이미 단일 스위치 + 스키마 11로 들어와 있다. `active`로 이름을 바꾸는 대신 ① v2 키(`guitar-pedalboard:v2:*`)와 백업 ② 다중 탭 감지 ③ 서비스 워커 업데이트 처리에 집중한다. 서비스 워커가 `autoUpdate`+`skipWaiting`이라 새 버전이 조용히 바로 적용되므로(`vite.config.ts:16,45-46`), 설계서의 "업데이트 배너"는 이 동작에 맞춰 다시 정한다. `enabled`는 읽기 전용 잔여 필드로 두고 v2에서 뺀다.
5. **S1.4a**의 리미터가 이미 있다. 천장은 설계서와 같다(0.89 ≈ −1.0 dBFS). `limiter.worklet.ts`(신규) 대신 기존 `peak-limiter-processor.ts`를 `OutputStage`로 옮기고 다른 점만 바꾼다: 룩어헤드 없음 → 1 ms, 릴리즈 50 ms → 80 ms, 감소량 계산 뒤 한 번 더 자르는 안전 클립(설계서 GS-6).
6. **S1.5**의 하울링 감지는 이미 워클릿이지만 출력 쪽·−22 dBFS(RMS 0.08) 기준이다. 설계서의 "입력 쪽, −50 dBFS, ±20 cents" 방식으로 **교체**한다.
7. **D13(`Shift+1~6`)을 "현재 키 유지"로 바꾼다.** 10~15번째 페달은 이미 `0 Q W E R Y`로 구현·시험돼 있다(`keyboardShortcuts.ts:30`, `shortcuts-regression.mjs`). 설계서대로 바꾸면 사용자 습관과 시험 31곳이 깨지고 얻는 것이 없다. 편차로 기록한다(L-4).
8. **저장 키 정리 범위를 넓힌다.** 접두사가 다른 `web-guitar-pedalboard-presets`가 있고, `io`에 입력 채널 모드가 없다(S1.3이 새 필드를 추가해야 한다).
9. **S4.9의 문자열 워클릿 3개**는 이제 8개다. `worklets/*.ts`가 `String.raw` 템플릿으로 소스를 내보내는 구조 자체를 한 번에 바꿀지 결정이 필요하다.
10. **보고서 337곳**은 `assert.match`+`doesNotMatch` 합이다(현재 312). S4.7의 종료 기준을 "0"이 아니라 "동작 검증으로 대체되지 못한 것만 목록으로 남김"으로 두는 편이 현실적이다(예: PWA 매니페스트 문자열).
11. 설계서 S1.6이 말한 "탭 맨 앞에 '페달' 추가·`--dock-h`"는 현재의 접이식 도크(기본 접힘)가 이미 같은 목적을 이룬다. 요구를 **E-04 시나리오 통과**로만 남긴다.
12. **S2.8**의 수용 기준 "묻지 않고 덮어쓰는 경로 0개"에 가져오기(`importPresets`, `presetStore.ts:544-562`)가 걸린다. 가져오기도 같은 확인 절차를 거치게 한다.
13. **S4.8**: `Source/`의 이미지는 이미 없다. 남은 일은 AI 기획 문서 3개를 `docs/planning/`으로 `git mv`하고 `.gitignore`에 `Source/`를 넣는 것이다. 'TS-9'·'Tube Screamer'·'Crunch Box' 표기는 이미 없고 'TS Clean'·'TS Boost'·'Plexi Lead'가 남았다(6절).
14. **S0.2**: `esbuild`는 이미 devDependencies에 있다. 실제로 남은 일은 ① `npm test`가 `responsive-a11y`를 빼고 돈다는 점(한 명령으로 24개) ② `engines` ③ PR·`phase/*`용 `verify.yml` ④ CI에서 Chrome이 없으면 건너뛰지 않고 실패하게 하기다. `deploy.yml`은 이미 빌드·lint·test·반응형 검사를 배포 앞에 둔다.
