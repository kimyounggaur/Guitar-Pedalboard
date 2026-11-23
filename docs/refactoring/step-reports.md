# Step별 보고서 원장

Step 하나가 끝날 때마다 아래에 항목을 더한다. 형식은 `.github/pull_request_template.md` 와 같아서 PR 본문으로 그대로 붙여 넣을 수 있다.
편차는 `docs/REFACTOR_LOG.md` 의 번호(L-n)로 가리킨다. '사람 확인 필요'는 자동 검사로 대신할 수 없는 것만 적는다.

- 브랜치 이름은 `refactor/sN-M-…`, Phase 통합 브랜치는 `phase/N` 이다. **main 에는 병합하지 않았고 배포하지 않았다.**
- 검증 칸의 명령은 모두 저장소 루트에서 돌렸다. `npm test` 는 Chrome 이 필요한 시험(반응형·프로브)을 포함한다.

---

## S0.1 코드 지도 갱신과 현황 조사

- 브랜치·병합: `refactor/s0-1-code-map` → `phase/0`(`bb1e5bc`). 커밋 `21d2bf3`.
- 해결 항목: 해당 없음(조사 Step)
- 변경 파일(11개, 추가 1,034줄): `docs/refactoring/code-map.md`, `docs/refactoring/regex-assertions.md`, `docs/refactoring/tools/list-regex-assertions.mjs`, `e2e/fixtures/storage-v1/` 6개 JSON + `README.md`, `docs/REFACTOR_LOG.md`

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| code-map.md 에 5장 모든 Step 의 대상 경로가 '확인됨' | 충족 | 코드 지도의 `파일:줄` 인용 168건을 현재 코드(`2a5ab81`)와 내용으로 대조(L-3). 판정 집계 해결 21·부분 20·미해결 3(합 44) |
| 저장 키·타입·MIDI 형식이 마이그레이션 픽스처로 쓸 만큼 구체적 | 충족 | `e2e/fixtures/storage-v1/` 에 v1 저장 상태 6종(기본, 사용자 프리셋·스위치 조합, 깨진 JSON, 꺼진 페달·mix 0, Reverb Decay 7.5, MIDI Bypass 매핑)과 설명서 |
| 정규식 단언 합계가 보고서 337곳과 일치 | **일치하지 않음, 이유 기록** | 현재 312곳(match 293 + doesNotMatch 19). 337 은 기준 커밋 `4ac9cf7` 의 316 + 21 과 정확히 같고, 그 뒤 시험 파일이 줄었다(`regex-assertions.md` 머리말) |

- 중요한 발견: 저장소가 설계서 작성 뒤 8커밋 앞서 나가 있다(L-2). '구현됨' 20·'일부' 다수라서 이후 Step 은 매번 현재 코드와 대조한 뒤 빠진 것만 만든다.
- 사람 확인 필요: 없음
- 남은 위험: 코드 지도의 판정은 코드를 읽고 실행해 얻은 것이라 설계서의 '현재' 서술을 일부 바꾼다. 의견이 다르면 L-3 의 판정 3건(R2-7·R2-10·R2-14)부터 본다.

---

## S0.2 테스트 일괄 실행과 CI 게이트

- 브랜치·병합: `refactor/s0-2-ci-gate` → `phase/0`(`e675ed0`), 보완 `refactor/s0-2-pr-template`(PR 본문 템플릿) → `phase/0`(`1ca6cc6`). 커밋 `7ed8379`, `a9c9035`, `197abb7`, `4dd1e71`, `88f7a07`.
- 해결 항목: R4-7(일부)
- 변경 파일: `scripts/run-all-tests.mjs`(신규), `scripts/responsive-a11y-regression.mjs`, `package.json`·`package-lock.json`, `.github/workflows/verify.yml`(신규)·`deploy.yml`, `.github/pull_request_template.md`(신규), `docs/refactoring/regex-assertions.md`·`tools/list-regex-assertions.mjs`(재생성), `docs/REFACTOR_LOG.md`

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| `npm test` 한 번에 결과가 나오고 시험 하나를 깨면 종료 코드 1 | 충족(개수는 24개로 달라짐, L-5) | `run-all-tests.mjs` 가 `test:*` 를 모두 돌리고 요약을 낸다. 일부러 실패하는 시험(`test:zz-fail`)을 임시로 넣어 종료 코드 1 을 S0.4 마무리 때 다시 확인했다(확인 뒤 되돌림) |
| main 배포 워크플로가 시험 실패 시 배포하지 않음 | 충족(워크플로 파일 기준) | `deploy.yml` 의 `build` 잡(typecheck → lint → build → Chrome 확인 → test)이 실패하면 `deploy` 잡(`needs: build`)이 돌지 않는다. **GitHub 에서 실제로 돌려 보지는 못했다** |
| PR 에서 verify 가 돈다 | 충족(워크플로 파일 기준) | `verify.yml` 트리거: 모든 PR·`phase/**` push·수동 실행. main push 는 `deploy.yml` 과 중복이라 뺌(L-5) |

- 검증: 로컬 `npm run typecheck`, `npm run lint`, `npm test`(24개) 통과. 워크플로 YAML 은 문법만 확인(`actionlint` 는 설치가 막혀 못 돌림).
- 사람 확인 필요
  - GitHub 설정에서 **`verify` 를 필수 상태 검사로 지정하는 브랜치 보호 규칙**(코드로 할 수 없다)
  - 처음 PR 을 올렸을 때 `verify` 가 GitHub 러너에서 실제로 통과하는지
- 남은 위험: CI 에서 `CHROME_PATH` 가 틀리면 다른 Chrome 으로 넘어가지 않고 실패하도록 만들었다. 러너 이미지가 바뀌면 `Check Chrome` 단계가 먼저 실패한다.

---

## S0.3 오디오 렌더 프로브와 기준선

- 브랜치·병합: `refactor/s0-3-render-probe` → `phase/0`(`750eb1d`). 커밋 `950b274`, `489dc0c`, `cee491d`, `fe6ec0b`, `921659f`, `deeb5d2`, `e84bf9e`(`baseline: S0.3 initial`), `fc89698`.
- 해결 항목: 해당 없음(측정 기반 마련)
- 변경 파일: `src/audio/offline/`(3), `src/audio/testing/`(5), `probe.html`, `vite.config.ts`(`--mode test`), `scripts/audio-render-probe.mjs`·`scripts/lib/chrome.mjs`·`scripts/make-fixture-wavs.mjs`·`scripts/run-all-tests.mjs`, `docs/baseline/`(`audio-probe.json`·`tolerances.json`·`README.md`), 이펙트 생성자의 컨텍스트 타입을 `BaseAudioContext` 로 넓힌 `src/audio/nodes/`·`src/audio/utils/` 20개 파일(한 줄씩, 동작 변화 없음), `package.json`, `eslint.config.js`, `docs/REFACTOR_LOG.md`

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 기준선 JSON 에 잴 수 있는 프로브 전부 × 샘플레이트 2개 | 충족 | 프로브 21개 × 44.1·48 kHz = 측정값 490개. 못 재는 P-07·P-19 는 앞선 Step(S1.5·S2.4)이 있어야 한다(`README.md`) |
| 기록값이 보고서의 현상과 같은 방향 | **일부만 충족**(L-6) | 열린 항목(P-05·P-06·P-12·P-13·P-16·P-17·P-20)은 방향이 같다. P-01·P-02·P-04·P-08·P-09·P-11·P-15·P-21 은 보고서 뒤에 이미 고쳐져 있어 다르다 |
| 같은 코드로 두 번 돌리면 허용 오차 안 | 충족 | 490개 중 P-17 의 시간 24개만 달랐고(벽시계 시간) 나머지는 비트 단위로 같다. 시간 계열은 비교 대상에서 뺌(L-10) |

- 검증: `npm run probe` 기준선과 일치, `npm test` 25개 통과(`test:probe` 포함, 약 2분 20초 추가).
- 프로브 변화: 첫 기준선이라 비교 대상 없음. 보고서와의 비교표는 `docs/baseline/README.md`.
- 사람 확인 필요
  - **허용 오차 규칙 5가지**(L-10)를 훑어보고 받아들일지. 넓히거나 `ignore` 를 늘리려면 사람 승인이 필요하다는 것이 설계서 6.4절의 규칙이다.
  - 기준선은 Chrome/153.0.8010.12 에서 만들었다. 다른 Chrome 에서 값이 흔들리면 Chrome 버전을 고정하고 기준선을 따로 갱신한다.
- 남은 위험: P-05·P-18·P-17 은 설계서 방식을 줄여 쟀다(L-8). 'S0.3 의 선택 항목'인 `loadWorklets` 목록과 `workletSources` 의 일치 시험(`offline-worklets-regression.mjs`)은 아직 없다.

---

## S0.4 브라우저 시나리오 하네스

- 브랜치·병합: `refactor/s0-4-e2e-harness` → `phase/0`(Step 끝에서 병합).
- 해결 항목: 해당 없음(측정 기반 마련). 결과로 **새 결함 F-1 발견**(L-13).
- 변경 파일: `playwright.config.ts`, `tsconfig.e2e.json`, `tsconfig.json`(참조 추가), `e2e/global-setup.ts`·`global-teardown.ts`, `e2e/helpers/`(`env`·`geometry`·`mocks`·`screens`·`app`·`fixtures`·`switches`·`record`), `e2e/tests/`(`e00-harness`·`e04-phone-reachability`·`e06-desktop-layout`·`e23-startup`), `e2e/types/node-shim.d.ts`, `.github/workflows/verify.yml`·`deploy.yml`, `package.json`(`e2e` 스크립트, `@playwright/test@1.63.0`)·`package-lock.json`, `.gitignore`, `docs/baseline/e2e.json`·`README-e2e.md`·`screenshots/`(4장), `docs/REFACTOR_LOG.md`(L-11~L-13)

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| `npm run e2e` 가 CI 에서 돌고, 기준 측정값이 보고서 수치와 같은 방향으로 재현 | **일부 충족** | 워크플로에 단계를 넣었지만 **GitHub 에서 실제로 돌려 보지 못했다.** 휴대폰 스위치 도달 0% 는 보고서와 같다. 1280 px 글자 겹침은 6곳(보고서 45곳, 방향만 같음). 그리고 도달 0% 의 원인이 보고서가 말한 도크만이 아니라 F-1 이다(L-12·L-13) |
| 가짜 마이크 WAV 가 앱 입력으로 들어와 출력 미터가 반응 | 충족 | `E-00 가짜 마이크` 시험: `ref-pc.wav` 로 연결 뒤 `Output 레벨` 의 `aria-valuenow` 가 0 보다 커짐 |

- 시험 구성(총 32개): E-00 하네스 자체 시험 10, E-04 휴대폰 도달성 6(화면 3 × 도크 2, 기록 모드), E-06 데스크톱 배치 14(화면 7 × 패널 2, 기록 모드), E-23 시작 회귀 3(AudioContext 0개·getUserMedia 0회, 서비스 워커 캐시 뒤 오프라인 새로고침, 오프라인에서 가짜 마이크 연결).
- 검증: `npm run typecheck`, `npm run lint`(`e2e/` 포함) 통과. `npm run e2e` 32/32 통과(약 1분 30초). `E2E_UPDATE_BASELINE=1` 로 세 번 돌려 `e2e.json` 이 매번 동일함을 확인. `npm test` 25/25 통과(160.6초, 기존 시험과 `test:probe` 포함).
- 프로브·스크린샷 변화: 첫 기준선. 수치표는 `docs/baseline/README-e2e.md`.
- 사람 확인 필요
  - **F-1 이 배포 사이트에서도 일어나는지**(휴대폰·노트북에서 페달 스위치 직접 누르기). 일어난다면 Phase 1 을 기다리지 않고 먼저 고칠 만한 사용자 영향이다.
  - 대표 스크린샷 4장이 기기에서 보는 화면과 같은지.
  - `verify.yml`·`deploy.yml` 의 `Install Playwright Chromium` 단계가 GitHub 러너에서 통과하는지(처음 PR 때).
- 남은 위험
  - 글자 겹침 수는 이 하네스의 정의(같은 카드 안의 서로 다른 글자 상자가 가로·세로 2 px 이상 겹침)에 따른 값이다. 2~3 px 높이 겹침을 문제로 칠지는 S1.8 에서 정한다.
  - `connectGuitar` 의 포커스 + Enter 우회는 F-1 수정(S1.6) 뒤에 마우스 클릭으로 되돌린다.
  - `e2e/types/node-shim.d.ts` 는 `@types/node` 를 쓸 수 있게 되면 지운다(L-11).
