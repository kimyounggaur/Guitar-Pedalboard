# 브라우저 시나리오(E2E) 기준선

실제 Chrome 에서 앱을 열어 화면 배치·도달성·시작 동작을 재는 시험이다(설계서 6.3절). 오디오 렌더 프로브(`README.md`)가 '소리'를 재듯, 이쪽은 '화면에서 손이 닿는지'를 잰다.

| 파일 | 내용 |
|---|---|
| `e2e.json` | 기록 모드 시험(E-04·E-06)의 기준 측정값. 화면 프로필 × 조건별로 한 덩어리 |
| `screenshots/` | 지금 상태를 눈으로 보기 위한 대표 스크린샷 4장(휴대폰 390×844 도크 접힘·펼침, 노트북 1280×800·1024×768 패널 펼침). 비교에는 쓰지 않는다 |

## 쓰는 법

```bash
npm run build                         # 시험은 빌드 결과(dist/)를 vite preview 로 서비스한다
npm run e2e                           # 빌드까지 알아서 한다. 전체 32개, 약 1분 30초
E2E_SKIP_BUILD=1 npm run e2e          # dist/ 가 이미 있을 때(CI 는 앞 단계에서 빌드해 이렇게 돌린다)
npm run e2e -- --grep "E-23"          # 일부만
npm run e2e -- --grep "@record"       # 기록 모드만
E2E_UPDATE_BASELINE=1 npm run e2e     # 기준선(e2e.json)과 대표 스크린샷 갱신 (의도한 변화일 때만)
```

| 환경 변수 | 뜻 |
|---|---|
| `E2E_SKIP_BUILD=1` | `npm run build` 를 건너뛰고 있는 `dist/` 를 쓴다 |
| `E2E_UPDATE_BASELINE=1` | 기록 모드가 잰 값을 `docs/baseline/e2e.json` 에 병합하고 대표 스크린샷을 `screenshots/` 로 복사한다 |
| `E2E_CHROME_PATH` | 시험에 쓸 Chrome 실행 파일. 없으면 Playwright 가 받은 Chromium(`npx playwright install chromium`)을 쓴다. `CHROME_PATH`(반응형 시험·프로브가 쓰는 변수)와는 일부러 분리했다 |

- 기준선을 갱신하는 커밋의 메시지는 `baseline: {Step ID} {이유}` 로 쓴다. 이유 없이 갱신하지 않는다.
- 시험 결과(`test-results/`)와 보고서(`playwright-report/`)는 git 에 넣지 않는다. CI 에서 실패하면 두 폴더를 `e2e-report` 이름으로 올린다(7일 보관).
- 가짜 마이크용 WAV 는 `node scripts/make-fixture-wavs.mjs` 가 `e2e/fixtures/*.wav` 로 만든다(git 제외). `e2e/global-setup.ts` 가 없으면 만든다.

## 하네스 구성

- 설정: `playwright.config.ts` — 작업자 1개, 데스크톱 Chrome 프로필, 마이크 권한 허용, `vite preview` 를 웹 서버로 띄움(`http://127.0.0.1:4173/Guitar-Pedalboard/`).
- 가짜 마이크: Chrome 인자 `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture=<WAV>`. WAV 는 브라우저를 띄울 때만 정할 수 있어서 `launchWithMic(wav)` 픽스처가 WAV 마다 브라우저를 새로 띄운다.
- 도우미(`e2e/helpers/`): `geometry.ts`(도달성·노출 비율·글자 겹침), `mocks.ts`(저장소 차단·가득 참, Web MIDI, 문서 숨김, `getUserMedia` 오류 7종, `AudioContext` 추적), `screens.ts`(화면 프로필 10종), `app.ts`(앱 조작), `switches.ts`(스위치 15개 측정), `record.ts`(기록 모드).
- 도우미 자체의 시험은 `e00-harness.spec.ts`(10개). 가려진 요소를 정말 '도달 불가'로 가려내는지, 겹친 글자를 세는지, 모의가 이름 그대로 동작하는지를 확인한다.
- 타입: `tsconfig.e2e.json` 이 `e2e/` 와 `playwright.config.ts` 를 검사한다. `@types/node` 는 앱의 `setTimeout` 반환형을 바꿔 `AutoWahEffect.ts` 를 깨뜨려서 넣지 않고, 쓰는 Node API 만 `e2e/types/node-shim.d.ts` 에 직접 선언했다.

## 기록 모드(`@record`)

E-04(휴대폰 도달성)·E-06(데스크톱 배치)은 **지금 결과가 나쁜 것이 정상**이다. 그래서 `expect` 로 통과·실패를 가르지 않고 값만 `test-results/measurements/` 에 쓰고, 끝날 때 요약을 찍는다. S1.6·S1.8 에서 같은 시험을 정식 단언(모두 도달, 겹침 0)으로 바꾼다. 그때까지는 기준선이 '고치기 전' 값을 지키는 역할이다.

값마다 **있는 그대로(`asIs`)** 와 **투명 입력을 걷어 낸 경우(`withoutFaderOverlay`)** 를 같이 적는다. 둘이 다른 이유는 아래 F-1 이다.

## 지금 기준선 (Chrome/153, 프로덕션 빌드)

같은 코드로 두 번 돌려 `e2e.json` 이 글자 하나 다르지 않음을 확인했다.

### E-04 휴대폰 — 15개 페달 스위치 도달

세 화면(390×844, 360×640, 412×915)의 결과가 같다.

| 도크 | 있는 그대로 | 가린 것 | 투명 입력 제외 시 |
|---|---|---|---|
| 접힘 | **0/15** | `input.knob-number-input` ×15 | 15/15 |
| 펼침 | **0/15** | 도크의 `span` ×15 | 0/15 |

### E-06 데스크톱 — 글자 겹침·스위치 도달·가로 넘침

| 화면 | 겹침(패널 펼침 / 접힘) | 스위치 도달 | 투명 입력 제외 시 | 가로 넘침 |
|---|---|---|---|---|
| 768×1024 | 6 / 6 | 0/15 | 15/15 | 0 px |
| 1024×768 | 7 / 7 | 0/15 | 15/15 | 0 px |
| 1280×800 | 6 / 6 | 0/15 | 15/15 | 0 px |
| 1366×768 | 6 / 7 | 0/15 | 15/15 | 0 px |
| 1440×900 | 5 / 6 | 0/15 | 15/15 | 0 px |
| 1536×864 | 7 / 6 | 0/15 | 15/15 | 0 px |
| 1920×1080 | 6 / 7 | 0/15 | 15/15 | 0 px |

겹침은 어느 화면이든 **Compressor·Crunch·Fuzz·EQ 카드 4개**에서 난다(Fuzz 가 가장 많다). 예: Fuzz 의 `90%` 와 `← OUT PUT` 이 12×9 px, `Classic` 과 `Fuzz` 가 38×14 px 겹침. Compressor·EQ·Crunch 는 2~3 px 높이 겹침(줄 간격이 빡빡한 글자 상자)이라 눈으로 겹쳐 보이는 정도는 Fuzz 가 가장 크다.

### 보고서 수치와 견주기 (설계서 6.3절 수용 기준)

| 항목 | 보고서 | 지금 기준선 | 판정 |
|---|---|---|---|
| 휴대폰 스위치 도달(E-04) | 0% | 0% | **같은 방향.** 다만 원인이 다르다(아래 F-1) |
| 1280 px 글자 겹침(E-06) | 45곳 | 6곳 | **같은 방향(0 초과)이지만 수치는 다르다.** 보고서 이후 CSS 가 좋아졌거나 센 방법이 다르다(보고서의 계수 방식은 알 수 없다). 지금 방식은 '같은 카드 안에서 서로 다른 글자 상자가 가로·세로로 2 px 이상 겹친 쌍'을 센다 |
| 1280 px 스위치 노출(E-06) | 0% | 0% | **같다.** 원인은 F-1 |
| 1536 px 이상 겹침 0·스위치 100% | 1680 px 이상 0곳 | 1920 px 에서도 6~7곳, 스위치 0% | **보고서와 다르다.** F-1 이 큰 화면까지 스위치를 막고 있다 |

## F-1 — 새로 발견한 결함 (설계서에 없음)

**Graphic EQ 의 숫자 입력이 투명한 전체 세로 막대가 되어 주 화면의 마우스·터치를 가로챈다.**

- 원인: `src/styles/pedals.css` 의 `.vertical-fader input { position: absolute; z-index: 3; inset: 0; width: 100%; height: 100%; opacity: 0; … }`. 이 선택자가 페이더의 슬라이더뿐 아니라 숫자 입력 `input.knob-number-input` 까지 잡는다. 그런데 바깥쪽 `.vertical-fader` 에는 `position` 이 없어 `inset: 0` 이 가까운 위치 기준 조상(화면 전체 열)을 기준으로 퍼진다.
- 결과: 15개 페달 스위치가 전부 이 투명 입력 15개에 가려진다. 실제 `page.mouse.click` 으로도 연결 버튼 클릭이 이 입력에 가로채인다(키보드 Enter 는 동작). E-04 접힘의 '있는 그대로 0/15 → 투명 입력 제외 시 15/15' 가 그 증거다.
- 들어온 시점: 설계서 기준 커밋 `4ac9cf7` 이후(커밋 `39bac60`, PR #1 병합). 배포된 앱에도 있을 가능성이 높다 — **사람이 배포 사이트에서 확인해야 한다.**
- 하네스 쪽 대응: `connectGuitar` 는 마우스 클릭 대신 버튼에 포커스를 두고 Enter 를 누른다. 그러지 않으면 시험이 앱을 켜지도 못한다. 이 우회는 S1.6 의 수정이 들어가면 지운다.
- 고칠 곳: S1.6(휴대폰 도달성). `.vertical-fader-rail input` 처럼 범위를 좁히는 수정을 **따로 떼어 낼 수 있는 커밋**으로 넣는다.

## 아직 사람이 확인해야 하는 것

- 위 F-1 이 실제 배포 사이트(GitHub Pages)에서도 일어나는지 — 휴대폰과 노트북에서 페달 스위치를 직접 눌러 본다.
- 대표 스크린샷 4장이 실제 화면과 같은지(Chrome 헤드리스와 기기 브라우저는 글꼴·여백이 조금 다를 수 있다).
- E-06 의 '글자 겹침' 수는 이 하네스의 정의에 따른 값이다. 2~3 px 겹침까지 문제로 볼지(Compressor·EQ·Crunch)는 S1.8 에서 정하며, 그때 눈으로 본 결과와 함께 판단한다.
- GitHub Actions 에서 실제로 돌려 본 적이 없다. 처음 PR 을 올릴 때 `Install Playwright Chromium` 단계가 CI 러너에서 통과하는지 확인한다.
