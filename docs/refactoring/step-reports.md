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

---

# Phase 1 — 안전과 핵심 조작

Phase 1 의 Step 브랜치는 `phase/1` 에서 만들고 `phase/1` 로 병합한다.

## S1.1 Crunch 곡선 0점 연속화

- 브랜치·병합: `refactor/s1-1-crunch-curve` → `phase/1`.
- 해결 항목: R1-6. **곡선은 이미 고쳐져 있었다**(커밋 `859a11c`, 코드 지도 S1.1 행 '이미 구현'). 이 Step 은 코드를 바꾸지 않고 '고쳐진 상태를 시험과 프로브가 지키게' 만들었다(L-14).
- 변경 파일: `scripts/crunch-curve-regression.mjs`(신규, `test:crunch-curve`), `scripts/audio-render-probe.mjs`(`criteria` 검사), `docs/baseline/tolerances.json`(`criteria` 2개), `docs/baseline/README.md`, `package.json`, `docs/REFACTOR_LOG.md`(L-14)

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| gain 0~100 전 구간에서 곡선 가운데 인접 표본 차 < 0.01 | 충족 | `test:crunch-curve`: 5 간격 21점 × 표본 4096·4097개. 4096점에서 가운데 차: gain 0 → 0.0009, 50 → 0.0027, 100 → 0.0051 |
| P-01 무연주 잡음 대 연주음 차 ≥ 30 dB | 충족 | 44.1 kHz 62.3 dB, 48 kHz 62.6 dB(수정 전 곡선 17.2·17.6 dB) |
| P-02 입력이 줄 때 출력이 25 dB 이상 줄어듦 | 충족 | 입력 51.6 dB 감소에 출력 42.3 dB 감소(수정 전 곡선 5.8 dB). 두 샘플레이트 모두 |
| 세 프리셋 연주음 출력 레벨 변화 ±3 dB | 충족 | 수정 전 곡선 대비 −0.2 ~ −0.6 dB(아래 표). 지금 코드 기준 변화는 0 |

**전후 표** — '수정 전'은 `createCrunchCurve` 만 커밋 `859a11c` 이전 식으로 임시로 되돌린 값이다(나머지 코드는 지금 그대로, 되돌린 뒤 복구함).

| 프로브 | 수정 전 곡선 | 지금 | 수용 기준 |
|---|---|---|---|
| P-01 `differenceDb` 44.1 / 48 kHz | 17.2 / 17.6 dB | 62.3 / 62.6 dB | ≥ 30 |
| P-01 `noiseOutDb`(무연주 잡음 출력) | −31.6 / −31.9 dBFS | −80.8 / −81.1 dBFS | — |
| P-02 `outputDropDb` | 5.84 / 5.87 dB | 42.27 / 42.28 dB | ≥ 25 |
| P-05 British Crunch (44.1k) | −12.82 dBFS | −13.32 dBFS | 변화 ±3 dB |
| P-05 Plexi Lead (44.1k) | −13.25 dBFS | −13.68 dBFS | 변화 ±3 dB |
| P-05 Thrash Rhythm (44.1k) | −13.69 dBFS | −14.23 dBFS | 변화 ±3 dB |

**곡선 표본값(전 → 후)** — 입력 x 에서의 출력, 표본 20만 개로 평가.

| gain | x = −0.01 | −0.001 | 0 | +0.001 | +0.01 |
|---|---|---|---|---|---|
| 0 | −0.032 → −0.018 | −0.015 → −0.002 | **−0.013 → 0** | 0.030 → 0.002 | 0.048 → 0.018 |
| 50 | −0.432 → −0.054 | −0.268 → −0.005 | **−0.248 → 0** | 0.506 → 0.006 | 0.610 → 0.056 |
| 100 | −0.704 → −0.102 | −0.625 → −0.010 | **−0.613 → 0** | 0.753 → 0.011 | 0.772 → 0.107 |

- 검증: `npm run typecheck`, `npm run lint`, `npm test` 통과(아래 '병합 직전 확인').
- 사람 확인 필요: **British Crunch · Plexi Lead · Thrash Rhythm 세 프리셋에서 줄을 손으로 막고 30초** — '지글거리는' 잡음이 없어야 한다(청취).
- 남은 위험: Gain 노브 곡선(20~30% 에서 이미 최대, R3-6)은 이 Step 의 범위가 아니다(S3.5). 설계서의 `drive` 스케치는 적용하지 않았다(L-14).

---

## S1.2 AudioSession 정리 절차

- 브랜치·병합: `refactor/s1-2-session-teardown` → `phase/1`.
- 해결 항목: R1-3(정지 뒤에도 마이크·엔진이 살아 있음), R2-12(Esc), R1-2(녹음 폐기 — HEAD 에서 이미 저장하고 있었고 시험으로 고정), 설계서 C2(정지 경로가 여러 개). 새로 발견한 결함 **F-2**(Esc 가 컨트롤 포커스에서 무시됨, L-17).
- 변경 파일(18개 + 이 보고서, +1,692 / −133줄): `src/audio/engine/AudioSession.ts`(신규), `src/audio/AudioEngine.ts`, `src/store/audioStore.ts`, `src/store/toastStore.ts`·`src/components/Toast.tsx`(신규), `src/components/GlobalKeyboardShortcuts.tsx`, `src/App.tsx`, `src/styles/panels.css`, `scripts/audio-session-regression.mjs`(신규, `test:audio-session`), `scripts/recording-regression.mjs`·`scripts/shortcuts-regression.mjs`, `e2e/tests/e01-teardown.spec.ts`(신규), `e2e/helpers/{app,mocks,teardown}.ts`, `e2e/types/node-shim.d.ts`, `package.json`, `docs/REFACTOR_LOG.md`(L-15~L-21)

**정리 순서표** — 어떤 이유로 멈추든(`user-disconnect`·`panic`·`howl`·`device-lost`·`error`) 같은 순서로 지난다. 한 단계가 실패해도 나머지는 계속하고 `failedSteps` 에 남긴다.

| 순서 | 단계 | 하는 일 | 코드 |
|---|---|---|---|
| 사전 | (번호 없음) | 아직 끝나지 않은 시작 요청을 무효로 만든다 — `getUserMedia` 가 늦게 돌아와도 입력이 켜지지 않는다 | `AudioSession.ts:171` → `AudioEngine.invalidatePendingStart` |
| ① | `silence-output` | 마스터 게인을 시상수 3 ms 로 0 으로, 24 ms 기다림(L-18) | `AudioEngine.silenceOutput` |
| ② | `stop-input` | 입력 트랙 stop — 마이크 표시등이 여기서 꺼진다(②·③ 맞바꿈, L-16) | `AudioEngine.stopInput` |
| ③ | `finalize-recording` | 녹음 중이면 마감을 최대 2초 기다려 파일을 남긴다 | `finalizeRecordingForStop`(`audioStore.ts`), 시간 제한 `AudioSession.ts:178` |
| ④ | `pause-playback` | 파일 모드면 pause(File 객체는 그대로 둠) | `AudioEngine.pausePlayback` |
| ⑤ | `release-graph` | 워클릿 포트 닫기, 노드 disconnect | `AudioEngine.releaseGraph` |
| ⑥ | `close-context` | `await context.close()` — 컨텍스트는 한 번에 하나 | `AudioEngine.closeContext` |
| ⑦ | `advance-generation` | 세대 번호 증가 — 늦게 도착한 비동기 결과 무시 | `AudioEngine.advanceGeneration` |
| ⑧ | `notify` | 이유별 안내(토스트, L-21). 이미 멈춘 상태의 정지는 안내하지 않는다 | `announceStop`(`audioStore.ts`) |

정지는 `audioStore.ts` 의 `stopSession(reason, detail)` 한 곳으로 모인다. 연결 해제·Panic 버튼·Esc·하울링 핸들러·장치 분리(`loadDevices`·입력 종료)·파일 재생 끝이 모두 여기를 부르고, 엔진의 `panic()`·`stop()` 은 지웠다(L-15).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| Panic·Esc·하울링(모의)·연결 해제 뒤 500 ms 안에 모든 입력 트랙 `ended`, 모든 `AudioContext` `closed`, 화면이 '기타 연결하기' | 충족 | E-01(아래 측정값). 가장 느린 경우 115 ms |
| 녹음 중 Panic → 파일이 남고 길이 = 녹음 시간 ±0.5초 | 충족 | E-01 '녹음 중 Panic' — 내려받은 파일을 디코딩해 길이 차 ≤ 0.5 s. 정지 완료 115 ms |
| 정지 → 연결을 10번 되풀이해도 동시에 열린 `AudioContext` ≤ 1 | 충족 | E-01: 최대 동시 열림 1, `getUserMedia` 10회, 모든 트랙 `ended`, 모든 컨텍스트 `closed` |
| 대화상자·메뉴가 열려 있으면 Esc 는 그것만 닫는다 | 충족 | E-01: 도움말 대화상자·MIDI 메뉴 — 첫 Esc 는 닫기만(트랙 `live`, 컨텍스트 `running`, 토스트 없음), 이어지는 Esc 가 정지 |
| 모든 정지 경로가 `stop(reason)` 하나를 지난다 | 충족 | `test:audio-session`: 이유 5가지가 같은 단계 순서, 소스에서 `engine.panic`·`engine.stop` 제거 |
| 녹음은 버리지 않는다 | 충족(HEAD 에서 이미 충족, 시험으로 고정) | `test:recording`, E-01 |

**E-01 측정값**(정지 동작부터 위 세 조건이 처음 관찰될 때까지, 한도 500 ms)

| 동작 | ms |
|---|---|
| Panic 버튼 | 56 |
| Esc — 포커스: 페달 스위치 / 녹음 버튼 / 입력 트림 슬라이더 / 없음 | 92 / 99 / 70 / 64 |
| Esc — 숫자 칸 편집 취소 다음의 Esc / MIDI 메뉴를 닫은 다음의 Esc | 59 / 51 |
| 하울링 차단(모의) | 65 |
| 연결 해제 버튼 | 57 |
| 녹음 중 Panic | 115 |

- 새 시험: `test:audio-session`(상태 기계·이유별 순서·단계별 실패 격리·마감 시간 초과·시작/정지 경쟁·Panic 직후 재연결·10회 반복, 변이 시험으로 확인), E-01 13건, `test:shortcuts` 에 포커스 대상 25가지 판정 표(변이 시험 2종으로 확인). `test:recording` 은 새 구조(`stopSession`·토스트)에 맞게 다시 썼다.
- 검증: `npm run typecheck`, `npm run lint`, `npm run build`, `npm test` 27/27(154초), `npm run e2e` 45/45(1.9분) 통과.
- 발견(F-2, L-17): `isInteractiveShortcutTarget` 가드가 버튼·스위치·슬라이더·탭에 포커스가 있을 때 Esc 도 무시했다. 연주 중에는 포커스가 거기 있는 것이 보통이라 하울링이 날 때 Esc 가 듣지 않는다. E-01 첫 실행에서 재현했고(마이크 트랙·컨텍스트가 그대로 살아 있음) 고쳤다. **배포 사이트에도 있을 가능성이 높다**(F-1 과 같은 이유).
- 사람 확인 필요
  - **실제 마이크**로 연결한 뒤 Panic 버튼·Esc·'연결 해제' 를 눌러 브라우저의 마이크 사용 표시(주소창·탭)가 바로 꺼지는지(데스크톱 Chrome, 가능하면 iOS Safari).
  - **실제 하울링**(스피커 + 마이크)에서 자동 정지와 안내가 뜨는지. 감지 방식은 S1.5 에서 바뀐다. → 바뀌었다. 이 항목은 S1.5 절의 '사람 확인 필요'로 옮겨 갔다.
  - 토스트가 휴대폰 화면에서 도크·페달을 가리지 않는지(위치는 S1.7 에서 다듬음).
  - USB 오디오 장치를 연결한 채 뽑았을 때 '입력 장치 연결이 끊겼습니다' 안내.
- 남은 위험
  - 하울링 감지기는 아직 출력 쪽·−22 dBFS 방식이다(S1.5 에서 입력 쪽 −50 dBFS·±20 cents 로 교체). 정지 문구의 주파수(`StopDetail.howlFrequencyHz`)는 그때 채운다. **→ S1.5 에서 처리**: 입력 쪽 판정으로 교체했고, 정지 안내에 '하울링(약 N Hz)' 이 들어간다.
  - 녹음 마감이 2초를 넘으면 기다리지 않고 정리를 이어간다 — 그 녹음은 남지 않을 수 있다(`test:audio-session` '마감 시간 초과'가 이 동작을 고정).
  - 숫자 입력 칸·열린 메뉴·대화상자에서는 Esc 가 먼저 그 컨트롤에 쓰이고 한 번 더 눌러야 정지한다(L-17 의 의도된 선택).
  - `connectGuitar`·`activate` 의 키보드 우회는 F-1 수정(S1.6) 뒤에 마우스 클릭으로 되돌린다. `AudioEngine.setInputDevice` 는 스토어에서 더는 쓰지 않지만 S1.3(입력 채널) 때 정리하려고 남겨 두었다.

## S1.3 입력 채널 처리 (InputStage)

- 브랜치·병합: `refactor/s1-3-input-stage` → `phase/1`.
- 해결 항목: R1-4(기타가 한쪽 출력으로만 들림). **HEAD 에 '1/2/스테레오' 메뉴가 이미 있었다**(`ConnectGuitarPanel`, 기본 '1') — 실제 결함은 메뉴가 없는 것이 아니라 ① 기본값이 1번 입력만 써서 **2번 입력에 꽂으면 무음**, ② 판정·기억이 없고, ③ 스테레오 모드는 **한쪽 출력만** 나오고(P-06 기준선 `modestereo.rightDb` = −200 dBFS, 손실 3.01 dB), ④ 채널이 하나뿐인 장치에서도 메뉴가 보이는 것이었다(L-26).
- 변경 파일(기준선 JSON·로그·이 보고서를 뺀 16개, 신규 4개, +1,437 / −69줄): `src/audio/engine/InputStage.ts`·`channelDecision.ts`(신규), `src/audio/AudioEngine.ts`, `src/audio/offline/renderChain.ts`, `src/audio/testing/probes.ts`(P-06), `src/store/audioStore.ts`, `src/components/DeviceSelector.tsx`·`ConnectGuitarPanel.tsx`, `src/styles/panels.css`, `scripts/input-stage-regression.mjs`(신규, `test:input-stage`), `scripts/audio-render-probe.mjs`(P-06 요약 항목), `e2e/tests/e02-input-channel.spec.ts`(신규), `e2e/helpers/mocks.ts`, `package.json`, `docs/baseline/tolerances.json`(`criteria` 5개), `docs/baseline/audio-probe.json`(별도 커밋 `baseline: S1.3 …`), `docs/baseline/README.md`, `docs/REFACTOR_LOG.md`(L-22~L-28)

**그래프** — 두 경로를 늘 연결해 두고 게이트를 크로스페이드한다(L-22). 연결을 끊고 잇지 않는다.

```text
source(2ch) ─▶ splitter ─┬ 0 ─▶ gainL ─┐
                         └ 1 ─▶ gainR ─┴▶ mono(1ch, explicit) ─▶ monoGate ──┐
            └────────────────────────────────▶ stereoGate ───────────────────┴▶ output ▶ inputGain ▶ 이펙트 체인
                         └▶ analyserL / analyserR (판정용 레벨, 게인 앞에서 잰다)
```

| 모드 | gainL / gainR | 경로 | 화면 |
|---|---|---|---|
| 자동 — 판정 전 | 0.5 / 0.5 | 모노 | '기타 소리가 들어오면 어느 입력을 쓸지 자동으로 정합니다' |
| 자동 — `ch1` 판정 | 1 / 0 (20 ms 램프) | 모노 | '1번 입력에서만 소리가 들어와 1번 입력을 씁니다' |
| 자동 — `ch2` 판정 | 0 / 1 | 모노 | '2번 입력에서만 소리가 들어와 2번 입력을 씁니다' |
| 자동 — `sum` 판정 | 0.5 / 0.5 | 모노 | '양쪽 입력에 비슷한 소리가 들어와 합쳐서 씁니다' |
| 1번 입력 / 2번 입력 | 1 / 0 · 0 / 1 | 모노 | (판정 문구 없음) |
| 스테레오 | — | 스테레오(8 ms 크로스페이드) | (판정 문구 없음) |

판정 규칙(L-24): 큰 쪽이 −50 dBFS 이상인 시간이 300 ms 쌓이면 한 번 판정 — 평균 전력 차가 15 dB 이상이면 큰 쪽 채널, 아니면 합침. 장치별로 `{모드, 판정}` 을 `guitar-pedalboard:io` 의 `inputChannels` 에 기억하고 다음 연결을 그 판정으로 시작하되 세션마다 한 번 다시 판정한다(L-23). 채널이 하나뿐인 장치(트랙 `channelCount` 1)와 파일 재생은 통과 경로이고 메뉴가 없다.

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 왼쪽에만 신호가 있는 스테레오 입력 → 자동 판정 뒤 출력 좌우 RMS 차 ≤ 1 dB, 레벨 손실 ≤ 0.5 dB | 충족 | P-06 `auto.left`: 판정 `ch1`, 좌우 차 **0 dB**, 손실 **0 dB**(44.1·48 kHz 모두). 오른쪽만(`ch2`)·양쪽 같은 소리(`sum`)도 0 / 0. E-02(실제 Chrome·가짜 마이크): 좌우 차 0.00 / 0.01 / 0.00 dB |
| '1번 / 2번 / 스테레오' 를 고르면 20 ms 페이드로 바로 반영되고 장치별로 기억됨 | 충족 | `test:input-stage`(램프 0.02 s·0.008 s, 모드 전환 후 게인 값), E-02: 연결 중에 2번 → 1번으로 바꾸면 무음(−200 dBFS) → −13.03 / −13.02 dBFS, 새로고침 뒤 모드·판정 문구 유지 |
| 양쪽에 같은 신호(진짜 모노) → 자동 판정이 '합침' 을 유지하고 레벨 변화 없음 | 충족 | P-06 `auto.both`: `sum`, 좌우 차 0, 손실 0, 판정 전 손실 0 dB. 채널이 1개인 장치는 통과 경로(`test:input-stage`, E-02: 메뉴 숨김). 한 채널만 쓰는 경우 판정 전 0.3초는 −6.02 dB(설계값 0.5/0.5, `pendingLossDb`) |
| 튜너 정확도 회귀 없음 | 충족 | `test:tuner` 통과, P-22(`maxAbsCentsOpenStrings`) 기준선 변동 없음. 튜너 연결과 워클릿은 건드리지 않았다(L-27) |

**P-06 전후** (44.1 kHz, 48 kHz 는 ±0.01 dB 안에서 같다)

| 측정 | 전(HEAD) | 후 |
|---|---|---|
| 왼쪽만 입력, 기본 동작 — 좌우 차 / 손실 | 기본 '1' 이라 0 / 0 (구조상 **오른쪽만 입력은 1번 채널이 비어 무음**) | 자동 판정 `ch1` → 0 / 0, 오른쪽만 `ch2` → 0 / 0 |
| 왼쪽만 입력, 스테레오 — 오른쪽 / 손실 | −200 dBFS / 3.01 dB | 같음(사용자가 직접 고른 결과, `manual.stereo`) |
| 판정까지 걸리는 시간 | 판정 없음 | 0.301 s(44.1k) · 0.300 s(48k) — 신호 시작부터 |
| 판정 전 0.25초 손실(한쪽만 신호) | — | 6.021 dB(설계값 ×0.5) |

**E-02 측정값**(`readOutputLevels`: 앱이 `destination` 에 연결하는 노드에 분석 노드를 붙여 판정 뒤 1초의 좌우 RMS 를 잼)

| 입력(가짜 마이크) | 판정 문구 | 왼쪽 / 오른쪽 dBFS | 차 |
|---|---|---|---|
| `ref-pc-left-only.wav` | 1번 입력에서만… | −12.97 / −12.97 | 0.00 |
| `ref-pc-right-only.wav` | 2번 입력에서만… | −12.93 / −12.92 | 0.01 |
| `ref-pc.wav`(양쪽 같음) | 양쪽 입력에 비슷한… | −13.01 / −13.01 | 0.00 |
| 왼쪽만, 새로고침 뒤 연결(기억한 판정으로 시작) | 1번 입력에서만… | −12.84 / −12.84 | 0.00 |
| 왼쪽만, 2번 입력 직접 선택 → 1번으로 변경 | (문구 없음) | −200 / −200 → −13.03 / −13.02 | → 0.01 |
| 왼쪽만, 스테레오 직접 선택 | (문구 없음) | −12.92 / −200 | (선택한 대로) |

- 새 시험: `test:input-stage`(판정 규칙 경계, InputStage 그래프·게인·램프·한 번만 판정·통과·정리), E-02 8건(위 표 + 메뉴 기본값·옵션 이름·1채널 장치 메뉴 숨김), P-06(새 정의, L-28). Chrome 의 가짜 마이크는 `channelCount` 제약을 무시하고 늘 2채널을 주므로, 1채널 장치는 트랙의 `getSettings()` 만 바꾼 모의(`mockInputChannelCount`)로 흉내 냈다 — 메뉴 숨김과 연결 유지만 확인하고 실제 모노 소리는 확인하지 않는다.
- 검증: `npx tsc -b --noEmit`, `npm run lint`, `npm run build`, `npm test` 28/28(162초), `npm run e2e` 53/53(2.5분) 통과.
- 만난 문제: `test:recording` 이 처음 실패했다 — 시험이 엔진을 부분 모의하는데 연결 직후 읽는 `getInputInfo()` 가 모의 스트림에서 던져 시작이 실패로 처리됐다. 입력 설정을 읽지 못해도 연결은 유지돼야 하므로 `getInputInfo()` 가 읽기 실패를 '모름(null)' 으로 돌려주게 했다(메뉴는 그대로 보임).
- 사람 확인 필요
  - **실제 2입력 오디오 인터페이스의 1번 입력**에 기타를 꽂고 유선 헤드폰으로 들어 **양쪽 귀에서 같은 크기로** 들리는지(판정 문구가 뜨기까지 약 0.3초 동안은 −6 dB 로 작게 들린다). 2번 입력, 양쪽에 같은 소리를 나눠 주는 구성도 같이.
  - 일부 인터페이스·브라우저는 `getSettings().channelCount` 를 알려 주지 않는다(없으면 2채널로 보고 메뉴를 보여 준다). 모노 마이크(노트북 내장)에서 메뉴가 숨는지.
  - 자동 판정 문구의 위치·크기가 휴대폰 도크에서 읽기 편한지(화면 배치는 S1.6 에서 다듬음).
- 남은 위험
  - 판정은 세션마다 한 번이라 연결한 채로 케이블을 옮기면 따라가지 않는다 — 메뉴에서 다시 고르거나 다시 연결해야 한다(설계서 규칙대로).
  - 이 Step 은 채널 수를 `getSettings().channelCount` 로만 안다. 2채널이지만 한쪽이 늘 비어 있는 장치는 자동으로 '1번/2번 입력' 이 판정된다(의도).
  - 판정용 레벨 폴링은 S1.5 에서 `onChannelLevels` 직접 호출로 바뀐다(L-25). 그때 P-06·E-02 를 다시 돌려 확인한다. **→ S1.5 에서 처리**: 폴링을 없애고 `level-meter#in` 의 측정을 `MonitorService` 가 `onChannelLevels` 로 넘긴다. P-06 기준선은 그대로이고(`test:probe` 통과) E-02 8개가 통과한다.
  - 프로브가 새 `P-06` 정의를 쓰므로 이전 기준선과 키가 다르다(L-28). 별도 `baseline:` 커밋으로 갱신했다.

---

## S1.4a 마스터 리미터 (OutputStage)

- 브랜치·병합: `refactor/s1-4a-limiter` → `phase/1`.
- 해결 항목: R1-5 중 '마지막 출력 단계의 리미터'. **HEAD 에 리미터가 이미 있었다**(`peak-limiter-processor.ts` — 문자열 워클릿, 천장 0.89, 룩어헤드 없음, 해제 50 ms; 코드 지도 8절). 그래서 이 Step 은 새로 넣는 일이 아니라 ① 설계서 사양(GS-6)으로 **바꾸고**(룩어헤드 1 ms·해제 80 ms·천장 −1 dBFS 에 마지막 한 번 더 자르기), ② 엔진 안에 흩어져 있던 마스터 게인·리미터를 `OutputStage` 로 묶어 S1.5 가 하울 가드를 옮길 자리를 만들고, ③ 새 워클릿을 별도 파일(`?worker&url`)로 만드는 방식이 빌드·프리캐시·오프라인에서 되는지 검증하는 일이었다(L-29, L-32).
- 변경 파일(기준선 JSON·이 보고서를 뺀 33개, 신규 6개, +1,117 / −425줄): `src/audio/engine/limiterSpec.ts`·`OutputStage.ts`, `src/audio/worklets/limiter.worklet.ts`·`urls.ts`(신규 4개), `src/audio/worklets/peak-limiter-processor.ts`(삭제), `src/audio/AudioEngine.ts`, `src/audio/offline/renderChain.ts`·`workletModules.ts`, `src/audio/testing/probes.ts`(P-03), `scripts/peak-limiter-regression.mjs`(다시 씀), `scripts/lib/esbuild-plugins.mjs`(신규)와 이를 쓰는 Node 시험 14개(`auto-wah`·`chorus`·`flanger`·`graphic-eq`·`history`·`knob`·`latency`·`midi`·`output-device`·`phaser`·`preset-ab`·`recording`·`shortcuts`·`tremolo`), `scripts/audio-render-probe.mjs`(P-03 요약 항목), `e2e/tests/s1-4a-output-stage.spec.ts`(신규)·`e23-startup.spec.ts`, `e2e/helpers/mocks.ts`, `docs/baseline/tolerances.json`(`criteria` 2개)·`README.md`, `docs/baseline/audio-probe.json`(별도 커밋 `baseline: S1.4a …`), `docs/REFACTOR_LOG.md`(L-29~L-33), `docs/refactoring/regex-assertions.md`. 시험 도구 수정(`scripts/lib/chrome.mjs`·`scripts/cdp-client-regression.mjs`·`package.json`, L-33)은 따로 가져갈 수 있게 별도 커밋이다.

**그래프** — 스피커·출력 미터·녹음이 모두 리미터 **뒤**에서 갈라진다.

```text
이펙트 체인 ─▶ masterGain(OutputStage.input) ─▶ howlGuard ─▶ limiter(OutputStage.output) ─┬▶ 스피커(destination)
                                                                                           ├▶ 출력 미터(AnalyserNode)
                                                                                           └▶ 녹음(MediaStreamDestination, 녹음 중에만)
```

※ 이 그래프는 S1.4a 시점의 것이다. S1.5 에서 `howlGuard` 가 `output-guard` 로 바뀌고(입력 0 = 프로그램 소리, 입력 1 = 마이크 입력일 때만 분석용) 리미터 뒤에 `level-meter#out` 이 붙었으며, 출력 미터(AnalyserNode)는 파형 전용으로 줄었다. 현재 그래프는 아래 S1.5 절에 있다.

| 리미터 사양(GS-6) | 값 |
|---|---|
| 천장 | −1 dBFS(0.8913). 감소량을 곱한 뒤 ±천장으로 한 번 더 자른다 |
| 룩어헤드 | 1 ms — 48 kHz 48샘플, 44.1 kHz 44샘플. 소리가 그만큼 늦게 나온다(L-30) |
| 어택 / 해제 | 즉시(룩어헤드 구간 최댓값 기준) / 시상수 80 ms |
| 채널 | 좌우 연동(두 채널 중 큰 값으로 이득 하나). 모노 입력은 양쪽으로 복사 |
| 이상 값 | NaN·무한대는 0 으로 |
| 화면 | 노출하지 않음(UI 변경 없음) |

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| P-03 최악 조합 피크 ≤ −1.0 dBFS(허용 −0.9) | 충족 | −1.000 dBFS(44.1·48 kHz). 리미터를 빼면 +68.4 / +67.9 dBFS 라 리미터가 실제로 일한다. `tolerances.json` 에 `P-03.peakWithLimiterDb` ≤ −0.9 추가 |
| 앱 기본 구성에서 Cab 만 꺼도 ≤ −1.0 dBFS | 충족 | P-03 `defaultCabOffPeakDb` −1.000(리미터를 빼면 +2.97 / +2.99 dBFS — Cab 을 끄면 깨졌다). 같은 기준 추가 |
| 녹음도 리미터 뒤 | 충족 | `test:recording`(녹음 연결이 `outputStage.output` 에서 나옴), 실제 그래프 시험(녹음 시작 전엔 녹음 노드에 연결 없음, 시작 뒤엔 입력이 리미터 하나뿐) |
| P-23 클릭 없음·새 노드 0 | 충족 | 새 노드 0, 최대 클릭 비율 +1.01 / +1.22 dB(전 +3.48 / +4.13) |
| E-23 오프라인 새로고침 뒤 연결 → 리미터 워클릿 로드 | 충족 | 새 시험: 캐시에 `/assets/limiter.worklet-….js` 있음 → 오프라인 새로고침 → 연결 → 리미터 모듈 `loaded` 1건, 불러오지 못한 모듈 0건 |
| 리미터 파라미터를 화면에 내놓지 않는다 | 충족 | 화면 코드는 바꾸지 않았다 |

**전후** (44.1 kHz / 48 kHz)

| 측정 | 전(HEAD) | 후 |
|---|---|---|
| P-03 최악 조합 피크 | −1.012 / −1.012 dBFS | −1.000 / −1.000 dBFS |
| P-03 최악 조합 평균 음량(RMS) | −3.16 / −3.11 dBFS | −10.65 / −10.47 dBFS |
| P-03 기본 구성 + Cab 끔, 리미터 있음(새 측정) | — (리미터 없으면 +2.97 / +2.99) | −1.000 / −1.000 dBFS |
| P-16 기본 구성 지연 | 3.02 / 2.79 ms | 4.02 / 3.79 ms(+1 ms, 룩어헤드) |
| P-23 최대 클릭 비율 | +3.48 / +4.13 dB | +1.01 / +1.22 dB |
| P-05 프리셋 음량 폭 / 중앙값 | 21.49 / 21.61 dB · −16.16 / −16.44 dBFS | 21.47 / 21.58 dB · −16.29 / −16.45 dBFS(큰 프리셋 22개가 최대 0.75 dB 내려감) |
| 번들 | 문자열 워클릿 8개 | 문자열 워클릿 7개 + 별도 파일 1개(`limiter.worklet-CaSHv9dI.js`, 1,292 bytes, import 0개, 프리캐시 포함) |

P-03 의 평균 음량이 크게 내려간 것은 과도한 입력에서 옛 리미터는 룩어헤드가 없어 큰 피크를 만난 뒤에야 이득을 내려 파형이 잘린 채 남고, 새 리미터는 1 ms 앞서 이득을 내려 파형을 덜 자르기 때문이다. 피크 상한은 같다. 소리가 어떻게 들리는지는 사람이 들어야 안다(아래 '사람 확인 필요').

- 새 시험: `test:peak-limiter`(다시 씀 — 워클릿 코드를 esbuild 로 묶어 `vm` 안에서 실제 처리기를 돌린다: 천장 이하 투명, 모노→양쪽, 빈 입력, 좌우 연동, 극단 입력, NaN·무한대, 룩어헤드 선행 이득 감소, 해제 시상수 수식 일치, 128샘플 단위로 나눠 처리해도 같은 결과, 지속 과입력, 96 kHz, `OutputStage` 연결·정리, 소스 단언), E-23 1건(오프라인 로드), `s1-4a-output-stage.spec.ts` 2건(실제 오디오 그래프의 연결: 스피커는 리미터에서만, 리미터는 하울 가드에서만, 녹음 노드는 녹음 시작 뒤 리미터에서만, 끊었다 다시 연결하면 새 리미터가 스피커에 다시 이어짐 — 연결 기록에 리미터 → 스피커가 두 번), P-03 새 측정 2개, `test:cdp-client`(L-33).
- 검증: `npx tsc -b --noEmit`, `npm run lint`, `npm run build`(프리캐시에 리미터 파일 포함 확인), `npm test` 29/29(164초), `npm run e2e` 56/56 통과.
- 만난 문제
  - Node 시험 14개가 `AudioWorkletProcessor is not defined` 로 죽었다 — esbuild 가 `?worker&url` 꼬리표를 떼고 워클릿 소스를 묶었다. 그 주소를 문자열로 바꿔 주는 `workerUrlStub` 으로 해결(L-29).
  - P-11(주파수 응답)이 246.1 → 228.5 Hz 로 어긋났다 — 입력과 출력을 비교하는 측정이라 리미터의 48샘플 지연을 '위상 차' 로 읽었다. 오프라인 렌더에 `alignOutput`(기본 켬)을 더해 리미터 지연을 앞에서 잘라 냈고 P-11 은 기준선 그대로 돌아왔다. 지연을 재는 P-16 만 끈다(L-30).
  - `npm test` 에서 `test:responsive-a11y` 가 180초 제한에 걸려 멈췄다 — S1.4a 와 무관한 시험 도구의 결함이었다(`Browser.close` 응답이 안 오면 영영 대기). 고쳤고 40회 연속 통과로 확인(L-33).
- 사람 확인 필요
  - **과도한 입력(전 페달 켬 + Level 200% + Graphic EQ +12 dB 같은 구성)을 헤드폰으로 짧게 들어 볼 것**(볼륨은 낮추고). 평균 음량이 −3 → −10.6 dBFS 로 내려갔으므로 찌그러짐 없이 눌리는지, 소리가 갑자기 작아졌다 커지는 느낌이 거슬리지 않는지.
  - **녹음 파일(WAV/WebM)을 편집기에서 열어 피크가 −1 dBFS 를 넘지 않는지**(실제 파일은 시험하지 않았다. 그래프 연결과 단위 시험만 확인).
  - 1 ms 지연이 귀로 느껴지지 않는지(기본 구성 지연이 약 4.0 ms 로 늘었다).
  - 앱 기본 구성에서 Cab 만 끄고 센 소리를 쳐도 실제 하드웨어에서 깨지지 않는지(프로브는 가상 신호로만 확인).
- 남은 위험
  - 화면의 `출력 지연 추정` 은 baseLatency + outputLatency 만 보여 주고 처리 지연은 '추정 미지원' 이라 리미터 1 ms 가 거기에 없다 — S2.10 에서 처리 지연을 넣을 때 `limiterLookaheadFrames` 를 포함해야 한다(L-32).
  - P-16 기본 구성(4.02 / 3.79 ms)이 목표 3.7 ms(2.7 + 리미터 1.0)를 44.1 kHz 에서 0.32 ms, 48 kHz 에서 0.09 ms 넘는다 — 열린 항목으로 남는다(L-30).
  - P-05 음량 폭은 그대로 약 21.5 dB 다. S1.4b(Cab 보정)·S1.4c(프리셋 음량 맞춤)에서 줄인다.
  - S1.5 는 `OutputStage` 의 `guard` 자리에 있는 출력 쪽 하울 가드를 입력 쪽 감지기로 바꾼다. 그때 `peak-limiter` 시험의 연결 단언과 이 보고서의 그래프를 같이 고쳐야 한다. **→ S1.5 에서 처리**: `test:peak-limiter`·`s1-4a-output-stage.spec.ts` 의 연결 단언을 새 그래프에 맞췄고, 위 그래프에는 주석을 달았다.
  - 문자열 워클릿 7개는 그대로다(Step 범위 밖). 엔진·스토어를 묶는 Node 시험은 `workerUrlStub` 이 필요하다 — 엔진에 `?worker&url` 워클릿을 더하는 Step(S1.5)은 새 시험에도 같은 플러그인을 붙여야 한다. **→ S1.5**: 문자열 워클릿은 6개가 됐다(옛 하울 가드를 지움). 엔진을 번들하는 기존 Node 시험은 이미 `workerUrlStub` 을 쓰고 있어 `?worker&url` 워클릿 둘(`level-meter`·`output-guard`)을 더해도 추가 조치가 필요 없었다(`npm test` 30/30).

---

## S1.4b Cab 음량 보정

- 브랜치·병합: `refactor/s1-4b-cab-makeup` → `phase/1`. **S1.4c 와 같은 배포에 넣는다**(둘 다 `phase/1` 에 모여 Phase 1 배포 때 함께 나간다).
- 해결 항목: R1-5 중 'Cab 켬/끔 음량 차'(D7 1단계). **HEAD 에서 이미 대부분 고쳐져 있었다** — `cabinet.ts` 의 `calibrateCabinet` 이 IR 을 기준 음량에 맞추고 `CabEffect` 는 `normalize = false` 다(코드 지도의 S1.4b 행, L-34). 시작 시점의 P-04 는 기본 −0.16 dB, 15가지 중 최대 1.58 / 1.73 dB 였다. 그래서 이 Step 은 설계서의 '에너지 정규화(Σh² = 1)를 새로 넣는' 일이 아니라 ① 남은 원인(IR 피크 ≤ +8 dB 계약이 마이크 끝·먼 거리에서 기준 음량 보정을 막음)을 **IR 밖의 보충 이득**으로 풀고 ② 모델별 보정표를 두고 ③ P-04 를 판정으로 바꾸는 일이었다(L-34~L-36).
- 변경 파일(기준선 JSON·이 보고서를 뺀 6개): `src/audio/utils/cabinet.ts`, `src/audio/nodes/CabEffect.ts`, `scripts/cabinet-response-analysis.mjs`, `docs/baseline/tolerances.json`(`criteria` 1개)·`README.md`, `docs/REFACTOR_LOG.md`(L-34~L-37), `docs/baseline/audio-probe.json`(별도 커밋 `baseline: S1.4b …`). 정규식 단언 목록(`regex-assertions.md`)은 바뀐 시험 파일에 정규식 단언이 없어 다시 만들지 않았다(생성 결과가 같음). 프리셋 정의·저장 형식·화면은 건드리지 않았다.

**동작**

```text
createCabinet(모델, 마이크, 거리) ─▶ IR(음색·피크 ≤ +8 dB 계약은 그대로)
                                  └▶ makeupDb = min(6, 피크 상한으로 못 채운 부족분 + 모델 보정표)
CabEffect ─▶ ConvolverNode(IR) ─▶ convolvedGain(= 10^(makeupDb/20)) ─┐
          └▶ bypassGain(0 또는 1) ──────────────────────────────────┴▶ highCut ─▶ presence ─▶ 출력
```

- 보충 이득은 켬/끔 음량이 같아지도록 합성 경로에만 곱한다. 사용자 IR(`setCustomImpulse`)과 모델 `off` 에는 쓰지 않는다(L-37).
- 모델별 보정표 `CAB_LEVEL_TRIM_DB`(dB, 켠 쪽이 이만큼 더 커짐): v30 +0.2 · greenback −0.5 · blue −0.4 · jensen −0.6 · tweed +0.2. 보충 상한 `MAX_CAB_MAKEUP_DB` = 6 dB(전 범위 실사용 최대 약 4.4 dB).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| P-04: REF-PC 로 Cab 켬/끔 RMS 차 ≤ 1.5 dB — 모든 모델과 마이크 양끝(0·100)에서 | 충족 | 15조합 모두 ±0.2 dB 안(최대 0.17 / 0.19 dB). `tolerances.json` 에 `P-04.maxAbsDiffDb` ≤ 1.5 추가(GS-3) |
| Cab 을 쓰는 프리셋 음량이 바뀌는 것은 정상(S1.4c 에서 다시 맞춤) | 해당 | P-05 +0.02 ~ +0.20 dB(Cab 을 쓰는 39개 프리셋) — 설계서가 걱정한 +15 dB 는 현재 코드에 없다(L-37) |
| IR 모양(음색) 변경 없음 | 충족 | IR 에 곱하는 배율 계산은 그대로다. 보충 이득은 IR 밖에 있고 `test:cabinet-response` 의 IR 단언(피크 ≤ +8 dB, 기준 음량 상한, 좌우 채널 같음)이 그대로 통과한다 |
| 프리셋 값 변경 없음 | 충족 | 프리셋 정의(`presetStore.ts`)는 변경 없음 |

**전후** — P-04 Cab 켬/끔 RMS 차(dB, 44.1 / 48 kHz, 양수 = 켠 쪽이 큼)

| 모델 | 마이크 0 | 마이크 55 | 마이크 100 |
|---|---|---|---|
| v30-4x12 | −0.05 / −0.05 → +0.15 / +0.15 | −0.16 / −0.16 → +0.04 / +0.04 | −1.58 / −1.73 → −0.10 / −0.10 |
| greenback-4x12 | +0.58 / +0.58 → +0.08 / +0.08 | +0.53 / +0.54 → +0.03 / +0.04 | +0.44 / +0.43 → −0.06 / −0.07 |
| blue-1x12 | +0.53 / +0.52 → +0.13 / +0.12 | +0.44 / +0.45 → +0.04 / +0.05 | −1.02 / −1.15 → −0.17 / −0.19 |
| jensen-1x12 | +0.72 / +0.71 → +0.12 / +0.11 | +0.62 / +0.61 → +0.02 / +0.01 | +0.47 / +0.46 → −0.13 / −0.14 |
| tweed-1x10 | −0.09 / −0.08 → +0.11 / +0.12 | −0.18 / −0.20 → +0.02 / +0.00 | −0.26 / −0.27 → −0.06 / −0.07 |
| **최대 절댓값** | 1.58 / 1.73 → **0.17 / 0.19** | | |
| **기본(V30, 마이크 55)** | −0.16 / −0.16 → **+0.04 / +0.04** | | |

| 그 밖의 측정 | 전 | 후 |
|---|---|---|
| P-03 보정 없는 최악 조합 피크(리미터 없음, 44.1 / 48 kHz) | +68.43 / +67.95 dBFS | +68.63 / +68.15 dBFS(기본 Cab 이 +0.2 dB). 리미터 있음은 −1.000 dBFS 그대로 |
| P-05 프리셋 음량 최소 · 중앙값 · 폭 | −33.61 · −16.29 · 21.47 dB(44.1 kHz) | −33.41 · −16.17 · 21.29 dB — 48 kHz 는 −33.70 · −16.45 · 21.58 → −33.50 · −16.27 · 21.40 |
| P-05 프리셋별 변화 | — | 39개가 +0.02 ~ +0.20 dB: +0.02 ~ +0.04 는 14개(−12 ~ −14 dBFS 의 큰 프리셋 — 마스터 리미터가 올라간 분을 눌렀을 것으로 *추정*, 확인하지 않음), +0.09 ~ +0.16 은 6개, +0.20 은 19개(클린·앰비언트 계열). `direct-clean`(Cab 없음)은 0 |
| P-23 최대 클릭 비율(44.1 / 48 kHz) | +1.01 / +1.22 dB | +0.97 / +1.18 dB. 48 kHz 의 '컴프레서 켬' 항목(−2.16 → −2.10 dB)이 허용 폭 ±0.05 를 넘어 기준선을 갱신했다(Cab 레벨 +0.2 dB 가 이 항목의 비선형 구간에 닿는 정도를 바꾼 것으로 *추정*, 추적하지 않음). 새 노드 0개는 그대로 |

- 새 시험: `test:cabinet-response` 확장 — ① 보정표의 키가 모델 목록과 같고 |값| ≤ 1 dB ② 200개 조합(샘플레이트 2 × 모델 5 × 마이크 5곳 × 거리 4곳)에서 `IR 기준 음량 + 부족분 = 0 dB(±0.02)`, 부족분 ≥ 0, 보충 ≤ 6 dB, `off` 는 0, 상한에 걸리는 조합이 실제로 있음(77개가 0.05 dB 넘는 보충 필요, 최대 4.54 dB — 표 포함). P-04 는 `tolerances.json` 판정 기준으로 `npm test` 의 `test:probe` 가 지킨다.
- 검증: `npx tsc -b --noEmit`, `npm run lint`, `npm run build`, `npm test` 29/29(165초) 통과. 병합 뒤 `npm run e2e` 56/56(2.6분) 통과(화면·저장 형식은 바꾸지 않았다).
- 만난 문제
  - TS2416 — `CabEffect` 의 새 필드 `makeupGain` 이 `BaseEffect.makeupGain: GainNode` 와 이름이 겹쳐 `cabinetMakeup` 으로 바꿨다.
  - 처음 계획한 Σh² = 1 정규화는 측정해 보고 접었다: 기준 보정 뒤 IR 에너지가 조합마다 6.5 dB 흩어져 있어(L-34) 켬/끔 차가 마이크·거리에 따라 같은 폭으로 흔들린다.
- 사람 확인 필요
  - **Cab 켬/끔을 귀로 비교**(헤드폰, 볼륨 낮게). 같은 연주에서 Cab 페달을 켜고 끌 때 음량 차가 거슬리지 않는지. 특히 'British Crunch'·'Plexi Lead'·'Thrash Rhythm' 같은 왜곡 프리셋(체인 단위 켬/끔은 스펙트럼이 달라져 정적 이득으로 못 맞춘다).
  - **모델 5가지 × 마이크 위치 양끝**으로 바꿔 가며 음량이 튀지 않는지(보정표는 REF-PC 로 잰 값이라 실제 기타와 다를 수 있다).
  - 사용자 IR 을 올려 켠 상태 음량(브라우저 정규화 그대로, L-37).
- 남은 위험
  - 사용자 IR 경로는 `normalize = true` 그대로라 켬/끔 음량 차가 보장되지 않는다 — D7 2단계(S3.2·S5.4)에서 같은 기준으로 맞춘다.
  - 체인 단위 켬/끔 차(왜곡 뒤 Cab)는 측정하지 않았다. P-04 는 REF-PC 를 Cab 만 지나게 한다.
  - P-05 음량 폭은 약 21.3 dB 로 그대로다 — S1.4c(프리셋 음량 맞춤)에서 줄인다. S1.4b 만 배포하면 안 된다(S1.4c 와 같은 배포 원칙 유지).
  - 보정표 값은 모델 5개 기준이다. IR 모델이 늘면(S3.2·S5.4) 같은 방식으로 다시 재야 한다(`test:cabinet-response` 가 표의 키가 모델 목록과 같은지 확인한다).

---

## S1.4c 프리셋 음량 정렬

- 브랜치·병합: `refactor/s1-4c-preset-trims` → `phase/1`. **S1.4b 와 같은 배포에 넣는다**(둘 다 `phase/1` 에 모여 Phase 1 배포 때 함께 나간다).
- 해결 항목: R1-5 중 '프리셋 사이 음량 차이'(D6). 시작 시점의 폭은 설계서의 27 dB 가 아니라 **21.3 dB**(−33.4 ~ −12.1 dBFS)였다 — S1.4a·S1.4b 가 이미 일부 줄여 놓았다.
- 변경 파일: `src/audio/offline/{loudnessSpec,measureLoudness,referenceSignal}.ts`(새 파일 3개 — 기준값·공식, 빠른 렌더 측정, REF-PC 생성기), `src/presets/factoryTrims.json`(새 파일 — 팩토리 40개 trim), `src/audio/engine/OutputStage.ts`·`src/audio/AudioEngine.ts`·`src/audio/offline/renderChain.ts`(trim 노드와 연결), `src/store/{pedalStore,presetStore,historyStore}.ts`·`src/main.tsx`·`src/audio/types.ts`(보정값 저장·복원·실행 취소), `src/components/{PresetPanel,MidiAdvancedControls}.tsx`·`src/styles/panels.css`(표시와 '음량 맞추기' 버튼), `src/audio/testing/{probes,signals}.ts`·`scripts/audio-render-probe.mjs`(P-05), `scripts/compute-preset-trims.mjs`(새 파일, `npm run trims`), `scripts/preset-loudness-regression.mjs`(새 시험), `e2e/tests/s1-4c-preset-loudness.spec.ts`(새 시험), `scripts/{peak-limiter,preset-ab}-regression.mjs`(구조 단언 갱신), `docs/baseline/{tolerances.json,audio-probe.json,README.md}`, `docs/REFACTOR_LOG.md`(L-38~L-43), `docs/refactoring/regex-assertions.md`, `package.json`.

**동작**

```text
REF-PC ─▶ 프리셋 체인 ─▶ presetTrim(trimDb) ─▶ 마스터 게인 ─▶ 하울 가드 ─▶ 리미터(−1 dBFS) ─▶ 스피커·미터·녹음
trimDb = min( 목표(−20 dBFS) − 평균 RMS ,  0 dBFS − 피크 )     ← 오프라인 렌더(보정·리미터 없음)로 잰 값, 0.1 dB 단위, ±24 dB
```

- 팩토리 40개의 trim 은 `npm run trims` 가 계산해 `src/presets/factoryTrims.json` 에 쓴다(P-05 를 44.1·48 kHz 로 렌더해 평균 RMS 는 평균하고 피크는 큰 쪽을 쓴다). 기준값(목표 −20, 허용 ±2, D6 예외, 리미터 허용 감소량 1 dB)은 `loudnessSpec.ts` 한 곳에만 있고, 바꾸면 이 스크립트를 다시 돌린다. `test:preset-loudness` 가 JSON 과 상수가 어긋나면 실패한다.
- 사용자 프리셋은 '음량 맞추기' 버튼이 같은 코드로 현재 체인에 REF-PC 4초를 오프라인으로 흘려 보내 보정값을 정한다(스피커로는 소리가 나가지 않는다). 보정값은 프리셋·페달 저장본·내보내기 JSON 에 `trimDb`(없으면 0)로 함께 저장되고, A/B 슬롯과 실행 취소·다시 실행도 페달과 한 쌍으로 따라간다.
- 목표까지 올리면 리미터가 1 dB 넘게 눌러야 하는 프리셋은 피크가 0 dBFS 에 닿는 곳에서 멈춘다(GS-7 우선, L-40). 버튼을 눌렀을 때 그렇게 멈추면 화면 글이 이유를 알려 준다.

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| P-05: 팩토리 40개 REF-PC 출력 RMS −20 ± 2 dBFS(D6 예외 프리셋은 그 목표) | 충족(예외 1개) | 프리셋 목표에서 최대 0.53 / 0.96 dB(44.1 / 48 kHz). 표준 목표(−20)에서는 'Acoustic Room' 만 −2.7 / −2.4 dB 로 ±2 밖(피크 여유와 맞바꿈, L-40). 'Headphone Safe Start' 는 D6 예외로 −26 dBFS(L-38) |
| 클린 ↔ 드라이브 전환 RMS 변화 ≤ 4 dB ★(보정 전 약 21 dB) | 충족 | 최대 3.20 / 2.66 dB(Acoustic Room ↔ Post Rock Wash / Vintage Fuzz). Acoustic Room 을 빼면 약 1.7 dB. D6 예외 프리셋은 이 판정에서 뺀다 |
| REF-PC 에서 리미터 최대 감소량 ≤ 1 dB(GS-7) ★ | 충족 | 최대 0.95 / 0.98 dB. **평균만 −20 에 맞췄을 때는 7개 프리셋이 1.0 ~ 3.4 dB 로 못 지켰다**(L-40) |
| '음량 맞추기' 가 사용자 프리셋을 −20 ± 1 dBFS 에 맞춘다 | 충족(피크 제한 프리셋 제외) | 4초 렌더가 8초 렌더와 최대 0.43 / 0.53 dB 차이(`quickMeasureErrorDb.*`). 2초는 1.5 dB 까지 어긋나 4초로 늘렸다(L-39). e2e: 'Texas Push' 에서 버튼 값이 팩토리 값과 ±1 dB. 피크 제한(순간 피크가 큰 클린)은 −20 까지 못 올라간다 |
| 'Headphone Safe Start' ↔ 'Texas Push' 전환에서 음량이 크게 튀지 않는다 | 부분 충족 | 5.9 / 6.1 dB(보정 전 약 27 dB). D6 예외(−26 dBFS)를 둔 대가이며 예외를 지우면 약 0 dB(L-38) |
| 보정값이 저장·복원·내보내기·가져오기·A/B·실행 취소에서 유지된다 | 충족 | `test:preset-loudness`, e2e 4개(L-42) |

**전후** — P-05 프리셋별 REF-PC 출력 RMS(dBFS), trim(dB), 리미터 감소량(dB). 전 = S1.4b 까지의 소리(보정 없음 + 리미터, 이전 기준선), 후 = 팩토리 보정 + 리미터. † 피크 여유 때문에 −20 에 못 미침, ‡ D6 예외(−26 dBFS)

| 프리셋 | 전 RMS (44.1 / 48 kHz) | trim | 후 RMS (44.1 / 48 kHz) | 리미터 감소 후 (44.1 / 48 kHz) |
|---|---|---|---|---|
| Clean Practice | −23.2 / −23.2 | +3.2 dB | −20.0 / −20.0 | 0.70 / 0.66 |
| Studio Clean † | −24.8 / −25.0 | +4.8 dB | −20.1 / −20.3 | 0.94 / 0.96 |
| Warm Jazz Clean | −23.8 / −24.5 | +4.1 dB | −19.7 / −20.4 | 0.22 / 0.18 |
| Bright Pop Clean † | −26.0 / −26.2 | +5.4 dB | −20.6 / −20.8 | 0.75 / 0.93 |
| Funk Comp † | −33.4 / −33.5 | +12.7 dB | −20.7 / −20.8 | 0.93 / 0.97 |
| Country Twang † | −29.0 / −29.0 | +8.4 dB | −20.6 / −20.6 | 0.88 / 0.98 |
| Edge Breakup | −13.0 / −12.9 | −9.3 dB | −20.1 / −20.0 | 0.00 / 0.00 |
| Acoustic Room † | −27.1 / −26.8 | +4.4 dB | −22.7 / −22.4 | 0.88 / 0.91 |
| Blues Lead | −14.4 / −14.4 | −8.9 dB | −19.9 / −20.1 | 0.00 / 0.00 |
| Texas Push | −14.4 / −14.3 | −10.9 dB | −20.1 / −19.9 | 0.00 / 0.00 |
| Chicago Blues | −12.5 / −12.5 | −10.5 dB | −20.0 / −20.0 | 0.00 / 0.00 |
| Delta Slap | −12.6 / −12.5 | −10.5 dB | −20.1 / −20.0 | 0.00 / 0.00 |
| Soulful Neck | −14.0 / −14.2 | −6.9 dB | −19.8 / −20.1 | 0.00 / 0.00 |
| Classic Rock | −12.6 / −12.6 | −10.1 dB | −20.1 / −19.9 | 0.00 / 0.00 |
| British Crunch | −13.2 / −13.4 | −7.1 dB | −19.9 / −20.1 | 0.00 / 0.00 |
| Plexi Lead | −13.6 / −13.3 | −6.9 dB | −20.1 / −19.8 | 0.00 / 0.00 |
| Arena Solo | −13.8 / −13.8 | −12.8 dB | −20.0 / −20.0 | 0.00 / 0.00 |
| Punk Rhythm | −13.2 / −13.3 | −12.3 dB | −20.0 / −20.0 | 0.00 / 0.00 |
| Indie Jangle | −19.3 / −19.2 | −0.8 dB | −20.1 / −20.0 | 0.89 / 0.87 |
| Tight Modern Metal | −13.6 / −13.7 | −11.5 dB | −20.0 / −20.0 | 0.00 / 0.00 |
| Thrash Rhythm | −14.1 / −14.1 | −6.2 dB | −20.0 / −20.0 | 0.00 / 0.00 |
| Djent Gate | −14.0 / −14.0 | −10.5 dB | −20.0 / −19.9 | 0.00 / 0.00 |
| Liquid Metal Lead | −13.1 / −13.9 | −12.5 dB | −20.0 / −20.1 | 0.00 / 0.00 |
| Doom Wall | −12.3 / −12.4 | −7.8 dB | −19.9 / −20.1 | 0.00 / 0.00 |
| Ambient Delay | −27.2 / −26.1 | +6.7 dB | −20.5 / −19.4 | 0.05 / 0.06 |
| Tape Swell † | −32.2 / −29.9 | +10.9 dB | −21.3 / −19.0 | 0.92 / 0.93 |
| Post Rock Wash | −13.8 / −14.7 | −6.0 dB | −19.5 / −20.5 | 0.00 / 0.00 |
| Dotted Eighth | −20.8 / −20.3 | +0.5 dB | −20.3 / −19.8 | 0.00 / 0.00 |
| Dream Clean | −27.6 / −28.0 | +7.8 dB | −19.9 / −20.3 | 0.39 / 0.40 |
| Fuzz Experiment † | −20.8 / −21.5 | +0.3 dB | −20.5 / −21.2 | 0.95 / 0.98 |
| Vintage Fuzz | −13.8 / −13.5 | −8.4 dB | −20.2 / −19.7 | 0.00 / 0.00 |
| Gated Velcro | −17.9 / −17.9 | −2.1 dB | −20.0 / −20.0 | 0.00 / 0.00 |
| Broken Speaker | −18.2 / −18.2 | −1.8 dB | −20.0 / −20.0 | 0.00 / 0.00 |
| Stoner Fuzz | −12.1 / −12.1 | −8.4 dB | −20.0 / −19.9 | 0.00 / 0.00 |
| Direct Clean | −26.8 / −26.8 | +6.8 dB | −20.0 / −20.0 | 0.00 / 0.00 |
| Headphone Safe Start ‡ | −29.9 / −30.0 | +3.9 dB | −26.0 / −26.1 | 0.00 / 0.00 |
| Low Noise Gate | −26.3 / −26.3 | +6.3 dB | −20.0 / −20.0 | 0.72 / 0.68 |
| Solo Boost | −13.8 / −13.4 | −9.0 dB | −20.3 / −19.8 | 0.00 / 0.00 |
| Dark Room | −25.0 / −25.1 | +5.1 dB | −19.9 / −20.0 | 0.04 / 0.06 |
| Bright Cut | −24.0 / −24.2 | +4.1 dB | −19.9 / −20.1 | 0.46 / 0.47 |

| 요약 | 전 | 후 |
|---|---|---|
| 40개 프리셋의 RMS 범위(44.1 / 48 kHz) | −33.4 ~ −12.1 · −33.5 ~ −12.1 (폭 21.3 / 21.4 dB, 중앙값 −16.2 / −16.3) | −26.0 ~ −19.5 · −26.1 ~ −19.0 (폭 6.4 / 7.0 dB, 중앙값 −20.0 / −20.0) |
| 클린↔드라이브 전환 최대(44.1 / 48 kHz) | 21.3 / 21.4 dB | 3.20 / 2.66 dB |
| REF-PC 에서 리미터가 눌러야 하는 최대 양(44.1 / 48 kHz) | 8.4 / 8.5 dB(보정 없이 가장 큰 프리셋 — 리미터가 소리를 크게 깎고 있었다. 리미터 없이는 −33.4 ~ −7.2 dBFS, 폭 26.2 dB) | 0.95 / 0.98 dB |
| '음량 맞추기' 4초 vs 8초 최대 오차(44.1 / 48 kHz) | 2초 렌더: 1.09 / 1.51 dB | 4초 렌더: 0.43 / 0.53 dB |

전환 폭이 가장 큰 5쌍(D6 예외 프리셋 제외) — 44.1 kHz: Acoustic Room ↔ Post Rock Wash 3.20, ↔ Soulful Neck 2.88, ↔ Doom Wall 2.83, ↔ Blues Lead 2.78, ↔ British Crunch 2.78 dB. 48 kHz: Acoustic Room ↔ Vintage Fuzz 2.66, ↔ Solo Boost 2.64, ↔ Dotted Eighth 2.61, ↔ Plexi Lead 2.60, ↔ Classic Rock 2.51 dB. 가장 큰 쌍이 모두 Acoustic Room 이라 이 프리셋만 빼면 최대 약 1.7 dB 다.

- 새 시험: `test:preset-loudness`(30번째 시험) — 공식(반올림·한도·피크 여유·무작위 2,000회 확인)·REF-PC 해시 4개 고정·`factoryTrims.json` 과 상수·프리셋 목록의 일치·페달 저장본(저장·복원·이전 형식·이상한 값)·프리셋 저장/내보내기/가져오기·A/B 슬롯·실행 취소/다시 실행·엔진 램프(30 ms). e2e `s1-4c-preset-loudness.spec.ts` 4개 — 보정값 표시, '음량 맞추기'(팩토리 값과 ±1 dB), 새로고침 뒤 유지, 실행 취소. `tolerances.json` 에 P-05 판정 기준 10개를 더했다.
- 검증: `npx tsc -b --noEmit`, `npm run lint`, `npm run build` 통과. `npm test` 30/30(282초, `test:probe` 262초 포함 — 새 기준선과 판정 기준 10개로 비교) 통과. `npm run e2e` 60/60(2.5분, 새 4개 포함) 통과.
- 만난 문제
  - 2초 렌더는 시간계열 프리셋(Ambient Delay·Tape Swell·Post-Rock Wash)에서 8초 렌더와 최대 1.5 dB 어긋났다 → 4초(L-39).
  - 평균만 맞추면 리미터가 1 dB 를 넘게 눌렀다(GS-2 와 GS-7 의 충돌) → 피크 여유 규칙(L-40).
  - 처음 e2e 에서 '기본 페달 설정' 이 `window.confirm` 으로 막혀 보정값이 0 으로 안 돌아왔다 → 시험에서 대화상자를 확인 처리했다(앱 문제 아님).
- 사람 확인 필요
  - **D6 값(−20 dBFS)을 실제 기타로 들어 확정**(상수 하나 `PRESET_TARGET_RMS_DBFS`, 바꾸면 `npm run trims`).
  - **'Headphone Safe Start' −26 dBFS 예외를 유지할지**, 'Headphone Safe Start' ↔ 'Texas Push' 전환(6 dB)이 괜찮은지, 'Solo Boost' 가 표준 목표(−20)로 충분한지(L-38).
  - 피크 제한을 받은 프리셋(Acoustic Room −2.7 / −2.4, Fuzz Experiment −0.5 / −1.2, Tape Swell −1.3 / +1.0 dB 등)이 귀로 너무 작지 않은지 — 작다면 평균을 우선하는 쪽으로 바꿀지(L-40).
  - 실제 기타·헤드폰으로 프리셋을 오가며(클린 ↔ 드라이브) 음량이 튀지 않는지, Cab 켬/끔 때도 거슬리지 않는지.
  - 휴대폰에서 '음량 맞추기' 가 끝나기까지 걸리는 시간(4초 렌더), 화면 글이 이해되는지.
  - 사용자가 올린 캐비닛 IR 을 켠 상태에서 '음량 맞추기' 결과(오프라인 측정은 내장 IR 만 쓴다, L-43).
- 남은 위험
  - REF-PC 는 합성 신호라 실제 기타의 피크·평균 비(crest)와 다르다. 실제 연주에서는 리미터 감소량·평균이 표와 다를 수 있다(D6 청취 확정 전까지 잠정).
  - Tape Swell(2.2 dB)·Ambient Delay(1.2)·Post-Rock Wash(1.0)·Solo Boost(0.5)는 샘플레이트에 따라 음량이 다르다. trim 은 두 샘플레이트의 평균이라 한쪽에서 최대 약 1.1 dB 어긋난다(표의 †/후 값 참고). 샘플레이트에 따라 소리가 달라지는 원인은 조사하지 않았다(S3 이후 후보).
  - 사용자 프리셋의 '음량 맞추기' 는 빠른 렌더가 8초 렌더 피크보다 최대 0.46 dB 낮게 재서 리미터 감소량이 1.5 dB 쯤까지 갈 수 있다. 다른 샘플레이트·사용자 IR 은 반영되지 않는다.
  - 이후 Step 이 소리를 바꾸면(S3.x 의 DSP 수정) 팩토리 trim 을 다시 계산하고 P-05 기준선을 같은 Step 에서 갱신해야 한다(S3.8 에서 재확인).

---

## S1.5 출력 가드와 MonitorService (하울링 감지 v2)

- 브랜치·병합: `refactor/s1-5-output-guard` → `phase/1`.
- 해결 항목: R1-2(하울링 보호가 대부분의 상황에서 동작하지 않음), 기반으로 R2-8·R2-10. **HEAD 에 하울링 가드가 이미 있었다** — 문자열 워클릿 `howl-guard-processor.ts` 가 `OutputStage` 안에서 출력 RMS 0.08(≈ −22 dBFS)이 1.5초 안정이면 차단했고, 오디오 스레드라 탭·화면과는 무관했다(L-45). 그래서 이 Step 은 ① 판정을 **입력 쪽** '줄지 않는 한 음'(부록 B)으로 **교체**하고(출력 레벨 기준 판정을 쓰지 않는 것은 `docs/prompts/phase-0-1.md` 의 S1.5 금지 사항이다), ② 레벨 측정(막대·클리핑·자동 채널 판정의 입력)을 오디오 스레드의 `level-meter` 워클릿으로 옮기고, ③ `MonitorService`·`monitorStore` 로 워클릿 메시지를 화면과 세션 정지(`howl-cut` → `stop('howl')`)에 잇는 일이다(L-44, L-45).
- 변경 파일(기준선 JSON·문서를 뺀 29개, 신규 9개·삭제 1개, +2,979 / −375줄): 새로 만든 것 — `src/audio/engine/guardSpec.ts`(수치·메시지 모양)·`monitorNodes.ts`(노드 만들기), `src/audio/monitor/howlDetector.ts`(판정 코어, Web Audio 와 무관한 순수 계산)·`levelReading.ts`·`MonitorService.ts`, `src/store/monitorStore.ts`, `src/audio/worklets/level-meter.worklet.ts`·`output-guard.worklet.ts`, `e2e/tests/e03-howl.spec.ts`. 지운 것 — `howl-guard-processor.ts`. 고친 것 — `AudioEngine.ts`(그래프·가드 모드·차단 핸들러), `InputStage.ts`(채널 분석 노드와 폴링을 없애고 `onChannelLevels` 가 측정 시각을 받게 함, `meteredChannels` 추가), `OutputStage.ts`(리미터 뒤 출력 미터 자리, 리미터 노드 노출), `MeterNode.ts`(파형 전용), `Meter.tsx`(monitorStore 읽기), `audioStore.ts`(차단 때 주파수 전달), `ConnectGuitarPanel.tsx`(안내 문구), `limiter.worklet.ts`(감소량 보고), `urls.ts`·`workletModules.ts`·`vite-env.d.ts`, `offline/renderChain.ts`(`monitoring`·`guardMode`·포트 닫기), `testing/probes.ts`(P-07·P-17), 시험 `scripts/howl-guard-regression.mjs`(다시 씀)·`input-stage-regression.mjs`·`peak-limiter-regression.mjs`, e2e `helpers/mocks.ts`·`s1-4a-output-stage.spec.ts`·`e01-teardown.spec.ts`. 기준선 JSON 은 별도 커밋(`baseline: S1.5 …`).

**그래프** — 입력은 가드에 두 번 들어간다(0 = 프로그램 소리를 지나가며 무음 처리됨, 1 = 분석 전용). 스피커·녹음·파형이 모두 리미터와 출력 레벨 미터 **뒤**에서 갈라진다.

```text
소스 ─▶ level-meter#in ─▶ InputStage ─▶ inputGain ─┬▶ 이펙트 체인 ─▶ presetTrim ─▶ masterGain ─▶ output-guard(입력 0) ─▶ limiter ─▶ level-meter#out ─┬▶ 스피커
                                                   ├▶ 튜너(켰을 때)                                                                                      ├▶ 녹음(녹음 중에만)
                                                   └▶ output-guard(입력 1, 마이크 입력일 때만 — 분석 전용)                                               └▶ 파형 분석
```

| 판정(부록 B, D9) | 값 | 비고 |
|---|---|---|
| 분석 | 창 2048 샘플(Hann)·hop 1024, 80 Hz~8 kHz, 상위 피크 8개(±2빈)의 에너지 ≥ 0.80 | 숫자는 부록 B 그대로 |
| 후보 프레임 | RMS ≥ −50 dBFS, 기준 음높이 ±20 cents | 레벨이 하한 아래면 FFT 를 건너뜀(판정 같음) |
| 차단 | 후보가 1.0초 이어지고 레벨 기울기 ≥ −1.0 dB/s(줄지 않음) → 10 ms 램프로 무음 → `howl-cut` | 파일 모드·'하울링 보호' 끔은 판정 안 함 |
| **보강 셋(L-44)** | 새 음 재시작(0.1초 안에 +6 dB)·기울기 앞 2프레임 제외·기준 음 붙들기(기준 음이 가장 큰 피크와 3 dB 안이면 바꾸지 않음) | 부록 B 에 없는 절차. 숫자는 안 바꿈. 하나씩 끄면 48 kHz G-1 오차단 / 48 kHz H-4 놓침 / −1.1 dB/s 감쇠음 오판 |

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| H-1 → 1.5초 안에 차단 — 데스크톱, 휴대폰 모든 탭, 문서 숨김 | 충족(문서 숨김은 **흉내**) | E-03: 데스크톱·휴대폰 입력/미터/프리셋 탭·문서 숨김(흉내) 모두 1.054초(앞선 실행은 1.054~1.077초). 오디오 시계로 잰 값(L-49). 휴대폰 '페달' 탭은 S1.6 에서 생기면 더한다 |
| H-2 → 1.5초 안에 차단 | 충족 | P-07 1.32 / 1.30초(여유 약 0.2초) |
| H-3 → 1.5초 안에 차단 | 충족 | P-07 1.041 / 1.023초 |
| H-4(기본 구성 + 입력 이득 +20 dB, 다섯 음의 합) → 차단 | 충족 | P-07 1.041 / 1.023초 (`inputGainDb: 20`) |
| G-1·G-2·G-3 60초 → 오차단 0 | 충족 | P-07 `falseCuts` 0 (44.1 / 48 kHz) |
| 파일 모드 H-1 → 차단 없음(리미터만) | 충족 | P-07 `disabledModeCuts` 0, 출력 −23.9 dBFS 유지 · E-03 파일 모드 시험 |
| 차단 시 녹음 파일이 남음(S1.2 경로) | 충족 | E-03 녹음 시험: 차단 99 ms 안에 정리 끝, '녹음은 저장했습니다' 안내, '다운로드' 켜짐, 받은 파일 길이가 녹음한 시간과 ±0.5초 안(0.78초 / 0.74초)이고 소리가 있음 |
| P-17: 가드·미터가 늘린 렌더 시간 ≤ 페달 처리의 5% ★(설계서가 정한 초기 목표치) | 충족(렌더 시간 대용) | `monitorOverheadOverPedals` 0.033 / 0.025 (라운드 5번 가운뎃값) |
| 판정 수치(부록 B)를 바꾸지 않는다 / 출력 레벨 기준으로 되돌리지 않는다 | 충족 | 숫자는 그대로, 절차만 보강(L-44). 출력 레벨은 보지 않는다 |

**P-07 판정 매트릭스** (오프라인 렌더, 장치 모드 가드, 44.1 kHz / 48 kHz)

| 신호 | 기대 | 결과 |
|---|---|---|
| H-1 1 kHz 순음 −20 dBFS | 차단 ≤ 1.5초 | 1.041초·1000 Hz / 1.023초·1000 Hz |
| H-2 2.5 kHz −50 → −6 dBFS | 차단 ≤ 1.5초 | 1.32초·2500 Hz / 1.30초·2500 Hz |
| H-3 800 Hz 왜곡 | 차단 ≤ 1.5초 | 1.041초·800 Hz / 1.023초·800 Hz |
| H-4 80·200·500·1250·3200 Hz 다섯 음의 합(−12 dBFS), 기본 구성 + 입력 이득 +20 dB | 차단 ≤ 1.5초 | 1.041초·1250 Hz / 1.023초·500 Hz |
| G-1 196 Hz 서스테인 리드(배음 10개, −4 dB/s 감쇠, 5 Hz ±15센트 비브라토, 4초씩 60초) | 오차단 0 | 0회(알림 6 / 45회) |
| G-2 110 Hz 톱니파 스트럼(4초에 −55 dB 감쇠)을 2초마다 다시 침, 60초 | 오차단 0 | 0회(알림 90 / 90회) |
| G-3 −70 dBFS 잡음 60초 | 오차단 0 | 0회(알림 0 / 0회) |
| 파일 모드 H-1 · 보호 끔 H-1 | 차단 없음 | 0회 · 0회(출력 −23.9 dBFS 유지) |

H 신호는 모두 차단 뒤 출력이 완전한 무음(−200 dB)이다. '알림'은 후보 구간이 이어지는 동안 0.25초마다 내는 진행 알림(`howl-suspect`, 로그용)의 수라 차단과는 별개이고, 후보 구간은 최장 766 ms 에서 끊겼다(1.0초 미만). H-4 는 다섯 음이 섞여 있어 어느 음으로 보고하는지가 샘플레이트에 따라 달랐다(1250 / 500 Hz — 둘 다 신호에 있는 음).

**E-03 하울링 차단 (e2e, 마지막 전체 실행의 값 — 앞선 실행에서는 차단 1.054~1.077초, 정리 65~224 ms)**

| 시험 | 입력에 들린 때 → `howl-cut` (오디오 시계) | 차단 → 정리 끝 |
|---|---|---|
| 데스크톱 | 1.054초, 1000 Hz | 85 ms |
| 휴대폰 '입력' 탭 | 1.054초 | 116 ms |
| 휴대폰 '미터' 탭 | 1.054초 | 95 ms |
| 휴대폰 '프리셋' 탭 | 1.054초 | 70 ms |
| 문서 숨김(흉내) | 1.054초, 차단 때 `visibilityState` = hidden | 마이크 트랙 ended·컨텍스트 closed 를 8초 안에 확인(시간은 재지 않음) |
| 녹음 중 차단 | 1.054초 | 99 ms · 받은 파일 길이 0.78초(녹음한 시간 0.74초), 최대 진폭 0.9155 |
| 파일 모드 · '하울링 보호' 끔 | 차단 없음(세션 유지, 토스트 없음) | — |

'차단까지' 시간은 입력 레벨 미터의 보고 간격(약 0.02초) 단위로 재서 실행마다 한 칸쯤 흔들린다. 모두 시험이 단언하는 범위(0.95~1.5초) 안이다.

**P-17 전후** (44.1 kHz / 48 kHz)

| 측정 | 전(S1.4c) | 후 |
|---|---|---|
| 측정 방식 | 구성별 최솟값끼리 나눔 | 구성을 라운드마다 섞어 5번, 같은 라운드끼리 나눈 비율의 가운뎃값(L-46) |
| 모두 꺼짐 ÷ 모두 켬 | 0.632 / 0.595 | 0.659 / 0.554 (기준선 허용 ±0.3 안) |
| 가드·미터가 더한 시간 ÷ 15개 페달 처리 시간 | — | **0.033 / 0.025** (기준 ≤ 0.05, 되풀이 0.026~0.037) |
| 모두 켬 구성에서 늘어난 비율(참고) | — | 0.027 / 0 |

- 새 시험: `test:howl`(다시 씀, 4.7초) — 판정 수치가 부록 B 와 같음·FFT 정의와 센트 단위 주파수 풀이·실제 신호 H-1~H-4/G-1~G-3 의 차단 시각(44.1·48 kHz)·'글자 그대로' 판정과 비교한 보강 셋의 근거(하나씩 끄기)·줄어드는 음 −0.5/−1.1/−1.5/−3 dB/s·음높이가 바뀌는 음·잡음·`level-meter`/`output-guard` 워클릿을 `vm` 에서 돌린 시험(메시지 모양, 무음 램프, 파일 모드, 리셋)·`levelReading`/`MonitorService`/`monitorStore`·소스 단언(워클릿이 화면·시계 API 에 기대지 않음, 옛 문자열 워클릿 없음, 엔진 배선). e2e E-03 8개. 프로브 P-07(22번째 프로브), P-17 확장, 판정 기준 8개.
- S1.3 에서 넘어온 항목: 채널 레벨 폴링(`measure`·`startMonitoring`)을 없애고 `level-meter#in` 의 측정을 `MonitorService` 가 `onChannelLevels` 로 넘긴다(L-25, L-45). 확인으로 P-06 기준선은 그대로이고(`test:probe` 통과) E-02 8개가 통과한다.
- 검증: `npx tsc -b --noEmit`, `npm run lint`, `npm run build`(프리캐시에 `level-meter.worklet`·`output-guard.worklet`·`limiter.worklet` 3개 포함, 각 1.3 / 7.2 / 1.8 kB), `npm test` 30/30(345.6초, 그중 `test:probe` 320.8초 — 이 실행 중에 가벼운 명령을 함께 돌려 앞선 299.6초보다 길었다), `npm run e2e` 68/68(2.9분, `docs/baseline/e2e.json` 불변). 새 기준선 판정: P-07 기준 7개·P-17 기준 1개 모두 통과, 다른 프로브의 기준선은 그대로(P-06 포함).
- 만난 문제
  - 부록 B 를 글자 그대로 따르면 48 kHz 에서 G-1 을 4.04초에 오차단하고 H-4 를 놓쳤다 → 숫자 대신 절차를 보강(L-44). 하나씩 끄고 재서 어느 보강이 어느 신호를 맡는지 시험으로 고정했다.
  - **전체 프로브가 8분 동안 멈췄다** — 렌더러가 6 GB 에서 OOM 으로 죽었다. 오프라인 렌더가 워클릿 포트에 `onmessage` 를 걸고 닫지 않아 렌더가 끝난 컨텍스트가 GC 되지 않았다 → 끝에 포트를 닫는다(L-47). 고친 뒤 전체 프로브 299.6초, 브라우저 최대 약 2.6 GB.
  - P-17 의 오버헤드 비율이 0.025~0.063 으로 널뛰어 기준 0.05 를 넘나들었다 → 같은 라운드끼리 나눈 가운뎃값으로 재고(0.026~0.037) 가드의 FFT 를 레벨 하한 아래에서 건너뛰게 했다(L-46).
  - 헤드리스 Chrome 이 다른 탭을 앞에 내거나 창을 최소화해도 문서를 숨김으로 만들지 못한다(실측) → E-03 은 숨겨진 탭의 조건을 흉내 낸다(L-49).
  - 처음 쓴 기록에 '예전에는 미터 탭이 보일 때만 감시했다' 고 적었다가 HEAD 코드를 확인하고 정정했다 — 그것은 설계서 기준 커밋(`4ac9cf7`)의 이야기이고, HEAD 의 옛 가드는 이미 오디오 스레드였다(L-45).
- 사람 확인 필요
  - **실제 휴대폰 스피커 + 마이크로 작은 음량 하울링을 내 보고 1.5초 안에 끊기는지**, 끊긴 뒤 마이크 표시등이 꺼지는지, 휴대폰 화면에서 토스트가 잘 보이는지, 녹음 중이었다면 파일이 남는지.
  - **정상 연주가 끊기지 않는지** — 퍼즈 서스테인, 트레몰로 피킹, 볼륨 스웰, EBow·외부 서스테이너, 전원 험(−50 dBFS 이상, 입력 트림을 올린 상태 포함). 측정한 한계로는 창 RMS −50 dBFS 이상의 꾸준한 순음이 1초 이어지면 차단된다(L-44). 오차단이 잦으면 2단계 대안(사람 승인 필요)을 정해야 한다.
  - 부록 B 수치(D9)와 L-44 보강 셋을 실기기·귀로 확인. H-2(커지는 하울링)는 한도 1.5초까지 여유가 약 0.2초다.
  - 실제 다른 탭·화면이 꺼진 상태에서 차단과 정리가 되는지(E-03 의 문서 숨김은 흉내, L-49).
  - 입력 막대가 이제 입력 트림 앞(원신호)을 본다 — 트림을 만지며 쓰는 흐름에서 괜찮은지(L-45). 휴대폰에서 미터 갱신이 매끄러운지.
  - '하울링 보호' 안내 문구가 휴대폰 도크에서 거슬리게 줄바꿈되지 않는지(L-48).
  - 녹음 파일(손실 코덱)의 최대 진폭이 0.9016~0.9155(−0.90~−0.77 dBFS)였다 — S1.4a 의 '녹음 파일 피크 ≤ −1 dBFS' 와 어떻게 볼지(L-49).
- 남은 위험
  - 판정은 '줄지 않는 한 음이 1초'라 일정한 입력(험, 외부 이펙터의 지속음, 서스테이너)을 하울링으로 본다. 분석 대역(80 Hz~8 kHz) 밖의 피드백은 보지 않는다.
  - 보강 셋(L-44)은 부록 B 에 없는 결정이고, 신호 7종과 감쇠음 몇 개로만 검증했다.
  - 오프라인 프로브는 채널 레벨을 입력에서 직접 재서 실시간 경로(포트 메시지 → `onChannelLevels`)의 시각은 흉내 내지 않는다 — 실시간 쪽은 E-03 의 실측(데스크톱 1.054~1.077초)이 근거다.
  - P-17 은 렌더 시간으로 본 대용 지표다. 휴대폰 CPU 의 실제 부하는 사람이 본다.
  - S1.6 이 '페달' 탭을 만들면 E-03 에 그 탭을 더한다(`PHONE` 탭 목록 한 줄). S2.5(4.12 경고 표)가 `monitorStore` 의 값을 쓴다 — 리미터 감소량(`limiterGrDb`)은 아직 화면에 나오지 않는다.
  - 하네스에서 `port.onmessage` 를 거는 코드는 끝에 포트를 닫아야 한다(L-47). 문자열 워클릿은 6개로 줄었고 별도 파일 워클릿이 3개다(문자열 → 파일 전환은 S4.9 의 선택 항목).
  - 정규식(소스 문자열) 단언이 336 → 354곳으로 늘었다(`howl-guard-regression.mjs` 14곳, `peak-limiter-regression.mjs` +4곳: 워클릿이 화면·시계 API 를 쓰지 않는다는 것과 엔진 배선을 확인하는 것들). 목록은 `docs/refactoring/regex-assertions.md` 를 다시 만들었다.

---

## S1.6 휴대폰 하단 패널 접기 (모바일 도크)

- 브랜치·병합: `refactor/s1-6-mobile-dock` → `phase/1`. 커밋 `ce5b95f`(F-1 고침) · `379a585`(F-3 고침) · `bab533c`(도크 + 하네스) · `9105cf8`(baseline) · `ae03c3f`(`--dock-tabs-h` 1 px 정정) · 문서 커밋. **F-1·F-3 은 각각 따로 떼어 cherry-pick 할 수 있다**(둘 다 시험 포함, 하네스의 F-1 우회는 `bab533c` 에서 걷었고 그 전에도 시험은 통과한다).
- 해결 항목: R1-1(휴대폰 하단 패널이 페달 아래쪽을 가림), D2(휴대폰: '톤 확인용' 유지 + 페달 조작 가능). 설계서에 없던 결함 두 개를 함께 고쳤다 — **F-1**(그래픽 EQ 숫자 입력이 화면 전체를 덮음, L-50)과 **F-3**(`pan-x` 가 페달 카드 위의 세로 터치 스크롤을 막음, L-51). 접힘 상태의 0/15 는 전부 F-1 때문이었고, 펼침 상태는 도크(66dvh)가 따로 가렸다.
- 변경 파일(기준선·문서를 뺀 20개, 신규 3개, +781 / −138줄): 제품 — `src/components/AppShell.tsx`(탭 4개·파생 펼침·토글 제거)·`PedalBoard.tsx`(`id="pedal-board-section"`)·`src/hooks/useDockHeight.ts`(신규, `--dock-h`)·`src/styles/responsive.css`(도크 4칸·50dvh·여백 식·`.pedal-board` 의 `touch-action`)·`pedals.css`(F-1 규칙, 스위치 `min-height`). 시험 — `scripts/responsive-a11y-regression.mjs`·`graphic-eq-regression.mjs`(소스 단언), `e2e/tests/` 의 `e04-phone-reachability`(정식)·`e03-howl`('페달' 탭)·`e00-harness`·`f-regressions`(신규)·F-1 우회 걷기(`e01`·`e02`·`s1-4a`·`s1-4c`), `e2e/helpers/` 의 `app`·`geometry`·`switches`·`mocks`·`touch`(신규). 기준선 — `docs/baseline/e2e.json` + 스크린샷 4장.

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 390×844 · 360×640 · 412×915 에서 15개 스위치 모두 도달 — 도크 접힘·펼침 | 충족 | E-04: 접힘 15/15, 펼침(입력·미터·프리셋 탭 각각) 15/15, 상자 전체가 도크 위인 것 15/15, 세 화면 모두(이전 0/15 · 0/15) |
| 390×844 첫 화면에 노브 2개 이상 완전히 보임 | 충족 | 5개(360×640 3개, 412×915 5개) |
| 도크를 펼치고 끝까지 스크롤하면 마지막 페달의 아래쪽 끝이 도크 위 | 충족 | 도크와의 여백 26.8 px(412×915 펼침 27.3 px). 변이 검사 — 아래 여백 규칙을 걷으면 −411 px 로 단언이 실패 |
| 스위치 터치 영역 ≥ 44×44 px | 충족 | 최소 54×101 px(E-04 가 ≥ 44 를 단언). 탭 버튼도 `min-height: 44px` |
| '페달' 탭이 첫 번째이자 기본, 그 탭에서는 탭 줄만 남음 | 충족 | 소스·브라우저 단언: 기본 선택 `mobile-tab-pedals`, 접힘 도크 58 px(허용 50~64), 패널 `hidden` |
| 다른 탭은 최대 50dvh, 같은 탭을 다시 누르면 접힘 | 충족 | 펼침 320 / 422 / 458 px(= 50dvh, 단언은 50% + 1 px 이하). 재탭하면 같은 접힘 높이로 돌아옴 |
| ResizeObserver 로 `--dock-h` 를 기록해 본문 아래 여백에 반영 | 충족 | `--dock-h` = ceil(도크 높이) px 를 접힘·펼침에서 단언. 여백 식은 설계서 그대로(L-53) |
| (Step 지시) E-03 에 '페달' 탭 추가 | 충족 | E-03 휴대폰 네 탭(페달·입력·미터·프리셋) 모두 H-1 차단 ≤ 1.5초, 차단 때 선택된 탭 확인 |

**전후** (E-04, 헤드리스 Chrome/153)

| 화면 | 스위치 도달 접힘 | 스위치 도달 펼침 | 도크 높이 접힘 | 도크 높이 펼침 최대 | 첫 화면 노브 |
|---|---|---|---|---|---|
| 360×640 | 0/15 → **15/15** | 0/15 → **15/15** | 약 110 → 58 px | 약 422 → 320 px | 3개 |
| 390×844 | 0/15 → **15/15** | 0/15 → **15/15** | 약 110 → 58 px | 약 557 → 422 px | 5개 |
| 412×915 | 0/15 → **15/15** | 0/15 → **15/15** | 약 110 → 58 px | 약 604 → 458 px | 5개 |

이전 높이는 옛 CSS(`max-height: min(66dvh, 620px)`, 토글 버튼 + 탭 줄)에서 계산한 값이다. 첫 화면 노브 수는 이번에 새로 잰 지표라 이전 값이 없다. 끝까지 스크롤했을 때 마지막 페달 아래 여백은 위 표와 같이 26.8 px(412×915 펼침만 27.3 px)이고, 접힘 도크의 윗선은 390×844 에서 786 px 이다.

**F-1·F-3 회귀 시험** (`e2e/tests/f-regressions.spec.ts` 6개) — F-1 4개(숫자 입력의 위치·`opacity`·`pointer-events`, 포커스 시 드러남, range 입력 도달, 스위치 15개 도달과 첫·끝 스위치의 실제 클릭), F-3 2개(세로 끌기 후 문서 이동량, 가로 끌기 후 보드 이동량). **고치기 전 CSS 로 되돌려 돌리면 실패함을 확인했다**(F-1 4개 모두 실패, F-3 세로 시험 실패 — 0 px). 고친 뒤: 세로 285 px, 가로 보드 346 px(snap).

- 프로브·스크린샷 변화: 오디오 엔진·워클릿을 건드리지 않아 오디오 프로브(P-xx)는 다시 돌리지 않았다. 대표 스크린샷 4장을 현재 화면으로 다시 찍었다 — `docs/baseline/screenshots/E-04__390x844__dock-collapsed.png`·`dock-expanded.png`(이전 모습은 `git show 379a585:docs/baseline/screenshots/E-04__390x844__dock-collapsed.png`), E-06 두 장에는 S1.3(입력 채널)·S1.4c(음량 보정 줄)에서 이미 들어온 화면 변화도 함께 담겼다. E-06 의 측정값은 스위치 도달만 0/15 → 15/15 로 바뀌었고 겹침·가로 넘침은 14개 조건 모두 그대로다.
- 검증: `npx tsc -b --noEmit`, `npx tsc -p tsconfig.e2e.json --noEmit`, `npm run lint`, `npm run build`, **`npm test` 30/30(342.5초)**, **`npm run e2e` 77/77(3.1분, 불안정 0)** — 시험 68 → 77개(`f-regressions` +6, `e00-harness` +2, E-03 '페달' 탭 +1). 정규식(소스 문자열) 단언은 354 → 373곳(`graphic-eq-regression` +3, `responsive-a11y-regression` +16, `docs/refactoring/regex-assertions.md` 다시 생성).
- 만난 문제
  - 옛 `reachable()` 로는 펼침 상태가 0/15 로 나온다 — 요소를 뷰포트 가운데로 스크롤하면 50dvh 도크의 윗선 바로 아래에 놓이기 때문이다. 하네스의 방법 문제라 `reachableAboveDock()` 을 새로 만들었다(L-56). 기준선의 접힘·펼침 값은 모두 이 방법으로 다시 쟀다.
  - `Input.synthesizeScrollGesture` 는 `touch-action` 을 거치지 않아 F-3 을 재현하지 못했다 → `Input.dispatchTouchEvent` 로 손가락 드래그를 보내는 `touchDrag` 를 만들었다.
  - 첫 화면 노브를 세다가 Noise Gate 노브의 가운데가 장식용 `<i>` 에 덮여 있음을 만났다 — **F-4 후보**(고치지 않음, L-55).
  - F-1 우회(포커스 + Enter)를 걷자 27곳이 실제 클릭으로 돌아왔고 모두 통과했다(L-57). 이 우회가 이제 없으므로 F-1 이 되살아나면 시험이 클릭 단계에서 실패한다.
- 사람 확인 필요
  - **실제 휴대폰에서**: 페달 카드 위로 손가락을 끌어 세로 스크롤이 되는지(F-3), 가로 스와이프로 카드가 넘어가는지, 접힘·펼침 도크에서 스위치 15개를 손가락으로 눌러 켜지는지, 노브를 돌릴 때 페이지가 같이 밀리지 않는지.
  - 배포 사이트(GitHub Pages)에서 F-1·F-3 이 실제로 재현되는지(고침은 `phase/1` 브랜치에만 있고 배포하지 않았다).
  - iOS Safari 의 주소창 변화(`dvh`), 노치·홈 바 기기에서 도크가 화면의 50% 를 넘지 않고 마지막 페달이 가려지지 않는지(안전 영역이 여백 식에 한 번 더 더해져 아래 여백이 조금 넉넉하다, L-53).
  - 기본 탭이 '페달' 이라 처음 기타를 연결하려면 '입력' 탭을 한 번 눌러야 하는 흐름이 괜찮은지(L-52). 대안: 연결 전에는 '입력' 탭을 기본으로.
  - 첫 화면(390×844)에서 노브가 5개 보이는 모습, 대표 스크린샷 4장이 실제 화면과 같은지.
  - 그래픽 EQ 숫자 입력은 키보드·스크린리더 포커스에서만 보인다 — 터치 사용자는 이것을 쓸 수 없다(고치기 전에도 쓸 수 없었다, L-50).
  - F-4 후보: 마우스·손가락으로 Noise Gate 와 다른 노브의 가운데를 끌어 값이 바뀌는지(L-55).
  - 토스트가 펼친 도크와 겹치는 모습(L-54, S1.7 에서 다룬다).
- 남은 위험
  - E-04 는 기하학적 히트 테스트다. 진짜 손가락 눌림(터치 이벤트의 눌림 인식)은 확인하지 않았다 — 터치는 스크롤 시험에서만 CDP 로 보냈다.
  - 헤드리스 Chrome 의 안전 영역은 0 이라 `env(safe-area-inset-bottom)` 이 두 번 더해지는 문제(L-53)가 시험에 드러나지 않는다.
  - `app-shell` 의 `mobile-dock-open` 클래스는 쓰는 CSS 가 없는 잔재다(L-52, 정리는 이후 Step).
  - F-4 후보(Noise Gate 가운데 드래그)와 같은 '장식 요소가 입력을 덮는' 결함이 다른 노브에도 있는지는 확인하지 못했다(L-55).
  - `docs/baseline/e2e.json` 의 `description` 문구가 아직 '기록 모드(E-04·E-06)' 라고 적혀 있다 — S1.8 에서 E-06 을 정식으로 바꾸며 기준선을 갱신할 때 함께 고친다.
  - 정규식 단언이 늘었다(354 → 373곳). 소스 문자열에 기대는 시험은 CSS·TSX 를 다듬을 때 쉽게 깨진다 — 브라우저 단언(E-04·`responsive-a11y-regression` 의 브라우저 부분)을 우선 믿는다.

---

## S1.7 저장소 접근 한 곳으로(SafeStorage)와 오류 화면

- 브랜치·병합: `refactor/s1-7-safe-storage` → `phase/1`. 커밋 `b8710c4`(SafeStorage·오류 화면·전역 오류 처리·ESLint 금지·단위 시험) · `fc82bf8`(L-54, 휴대폰 순서 변경 알림 위치 — **따로 떼어 cherry-pick 할 수 있다**) · `5b7b9e2`(E-05 브라우저 시험 7개) · `6b1ddb9`(주석 한 줄) · 문서 커밋.
- 해결 항목: R2-1(저장소가 막히거나 차면 앱이 멈춤, 설계서 C6·G6). **다만 L-69 — 설계서의 '현재' 서술(막히면 흰 화면, 가득 차면 조작 불가)은 S1.6 코드에서 이미 재현되지 않았다.** 설계 기준 커밋 `4ac9cf7` 에서는 맞았고, `859a11c`(2026-11-13)가 try/catch 와 안내 배너를 먼저 넣었다(코드 지도 S0.1 도 'R2-1 해결(실측)', S1.7 을 '축소'로 분류했다). 옛 코드(`b94a7ea`)를 따로 빌드해 같은 모의로 재어 보니 이 Step 이 실제로 고친 것은 다섯 가지다 — ① 안내가 닫아도 되풀이됨 ② 깨진 값을 알리지 않고 덮어씀 ③ 렌더 오류 때 소리가 계속됨 ④ 앱 스크립트 실패 때 빈 화면 ⑤ 처리되지 않은 오류가 아무 표시 없이 사라짐(아래 '전후'). 함께 처리: L-21(S1.2 의 최소 토스트 확장), L-54(휴대폰 순서 변경 알림이 펼친 도크와 겹침).
- 변경 파일(문서·기준선 제외 35개, 신규 10·삭제 3, +2184 / −251줄): 제품 — `src/persistence/`(신규 `SafeStorage.ts` 418줄·`keys.ts`·`index.ts`), `src/app/`(신규 `AppErrorBoundary.tsx`·`globalErrors.ts`·`staticFallback.ts`·`errorReport.ts`), `src/main.tsx`·`index.html`(앱이 아예 못 뜰 때의 안전망), `src/store/`(`pedalStore`·`presetStore`·`audioStore`·`toastStore`; 옛 `storageNotice.ts` 삭제), `src/components/`(`PresetPanel`·`MidiAdvancedControls`·`ConnectGuitarPanel`·`Toast`; 옛 `ErrorBoundary.tsx`·`StorageNotice.tsx` 삭제), `src/audio/`(`midi.ts`·`midiAdvanced.ts` 에서 저장 제거), 스타일(`app-error.css` 신규·`responsive.css`·`panels.css`·`globals.css`), `eslint.config.js`. 시험 — `scripts/safe-storage-regression.mjs`(신규 712줄, `npm test` 에 `test:safe-storage` 로 등록)·`midi`·`preset-ab`·`responsive-a11y` 회귀 갱신, `e2e/tests/e05-storage.spec.ts`(신규 7개)·`e04-phone-reachability.spec.ts`(순서 변경 알림 3개).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 사이트 데이터 차단 모의: 흰 화면 없이 표시, Bypass·On/Off·노브·프리셋 불러오기 동작, 안내 1회 | 충족 | E-05 ①: 카드 15개, `storage:blocked` 알림 1장, Drive 스위치 켬→끔→켬, 노브 61, 프리셋 'Direct Clean' 이 Noise Gate 를 끔. 알림을 닫고 다시 써도 0장, 처리되지 않은 예외 0 |
| 저장 공간 가득 참 모의: 위 조작 동작, 안내 1회(되풀이 없음) | 충족 | E-05 ②: 같은 확인, `storage:quota` 1장 |
| 렌더 중 예외 주입: 한국어 오류 화면이 뜨고 소리가 멈춤 | 충족 | E-05 ④: 제목 '문제가 생겨 화면을 표시하지 못했습니다'·포커스 이동, AudioContext 1개가 closed, 마이크 트랙 0개 live. 변이 검사 — `void stopSessionForError();` 를 빼면 notClosed 1·liveTracks 1 로 시험이 실패 |
| 린트: `localStorage` 직접 참조 0건 | 충족 | `grep -rn "localStorage" src --include=*.ts --include=*.tsx` 가 SafeStorage.ts 밖에서 0건. ESLint 가 `window.localStorage`·`globalThis.localStorage`·맨 `localStorage` 세 형태를 모두 오류로 잡음(임시 파일로 확인) |
| 모든 `localStorage` 호출을 SafeStorage 로 교체 | 충족 | 아래 교체 목록 19곳 + 지연 저장 1곳 |
| 저장 키 이름·값 형식을 바꾸지 않음(S2.4 범위) | 충족 | 단위 시험 0절이 9개 키 문자열을 옛 코드 그대로 못 박음. 깨진 값 보관 키 `…:corrupt-<시각>` 만 새로 생김 |
| SafeStorage: `mode`·읽기·쓰기·`setDebounced`(300 ms, pagehide·visibilitychange 에서 바로 씀)·삭제·`usageBytes`, 어떤 경우에도 throw 하지 않음 | 충족 | 단위 시험 `test:safe-storage`(assert 165곳): 차단·가득 참·알 수 없는 오류·깨진 값·저장소 없음(Node)·범위 있는 초기화. 인터페이스를 넓힌 부분은 L-58 |
| 깨진 값 → `:corrupt-{시각}` 보관 + 기본값 + 안내 | 충족 | E-05 ③(픽스처 03): 켜진 페달 5개로 기본값 시작, `storage:corrupt` 1장, 깨진 세 키가 원문 그대로 보관(키마다 최대 3개, L-65) |
| 토스트 확장: 종류·같은 키 중복 방지·동작 버튼 자리 | 충족 | `toastStore` 의 `action` 칸(L-61). 오류 토스트의 '오류 정보 복사'가 처음 쓴다. 'S2.8 실행 취소' 는 그때 같은 칸을 쓴다 |
| `AppErrorBoundary`: 소리를 끈 뒤 한국어 화면, 버튼 3개(다시 시도·설정 초기화·오류 정보 복사) | 충족 | E-05 ④⑤. 소리 끄기는 `stopSessionForError()`(L-62 — 설계서의 `AudioSession.stop('error')`). 초기화는 안에서 두 번 묻고 `guitar-pedalboard:` 키만 지우며 내 프리셋은 남김 |
| `main.tsx` 안전망 + 전역 오류 알림 | 충족 | E-05 ⑥(스크립트 요청을 막으면 정적 안내와 '페이지 다시 불러오기'), ⑦(타이머·약속의 예외는 알림 1장, 중단된 요청·ResizeObserver 는 걸러짐) |
| (L-54) 휴대폰 순서 변경 알림이 접힌·펼친 도크 모두에서 도크 위 | 충족 | E-04 세 화면 × 접힘·펼침 세 탭에서 도크와의 간격 11~14 px. 고치기 전 CSS 로 되돌리면 24 px 로 실패 |

**localStorage 호출 교체 목록** (이전 위치 `b94a7ea` → SafeStorage 메서드)

| 이전 위치 | 이전 호출 | 지금 |
|---|---|---|
| `store/pedalStore.ts:315` | `canUseStorage()` 접근 확인 | 삭제(접근 검사는 SafeStorage 안) |
| `store/pedalStore.ts:349` | `savePedals` 의 `setItem` | `safeStorage.set(pedals, …)` |
| `store/pedalStore.ts` `schedulePedalSave`(300 ms 타이머)와 파일 안의 `pagehide` 처리(365) | 지연 저장 | `safeStorage.setDebounced(pedals, () => 값, 300)` — 함수는 쓰는 순간 평가, pagehide·visibilitychange 흘려 쓰기는 SafeStorage 가 맡음(L-60) |
| `store/pedalStore.ts:869` | `readStoredState` 의 `getItem` | `safeStorage.read(pedals, 해석, null)` |
| `store/presetStore.ts:376` | `canUseStorage()` | 삭제 |
| `store/presetStore.ts:451` | `readUserPresets` 의 `getItem` | `safeStorage.read(presets, parsePresetJson, [])` |
| `store/presetStore.ts:462` | `writeUserPresets` 의 `setItem` | `safeStorage.setRaw(presets, serializePresetPayload(presets))` |
| `store/audioStore.ts:51` | 출력 장치 읽기 | `safeStorage.getRaw(outputDevice)` |
| `store/audioStore.ts:985` | 출력 장치 쓰기 | `safeStorage.setRaw(outputDevice, deviceId)` |
| `store/audioStore.ts:122` | `readIoSettings` | `safeStorage.read(io, parseIoSettings, 기본값)` |
| `store/audioStore.ts:160` | `persistIoSettings` | `safeStorage.set(io, settings)` |
| `store/audioStore.ts:206` | `readMidiMappings` | `safeStorage.read(midi, JSON.parse 뒤 validateMidiMappings, {})` |
| `store/audioStore.ts:216` | `persistMidiMappings` | `safeStorage.set(midi, mappings)` |
| `audio/midiAdvanced.ts:25` | `readMidiAdvanced` | 삭제 — 오디오 계층은 저장소를 건드리지 않는다. 읽기는 화면 쪽으로(L-66) |
| `components/MidiAdvancedControls.tsx:28` | 설정 저장 `setItem` | `safeStorage.set(midiAdvanced, checked)`(읽기는 `safeStorage.read(midiAdvanced, …)`) |
| `components/PresetPanel.tsx:25` | `canUseStorage()` | 삭제 |
| `components/PresetPanel.tsx:32` | `readStringList`(즐겨찾기·최근) | `safeStorage.read(키, 문자열 배열 해석, [])` |
| `components/PresetPanel.tsx:42` | `writeStringList` | `safeStorage.set(키, values)` |
| `components/ConnectGuitarPanel.tsx:13` | 모바일 안내 닫음 읽기 | `safeStorage.getRaw(mobileAudioNotice) === 'true'` |
| `components/ConnectGuitarPanel.tsx:86` | 닫음 쓰기 | `safeStorage.setRaw(mobileAudioNotice, 'true')` |

새로 생긴 호출은 하나다 — `AppErrorBoundary` 의 '설정을 초기화하고 다시 시작' 이 `safeStorage.clearAppSettings()` 를 부른다(`guitar-pedalboard:` 로 시작하는 키와 깨진 값 보관본을 지우고 `web-guitar-pedalboard-presets` 는 남긴다, L-62).

**전후** — '이전' 은 옛 코드(`b94a7ea`)를 일회용 임시 작업 폴더에 빌드해 **같은 모의와 같은 조작**으로 잰 값이다(저장소에는 남기지 않았다, L-69). '지금' 은 E-05.

| 상황 | 이전(`b94a7ea`) | 지금 |
|---|---|---|
| 저장소 차단(SecurityError) | 카드 15개·스위치·노브·프리셋 모두 동작, 처리되지 않은 예외 0. 안내는 열 때는 없고 첫 쓰기 뒤에 `role=alert` 배너 1개, **닫은 뒤 다음 쓰기에서 다시 뜸** | 열 때 알림 1장(`storage:blocked`), 닫은 뒤 쓰기를 해도 0장. 조작 동작 |
| 저장 공간 가득 참(QuotaExceededError) | 위와 같음(배너가 되풀이됨) | `storage:quota` 1장, 되풀이 없음 |
| 깨진 저장값(픽스처 03) | 기본값으로 열림(켜진 페달 5개). **화면 안내 없음**(콘솔 경고뿐). 페달 키는 첫 조작 뒤 새 값이 원문을 **덮어씀**, 보관본 없음 | 기본값 + `storage:corrupt` 1장. 깨진 세 키가 원문 그대로 `…:corrupt-<시각>` 에 보관됨 |
| 렌더 중 예외(기타 연결 상태) | '화면을 표시하지 못했습니다' + 버튼 1개('페이지 다시 불러오기'). **2.5초 뒤에도 AudioContext running·마이크 트랙 live** | 한국어 오류 화면(버튼 3개), AudioContext closed·마이크 트랙 ended. '다시 시도'로 돌아오고 다시 연결도 됨 |
| 앱 스크립트를 못 불러옴 | 본문 0글자(**빈 화면**) | 정적 안내(`main[data-static-fallback]`)와 '페이지 다시 불러오기', 누르면 복구 |
| 이벤트·타이머·약속의 처리되지 않은 예외 | 콘솔에만 남고 화면에는 아무 표시 없음 | 알림 1장(+ '오류 정보 복사'), 같은 오류는 겹치지 않음. 중단된 요청(AbortError)·ResizeObserver 알림은 걸러짐 |

- 판정(단계 지시문의 '멈추고 물어볼 조건')
  - '저장 시점이 바뀌어(디바운스) 즉시 저장을 가정한 기존 코드가 깨질 때' — **해당 없음.** 옛 코드가 이미 300 ms 지연 저장과 `pagehide` 저장을 했고, 새 코드는 같은 300 ms 에 `visibilitychange`(hidden)를 더했을 뿐이다(L-60). 관련 회귀 시험이 모두 통과한다.
  - '오류 경계로 잡을 수 없는 오류 종류가 있을 때' — **있다**(이벤트 핸들러·타이머·약속·모듈 로드 실패·`AudioWorkletNode.onprocessorerror`). '스스로 승인하며 진행' 지시에 따라 묻지 않고, 앞의 세 가지는 `window` 의 `error`·`unhandledrejection` 처리기로, 모듈 로드 실패는 `index.html` 안전망으로 받았다. `onprocessorerror` 는 처리하지 않았고 아래 남은 위험에 적었다(L-63).
- 프로브·스크린샷 변화: 오디오 엔진·워클릿·프리셋 값을 건드리지 않아 프로브 기준선은 그대로다(`npm test` 의 프로브 비교 통과, 기준선 파일 변경 없음). 스크린샷 기준선도 바꾸지 않았다. 새 오류 화면·알림의 스크린샷은 기준선에 넣지 않았다 — 사람이 직접 본다.
- 검증: `npx tsc -b --noEmit`, `npx tsc -p tsconfig.e2e.json --noEmit`, `npm run lint`, `npm run build`, **`npm test` 31/31 통과(420.8초, 코드가 최종인 `6b1ddb9` 에서)** — L-54 커밋 전 상태에서도 31/31(379.2초), **`npm run e2e` 87/87(3.6분)** — 시험 77 → 87개(E-05 +7, 순서 변경 알림 +3). 정규식(소스 문자열) 단언은 373 → 394곳(`safe-storage-regression` 신규, `midi`·`preset-ab`·`responsive-a11y` 갱신, `docs/refactoring/regex-assertions.md` 다시 생성).
- 만난 문제
  - 설계서의 '현재' 서술이 이미 해결되어 있었다(L-69). 옛 코드를 빌드해 재어 본 뒤에야 확인했다 — 이 Step 의 '전후' 는 그 실측이다.
  - 시험 출력이 쏟아졌다(깨진 값마다 `console.warn`). 단위 시험이 경고를 모아 끝에 한 번 요약하고, 실행 때는 출력을 걸러 읽었다.
  - E-05 ①②가 처음 10초 시간 초과로 실패했다. 프리셋 'Direct Clean' 을 불러온 뒤에는 Drive 가 꺼져 있어, 한 번 더 누르면 켜지는데 시험이 '꺼짐'을 기대했다 → 앞 상태의 반대를 기대하는 `flipDrive` 도우미.
  - '저장된 설정 때문에 계속 죽음' 시험(⑤)이 **죽지 않은 채 통과**하고 있었다. 범위 입력에 `fill('2.0')` 은 "Malformed value" 오류라 `.catch` 가 삼켰고, ④는 연결된 미터가 계속 다시 그려져서 우연히 통과했다 → `fill('2')`, 그리고 오류 화면이 이미 떠 있을 때만 오류를 삼킨다.
  - 렌더 예외를 일으키는 방법. 불러오기 값에 독을 넣는 방법은 S2.1 의 검증이 막으면 깨지고, 한 번만 던지는 예외는 React 가 렌더를 한 번 다시 시도해 통하지 않는다 → 시험이 `Number.prototype.toFixed` 를 계속 던지게 하고, 저장된 설정 때문에 죽는 상태는 init 스크립트가 흉내 낸다(L-67).
  - 서비스 워커가 가운데서 요청을 받으면 `page.route` 가 닿지 않아 E-05 전체를 `serviceWorkers: 'block'` 으로 돌린다.
  - `usageBytes()` 가 앱 키 전부(접두사)를 세야 하는데 처음에는 고정 키 목록만 셌다(L-64).
- 사람 확인 필요
  - **실제 브라우저에서 사이트 데이터를 막은 상태**(Safari 비공개 모드, Chrome 의 쿠키·사이트 데이터 차단)로 열어 안내 문구와 조작이 맞는지. 모의는 '`localStorage` 를 읽을 때 SecurityError' 와 '`setItem` 의 QuotaExceededError' 두 가지만 흉내 낸다.
  - 정말 가득 찬 저장 공간(같은 주소 `kimyounggaur.github.io` 의 다른 앱이 공간을 채운 경우)에서의 안내와 조작.
  - 오류 화면의 모양과 문구를 실제 휴대폰·노트북에서 눈으로 보기, 키보드 포커스와 스크린리더 낭독('문제가 생겨 화면을 표시하지 못했습니다'). 기준선 스크린샷이 없다.
  - **배포 사이트에서 '설정을 초기화하고 다시 시작'**: 두 번 묻는지, 취소하면 그대로인지, 초기화 뒤 내 프리셋이 남는지, 같은 주소의 다른 앱 데이터는 지워지지 않는지(코드는 `guitar-pedalboard:` 접두사만 지운다).
  - 실제로 쓰는 동안 **오류 알림(`app:unexpected-error`)이 오경보로 자주 뜨는지** — 전에는 조용히 사라지던 처리되지 않은 약속 거부(오디오 연결·MIDI 권한 등)가 이제 보인다.
  - 알림 문구 4종(차단·가득 참·깨짐·알 수 없음)이 읽기 편한지. 앞의 셋은 설계서 문구 그대로, '알 수 없음'만 새로 썼다(L-59).
  - 휴대폰 순서 변경 알림이 펼친 도크 윗선 바로 위에 놓이는지, 안전 영역이 있는 실제 iOS 기기에서(L-53, L-68).
- 남은 위험
  - `AudioWorkletNode.onprocessorerror`(워클릿이 오디오 스레드에서 죽는 경우)는 아직 처리하지 않는다. 죽으면 소리만 끊기고 화면에는 알림이 없다(L-63).
  - 파싱은 되지만 내용이 독인 사용자 프리셋 보관함은 '초기화' 뒤에도 다시 죽일 수 있다. 초기화가 내 프리셋을 남기기 때문이다. S2.1 의 불러오기 검증이 막는다(L-62).
  - 이전에 조용히 사라지던 처리되지 않은 약속 거부가 이제 알림으로 보인다 — 오경보가 늘 수 있다.
  - E-05 의 렌더 예외 주입은 '소수를 `toFixed` 로 그리는 표시가 어딘가에 있다'는 사실에 기대고(L-67), 서비스 워커를 막은 채 돈다. 서비스 워커·캐시와 오류 화면의 상호작용은 시험하지 않았다.
  - 한 번 막힌 저장소(`blocked`)는 새로고침 전에는 다시 시도하지 않는다. 설정을 바꾼 뒤 같은 탭에서 되살아나지 않는다.
  - `usageBytes()` 는 만들었지만 화면에 쓰이지 않는다(L-64). 지연 저장(300 ms)은 탭이 강제 종료되면 마지막 변경이 사라질 수 있다 — 이전과 같다.
  - 정규식 단언이 늘었다(373 → 394곳). 소스 문자열에 기대는 시험은 코드를 다듬을 때 쉽게 깨진다 — 브라우저 단언(E-05·E-04)을 우선 믿는다.

---
