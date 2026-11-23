# 리팩토링 작업 기록 (REFACTOR_LOG)

설계서(`docs/refactoring-design.md`)와 Step 지시문(`docs/prompts/phase-0-1.md`)을 실제로 실행하면서
**설계서와 달라진 점**과 **스스로 내린 판단**을 남기는 파일이다. Step마다 아래에 항목을 덧붙인다.

## 작업 방식 (자율 승인 모드)

- 사용자 요청: "설계 내용 그대로 단계적으로, 물어보지 말고 스스로 승인하면서 개발".
- 구현 계획 승인·'멈추고 물어볼 조건' 판단은 작업자(Claude)가 설계서 기본 가정으로 결정한다.
- 결정 D1~D16은 설계서 2장 기본값을 그대로 따른다(변경 없음).
- Step마다 브랜치 1개(`refactor/sN-M-…`)를 만들고, Phase 통합 브랜치(`phase/N`)에 모은다.
- **main에 병합하지 않고 배포하지 않는다.** main에 병합하면 GitHub Pages가 바로 배포되고,
  설계서에는 사람이 직접 해야 하는 확인(귀로 듣기·실제 기기)이 있기 때문이다.
- 사람이 해야 하는 확인(청취, 실기기, 브랜치 보호 규칙 설정, 배포)은 각 Step 끝에 '사람 확인 필요'로 남긴다.

## 편차 기록

| # | Step | 설계서·지시문 | 실제 | 이유 |
|---|---|---|---|---|
| L-1 | 준비 | 설계서·지시문을 **main**에 커밋(지시문 0.1-1) | `phase/0` 브랜치 첫 커밋으로 넣음 | main 병합은 곧 Pages 배포. 사람 검토 전에 main을 건드리지 않기 위해 |
| L-2 | 전체 | 기준 커밋 `4ac9cf7` | 실제 HEAD는 `2a5ab81`(2026-11-13), 기준 이후 8커밋·136파일 변경 | 저장소가 설계서 작성 이후 앞서 나감(Codex PR #1 병합 포함). S0.1에서 항목별로 대조 |
| L-3 | S0.1 | 설계서·초안의 줄 번호와 "현재" 서술은 기준 커밋 `4ac9cf7` 기준 | 코드 지도의 `파일:줄` 인용 168건을 현재 코드(`2a5ab81`)를 열어 내용으로 대조하고, 스크립트 치환 74곳과 손으로 고친 몇 곳을 바로잡음. 판정 집계는 해결 21·부분 20·미해결 3(합 44). 판정 3건(R2-7·R2-10·R2-14)은 '부분'으로 바꿈 | 줄 범위 안인지만 보면 틀린 줄이 남는다(예: `PedalCard.tsx` 311→313, `tuner-processor.ts` 3→4). 머리말 집계도 표에서 다시 세어 고침(20/18/6 → 21/20/3). `npm test`가 `responsive-a11y`를 뺀다는 점, localStorage 호출이 7개 파일 16곳이라는 점도 이때 바로잡음 |
| L-4 | S2.11 (D13) | 10~15번째 페달 단축키 `Shift + 1~6` | **현재 키 `0 Q W E R Y` 유지** | 이미 구현돼 있고(`keyboardShortcuts.ts:30`) `shortcuts-regression.mjs`가 31곳으로 지킨다. 바꾸면 사용자 습관과 시험이 깨지는데 얻는 것이 없다. D13 기본값을 바꾸는 것이므로 편차로 남긴다 |
| L-5 | S0.2 | ① 시험 순서 typecheck → lint → test → build ② esbuild를 devDependencies에 추가 ③ 시험 14개 ④ `verify.yml`: PR과 main 공통 | ① **typecheck → lint → build → test**(`test:pwa`가 `dist/`를 읽으므로 빌드가 먼저. `deploy.yml`도 원래 이 순서) ② 이미 들어 있어 추가 없음 ③ **24개**(`responsive-a11y` 포함 — 예전 `npm test`는 이것만 빼고 돌았다) ④ 트리거는 PR(모든 브랜치)·`phase/**` push·수동 실행, **main push는 뺌**(main에서는 `deploy.yml`이 같은 검사를 배포 앞에서 하므로 중복 방지) | 코드 지도 14번: 현재 저장소가 설계서 작성 시점보다 앞서 있음. 그 밖의 추가: 깨끗한 체크아웃에서 `npm test`가 `dist/` 없어 실패하므로 러너가 `dist/`가 없으면 먼저 빌드함 · CI에서 `CHROME_PATH`가 틀리면 다른 Chrome으로 넘어가지 않고 실패 · `CI=false`/`0`은 CI로 보지 않음 · 통과한 시험이 남긴 '건너뜀' 경고를 요약에 다시 보여 줌 · `actionlint`는 설치가 막혀 돌리지 못함(YAML 문법만 확인) |
| L-6 | S0.3 | 수용 기준: 기록값이 보고서의 현상과 같은 방향 — P-01 잡음 증폭 큼, P-04 약 15 dB, P-05 폭 약 27 dB, P-15 −3 dB, P-11 약 4.7 ms | **일부만 성립.** 지금 코드(HEAD `2a5ab81`)에서는 P-01 차 62 dB(보고서 10 dB), P-04 기본 −0.16 dB, P-15 0 dB, P-11 2.02 ms 로 이미 고쳐져 있다. P-05 폭은 21.5 dB(보고서 27)로 여전히 크다. 기준선은 **지금 코드의 실측값**으로 기록하고 보고서와의 비교표를 `docs/baseline/README.md` 에 남김 | 보고서가 쓰인 뒤 코드가 앞서 갔다(L-2). 기준선을 보고서 값에 맞추려고 코드를 되돌리거나 값을 꾸밀 수 없다. 프로브가 틀린 것이 아님은 P-06·P-12·P-13·P-16 처럼 아직 열린 항목이 방향대로 나오는 것으로 확인. **코드 지도가 '구현됨'으로 분류한 Step 중 README 표의 ✖ 에 걸리는 것은 그 Step 을 시작할 때 다시 대조한다** |
| L-7 | S0.3 | 파일 구성: `src/audio/testing/renderProbe.ts`·`signals.ts` | `src/audio/offline/{workletModules,effectFactory,renderChain}.ts`(체인 렌더) + `src/audio/testing/{signals,measure,probes,nodeCounter,probePage}.ts`(신호·측정·프로브 정의·노드 세기·페이지). 러너는 `scripts/audio-render-probe.mjs`, Chrome 실행은 `scripts/lib/chrome.mjs` 재사용 | 체인을 앱 코드(`offline/`)와 시험 전용 코드(`testing/`)로 나누면 프로브 정의가 길어져도 렌더 하네스가 흩어지지 않는다. `vite --mode test` 는 `probe.html` **만** 입력으로 삼고(`base '/'`, PWA 끔) 러너가 직접 `dist-probe/` 로 빌드하므로 CI 에 별도 `build --mode test` 단계가 필요 없다 |
| L-8 | S0.3 | 프로브마다 설계서 6.2절 입력 그대로 렌더 | **P-05**: 꺼진 페달을 체인에서 뺀 채 렌더(샘플레이트당 76초 → 35초). 첫 프리셋을 15개 전체로 한 번 더 렌더해 차이 신호가 −200 dB 임을 `bypassTransparent` 로 기록. **P-18**: 꺼진 페달을 혼자 켠 체인과 빈 체인을 견주고(같은 값은 한 번만 렌더, 368개 → 14번), 설계서의 "프리셋 전체 체인" 방식은 쓰지 않음. **P-17**: 6초 신호 3회 중 최소 | 원래 방식(P-05 15개 체인 40번, P-18 약 400번 전체 렌더)은 한 샘플레이트에 수십 분이 걸려 `npm test` 에 넣을 수 없다. 꺼진 페달이 소리를 바꾸지 않는다는 가정은 `bypassTransparent` 로 매번 확인한다. P-18 은 '프리셋 안에서 맨 처음 바뀌는 소리'가 아니라 '그 페달을 켰을 때 소리가 바뀌는지'를 재도록 의미를 좁힘 |
| L-9 | S0.3 | `npm run probe` 를 `npm test` 에 넣는다 | `test:probe`(= `probe`)를 추가. `scripts/run-all-tests.mjs` 에 시험별 제한 시간을 두어 `test:probe` 만 900초(나머지는 그대로 180초). `eslint.config.js` 의 무시 목록에 `dist-probe/**` 추가 | 프로브는 44.1·48 kHz 로 21개를 렌더해 2분 20초쯤 걸려 기본 180초를 넘길 수 있다. `dist-probe/` 는 번들된 한 줄짜리 JS 라 린트가 수백 건 오류를 낸다 |
| L-10 | S0.3 | `tolerances.json` 을 항목마다 둔다(넓히려면 사람 승인) | 기본 ±0.05, 그 밖에 5가지: P-05 `bypassNullDb`·P-20 `nullDb.*` 는 상한 −90 dB, P-17 `time.*` 은 비교 안 함, `cpuShare.*` 는 기준값 4배 안, `ratio.*` 는 ±0.3. 러너에 `atMost` 규칙을 추가 | 같은 코드로 두 번 돌리면 P-17 시간 24개만 달랐고(490개 중) 나머지는 비트 단위로 같았다. 시간·잔차는 기계마다 달라서 기준값과의 차이로 비교할 수 없다. **허용 오차를 처음 정한 것이므로 사람이 한 번 훑어본다** |
| L-11 | S0.4 | `@playwright/test` 를 설치하고 `playwright.config.ts`·`npm run e2e` 를 둔다. 하네스 파일 구성은 설계서 6.3절 | `@playwright/test` **1.63.0 으로 고정**(`^` 없음). `e2e/` 와 `playwright.config.ts` 는 앱과 따로 `tsconfig.e2e.json` 으로 검사하고 `tsconfig.json` 의 `references` 에 연결해 `npm run typecheck` 에 포함. **`@types/node` 는 넣지 않고** 쓰는 Node API 만 `e2e/types/node-shim.d.ts` 에 선언. Chrome 지정 변수는 `E2E_CHROME_PATH`(`CHROME_PATH` 와 분리). CI: `verify.yml`·`deploy.yml` 의 `build` 잡에 `npx playwright install --with-deps chromium` → `npm run e2e`(`E2E_SKIP_BUILD=1`, 앞에서 만든 `dist/` 재사용) → 실패 시 `e2e-report` 업로드를 추가, `verify.yml` 제한 시간 20 → 30분. `ESLint` 의 react-hooks 규칙이 Playwright 픽스처의 `use` 를 React 훅으로 오해해 인자 이름을 `provide` 로 바꿈 | `@types/node` 를 넣으면 앱의 `setTimeout` 반환형이 `NodeJS.Timeout` 이 되어 `AutoWahEffect.ts(161,5)` 가 깨진다. 앱 코드는 이 Step 의 대상이 아니라서 건드리지 않고 e2e 쪽에서 비켜 감. 앱 쪽 타이머 타입을 정리하면 이 shim 을 지우고 `@types/node` 를 넣을 수 있다. 워크플로는 GitHub 에서 실제로 돌려 보지 못했다(사람 확인 필요) |
| L-12 | S0.4 | 기준 측정값이 보고서 수치와 **같은 방향으로 재현**(예: 1280 px 겹침 45곳, 휴대폰 스위치 도달 0%). 현재 상태의 스크린샷과 측정값을 기준으로 기록 | E-04·E-06 은 **기록 모드**(`@record`): 단언하지 않고 `test-results/measurements/` 에 쓰고, `E2E_UPDATE_BASELINE=1` 일 때만 `docs/baseline/e2e.json` 에 병합. 지금 값: 휴대폰 스위치 도달 **0%**(보고서와 같음), 1280 px 글자 겹침 **6곳**(보고서 45곳 — 방향 0 초과는 같고 수치는 다름), 1536 px 이상에서도 스위치 0%·겹침 6~7곳(보고서는 1680 px 이상 0곳). 스크린샷 20장 중 **대표 4장(0.8 MB)만** `docs/baseline/screenshots/` 에 커밋 | 보고서의 겹침 계수 방식을 알 수 없고 보고서 이후 CSS 도 바뀌었다(L-2). 값을 보고서에 맞춰 꾸밀 수는 없다. '같은 방향'은 글자 겹침이 0 보다 크고 스위치가 가려진다는 점에서 성립. 전부 커밋하면 5.9 MB 이고 기준선을 고칠 때마다 저장소가 부푼다. S0.4 의 정지 조건(가짜 마이크가 입력으로 안 들어옴 등)은 하나도 걸리지 않아 계속 진행했다 |
| L-13 | S0.4 → S1.6 | (설계서에 없음) R1-1 은 '하단 패널이 페달 아래를 가린다'로만 설명. E-04 '현재 0%' 의 원인도 도크로 봄 | **새 결함 F-1**: `src/styles/pedals.css` 의 `.vertical-fader input { position:absolute; inset:0; opacity:0; z-index:3 … }` 가 숫자 입력 `input.knob-number-input` 까지 잡고, 바깥 `.vertical-fader` 에 `position` 이 없어 투명한 입력 15개가 주 화면 열 전체를 덮는다. 도크가 **접힌** 상태에서도 15개 스위치가 전부 그 입력에 가려진다(실제 `page.mouse.click` 으로 확인, 키보드 Enter 는 동작). 도크 **펼침** 상태에서는 투명 입력을 걷어도 0/15(도크가 가림). 설계서 기준 커밋 이후(`39bac60`)에 들어옴 → **배포 사이트에도 있을 가능성이 높다** | 하네스는 마우스 대신 포커스 + Enter 로 앱을 연결하는 우회(`connectGuitar`)를 쓴다. 수정은 S1.6 에 **따로 떼어 낼 수 있는 커밋**으로 넣는다(범위를 `.vertical-fader-rail input` 으로 좁힘). 사람이 배포 사이트에서 휴대폰·노트북으로 페달 스위치를 눌러 보고 확인해야 한다 |

### 아직 실행 전이지만 코드 지도(8절)에서 이미 정한 방향

각 Step을 실제로 할 때 결과를 위 표에 번호를 붙여 옮긴다. 아래는 실행 전 판단이라 바뀔 수 있다.

- **S1.4a** — 리미터가 이미 있다(`peak-limiter-processor.ts`, 천장 0.89 ≈ −1 dBFS). 새로 만들지 않고 `OutputStage`로 옮기며 룩어헤드 1 ms·릴리즈 80 ms·안전 클립만 바꾼다.
- **S1.5** — 하울링 감지가 이미 워클릿이지만 출력 쪽·−22 dBFS 기준이다. 설계서의 입력 쪽 −50 dBFS·±20 cents 방식으로 **교체**한다.
- **S2.4** — On/Off·Bypass 통합이 단일 스위치와 스키마 11로 이미 들어와 있다. `active` 이름 바꾸기보다 v2 키·백업·다중 탭·서비스 워커 업데이트 처리에 집중한다.
- **S2.8** — 가져오기(`importPresets`)가 같은 이름 프리셋을 묻지 않고 덮어쓴다. 확인 절차를 같이 적용한다.
- **S4.8** — `Source/`의 AI 기획 문서 3개는 `docs/planning/`으로 `git mv`하고 `.gitignore`에 `Source/`를 넣는다.
- **이미 구현된 Step 20개** — 새로 만들지 않고 프로브·시나리오로 확인하며 남은 틈만 메운다(코드 지도 1절).
