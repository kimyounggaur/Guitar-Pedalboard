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

---

## S1.8 노트북 화면 배치 (데스크톱 레이아웃)

- 브랜치·병합: `refactor/s1-8-desktop-layout` → `phase/1`. 커밋 `3b1b655`(F-4 고침 — **따로 떼어 cherry-pick 할 수 있다**, 시험 포함) · `93f51f4`(S1.8 본 코드·시험) · 문서 커밋 · `baseline: S1.8`(기준선·스크린샷만) 커밋.
- 해결 항목: R1-7 중 남아 있던 '글자 겹침'(코드 지도 S0.1 이 '부분'으로 분류했다 — 'Bypass 잘림'은 `PedalCard` 의 Bypass 스위치가 없어져 이미 사라졌고, E-06 이 스위치 15개가 카드 안에서 모두 닿음을 계속 단언한다). 설계서 4.10절의 위쪽 압축·오른쪽 패널 접기·좁은 카드 규칙도 이 Step 에서 했다. 설계서에 없던 결함 **F-4**(노브 가운데를 끌어도 값이 안 바뀜, S1.6 이 후보로 남김)를 같은 CSS 작업 중에 고쳤다(L-77).
- 변경 파일(문서·기준선을 뺀 19개, 신규 1개, +1328 / −149줄): 제품 — `src/hooks/useSidebar.ts`(신규, 붙은 패널/서랍 판단과 열림 상태)·`src/components/AppShell.tsx`(서랍·막·포커스 관리·`.app-toolbar`)·`ConnectGuitarPanel.tsx`(연결 뒤 상태 막대, 상세 접기)·`DeviceSelector.tsx`(`InputChannelFields` 분리)·`PedalBoard.tsx`·`SliderControl.tsx`(이름 `title`)·`effects/CrunchPedal.tsx`(흐름 배치)·`effects/TremoloPedal.tsx`(좁을 때 Shape 선택 상자)·`src/persistence/keys.ts`(`ui` 키)·`src/styles/layout.css`(+255)·`pedals.css`(+250). 시험 — `e2e/tests/e06-desktop-layout.spec.ts`(기록 모드 14개 → 정식 31개)·`f-regressions.spec.ts`(F-4 +5)·`e2e/helpers/`(`app`·`record`·`screens`·`switches`)·`e2e/global-teardown.ts`·`scripts/safe-storage-regression.mjs`(키 `ui` 고정). 기준선 — `docs/baseline/e2e.json` + 스크린샷 6장(갱신 4·신규 2).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 겹침 0 — 768·1280·1366·1440·1536·1680 px 이상, 오른쪽 패널 펼침·접힘 모두 | 충족 | E-06: 8개 폭(1024·1920 포함) × 2상태 16조건 모두 겹침 0, 가로 넘침 0. 이전 5~7곳(1680×1050 은 기준선에 없던 프로필이라 직전 코드에서 따로 재어 보니 6 / 7곳). **S1.8 직전 코드 `0f56ef7` 에 새 E-06 시험 31개를 돌리면 30개가 실패한다**(겹침 16·연결 뒤 8·서랍 2·붙은 패널 2·1279 px 경계 1·좁은 카드 1; 통과 1개는 1280 px 붙은 패널 경계) |
| 스위치 노출 100% — 같은 조건 | 충족(서랍 연 상태 제외) | 붙은 패널·서랍 닫힘 14조건: 15/15 도달, 보이는 비율 최소 1. **서랍을 연 768·1024 px 2조건은 서랍과 막이 보드를 덮는 것이 설계라 단언하지 않았다**(기준선에는 0/15 로 남음). 대신 열기 전과 보드 배치가 같고 겹침·넘침 0 임을 단언(L-73) |
| 1280×800 첫 페달 카드 윗선 ≤ 320 px ★ | **연결 뒤만 충족** | 연결 뒤 **281 px**(단언). 연결 전은 770 px — 입력 패널을 줄이지 않았다(L-76). 설계서의 '현재 604 px' 는 S1.8 직전에 재현되지 않았다(946 px, 패널 펼침). 줄을 합치기 전에는 324.9 px 로 5 px 모자랐다(L-72) |
| 900 px 높이 화면에서 첫 줄 페달의 스위치가 스크롤 없이 보임 ★ | **미충족(하지 않기로 판정)** | 8개 폭 모두 연결 전·후 첫 화면에 보이는 첫 줄 스위치 0개. 카드 윗선에서 스위치 아래끝까지가 854 px 라 619 px 이하여야 하는데, 스위치가 카드 맨 아래에 있는 구조라 카드 속을 다시 짜야 한다(L-71). 기록만 한다 |
| 오른쪽 패널의 접힘·펼침 상태를 기억 | 부분 충족 | 붙은 패널(≥ 1280 px)은 `guitar-pedalboard:ui` 에 `{"sidebarOpen":…}` 를 저장하고 새로고침 뒤에도 유지(E-06). **서랍(768~1279 px)은 일부러 기억하지 않는다** — 기억하면 다음 방문이 화면이 덮인 채 시작된다(L-73) |
| (변경) 최소 300 px 자동 칸 | 충족 | 카드 폭 최소 301.2 px(1920 접힘, 6칸), 단언은 ≥ 300 |
| (변경) 컨테이너 쿼리·라벨 한 줄 + 말줄임(툴팁)·Tremolo SHAPE 선택 상자·MIDI 줄 분리 | 충족 | 카드 안쪽 폭 ≤ 340 px 에서 켜진다. E-06 '좁은 카드': 선택 상자↔세 버튼 전환과 선택 상자로 바꾼 값이 파라미터에 반영됨(L-74) |
| (변경) 위쪽 압축 — 로고 56 px, 연결 뒤 한 줄 상태 막대 | 부분 충족 | 로고 150 → **56 px**. 상태 막대는 **1920 px 에서만 한 줄**(34 px), 1280~1680 px 는 두 줄(72~74 px) — 트림·채널 설명을 빼야 한 줄이 되는데 연주 중 필요해 남겼다(L-72). 음원 파일 모드는 기존 패널 그대로 |
| (변경) 카드 안 배치가 크게 바뀌면 멈추고 Figma 로 확인 | 판정: 크지 않음 | 겹친 글자·장식의 **자리만** 흐름 배치로 옮겼다. 색·모양·노브 크기·소리는 그대로(L-70). 자율 진행이라 묻지 않았고, Figma 대조는 사람 확인으로 남긴다 |
| (설계서에 없는 추가 단언) 1280 px 경계에서 JS 와 CSS 가 같은 방식을 고른다 | 충족 | E-06: 1279 px 는 서랍(`position: fixed`), 1280 px 는 보드 옆 붙은 패널. JS 기준을 1200 으로 바꿔 빌드하면 1279 px 시험이 실패함을 확인했다 |

**전후 — E-06 화면 폭별** ('전' 은 S1.8 직전 `0f56ef7` 의 측정, '후' 는 새 기준선. 펼침 / 접힘, 패널 펼침 = 서랍이 열렸거나 붙은 패널이 열린 상태)

| 화면 | 겹침 전 → 후 | 칸 수 전 → 후 | 최소 카드 폭 px 전 → 후 | 첫 카드 윗선 px(연결 전) 전 → 후 | 연결 뒤 윗선 |
|---|---|---|---|---|---|
| 768×1024 | 6 / 6 → **0 / 0** | 1 / 2 → 2 / 2 † | 373 / 348 → 348 / 348 | 1123 / 1076 → 900 / 900 | 281 px |
| 1024×768 | 7 / 7 → **0 / 0** | 2 / 3 → 3 / 3 † | 309 / 314 → 314 / 314 | 1107 / 1076 → 900 / 900 | 281 px |
| 1280×800 | 6 / 6 → **0 / 0** | 2 / 3 → 2 / 3 | 344 / 399 → 344 / 399 | 946 / 912 → 770 / 737 | **281 px** |
| 1366×768 | 6 / 7 → **0 / 0** | 2 / 4 → 2 / 4 | 387 / 318 → 387 / 318 | 946 / 912 → 770 / 737 | 281 px |
| 1440×900 | 5 / 6 → **0 / 0** | 2 / 4 → 2 / 4 | 424 / 337 → 424 / 337 | 928 / 912 → 752 / 737 | 281 px |
| 1536×864 | 7 / 6 → **0 / 0** | 3 / 4 → 3 / 4 | 311 / 361 → 311 / 361 | 928 / 912 → 752 / 737 | 281 px |
| 1680×1050 | 6 / 7 → **0 / 0** † | 3 / 5 → 3 / 5 | 359 / 315 → 359 / 315 | 912 / 912 → 737 / 737 | 283 px |
| 1920×1080 | 6 / 7 → **0 / 0** | 4 / 6 → 4 / 6 | 327 / 301 → 327 / 301 | 912 / 912 → 737 / 737 | 243 px |

† 1680×1050 의 '전' 은 기준선에 없던 프로필이라 직전 코드를 임시 작업 폴더에 빌드해 재었다. 768~1279 px 의 '펼침'은 이제 서랍이라 보드가 칸을 내주지 않는다(768 px 는 1칸 → 2칸). 겹침은 모두 Compressor·Crunch·Fuzz·EQ 카드 4개에서 났다. 첫 카드 윗선이 위로 올라온 것(−176 px 안팎)은 로고 150 → 56 px 와 실행 취소 줄·패널 버튼 줄 합침(44 px) 등 때문이다. 스위치 도달은 서랍을 연 2조건을 빼고 전 조건 15/15 로 전과 같다. 설계서 표의 '지금 겹침'(37·45·32·18·11곳)은 하네스가 세는 방식이 달라 재현되지 않았다(L-12).

**연결한 뒤**(가짜 마이크, 같은 8개 폭): 상태 막대 높이 72 px(1280~1536)·74 px(1680)·34 px(1920), 로고 56 px, 첫 화면에 보이는 첫 줄 스위치는 전부 0. 입력 패널(연결 전)의 높이는 줄이지 않았다(L-76).

**문서 높이(스크롤 길이)** — 카드가 길어졌다. 폭이 넓은 카드(≥ 387 px)에서는 높이가 달라진 카드가 두 종류뿐이고(757 → 796 px, 815 → 851 px), 340 px 안팎 이하에서는 컨테이너 쿼리의 2열 배치 때문에 더 커진다 — 1440 폭 기준 Crunch·Fuzz·EQ 816 → 911 px, Compressor·Noise Gate 866 → 925 px(L-70), Cab 914 → 1109 px(L-74).

| 화면 | 펼침 전 → 후 (px) | 접힘 전 → 후 (px) |
|---|---|---|
| 768×1024 | 12712 → 8441 | 7812 → 8441 |
| 1024×768 | 7859 → 5755 | 5338 → 5755 |
| 1280×800 | 7682 → 8311 | 5175 → 5038 |
| 1366×768 | 7682 → 7581 | 4559 → 4790 |
| 1440×900 | 7648 → 7548 | 4559 → 4790 |
| 1536×864 | 5206 → 5607 | 4559 → 4790 |
| 1680×1050 | 5175 → 5592 | 3733 → 3870 |
| 1920×1080 | 4559 → 4790 | 3749 → 3870 |

**스크린샷**(전후 모두 같은 Chrome/153, 같은 입력): 전 — `docs/refactoring/screenshots/s1-8/before-1280x800-open.png`·`before-1440x900-open.png`, 카드 4장 `before-card-{Crunch,Fuzz,Compressor,EQ}.png`. 후 — 기준선 스크린샷 `docs/baseline/screenshots/E-06__1280x800__sidebar-open.png`·`E-06__1440x900__sidebar-open.png`·`E-06__1280x800__connected.png`·`E-06__1024x768__sidebar-open.png`(서랍 열림), 카드 4장 `docs/refactoring/screenshots/s1-8/after-card-{Crunch,Fuzz,Compressor,EQ}.png`. 눈으로 확인은 사람 몫이다(아래).

- 판정(단계 지시문의 '멈추고 물어볼 조건')
  - '카드 안 배치가 크게 바뀌어 Figma 시안으로 먼저 확인해야 할 때' — **크지 않다고 판정**했다. 겹침의 원인은 두 가지였다(제목이 두 줄이 될 때 `line-height < 1`, Crunch·Fuzz 의 `position: absolute; top` 장식이 숫자 입력으로 키가 커진 노브 줄과 부딪힘). 글자·장식의 자리만 흐름 배치로 옮겼고 색·모양·노브 크기·소리는 그대로다(L-70). 묻지 않고 진행했으므로 **Figma 와의 대조는 사람이 한다.**
  - '수용 기준을 만족할 수 없을 때' — 900 px 높이 첫 줄 스위치 노출은 카드 속 재설계 없이는 불가능해 **기준을 충족하지 못한 채 기록만 한다**(L-71). 연결 전 첫 카드 ≤ 320 px 도 연결 전에는 충족하지 못한다(L-76).
- 프로브·스크린샷 변화: 오디오 엔진·워클릿·프리셋 값을 건드리지 않아 프로브 기준선은 그대로다(`npm test` 의 프로브 비교 통과). 브라우저 기준선(`e2e.json`)은 바뀐다 — E-06 전체(8개 폭 × `sidebar-open`·`sidebar-collapsed`·`connected`, 1680×1050 신규)와 E-04 의 `lastPedalGapAboveDock` +0.5 px(26.8 → 27.3, 27.3 → 27.8; 카드 높이가 바뀐 반올림 차이이고 E-04 단언은 통과). `description` 문구는 '기록 모드' 에서 정식 단언으로 고쳤다(L-75). 대표 스크린샷 4 → 6장(갱신 4·신규 2).
- 검증: `npx tsc -b --noEmit`, `npx tsc -p tsconfig.e2e.json --noEmit`, `npm run lint`, `npm run build`, **`npm test` 31/31 통과(369.9초, 제품 코드가 최종과 같은 상태에서)**, **`npm run e2e` 109/109(3.9분, 불안정 0)** — 시험 87 → 109개(E-06 14 → 31, f-regressions 6 → 11). 정규식(소스 문자열) 단언은 394곳 그대로이고 `docs/refactoring/regex-assertions.md` 만 줄 번호가 두 줄 밀려 다시 생성했다. '시험이 이빨이 있는지' 확인 세 가지: ① 새 E-06 31개를 S1.8 직전 코드(`0f56ef7`, 임시 작업 폴더에 따로 빌드)에 돌리면 30개 실패 · 1개 통과, ② `SIDEBAR_DOCK_MIN_WIDTH` 를 1200 으로 바꿔 빌드 → 1279 px 경계 시험 실패(원복·재빌드 뒤 통과), ③ F-4 시험 5개를 `0f56ef7` 에 돌리면 모두 실패(히트 테스트 14곳, 끌기 4개 값 그대로).
- 만난 문제
  - **`[hidden]` 과 `display: grid` 의 우선순위.** 연결 뒤 '입력 설정' 상세가 기본 접힘이어야 하는데 항상 펼쳐져 있었다. `.connect-panel-details[hidden]`(0,2,0)가 `.connect-panel.is-connected .connect-panel-details { display: grid }`(0,3,0)에 졌다. **새로 쓴 연결 뒤 시험이 잡았다**(상세 숨김 단언). `.connect-panel.is-connected .connect-panel-details[hidden] { display: none }` 으로 고쳤다.
  - **1280×800 연결 뒤 첫 카드 윗선이 324.9 px**(기준 320). 실행 취소 줄과 패널 버튼 줄을 한 줄(`.app-toolbar`)로 합쳐 44 px 줄이니 281 px.
  - **900 px 에서 첫 줄 스위치가 보이는 것은 구조상 불가능**(위 표·L-71). 연결해서 첫 카드가 281 px 로 올라와도 그 카드의 스위치 아래끝은 1135 px(1920 px 는 1097 px)다.
  - **서랍을 연 상태의 '스위치 노출 100%'** 도 같은 이유로 의미가 없다(서랍과 막이 덮음). 기준을 '보드 배치가 열기 전과 같다'로 바꿨다(L-73).
  - **S1.6 이 후보로 남긴 F-4 를 이 Step 에서 확인하고 고쳤다.** 1920×1080 에서 range 입력 101개를 훑어 13개의 가운데를 장식 층이 받음을 확인했고(S1.6 의 '14개' 추정과 하나 다름), 따로 커밋했다(L-77).
- 사람 확인 필요
  - **Figma 시안과의 대조 및 눈으로 보기**: 다시 짠 Crunch·Fuzz·Compressor·EQ 카드의 얼굴(LED·풋스위치·IN/OUT 라벨 위치, 제목 줄 간격)과 `docs/refactoring/screenshots/s1-8/` 의 전후 비교(L-70).
  - **실제 노트북·태블릿**에서: 오른쪽 패널 서랍(768~1279 px)의 열고 닫는 느낌 — 닫기 버튼·Esc·바깥 막 클릭, 열면 포커스가 닫기 버튼으로 가는지; 창 크기를 끌어 1280 px 경계를 오갈 때 갑자기 바뀌는 느낌(L-73).
  - **실제 오디오 인터페이스를 연결한 상태 막대**가 읽기 편한지(1280~1680 px 의 두 줄, 1920 px 의 한 줄), '입력 설정' 펼침 위치(L-72). 연결 전 첫 화면에 페달이 하나도 안 보이는 것(L-76).
  - 카드가 340 px 를 오갈 때 같은 카드가 갑자기 다른 배치(2열 노브·Tremolo 선택 상자)로 바뀌는 모습, 길어진 카드(Cab +195 px 등)가 괜찮은지(L-74).
  - **F-4**: 실제 마우스로 여러 노브의 가운데와 링을 끌어 느낌이 달라지지 않았는지, **손가락으로 짚을 때도 같은지(터치는 확인하지 못했다)**(L-77).
  - 휴대폰(≤ 767 px)은 같은 좁은 카드 규칙이 걸린다(L-74). E-04 는 통과하지만 실제 휴대폰에서 카드가 어색해지지 않았는지.
- 남은 위험
  - **연결 전 첫 카드 윗선은 770 px**(1280×800)이고 그 화면에는 페달이 하나도 안 보인다. 연결 전 입력 패널을 접거나 옆으로 옮기는 디자인 결정이 필요하다(L-76).
  - **첫 줄 스위치는 어떤 폭에서도 첫 화면에 들어오지 않는다.** 설계서 ★ 기준 하나가 미충족이다. 스위치를 카드 위쪽으로 올리거나 카드 속을 다시 짜야 한다(L-71) — 사람의 디자인 판단.
  - 카드가 길어졌다(좁은 폭에서 최대 +195 px, 1280×800 펼침의 문서 높이 +8%). 340 px 를 오가는 폭에서는 배치가 갑자기 바뀐다(L-74).
  - 서랍은 비모달이라 키보드 Tab 이 서랍 밖 보드로 빠져나간다(L-73). 모달로 만들려면 전역 단축키(Esc 긴급 정지 등)와의 상호작용을 다시 봐야 한다.
  - 저장 키 `guitar-pedalboard:ui` 가 하나 늘었다. S2.4 가 v2 키·백업·다중 탭을 정할 때 이 키도 같이 본다(L-73).
  - E-06 의 '겹침 0' 은 하네스 정의(글자 상자끼리 가로·세로 2 px 이상)에 따른 값이다. 글자와 그림이 눈으로 붙어 보이는 것은 세지 않는다.
  - 상태 막대는 실시간 장치 입력일 때만 나온다. 음원 파일 모드는 파일 올리기 때문에 기존 패널 그대로다(L-72).
  - F-4 는 `phase/1` 에만 있고 배포하지 않았다. 터치 입력은 시험하지 못했다.

---

## S2.1 꺼진 페달의 Mix 0% 바로잡기

- 브랜치·병합: `refactor/s2-1-off-pedal-mix` → `phase/2`. 커밋 `9830de0`(코드·시험) · `a46c9fa`(문서와 **P-18 기준선 `audio-probe.json`** — 기준선 변경분이 14줄(새 지표 5개 추가, 기존 값 변동 없음)이라 따로 떼어 `baseline:` 커밋으로 만들었어야 했는데 문서와 함께 스테이징해 한 커밋에 들어갔다. 역사를 고쳐 쓰지 않으려고 그대로 두었고, 기준선 변경은 `git show a46c9fa -- docs/baseline/audio-probe.json` 로 따로 볼 수 있다).
- 해결 항목: R2-2. **설계서의 '현재'(팩토리 프리셋 40개에 Mix 0% 로 꺼 둔 페달)는 데이터에서 재현되지 않았다**(L-78). 꺼진 페달 368개의 Mix 는 전부 그 페달의 기본값이고, 설계서가 든 수(Crunch 37·Fuzz 35·Drive 23·Delay 23·Reverb 6·Compressor 2)는 그 페달이 **꺼져 있는** 프리셋의 수와 정확히 같다. 그래서 이 Step 은 '이미 저장돼 있거나 가져온 옛 데이터를 불러올 때 바로잡기'와 '다시 생기지 않게 지키는 시험·측정 기준'으로 줄었다.
- 변경 파일(9개, 신규 3개, +525 / −10줄): 제품 — `src/presets/normalize.ts`(신규, `restoreMixOfOffPedals`·`isPedalOff`)·`src/store/pedalStore.ts`(`mergeStoredPedals` 끝에서 호출)·`src/store/presetStore.ts`(`off()` 가 Mix 를 받지 않음, 호출 4곳 정리). 측정·시험 — `src/audio/testing/probes.ts`(P-18 확장)·`docs/baseline/tolerances.json`(규칙 1·기준 3)·`scripts/audio-render-probe.mjs`(요약 항목)·`scripts/preset-normalize-regression.mjs`(신규, `npm run test:preset-normalize`)·`e2e/tests/s2-1-off-pedal-mix.spec.ts`(신규)·`package.json`(시험 스크립트 1개).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| P-18: 40개 프리셋에서 꺼진 페달을 하나씩 켜면 출력이 바뀐다(RMS 차 ≥ 0.5 dB 또는 스펙트럼 차 ≥ 1 dB ★) | 충족(평탄한 Graphic EQ 제외, L-79) | 꺼진 페달 368개 중 변화 없음 40개는 모두 밴드가 전부 0 dB 인 Graphic EQ(`unchangedFlatEq` 40). 그 밖의 변화 없음 `unchangedUnexpected` **0**(기준 atMost 0, 두 샘플레이트). 팩토리 데이터를 일부러 'Mix 0' 으로 만들면 56개가 걸려 기준이 실패함을 확인했다 |
| 프리셋을 불러온 직후의 소리는 바뀌지 않는다(널 테스트 ≤ −90 dB) | 충족 | `loadNullDb` **−200 dB**(완전히 같음, 두 샘플레이트). 팩토리 40개 각각에서 꺼진 페달의 Mix 를 모두 0 으로 만든 체인과 바로잡은 체인을 렌더했고, 바로잡기가 368개를 실제로 건드렸다(`loadRestoredPedals` 368, `loadUntouchedOffPedals` 0). 바로잡기가 페달을 켜 버리게 바꾸면 `loadNullDb` 가 +9.2 dB 로 올라 기준이 실패한다 |
| 데이터 검사 단위 테스트: 팩토리 프리셋에 '꺼짐 + Mix 0' 조합이 0개 | 충족 | `npm run test:preset-normalize`(1283건): 40개 프리셋 × 15개 페달에서 꺼진 368개의 Mix 가 모두 0 보다 크고, 팩토리 데이터는 바로잡기가 건드릴 것이 없다(같은 객체가 돌아옴). 팩토리 `off()` 가 Mix 0 을 심도록 바꾸면 실패 |
| 불러오기 정규화: 사용자 프리셋도 '꺼짐 + Mix 0' 이면 기본 Mix(M2 와 같은 함수) | 충족 | 한 함수(`restoreMixOfOffPedals`)를 저장소의 작업 상태·사용자 프리셋·프리셋 파일 가져오기가 모두 지난다(L-80). 저장 형식 1(맨 앞 배열)·10(enabled/bypassed 네 조합)·11 모두. 픽스처 04 원본으로 확인 |
| (변경 1) 팩토리 데이터의 `mix: 0` 을 기본 Mix 로 바꾼다 | 해당 없음(원래 없음, L-78) | `off(0)`·`off(100)` 호출 4곳을 `off()` 로 정리했고 팩토리 40개의 직렬화 SHA-256 은 전후가 같다 |
| (설계서에 없는 추가 단언) 켜진 페달의 Mix 0·이 세션에서 사용자가 정한 값·저장본 원문은 건드리지 않는다 | 충족 | 회귀 시험 1283건 가운데: 켜진 페달·Mix 1·0.4·50·음수·문자열 "0"·id 불명은 같은 객체로 돌아오고, 동결한 입력을 바꾸지 않으며 두 번 적용해도 같다. 불러오기만으로는 저장소에 쓰지 않고 원문이 그대로 남는다 |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 픽스처 04(꺼진 Delay·Reverb·Chorus, Mix 0%)를 연 화면의 Mix | Delay 0 · Reverb 0 · Chorus 0 (수정 전 코드에서 e2e 가 `Received: "0"` 으로 실패) | Delay 30 · Reverb 25 · Chorus 35, 모두 꺼진 채. 켜도 같은 값 |
| 같은 사용자 프리셋('Off Pedals Mix 0')을 불러온 화면 | Mix 0 그대로 | 기본 Mix |
| 팩토리 프리셋의 꺼진 페달 Mix 0 | 0개 | 0개(시험이 지킴) |
| P-18 `unchangedUnexpected` | 측정하지 않았다(`unchangedCount` 40 = 전부 Graphic EQ) | 0 |
| P-18 `loadNullDb` | 측정하지 않았다 | −200 dB |
| `npm test` | 31개 통과 | 32개 통과(386.6초 — P-18 이 샘플레이트당 1.5초 → 약 28초) |
| `npm run e2e` | 109개 통과 | 112개 통과(4.1분, 새 시험 3개) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit` 오류 0.
  - `npm test` 32개 모두 통과(386.6초). `npm run e2e` 112개 모두 통과(4.1분, 기준선 `e2e.json` 은 바뀌지 않았다).
  - **새 시험이 정말 잡는지**: (1) 회귀 시험을 변이 4종으로 돌려 모두 실패를 확인 — `mergeStoredPedals` 의 호출을 빼면 '가져온 꺼진 Delay 의 Mix 0 → 기본 30' 이, 켜진 페달까지 바꾸게 하면 '켜진 페달의 Mix 0 … 같은 객체' 가, 팩토리 `off()` 가 Mix 0 을 심으면 `factory-clean-practice:drive '꺼짐 + Mix 0' 조합이 있다` 가, 임계값을 `<= 1` 로 넓히면 '꺼진 페달의 Mix 1' 이 실패한다. (2) P-18 은 바로잡기가 페달을 켜게 바꾸고 팩토리 `off()` 가 Mix 0 을 심도록 동시에 바꿔 돌렸더니 `unchangedUnexpected` 56 과 `loadNullDb` +9.2 dB 로 기준 2개가 실패했다. (3) 새 e2e 3개를 S2.1 직전 코드 `52fbcdf` 에 돌리면 픽스처 04 시험 2개가 실패하고(Mix `0`) 공장 프리셋 시험 1개는 통과한다(원래 정상이었다는 증거).
- 만난 문제
  - **설계서의 수치가 데이터와 다르다**(L-78). 설계서 '현재' 의 6개 수는 꺼져 있는 프리셋 수다. 점검 보고서가 Mix 0% 를 본 화면은 확인하지 못했다.
  - 기준선 P-18 의 '변화 없음 40개' 가 전부 Graphic EQ 라 '하나씩 켜면 바뀐다' 를 그대로 걸면 기준이 영원히 실패한다. 평탄한 EQ 를 따로 세는 쪽으로 정했다(L-79).
  - 회귀 시험 첫 실행 실패: v1 형식에서 `enabled: true` 만 적은 Reverb 가 '꺼짐' 으로 나왔다. 앱 동작이 맞다(Bypass 를 적지 않으면 그 페달의 기본 상태를 따르고 Reverb 의 기본은 꺼짐). 시험이 옛 형식대로 `params.bypass: false` 를 적게 고쳤다.
  - e2e 에서 Delay 의 Mix 노브 이름은 `Mix` 가 아니라 `E.Level`(에코 레벨)이다. 선택자를 고쳤다.
  - 변이 검사를 한 뒤 `dist-probe` 가 변이된 코드로 만들어져 있어, 기준선을 갱신하기 전에 다시 빌드했다(`--skip-build` 를 쓰지 않았다).
- 사람 확인 필요
  - **설계서 '현재' 수치의 출처**: 실제 배포본에서 공장 프리셋을 불러온 뒤 꺼진 Crunch·Fuzz·Delay 의 Mix 가 0% 로 보이는 경로가 있는지. 현재 코드와 기준선 데이터로는 재현되지 않았다(L-78).
  - **옛 저장본이 있는 실제 브라우저**에서 열었을 때 꺼진 페달의 Mix 가 기본값으로 보이는 것이 자연스러운지(소리는 같고, 저장본은 사용자가 무언가를 바꿀 때까지 원문 그대로다).
- 남은 위험
  - 숫자 `0` 일 때만 바로잡는다. 문자열 `"0"`·0.4 같은 값은 S2.2(파라미터 스키마)의 범위 검증이 다룬다(L-80).
  - 이 세션에서 사용자가 'Mix 0 + 끔' 으로 만들어 저장한 프리셋은 같은 세션 안에서는 그대로이고 다음에 읽을 때 기본 Mix 로 바뀐다(L-80). 소리는 같다.
  - 켜진 페달의 Mix 0(켰는데 아무 일 없는 상태)은 사용자가 정한 값이라 그대로다.
  - 함수가 `enabled`/`bypassed` 모양을 읽는다. S2.4 가 `bypassed` 를 `active` 로 바꾸면 `isPedalOff` 한 곳을 맞춘다.
  - P-18 이 느려졌다(샘플레이트당 약 +26초). 프로브 전체 시간이 그만큼 늘었다.

---

## S2.2 조절기 이름·범위·기능 바로잡기 (파라미터 스키마)

- 브랜치·병합: `refactor/s2-2-param-schema` → `phase/2`. 커밋 `8d643f6`(스키마·M3·Reverb 6 초·Delay Sync 표시·EQ Level) · `654d8a5`(Fuzz Gate 를 진짜 게이트로 + 시험 + 프로브 P-20·P-24) · `27897bc`(공장 Fuzz 프리셋 trim 5개) · `2ba1173`(**`baseline:` 기준선 `audio-probe.json` 만** — 이번에는 문서와 섞이지 않게 따로 커밋했다) · `2a11548`(신규 e2e 8개·M3 → M2 순서·기준 10개) · 이 보고서를 담은 문서 커밋(`docs(S2.2): …` — 기록 L-81~L-91·README 갱신). main 에는 병합하지 않는다(병합하면 Pages 가 자동 배포된다).
- 해결 항목: R2-3, D14, D15. **설계서 4.9 표 15행 가운데 12행은 앱 기준선에서 이미 반영돼 있었고**(EQ 이름 7·Noise Gate '간격'·Compressor 'Knee'·Compressor GR 실측·프리셋 패널 막대와 Store 탭 2행: L-82·L-86), 이 Step 이 실제로 바꾼 것은 3행 — **Fuzz Gate**(진짜 게이트, L-83·L-88), **Reverb Decay**(저장값·엔진·공장 프리셋까지 6 초, L-89), **Delay Sync**(D.Time 막기와 동기값 표시, L-84) — 과 표에 없던 **EQ Level 범위 0~200**(L-81)이다. 파라미터 스키마(`src/audio/params/`, 15개 이펙트의 숫자 정의 100개·선택 정의 20개)도 이 Step 에서 처음 만들었다. 저장 키는 하나도 바꾸지 않았다.
- 변경 파일(38개, 신규 21개, +2,432 / −173줄 — 읽는 문서는 빼고 기준선·기준 JSON 둘은 넣었다): 제품 — `src/audio/params/`(신규 18개: `types.ts`·`index.ts`·`definitions/*.ts` 16개)·`FuzzEffect.ts`·`noise-gate-processor.ts`·`DelayEffect.ts`·`impulseCache.ts`·`impulse.worker.ts`·`FuzzPedal.tsx`·`EQPedal.tsx`·`DelayPedal.tsx`·`ReverbPedal.tsx`·`normalize.ts`(M3)·`pedalStore.ts`·`presetStore.ts`(공장 Reverb 2개)·`factoryTrims.json`. 측정·시험 — `probes.ts`(P-20 재정의·P-24 신규)·`tolerances.json`(기준 10개)·`audio-probe.json`(기준선)·`scripts/param-schema-regression.mjs`(신규, `npm run test:param-schema`)·`scripts/fuzz-gate-regression.mjs`(신규, `npm run test:fuzz-gate`)·`e2e/tests/s2-2-param-schema.spec.ts`(신규)·`package.json`(시험 스크립트 2개).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 단위 테스트: 화면에 그려지는 모든 조절기에 ParamDef 가 있고 라벨·단위가 화면과 같다 | 충족 | 신규 e2e 2개가 15개 카드의 슬라이더를 전수로 읽어 스키마의 이름·범위(min·max·step)·표시 글자와 견준다(처음 화면, 그리고 모든 슬라이더를 최솟값·최댓값으로 옮긴 뒤). 거꾸로 스키마의 숫자 정의는 숨긴 것(Delay level)과 Sync 로만 나오는 BPM 둘을 빼고 모두 화면에 있어야 한다(쓰이지 않는 정의가 있으면 실패). `test:param-schema` 6,674건: 키·기본값·선택지가 앱의 기본 페달과 같음, 정의 건전성, 표시 문자열, 공장 프리셋 40개의 모든 값이 스키마 범위·선택지 안, 불러오기 경로. **화면이 스키마를 읽는 곳은 아직 4곳뿐이고 나머지는 같은지를 시험이 지킨다**(L-91) |
| P-21: 무음에서 GR 표시 0 dB, −10 dBFS 지속음에서 표시값 = reduction ±0.5 dB | 충족(이미 반영돼 있었음, L-86) | 무음 0 dB(`displayedSilenceDb` 0, 새 기준 −0.5 ~ 0). 이 앱의 Compressor 는 워클릿이 적용한 감소량을 그대로 보여 주므로 표시값이 곧 실제 감소량이다 |
| P-20: Reverb Decay 저장값 7.5 → 6.0, 프리셋 2개(6.2·7.5 초)의 소리 변화 0(널 테스트) | 충족 | `convertedDecayError` **0**(6.2·7.5·10 → 정확히 6.0), `nullDb.*` **−200 dB**(완전히 같음, 두 샘플레이트), `maxFactoryDecay` **6**. 저장된 작업 상태·사용자 프리셋·가져온 프리셋·픽스처 05 가 모두 불러올 때 6 초가 된다(`test:param-schema`). 신규 e2e 도 7.5 초 저장본과 공장 프리셋 둘이 화면에서 6 초임을 본다 |
| Fuzz Gate 0 에서 소리 변화 0 ★ | 충족 | 게이트 워클릿(Gate 0 설정)이 입력과 다른 샘플 **0개**(`gate0.workletDiffSamples`, 기준 atMost 0). `FuzzEffect` 전체가 S2.2 이전 코드와 같은 출력이라는 것은 4개 설정 × 3개 입력(모노·스테레오·음)에서 한 샘플도 다르지 않음을 일회성 프로브로 대조했다(L-90, 저장소에 남기지 않음) |
| Fuzz Gate 50 에서 무연주 잡음 출력이 30 dB 이상 줄어듦 ★ | 충족 | −70 dBFS 잡음(G-3)에서 Gate 0 대비 **−62.7 / −62.4 dB**(Mix 90%, 44.1 / 48 kHz), Mix 100% 에서 **−78.2 dB**(기준 atMost −30, 두 곳 모두) |
| Delay Sync 를 켜면 D.Time 을 조작할 수 없고 동기된 값이 보인다 | 충족 | 신규 e2e: D.Time 이 `disabled`·`aria-disabled`, 직접 입력도 막힘, '1/4 · 500 ms' → 음표 단위를 바꾸면 '1/8 · 250 ms'·'Dotted 1/8 · 375 ms'·'1/16 · 125 ms', Slapback 에서는 풀리고 Sync 를 끄면 원래대로 |
| 프리셋 패널에 고정 수치 막대와 Store 탭이 없다 | 충족(이미 없었음, L-86) | 신규 e2e: 탭은 '라이브러리' 하나, Store 탭·Peak·RMS 글자 없음 |
| (설계서에 없는 추가 단언) 열린 게이트는 소리를 바꾸지 않고, 음의 첫 소리를 먹지 않는다 | 충족 | 문턱 −80 dBFS 의 게이트 워클릿이 소리가 열린 뒤 입력과 다른 샘플 **0개**(`open.workletDiffSamples`), 체인 출력 레벨 차 **0 dB**(`open.levelDiffDb`, 기준 0.01 이하), 쉬었다 시작하는 음의 처음 10 ms 손실 **−0.075 dB**(기준 ≥ −1). 게이트가 열리는 데 걸린 시간 약 17 ms |
| (설계서에 없는 추가 단언) M3 는 입력을 바꾸지 않고 몇 번을 적용해도 같으며, M2 보다 먼저 돈다 | 충족 | `test:param-schema`: 동결한 입력·같은 객체 반환·멱등·알 수 없는 키(M7)·문자열·NaN 은 그대로, 꺼진 Delay 의 Mix −5 → 기본 Mix(30). 순서를 뒤집으면 실패한다(L-91) |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| Fuzz 의 Gate 슬라이더 | 이름 '출력 감쇠'. 출력을 `max(0.28, 1 − gate/100 × 0.55)` 만큼 줄이는 볼륨(최대 −6.9 dB), 잡음은 거의 그대로 | 이름 'Gate'. 0 = 끔, 1~100 = 문턱 −80 ~ −30 dBFS 의 진짜 게이트. 무연주 잡음 −62 dB(Mix 90%)·−78 dB(Mix 100%) |
| Gate > 0 인 저장 Fuzz 의 크기 | — | 이전보다 커짐: Gate 15 +0.75, 50 +2.8, 58 +3.3, 72 +4.4, 100 +6.9 dB. 공장 5개는 trim 을 다시 계산(L-88). 사용자 프리셋은 보정하지 않음 |
| Reverb Decay | 화면 0.2~6 초, 저장·엔진 상한은 더 높음(공장 6.2·7.5 초) | 화면·저장·엔진·공장 프리셋 모두 0.2~6 초. 불러올 때 6 초로 맞춤(M3) |
| Delay Sync 켜고 D.Time | `disabled` 만, 값은 쓰이지 않는 저장값(280 ms) | `disabled` + `aria-disabled`, '1/4 · 500 ms' 같은 동기된 값. Slapback 은 예외로 풀림 |
| EQ Level 페이더 | 0~100 (공장 Solo Boost 의 108 을 못 그림) | 0~200 |
| 불러오기 정규화 | M2(꺼짐 + Mix 0 되돌리기)만 | M3(범위) → M2. 범위 밖 숫자는 범위 안으로, 꺼진 페달의 음수 Mix 도 기본 Mix 로 |
| 오디오 프로브 | 22개, 측정값 1,616개(옛 README 에는 1,606개로 적혀 있었다) | 23개(P-24 신규), 1,646개. P-20 지표 재정의. 바뀐 값은 P-03·P-05·P-20·P-24 뿐 |
| `tolerances.json` 의 기준 | 31개 | 41개(+10, 이 Step 에서 모두 추가) |
| `npm test` | 32개 통과(386.6초) | 34개 통과(426.4초 — 새 시험 `test:param-schema`·`test:fuzz-gate` 추가, 프로브 단계 396.0초) |
| `npm run e2e` | 112개 통과(4.1분) | 120개 통과(4.7분, 새 시험 8개, 기준선 `e2e.json` 불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit` 오류 0. 정규식 단언 목록(`regex-assertions.md`)은 달라지지 않았다.
  - 최종 소스(`2a11548`)에서 `npm test` 34개 모두 통과(426.4초), `npm run e2e` 120개 모두 통과(4.7분, 기준선 `e2e.json` 은 바뀌지 않았다). `test:param-schema` 6,674건, `test:fuzz-gate` 11,913건. P-20·P-24 를 따로 한 번 더 돌려도 기준선과 일치한다(9.8초).
  - **새 시험이 정말 잡는지**: (1) 신규 e2e 8개를 S2.2 직전 코드 `3686412` 에 돌리면(스키마 폴더만 복사해 시험이 읽게 하고 앱은 이전 빌드) **5개가 실패**한다 — 슬라이더 전수 2개(`fuzz.출력 감쇠` 가 스키마에 없음·`fuzz.Gate` 슬라이더 없음·`eq.Level` max 100 ≠ 200), Fuzz Gate(Gate 슬라이더 없음), EQ Level(`max` 100), Delay(`aria-disabled` 없음). 나머지 3개(BPM·Reverb 6 초 화면·프리셋 패널)는 통과한다 — 원래 맞던 동작을 못 박은 시험이다(L-86). (2) `test:fuzz-gate` 를 변이 13종으로 돌려 모두 실패를 확인했다. 처음에 살아남은 한 건(`reductionDb` 를 즉시 바꾸지 않고 부드럽게 바꾸는 변이)은 소스 고정 점검 두 줄을 더해 잡았다. (3) M3 → M2 순서를 뒤집으면 `test:param-schema` 의 '꺼진 Delay 의 Mix −5' 가 실패한다(실제 0, 기대 30). (4) 프로브는 소리가 바뀐 P-03·P-05, 지표를 다시 정의한 P-20, 신규 P-24 넷만 기준선이 달라졌고 나머지는 허용 오차 안이다. 새 기준 10개는 현재 값에서 모두 통과한다.
- 만난 문제
  - **설계서 4.9 표의 '지금 화면' 15행 중 12행이 이미 고쳐져 있었다**(L-82·L-86). 이 Step 의 일이 '이름 바꾸기'가 아니라 '스키마와 같은지 지키기'로 줄었다.
  - **체인 전체의 널 테스트를 쓸 수 없었다**(L-90). 두 번의 Fuzz 렌더는 입력이 1 ppm 만 달라도 약 −80 dB 의 차이가 남아, '열린 게이트가 소리를 안 바꾼다'를 워클릿 정확 일치와 레벨 차로 나눠 재도록 P-24 를 바꿨다.
  - 신규 e2e 첫 실행에서 4개가 실패했다 — 모두 시험의 가정 문제였다: (a) 그래픽 EQ 밴드('100 Hz 100 헤르츠, 0 dB')와 Reverb Tone('7.2 kHz')의 접근성 문구는 화면 글자와 **일부러** 다르게 풀어 쓴 것이라 숫자·단위가 같은지만 보게 했고, (b) EQ Treble 기본 1.8 은 눈금(0.5)에 없어 입력은 2.0 으로 읽히고 화면은 1.8dB 라 처음 화면에서는 스키마 기본값으로 견주게 했으며(L-82), (c) Sync 스위치는 체크박스가 가려져 있어 라벨을 눌러야 켜진다.
  - 변이 검사에서 살아남은 변이 하나(위 (2))와, 프로브를 디버그하며 남긴 코드(디버그용 프로브·옛 `FuzzEffect` 사본)를 정리한 일이 있었다 — 모두 커밋 전에 지웠다.
  - 이 Step 을 마무리하던 중 **M3 가 M2 뒤에 돌아 꺼진 페달의 음수 Mix 가 '꺼짐 + Mix 0' 으로 남는 문제**를 찾아 순서를 바꿨다(L-91). S2.1 이 이 Step 으로 넘긴 '음수·범위 밖 Mix' 가 이것이다.
- 사람 확인 필요
  - **Fuzz 청취**: 진짜 게이트가 된 Gate 를 실제 연주로 — 기본값 15, 공장 'Gated Velcro'(72)·'Broken Speaker'(58). 음의 시작·끝에서 소리가 끊기거나 떨리지 않는지, 열림 1 ms·유지 30 ms·닫힘 80 ms 가 맞는지(L-83). 서스테인이 문턱 근처로 줄어드는 꼬리는 측정하지 않았다.
  - **저장된 Fuzz 가 더 커진 것**: Gate > 0 인 사용자 프리셋은 +0.75 ~ +6.9 dB 커졌다. 받아들일지, S2.4 에서 Level 을 낮추는 변환을 넣을지(L-88).
  - **Delay Sync 표시**를 실제 화면에서(동기된 값이 읽히는지, Slapback 예외가 자연스러운지).
  - **EQ Level 페이더**의 눈금이 0~200 으로 바뀌어 기본값이 가운데에 놓인다(L-81).
  - **Tremolo Rate 를 막을지**(L-85), **Compressor Sustain 의 이름·설명**(L-87), **EQ Treble 기본 1.8 을 눈금에 맞출지**(L-82).
- 남은 위험
  - 스키마를 직접 읽는 화면은 Reverb·EQ·Fuzz·Delay 의 해당 조절기뿐이다. 나머지 페달의 라벨·범위는 코드에 따로 있고 시험이 같음을 지킨다(L-91). 새 페달·조절기를 더할 때 스키마와 화면을 둘 다 고쳐야 한다.
  - 문자열·NaN 같은 숫자가 아닌 값은 M3 이 건드리지 않는다. S2.1 이 넘긴 문자열 "0" 은 그대로 열려 있다(S2.4 의 검증 몫).
  - 'FuzzEffect 가 Gate 0 에서 이전 코드와 같다'는 대조는 일회성이라 저장소에 남아 있지 않다(L-90). 이후 FuzzEffect 를 건드리는 Step(S3.x)은 `test:fuzz-gate` 의 워클릿·지문 시험과 P-24 로만 지켜진다.
  - 체인의 −80 dB 수치 잡음 바닥의 원인은 가려내지 못했다. 같은 체인을 두 번 렌더해 견주는 널 시험은 이 바닥 위에서만 쓸 수 있다.
  - `npm test` 가 386.6초 → 426.4초(+39.8초)로 늘었다. 새 시험 2개는 합쳐 3초 이하이고 P-20(재정의)·P-24(신규)는 두 샘플레이트에서 합쳐 약 7.8초라, 설명되는 것은 11초쯤이다. 나머지 증가분은 가르지 못했다(기계 흔들림일 수 있고, Fuzz 게이트 워클릿 비용일 수도 있다).
  - 공장 프리셋은 trim 으로 맞췄지만 Gate > 0 인 Fuzz 사용자 프리셋은 청취 승인이 필요하다(위).

---

## S2.3 오류 안내 한국어화와 기본 장치로 다시 연결

- 브랜치·병합: `refactor/s2-3-connect-errors` → `phase/2`. 커밋 `c6cc6d9`(문구 카탈로그 `src/i18n/ko.ts`·`errors.ts`·엔진·스토어·연결 패널 + `test:connect-errors`) · `34f13c4`(e2e E-07 17개) · 이 보고서를 담은 문서 커밋(`docs(S2.3): …` — 기록 L-92~L-99·README 갱신). 기준선 JSON 은 바뀌지 않아 `baseline:` 커밋은 없다. main 에는 병합하지 않는다(병합하면 Pages 가 자동 배포된다).
- 해결 항목: R2-7, 그리고 R4-6(한국어·영어 혼용)의 시작인 문구 카탈로그(`ko.ts` — 나머지 문구는 S4.6 이 옮긴다). **설계서 '현재'(영어 원문 'Permission denied' 가 그대로 나온다)와 달리 기준선 앱에는 이미 4개 오류 이름의 한국어 안내가 있었다**(문구는 설계서 4.13 표와 달랐다). 그래서 이 Step 의 일은 번역이 아니라 ① 표와 같은 문구, ② 표에 있는데 코드에 경로가 없던 두 행(보안 출처·워클릿 로드 실패)과 '그 밖' 행, ③ 기본 장치로 다시 연결(없던 기능), ④ 안내가 화면에서 보이는지다.
- 변경 파일(8개, 신규 4개, +858 / −22줄): 제품 — `src/i18n/ko.ts`(신규, 31줄)·`src/audio/engine/errors.ts`(신규, 118줄)·`src/audio/AudioEngine.ts`(+11 −1)·`src/store/audioStore.ts`(+44 −19)·`src/components/ConnectGuitarPanel.tsx`(+15 −2). 시험 — `scripts/connect-errors-regression.mjs`(신규, `npm run test:connect-errors`)·`e2e/tests/e07-connect-errors.spec.ts`(신규)·`package.json`(시험 스크립트 1개). 저장 키·DSP 는 바뀌지 않았다.

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| `getUserMedia` 를 각 오류로 실패시키는 모의 7종 → 각각 4.13 의 문구가 보이고 영어 원문 노출 0 | 충족 | e2e E-07 7개(NotAllowed·NotFound·NotReadable·Overconstrained·Security·Abort·TypeError)가 문구를 **글자 그대로**(앱의 카탈로그를 가져다 쓰지 않고 시험 파일에 따로 적었다) 단언하고, 화면 전체의 글자에 영어 원문(모의 7종과 워클릿 로드의 브라우저 기본 문구)과 오류 이름이 없음을 본다(표의 '그 밖' 행이 일부러 적는 `TypeError` 만 예외). 표에 없는 Overconstrained 단독 실패는 입력 장치 없음 문구(L-92). `test:connect-errors` 228건은 4.13 표를 설계서 문서에서 직접 읽어 카탈로그와 견준다 |
| 저장된 장치 ID 가 없는 상태에서 연결 → 기본 장치로 연결되고 안내가 뜬다 | 충족 | e2e: 장치를 골라 두고 장치 지정 요청만 OverconstrainedError·NotFoundError 로 거부시키면 `getUserMedia` 요청이 exact → default 순서로 가고, '연결 해제'가 보이고, 경고 토스트(`role="alert"`)가 뜨고, 선택 상자가 기본 장치로 돌아오고, 열린 AudioContext 1개·입력 트랙 live. 안내를 닫고 다시 연결하면 요청은 default 한 번뿐이고 안내는 되풀이되지 않는다 |
| (설계서 변경 문장) 연결에 실패하면 항상 안내를 띄운다 | 충족 | 7종 모두 데스크톱 기본 크기에서, 그리고 휴대폰 390×844·360×640·412×915 의 입력 탭에서 안내 **전체**가 화면 안에 들어오는지(`toBeInViewport` 비율 1) 본다. 이 단언이 안내가 패널 맨 아래에 있던 결함을 잡았다(L-93) |
| (설계서에 없는 추가 단언) 기본 장치로도 실패하면 안내하고 두 번만 시도한다, 장치는 있는데 못 여는 오류는 다시 시도하지 않는다 | 충족 | e2e: 두 요청 모두 실패하면 입력 장치 없음 문구·요청 exact·default 두 번·AudioContext 0개. NotReadableError 는 요청 exact 한 번, 선택 유지, 기본 장치 안내 없음. `test:connect-errors` 는 NotAllowed·NotReadable·Security·Abort 가 다시 시도하지 않고 선택을 바꾸지 않음, 다시 시도까지 실패하면 두 번째 오류의 문구와 고른 장치의 채널 설정 복원을 단언한다 |
| (설계서에 없는 추가 단언) 워클릿 로드 실패와 비보안 출처가 장치 시작 실패와 구별된다 | 충족(모의) | e2e: `addModule` 을 AbortError 로 거부시키면 '오디오 엔진을 시작하지 못했습니다…'(장치 시작 실패 문구가 아님), `isSecureContext` false + `navigator.mediaDevices` 없음이면 '이 주소에서는 마이크를 쓸 수 없습니다…'. 실제 상황이 아니라 모의다(L-98) |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 마이크 권한 거부(NotAllowedError) | '마이크 권한이 차단되었습니다. 브라우저 주소창의 사이트 설정에서 마이크를 허용해 주세요.' | 4.13: '마이크 권한이 차단되어 있습니다. 주소창의 자물쇠 아이콘에서 마이크를 허용한 뒤 다시 연결해 주세요.' |
| 입력 장치 없음(NotFoundError) | '선택한 입력 장치를 찾을 수 없습니다. 연결 상태를 확인하고 장치 목록을 새로고침해 주세요.'(Overconstrained 와 같은 문구) | 4.13: '입력 장치를 찾을 수 없습니다. 오디오 인터페이스나 마이크가 연결되어 있는지 확인해 주세요.' |
| 장치를 못 엶(NotReadableError) | '입력 장치를 사용할 수 없습니다. 다른 앱에서 장치를 사용 중인지 확인해 주세요.' | 4.13: '입력 장치를 열 수 없습니다. 장치를 쓰는 다른 프로그램을 닫고 다시 시도해 주세요.' |
| 골라 둔 장치가 없음(OverconstrainedError) | 위의 '선택한 입력 장치를 찾을 수 없습니다…' 로 **실패하고 끝**(연결 안 됨) | 기본 장치로 자동 재시도 → 연결되고 경고 토스트 '저장된 입력 장치를 찾지 못해 기본 장치로 연결했습니다.', 선택은 기본 장치로(L-94~L-96) |
| 보안 출처가 아님(SecurityError) | 비보안 출처에서는 '이 브라우저는 오디오 입력을 지원하지 않습니다.', 호출이 SecurityError 로 거부되면 일반 문구 '오디오 장치를 시작하지 못했습니다.' | 4.13: '이 주소에서는 마이크를 쓸 수 없습니다. https 주소로 접속해 주세요.' |
| 장치 시작 실패(AbortError) | '오디오 장치 연결이 중단되었습니다. 장치를 확인한 뒤 다시 시도해 주세요.' | 4.13: '장치를 시작하지 못했습니다. 장치를 다시 꽂고 시도해 주세요.' |
| 워클릿 로드 실패 | AbortError 와 같은 이름이라 '오디오 장치 연결이 중단되었습니다…'(원인이 틀린 안내) | 4.13: '오디오 엔진을 시작하지 못했습니다. 브라우저를 최신 버전으로 업데이트해 주세요.' |
| 그 밖의 오류 | '오디오 장치를 시작하지 못했습니다.' | 4.13: '연결하지 못했습니다(오류: {이름}). 페이지를 새로 고친 뒤 다시 시도해 주세요.' 한글 메시지가 있는 앱 오류는 그대로(L-99) |
| 음원 파일 재생이 거부됐을 때(NotAllowedError) | '마이크 권한이 차단되었습니다…'(마이크와 상관없는 일) | '오디오 장치를 시작하지 못했습니다.'(L-97) |
| 오류 문단 | 패널 맨 아래, `role` 없음. 휴대폰 입력 탭에서는 도크 밖으로 잘려 화면에 0% | '기타 연결하기' 줄 바로 아래(연결된 상태에서는 상태 표시줄 아래), `role="alert"`, 새 오류가 생기면 보이는 곳까지 스크롤(L-93) |
| `npm test` | 34개 통과(426.4초) | 35개 통과(404.6초 — 새 시험 `test:connect-errors`) |
| `npm run e2e` | 120개 통과(4.7분) | 137개 통과(5.0분, 새 시험 17개, 기준선 `e2e.json` 불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit` 오류 0. 정규식 단언 목록(`regex-assertions.md`)은 달라지지 않았다(새 스크립트는 `.includes` 만 쓴다).
  - 최종 소스(`34f13c4`)에서 `npm test` 35개 모두 통과(404.6초), `npm run e2e` 137개 모두 통과(5.0분, 기준선 `e2e.json`·`audio-probe.json` 은 바뀌지 않았다 — DSP 변경 없음). `test:connect-errors` 228건.
  - **새 시험이 정말 잡는지**: (1) 신규 e2e 17개를 S2.3 이전 코드 `7c9c029` 에 돌리면(시험 파일만 복사, 앱은 그 코드의 빌드) **17개 모두 실패**한다. 다만 이 실패의 일부는 옛 오류 문단에 `role="alert"` 가 없어 요소를 찾지 못한 것이라 '문구가 다르다'를 따로 가른 실패는 아니다. 옛 문구는 소스(`toErrorMessage`)로 확인해 위 표에 적었다. (2) **안내를 옮기기 전 상태로 첫 실행한 e2e 15개 가운데 휴대폰 390×844 하나가 `toBeInViewport` 비율 0 으로 실패**했고(나머지 14개 통과) 이것이 위치 결함의 발견이다(L-93). (3) `test:connect-errors` 를 변이 21종으로 돌려 모두 실패를 확인했다 — 분류 표·문구·다시 시도 판정·스토어 연결 흐름·엔진 소스 점검 14종, 안내 위치 5종(옛 위치로, 스크롤 제거, 연결된 상태의 안내를 상세 설정 아래로, `role` 제거, 문단 두 군데에서 만들기), 다시 시도 실패 때 채널 설정 복원 2종(복원 안 함, 기본 장치 것으로 복원). 모두 원본을 /tmp 에 복사해 두었다가 되돌렸고 같은 파일임을 `cmp` 로 확인했다.
- 만난 문제
  - **안내가 화면 밖에 있었다**(L-93). 오류 문단이 연결 패널의 맨 아래에 있어서, 휴대폰의 스크롤되는 도크에서는 연결 버튼 아래로 밀려 잘렸다. 안내가 DOM 에 있어도 `toBeVisible` 은 통과하므로 e2e 가 화면 안 여부(`toBeInViewport`)를 본다.
  - **설계서 '현재'가 기준선과 달랐다.** 이미 있던 4개 오류 이름의 한국어 안내(문구만 표와 다름)를 표 문구로 바꾸고, 없던 경로(비보안 출처·워클릿 로드 실패)를 엔진에 만들었다(L-98).
  - **재시도가 실패하면 채널 설정이 기본 장치 것으로 남았다.** 코드를 다시 읽다가 찾았다: 기본 장치로 다시 시도하면서 그 장치의 채널 설정을 올리는데 그 시도도 실패하면 선택은 고른 장치에 그대로 있는데 채널 설정은 기본 장치 것이 남고, 이 상태에서 채널 모드를 바꾸면 고른 장치의 기억으로 저장될 수 있다. 실패하면 고른 장치의 설정으로 되돌리게 고치고 시험을 더했다(변이 2종).
  - 린트가 새 Node 시험에서 `DOMException`·`File` 정의 없음 8건을 냈다(`scripts/` 에는 ESLint 전역 설정이 없다). `File` 은 `node:buffer` 에서 가져오고 `DOMException` 은 `globalThis` 에서 꺼냈다.
  - e2e 첫 판본이 토스트를 닫으려고 `.toast` 노드를 DOM 에서 직접 지우는 우회를 썼다. React 가 관리하는 노드를 지우는 것이라 실제 '닫기' 버튼을 누르는 방식으로 바꿨다.
- 사람 확인 필요
  - **기본 장치로 몰래 바뀌는 연결**: 인터페이스를 뽑은 채로 '기타 연결하기'를 눌러 경고 토스트가 뜨고 기본 입력(내장 마이크일 수 있다)으로 연결되는 흐름이 받아들일 만한지. 내장 마이크가 스피커 소리를 잡아 하울링이 날 수 있어 헤드폰 안내가 이미 있지만, 설계서 4.13 이 정한 동작이라 그대로 두었다(L-96).
  - **실제 브라우저의 권한 차단 흐름**: Chrome·Safari·Firefox 에서 마이크를 '차단'한 뒤 연결했을 때 '주소창의 자물쇠 아이콘' 안내가 맞는지(브라우저마다 아이콘 위치와 이름이 다르다). http 주소로 열었을 때의 문구도 실제로.
  - **문구와 세기**: 경고 토스트가 알맞은 세기인지, 토스트의 '저장된' 글자가 지금 동작(장치 ID 를 저장하지 않음)과 맞는지(L-96), 기본 장치로도 연결이 안 될 때의 입력 장치 없음 문구(L-92).
  - **휴대폰에서 오류가 났을 때 패널이 자동으로 스크롤되는 느낌**(L-93).
- 남은 위험
  - `selectedDeviceId` 를 저장하지 않으므로 설계서의 '저장된 입력 장치가 없음'은 지금은 '고른 뒤 연결 전에 장치가 빠진 경우'로만 생긴다. S2.13 이 장치 ID 를 저장하면 이 경로의 비중이 커진다(L-95).
  - 브라우저별 오류 이름 차이는 Chromium 으로만 확인했다. 옛 이름(`PermissionDeniedError` 등)과 Firefox 식 NotFoundError 는 같은 행으로 분류하지만 실제 브라우저에서는 보지 못했다. 워클릿 로드 실패와 비보안 출처는 모의로만 확인했다.
  - 기본 장치로 다시 시도하면 AudioContext 와 워클릿 로드를 한 번 더 치르므로 연결이 그만큼 늦어진다(걸리는 시간은 재지 않았다).
  - 연결 중 장치 바꾸기(`setSelectedDevice`)의 다시 연결과 연결이 아닌 실패(음원 파일·녹음·장치 목록)는 Node 시험만 있고 e2e 는 연결 버튼 경로만 본다. 후자는 원인별 안내 없이 일반 문구 하나다(L-97).
  - `ko.ts` 에는 연결 오류와 일반 실패 문구뿐이다. 나머지 화면 문구(R4-6)와 영어·내부 이름 노출 점검(E-22)은 S4.6 몫이다.

---

## S2.4 선행 이동 (코드 위치만 옮김)

- 브랜치·병합: `refactor/s2-4-prep-move` → `phase/2`. 커밋 `cba1c79`(이동 전부) · 이 보고서를 담은 문서 커밋(`docs(S2.4 선행): …` — 기록 L-100). 기준선 JSON 은 바뀌지 않아 `baseline:` 커밋은 없다. main 에는 병합하지 않는다(병합하면 Pages 가 자동 배포된다).
- 해결 항목: 없음(R2-2 의 준비). 설계서 0.3-4(파일 이동과 로직 변경을 같은 PR 에 섞지 않는다)를 지키려고 S2.4 본 작업 앞에 따로 둔 Step 이다. S2.4 본 작업은 v1 저장 형식을 읽는 코드를 새 `persistence/` 안에서 쓰는데, 그 코드가 `pedalStore.ts`(872줄) 안에 스토어와 섞여 있었다.
- 변경 파일(6개, 신규 4개, +952 / −925줄): `src/presets/initialPedals.ts`(신규 283줄 — 페달 15개 기본 상태·`clonePedal`·`clonePedals`) · `src/persistence/legacy/boardV1.ts`(신규 584줄 — 스키마 1~11 읽기·`mergeStoredPedals`·`migratePedalCollection`) · `src/persistence/legacy/presetsV1.ts`(신규 60줄 — `parsePresetJson` 등) · `src/presets/createId.ts`(신규 5줄) · `src/store/pedalStore.ts`(872줄 줄어 196줄) · `src/store/presetStore.ts`(73줄 줄어). 저장 키·형식·DSP·화면은 바뀌지 않았다.

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| (설계서에 없는 추가 단언) 옮긴 본문이 줄 단위로 같다 | 충족 | 옮기기 전후의 diff 에서 지워진 줄과 더해진 줄을 줄 내용으로 견주었다. 빈 줄을 뺀 차이는 37가지뿐이고 전부 import 경로(`./` → `../../`)·옮긴 곳 머리말 주석·`pedalStore.ts`/`presetStore.ts` 의 새 import·이전 이름을 다시 내보내는 `export` 였다. 함수 본문은 한 줄도 다르지 않다 |
| (설계서에 없는 추가 단언) 가져오는 쪽 코드는 바뀌지 않는다 | 충족 | `pedalStore.ts`·`presetStore.ts` 가 `clonePedals`·`initialPedals`·`migratePedalCollection`·`migrations`·`migrateStoredState`·`SCHEMA_VERSION`·`parsePresetJson`·타입 `StoredPedal`/`StoredState` 를 다시 내보낸다. 이 두 파일 밖에서 바뀐 파일은 0개 |
| (설계서에 없는 추가 단언) 동작이 같다 | 충족 | 아래 검증 |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| `src/store/pedalStore.ts` | 868줄 — 스토어 + 기본 페달 + v1 읽기 사슬(1→11) | 196줄 — 스토어와 저장본 만들기·읽기 연결 |
| v1 저장 형식 읽기 | 스토어 파일 안 | `src/persistence/legacy/boardV1.ts`·`presetsV1.ts`(S2.4 본 작업이 v2 변환에서 이 코드를 부른다) |
| `npm test` | 35개 통과(404.6초) | 35개 통과(436.7초 — 같은 시험, 측정 오차 안쪽의 변동으로 본다) |

- 검증
  - `npm run typecheck`·`npm run lint` 오류 0.
  - 이동 커밋의 소스에서 `npm test` 35개 모두 통과(436.7초 — 오디오 프로브 23개의 기준선 값이 하나도 바뀌지 않았다). `npm run e2e` 는 전체가 아니라 저장·시작·프리셋 e2e 5개 파일(`e05-storage`·`e23-startup`·`s2-1-off-pedal-mix`·`s1-4c-preset-loudness`·`f-regressions`) 29개만 돌렸고 모두 통과(49.5초). 이동은 저장소를 읽고 쓰는 두 스토어의 import 만 바꾸므로, 시작할 때 저장본을 읽는 경로를 가장 직접 지나는 시험을 골랐다. 전체 e2e 는 S2.4 본 작업의 마지막에 돌린다.
  - **새 시험이 정말 잡는지**: 이 Step 은 새 시험이 없다(동작이 같음을 기존 시험으로 확인하는 Step). 기존 시험이 이동 때문에 깨질 수 있는지는 확인했다 — `__migration_check.ts` 의 v1~v11 변환 단언 1,085줄이 `migrateStoredState`·`parsePresetJson` 을 재내보낸 이름으로 불러 모두 통과한다.
- 만난 문제
  - 없다. 타입 검사·린트가 첫 시도에 통과했다. 이동 스크립트는 줄 번호로 자르는 일회용이라 저장소에 넣지 않았다.
- 사람 확인 필요
  - 없다(화면·소리·저장 동작이 같음을 자동 시험으로 확인한다). `legacy/` 라는 폴더 이름이 4.14 목록에 없는 것은 기록 L-100 에 적었다.
- 남은 위험
  - 이전 이름을 두 스토어가 다시 내보내는 임시 통로는 S2.4 본 작업이 `active` 모델과 v2 저장을 넣은 뒤에도 남는다. 쓰는 쪽이 새 위치를 직접 가져오도록 바꾸는 일은 이름이 바뀌는 Step 마다 조금씩 하고, 마지막 정리는 Phase 4 몫이다.

---

## S2.4 On/Off·Bypass 통합과 저장 형식 v2

- 브랜치·병합: `refactor/s2-4-active-v2` → `phase/2`. 커밋 `c771f3d`(C1 — 켜짐을 `active` 하나로, 켜고 끄는 입구 `setPedalActive`) · `a7f7762`(C2 — 저장 형식 v2: 키·열기 절차·변환 M1~M7·앱 데이터 층 + `test:storage-v2`) · `818f81f`(C3 — 다른 탭 경고·새 버전 알림 + `test:app-notices`·pwa 단언) · `16db57e`(C4a — 프로브 P-19) · `b55109b`(`baseline: S2.4 P-19 …` — 기준선에 P-19 값 50개만 더함) · `8f75ea5`(C4b — e2e 21개) · 이 보고서를 담은 문서 커밋(`docs(S2.4): …` — 기록 L-101~L-118·README 갱신). 앞선 선행 이동(`cba1c79`)은 앞 절. **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 저장 형식이 바뀌는 첫 배포라서 병합·배포 전에 사람이 확인할 것이 있다(아래 '사람 확인 필요').
- 해결 항목: R2-4(On/Off 와 Bypass 가 같은 일), D1(하나로 합친다), D10(`guitar-pedalboard:v2:*` 네임스페이스·v1 키는 백업으로 보존). **설계서 '현재'와 달리 기준선 앱에는 이미 발스위치 하나('효과')와 스키마 11이 있었고**(10→11 마이그레이션이 `enabled` 를 늘 true 로 두고 꺼짐을 `bypassed` 로 모았다) 첫 화면의 켜진 LED 도 5개였다. 그래서 이 Step 의 일은 화면이 아니라 ① 메모리·엔진·저장의 두 필드를 `active` 하나로 합치고 켜고 끄는 길을 하나로 모으기, ② v2 저장(키·변환·백업), ③ 옛 버전 탭 경고, ④ 새 버전 알림, ⑤ 그것들을 지키는 시험(E-08·P-19)이다(코드 지도 8절의 판단대로).
- 변경 파일(62개, 신규 14개, +4,615 / −562줄, 이 문서 커밋 전): 제품(31개, +1,408 / −260) — 신규 `src/persistence/schema.ts`(392줄: v2 타입·읽을 때의 검증·메모리 모양과의 변환)·`bootstrap.ts`(156: 앱을 열 때 저장 형식 정하기)·`appData.ts`(100: 스토어가 쓰는 읽기·쓰기 입구)·`migrations/v1-to-v2.ts`(152: 변환 M1~M7)·`src/store/pedalActions.ts`(27: 켜고 끄는 입구)·`src/app/crossTabNotice.ts`(58)·`src/app/updateNotice.ts`(62), 고침 — `audio/types.ts`·`BaseEffect.ts`·`AudioEngine.ts`·`midi.ts`·`PedalCard.tsx`·`GlobalKeyboardShortcuts.tsx`·`pedalStore.ts`·`presetStore.ts`·`audioStore.ts`·`keys.ts`·`SafeStorage.ts`(설정 초기화가 남기는 키)·`legacy/boardV1.ts`·`legacy/presetsV1.ts`·`main.tsx`·`probes.ts`(P-19)·`pedals.css`(옛 `is-disabled` 규칙 5줄 삭제 — 스토어의 모든 갱신이 `enabled: true` 로 두어 적용될 일이 없었다) 외. 시험(스크립트 19개, +2,085 / −223) — 신규 `scripts/storage-v2-regression.mjs`(1,306줄)·`scripts/app-notices-regression.mjs`(437줄)과 `enabled`·`bypassed` → `active`·새 저장 키로 고친 기존 스크립트들. e2e(8개, +946 / −8) — 신규 `e08-active-led.spec.ts`·`s2-4-cross-tab.spec.ts`·`s2-4-update-notice.spec.ts`·`helpers/storage.ts`·`helpers/dist-server.ts`, 갱신 `e05-storage.spec.ts`·`s1-4c-preset-loudness.spec.ts`(새 키)·`types/node-shim.d.ts`. 기준선(3개) — `audio-probe.json`(+60줄, 지운 줄 0)·`tolerances.json`(+47줄, 지운 줄 0)·`regex-assertions.md`(다시 만듦). `package.json`(시험 스크립트 2개). **DSP·소리는 바뀌지 않았다**(기존 프로브 값 1,646개 불변).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| E-08: 첫 화면에서 LED 가 켜진 페달 수 = 실제 활성 이펙트 수(기본 5개) | 충족 | `e08-active-led.spec.ts` 12개. 처음 연 화면은 발스위치가 카드마다 하나이고 켜진 LED 가 기본 5개(Noise Gate·Compressor·Drive·EQ·Cab)이며, 기타를 연결하면 미터의 이펙트 수 '5개' = LED 수이고 스위치·키보드 단축키·프리셋으로 바꿔도 LED·미터·저장된 상태가 함께 바뀐다. 픽스처 6종마다 LED 수 = 저장돼 있던 켜진 페달 수(5/2/5/5/6/5)이고 새로고침해도 v2 에서 읽는다. 화면 쪽 단언은 기준선(S2.4 이전)에서도 통과했다 — 저장 단언이 기준선을 실패시킨다 |
| P-19: v1 픽스처 6종을 불러온 소리와 v2 로 바꾼 뒤의 소리가 같다(널 ≤ −80 dB) | 충족 | 널 −200 dB(완전히 같음) 9개(보드 6 + 사용자 프리셋 3). 정답은 v1 원문에서 변환 코드를 거치지 않고 따로 만든 체인(L-115). 켜진 페달 목록이 옛 규칙과 다른 곳 0, 사라진 프리셋 0, 첫 방문 변환 5·새로 시작 1·옛 방식 0, 둘째 방문 v2 6. 기준 −80(criteria)에 더해 규칙 −90 |
| 마이그레이션 단위 테스트 6종 통과, 두 번 실행해도 결과가 같다 | 충족 | `npm run test:storage-v2` 1,046건. 픽스처 6종이 손으로 쓴 기대값(규칙 M1~M3·M6 만으로 쓴 값)과 같고, 두 번 옮겨도 v2 키 둘의 글자열이 같고, 되읽은 값이 v1 을 옛 방식으로 읽은 값과 같다. 규칙마다(M1 네 가지 조합·M2·M3·M5·M6·M7) 따로, 열기 절차 다섯 경우(처음·v1 에서·이미 v2·더 새로운 형식·깨진 값)도 본다 |
| v1 키가 남아 있고, 구버전 탭이 v1 키를 쓰면 안내가 뜬다 | 충족 | 키 — `test:storage-v2` 가 v1 키를 어떤 경우에도 쓰지도 지우지도 않음을 확인(깨진 값을 보관하려고 옮기는 것만 예외), e2e 가 픽스처 6종 모두 변환 뒤·새로고침 뒤·노브와 스위치를 저장한 뒤에도 v1 키 원문이 그대로임을 확인(03 은 깨진 원문이 보관 사본에 그대로). 안내 — e2e 5개: v1 키 둘 중 어느 쪽에 쓰든 경고 한 장(문구 그대로, 닫을 때까지 남음), 이 앱끼리의 v2 쓰기(스위치·노브)·v1 키 삭제·저장소 비우기에는 없음, 닫은 뒤 5분 안에는 다시 안 뜸, 옛 방식 모드 탭은 알리지 않음. `test:app-notices` 102건 |
| 연주 중 새 버전이 배포돼도 자동 새로고침이 일어나지 않는다 | 충족 | e2e 4개(진짜 서비스 워커. 작은 서버가 시험 도중에 `sw.js` 의 바이트를 바꿔 내려 배포를 흉내 낸다): 처음 설치로 제어권을 잡는 것은 알림이 없고, 새 서비스 워커가 활성화되면 알림 한 장·버튼을 눌러야만 새로고침하며, 기타를 연결한 채로도 연결이 안 끊기고 새로고침이 없고, 새로고침 뒤 탭도 다음 새 버전을 알리고, 바이트가 같으면 알림이 없다. `pwa-regression` 이 `skipWaiting`·`clientsClaim` 과 '등록 스크립트에 reload 없음' 을 못 박는다 |
| (설계서 주의) 변환에 실패하면 앱은 v1 데이터로 계속 동작해야 한다 | 충족 | `test:storage-v2`: 켜짐·노브 값·순서·음량 보정이 틀린 변환을 끼워 넣으면 v2 를 쓰지 않고 옛 방식 모드로 열려 v1 키를 읽고 v1 모양으로 쓴다. 쓰기 실패는 `schema` 를 쓰지 않아 다음 방문에 다시 옮긴다(L-107). e2e: `schema` 3 인 저장소는 옛 방식으로 열려 LED 수가 맞고 v2 키가 생기지 않는다 |
| (설계서에 없는 추가 단언) 켜고 끄는 입구가 하나다 | 충족 | 화면 스위치·키보드 단축키·MIDI 가 모두 `setPedalActive`/`togglePedalActive` 를 부르고, 프리셋·A/B 는 페달 전체를 한꺼번에 넣는 길로 같은 `active` 를 쓴다. `shortcuts`·`midi`·`preset-ab` 시험을 `active` 로 고쳐 단언한다 |
| (설계서에 없는 추가 단언) 소리·기존 기준선 불변 | 충족 | `npm test` 의 `test:probe` 가 기존 프로브 1,646개 값을 기준선·허용치 그대로 견주어 통과했다. 기준선 JSON 은 P-19 값만 더했다 |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 페달의 켜짐 | `enabled` + `bypassed` 두 필드(v11 부터 `enabled` 는 늘 true). `BaseEffect` 가 `enabled && !bypassed` 로 합쳐 씀 | `active` 하나. 화면·LED·엔진·저장이 같은 값(M1 `active = enabled && !bypassed` 는 읽을 때 한 번만) |
| 켜고 끄는 길 | 화면 스위치는 `commitParam('bypassed')` + 엔진 `setPedalBypass`, 키보드는 `setPedalBypass`, MIDI 는 `bypassed` 메시지 — 길마다 스토어·엔진을 따로 부름 | 셋 다 `setPedalActive`/`togglePedalActive` 하나(저장소 먼저, 엔진은 그 값을 읽는다). MIDI 메시지 필드는 `active`(뜻은 그대로, L-102) |
| 저장 키 | `guitar-pedalboard:pedals`(`{version:11, pedals:[{id,enabled,bypassed,…}], presetTrimDb?}`)·`web-guitar-pedalboard-presets` | `guitar-pedalboard:schema` = '2'(맨 마지막에 씀)·`v2:state`(`{schemaVersion:2, chain, pedals:{id:{id,type,active,params}}, trimDb}`)·`v2:presets`. 이름·색은 코드의 기본 페달에서 가져오므로 적지 않는다. v1 키는 백업으로 남고 앱이 읽지도 쓰지도 않는다(옛 방식 모드만 예외) |
| 모르는 필드·`trimDb` | 모르는 필드는 읽을 때 버림. `presetTrimDb` 는 0 이면 안 적음 | 모르는 필드는 `_extra` 로 돌려 쓴다(M7). `trimDb` 는 늘 숫자, ±24 dB(L-108) |
| 옛 버전 탭 | 알림 없음 | v1 키에 값이 쓰이면 경고 토스트(L-113) |
| 새 서비스 워커 | 말없이 열린 탭을 넘겨받음(`skipWaiting`·`clientsClaim`) | 같은 설정에 알림만 더함: info 토스트 '새 버전이 있습니다 — 연주를 마친 뒤 새로고침' + '새로고침' 버튼, 자동 새로고침 없음(L-114) |
| 설정 초기화 | `guitar-pedalboard:` 키를 모두 지움 | `schema`·`v2:presets` 는 남기고 나머지를 지움(L-105) |
| `npm test` | 35개 통과(436.7초, 선행 이동 시점) | 37개 통과(374.0초 — 새 시험 `test:storage-v2`·`test:app-notices`. 시간은 기계 상태에 따른 변동이라 빨라졌다는 뜻이 아니다) |
| `npm run e2e` | 137개 통과(5.0분) | 158개 통과(5.2분, 새 시험 21개, 기준선 `e2e.json` 불변) |
| 프로브 | 23개, 값 1,646개 | 24개(P-19 추가), 값 1,696개(기존 값 불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e --ext .ts` 오류 0. 정규식 단언 목록(`regex-assertions.md`)은 고친 기존 스크립트의 줄 번호가 밀려 다시 만들었고 지금 코드와 같다(새 시험 스크립트는 `.includes` 만 쓴다).
  - 최종 소스(`8f75ea5`, 작업 트리 깨끗)에서 `npm test` 37개 모두 통과(374.0초, `test:probe` 346.9초 포함), `npm run e2e` 158개 모두 통과(5.2분, 기준선 `e2e.json` 불변). `test:storage-v2` 1,046건·`test:app-notices` 102건.
  - **새 시험이 정말 잡는지**: (1) 신규 e2e 21개를 S2.4 이전 코드 `fa41674` 에 돌리면(시험 파일만 복사, 앱은 그 코드의 빌드) **16개 실패·5개 통과**한다. 실패는 `schema` 키 없음·v2 키 없음·경고 토스트 없음·새 버전 알림 없음이고, 통과한 5개는 이 Step 이 바꾸면 안 되는 동작이다(`schema` 3 옛 방식 모드 2개, 도우미의 페달 표 확인 1개, 옛 방식 탭은 경고 없음 1개, 서비스 워커가 그대로면 알림 없음 1개). 단일 스위치·LED 5개는 이미 기준선에 있어 E-08 의 화면 단언이 거기서는 통과하고 저장 단언에서 실패한다. (2) **변이 시험**(소스를 일부러 틀리게 바꿔 시험이 실패하는지 본다): `test:storage-v2` 17종 모두 적발, `test:app-notices` 32종 모두 적발, `pwa-regression` 3종 적발, P-19 10종 중 9종 적발 + 1종 생존(소리가 같아지는 **등가 변이**, L-115) + 변이 없는 대조 1개, e2e 21종(새 버전 알림 4·두 탭 6·E-08 11) 모두 적발. (3) **e2e 의 구멍을 변이가 찾았다**: 첫 판에서 A2(v2 모드의 노브 지연 저장이 v1 작업 상태 키에도 쓰는 변이)가 살아남았다 — e2e 가 스위치(바로 저장)만 눌러 노브(300 ms 뒤 저장) 길을 지나지 않았기 때문이다. E-08 첫 시험·픽스처 시험·두 탭의 '경고 없음' 시험에 노브 돌리기를, 프리셋 가져오기 시험을 더하고 변이 A2b(프리셋 저장이 v1 프리셋 키에도 씀)·A2c(바로 저장이 v1 키에도 씀)를 더해 셋 모두 적발했다.
- 만난 문제
  - **설계서 '현재'가 기준선과 달랐다.** 단일 스위치·스키마 11·LED 5개가 이미 있어 '화면에서 Bypass 지우기'는 할 일이 없었고, 두 필드를 하나로 합치는 일(타입·엔진·MIDI·단축키·저장)과 v2 저장이 실제 일이었다. 시험이 그것을 나눠 본다: 화면 단언은 기준선에서도 통과하고 저장·알림 단언이 이 Step 에서야 통과한다.
  - **깨진 v1 키는 '그대로 남아 있다' 고 단언할 수 없다.** 픽스처 03 에서 `guitar-pedalboard:pedals` 가 사라졌다 — S1.7 의 `SafeStorage` 가 깨진 값을 `{키}:corrupt-{시각}` 로 복사하고 원래 키를 지우기 때문이다. 단언을 '깨진 값이면 원래 키는 없고 보관 사본에 원문이 그대로' 로 고쳤다(L-111).
  - **변이 시험 뒤의 `dist/`.** 변이를 빌드한 `dist/` 가 남은 채로 e2e 를 돌리면 틀린 코드를 시험하게 된다. 변이 시험 뒤에는 변이를 되돌려(바이트 비교) 깨끗이 다시 빌드하고 `E2E_SKIP_BUILD` 를 쓰지 않았다.
  - `test:storage-v2` 의 변이 시험 첫 판에 1종이 살아남았다. 해당 시험을 보강한 뒤 17종 모두 적발된다.
- 사람 확인 필요
  - **실제 브라우저에서 옛 데이터로 업그레이드**: 이미 앱을 써 온 사람의 브라우저(실제 프리셋·작업 상태)에서 새 버전을 열었을 때 LED·노브·프리셋이 그대로인지, 한 번 닫고 다시 열어도 같은지. 픽스처 6종과 P-19 는 고정된 데이터이고 실제 사용자 데이터는 아니다(설계서 7.3 도 '실제 브라우저에서 기존 데이터로 업그레이드 시험' 을 요구한다).
  - **실제 배포에서의 새 버전 알림**: 열려 있는 탭에 새 서비스 워커가 들어오는 순간 알림이 뜨는지는 GitHub Pages 에 올려 봐야 안다. 브라우저가 새 서비스 워커를 언제 알아채는지(탭을 열 때·새로고침할 때·주기 확인)는 브라우저 몫이고, e2e 는 그것을 흉내 냈다(L-114). **이 알림이 처음 들어가는 배포 전부터 열려 있던 탭은 알림이 없다.**
  - **실제 옛 빌드 탭과의 두 탭**: 실제 옛 앱이 v1 키에 쓸 때 경고가 뜨는지(e2e 는 같은 키에 값을 써서 흉내 냈다), 경고의 5분 쿨다운이 알맞은지(L-113).
  - **팩토리 사본 토스트**(L-110): 팩토리 프리셋과 똑같은 사본이 있는 저장소로 업그레이드했을 때 문구와 '정리' 동작이 받아들일 만한지. 대화상자는 S2.8 에서 생긴다.
  - **Fuzz Gate > 0 으로 저장된 프리셋의 소리**(L-116): 변환은 값을 바꾸지 않으므로 S2.2 의 변화(Gate 15 +0.75 dB … Gate 100 +6.9 dB)가 그대로 나온다. 귀로 확인하고, 보정이 필요하면 따로 정한다.
  - **롤백**: 새 버전을 열었다가 옛 번들로 돌아가면(스키마 2 + 옛 앱) 옛 앱은 v1 키만 보므로 새 버전에서 한 편집이 옛 앱에 보이지 않고, 옛 앱에서 한 편집은 v1 키에 쓰여 새 버전 탭이 경고한다. 의도한 동작이지만 사람이 한 번 확인한다.
  - **듣기**: 변환 전후의 소리가 같음은 널 테스트로 확인했다. 실제 프리셋 몇 개를 변환 전후로 귀로 들어 보는 일은 사람 몫이다.
- 남은 위험
  - **v2 쓰기가 반쯤 실패하는 경우**: `v2:state` 는 쓰였고 `v2:presets` 가 실패하면 `schema` 가 안 쓰이므로 다음 방문에 v1 에서 다시 옮기며, 그 사이 v2 에서 한 편집이 사라진다(L-107).
  - **옮기지 못하는 값**: 코드에 없는 페달 id 는 v2 로 옮기지 않는다(v1 백업에만 남는다). id 가 빈 v1 프리셋은 새 id 를 받아 변환이 그 프리셋에서는 멱등이 아니다. 프리셋 목록은 한 항목이라도 올바르지 않으면 목록 전체를 보관하고 읽지 않는다(L-111). 숫자처럼 보이는 문자열('0')은 M3 의 범위 맞춤이 건너뛴다.
  - **내려가기·다른 버전**: `schema` 가 2 보다 큰 저장소는 옛 방식으로 열어 v1 키에만 쓴다 — 새 앱에는 그 편집이 보이지 않는다(L-106). 설정 초기화는 `schema`·프리셋을 남기고 작업 상태와 v1 작업 상태 백업을 지운다(L-105).
  - **경고의 한계**: 옛 탭이 아무것도 쓰지 않으면 경고가 없다(L-113). 새 버전 알림은 브라우저가 새 서비스 워커를 알아채는 시점에 기대고(L-114), 이 앱은 새 버전을 찾으러 다니지 않는다.
  - **확인하지 못한 가설**: 서비스 워커가 새 버전으로 넘어간 뒤 옛 스크립트로 도는 탭이 기타를 다시 연결하면(연결할 때마다 워클릿 파일을 새로 받는다) 파일 이름의 해시가 새 배포에 없어 받지 못할 수 있다. 이 앱의 설정(`skipWaiting`·`clientsClaim`·`cleanupOutdatedCaches`)에서 원래 있던 성질이고 이 Step 이 만든 것은 아니지만, 알림이 '연주를 마친 뒤 새로고침' 을 권하는 이유이기도 하다. 실제 배포로 확인하지 못했다.
  - **Fuzz Gate > 0 으로 저장된 프리셋이 더 크게 들린다**(L-88·L-116). 리미터(−1 dBFS)가 천장을 지킨다.
  - **v1 키 정리**는 어느 Step 에도 없고 일정도 등록하지 않았다(L-118). v1 키는 사용자가 '설정 초기화' 를 누르지 않는 한 계속 남는다.

---

## S2.5 입력 레벨 경고 바로잡기

- 브랜치·병합: `refactor/s2-5-level-warnings` → `phase/2`. 커밋 `69d9d5f`(C1 — 판정기 `levelWarning.ts`·`MonitorService` 배선·화면 `InputLevelNotice`·시험 신호 4종·Node 시험 `test:level-warning`) · `58732a2`(C2 — e2e E-09 18개와 하네스) · `7065a4c`(C3 — 시험 파일 주석의 옛 앱 수치만 바로잡음) · `b9a09dc`(C4 — 신호 주석의 기록 번호만 바로잡음) · 이 보고서를 담은 문서 커밋(`docs(S2.5): …` — 기록 L-119~L-128·README 갱신). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 소리가 바뀌지 않아 기준선 JSON 은 건드리지 않았다.
- 해결 항목: R2-8(입력 레벨 경고가 사실과 다름), 4.12 원칙 3(경고는 근거가 있을 때만, 띄울 때와 지울 때의 간격). **설계서 '현재'와 달리 기준선 앱은 정상 신호에 경고가 없었고 일시정지한 파일에도 경고가 없었다**(S1.5·S1.6 이후, L-127). 실제로 재현된 것은 작은·큰 신호에서의 오경고와 깜박임, 무음에 경고가 없음, 한 번 치고 멈춘 연주 뒤 약 7.7초 동안의 오경고, 파일 모드의 오경고였다. 이 Step 의 일은 ① 판정을 화면(입력 패널이 렌더 때마다 순간 피크로 계산)에서 `MonitorService` 로 옮기고 4.12 표의 문턱·시간을 지키는 것, ② 두 패널이 같은 결과를 보이는 것, ③ 그것을 지키는 시험(Node 37건·e2e 18개)이다.
- 변경 파일(16개, 신규 5개, +1,213 / −36줄, 이 문서 커밋 전): 제품 `src/` 9개(+282 / −28) — 신규 `audio/monitor/levelWarning.ts`(150줄: 화면·DOM·타이머를 모르는 순수 판정기 `LevelWarningJudge` 와 문턱 모음 `LEVEL_WARNING_SPEC`)·`components/InputLevelNotice.tsx`(25), 고침 `audio/monitor/MonitorService.ts`(+25: 입력 보고마다 판정, 바뀔 때만 싱크에 알림, detach 때 비움)·`audio/AudioEngine.ts`(+3: 판정 여부 훅 `inputJudging` = 장치 스트림이 열려 있을 때만)·`store/monitorStore.ts`(`inputWarning`)·`components/ConnectGuitarPanel.tsx`(옛 순간값 판정 22줄 삭제)·`components/Meter.tsx`(경고 표시·클리핑 표시가 판정을 따름)·`i18n/ko.ts`(`ko.level` 세 문장)·`audio/testing/signals.ts`(신호 4종, +46). 시험·도구 7개(+931 / −8) — 신규 `scripts/level-warning-regression.mjs`(516줄)·`e2e/tests/e09-level-warning.spec.ts`(280)·`e2e/helpers/level-notice.ts`(120), 고침 `package.json`(`test:level-warning`)·`scripts/howl-guard-regression.mjs`(싱크 모의에 `setInputWarning`)·`scripts/make-fixture-wavs.mjs`(`--missing`)·`e2e/global-setup.ts`(빠진 WAV 만 만들기). **DSP·소리는 바뀌지 않았다**(프로브 24개·값 1,696개 불변).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| E-09 정상 입력(REF-PC, 피크 −12 dBFS) → 경고 없음 | 충족 | e2e 2개(데스크톱·휴대폰 '페달' 탭): 오디오 시계 7초까지 경고가 한 번도 없음. Node: 60초 |
| E-09 작은 입력(−40 dBFS) → '작습니다' | 충족 | e2e 2개: 데스크톱 5.22초·휴대폰 '페달' 탭 5.15초에 '입력이 작습니다' 하나가 뜨고 유지, '신호 없음'·'너무 큼' 은 없음. 판정기만 Node 로 돌리면 4.06~4.14초이고 e2e 가 늦은 것은 L-121(브라우저 44.1 kHz 리샘플링으로 타건 피크가 ±0.01 dB 흔들림, 최대 +1초) |
| E-09 한계 초과(0 dBFS) → '너무 큽니다' | 충족 | e2e 6개: 데스크톱 2.10초, 휴대폰 네 탭(페달·입력·미터·프리셋) 모두 2.08~2.11초(연결 직후 1초 뒤 첫 깨짐에 바로). 미터의 '클리핑 발생' 표시가 같이 켜지고(L-124), 연결을 끊었다 다시 이으면 새 시계로 2.15초에 다시 뜬다 |
| E-09 5초 무음 → '신호가 없습니다' | 충족 | e2e 2개: 데스크톱 6.21초·휴대폰 '페달' 탭 6.17초(연결 직후 1초 + 5초 무음, L-121) |
| '휴대폰 입력 탭을 포함한 모든 탭에서' | 충족(읽은 대로) | 큰 신호는 네 탭 각각을 고른 채 같은 시각에 판정되고, 정상·작음·무음은 '페달' 탭에서 판정시킨 뒤 네 탭을 돌며 입력·미터 탭에만 보임을 확인한다. 판정을 화면 탭에 묶는 변이 2종을 e2e 가 잡는다. **'페달'·'프리셋' 탭에는 표시가 없다**(L-125·L-128) |
| PC 에서 연주를 멈춰도 '작습니다' 가 뜨지 않는다 | 충족 | e2e: LVL-STOP(한 번 치고 멈춤)에서 12초가 되도록 어떤 경고도 없음(옛 앱은 3.88초~11.58초 '너무 작습니다'). Node: 마지막 소리의 5초 뒤에야 '신호 없음' 만. 표를 글자 그대로 구현하면 6.3초에 거짓 '작음' 이 떠서 조건을 하나 보탰다(L-119) |
| 파일을 일시정지해도 '작습니다' 가 뜨지 않는다 | 충족(옛 앱에서도 재현 안 됨) | e2e: 재생하다 일시정지한 채 9.5초가 되도록 경고 없음. 파일 재생은 재생 중에도 판정하지 않는다(0 dBFS·−40 dBFS·무음 파일 3개 시험, L-120) |
| (설계서 4.12) 연결 직후 1초·세션 정지는 판단하지 않음 | 충족 | e2e: 연결을 끊으면 경고가 바로 사라지고 다시 연결한 직후 0.8초 안에는 없음. Node: 1초 버림·판정 중단·시계 역행·detach |
| (설계서에 없는 추가 단언) 소리·기존 기준선 불변 | 충족 | `npm test` 의 `test:probe` 가 기존 프로브 1,696개 값을 기준선·허용치 그대로 견주어 통과. `e2e.json`·`audio-probe.json` 불변 |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 판정하는 곳 | 입력 패널(`ConnectGuitarPanel`)이 렌더 때마다 순간 피크로 계산(클리핑 → '클리핑 발생', 피크 > −1 → '0dBFS 에 근접', −90 < 피크 < −40 → '너무 작습니다'). 미터 패널에는 입력 경고가 없음 | `MonitorService` 가 입력 레벨 보고(오디오 시계)로 판정. 화면은 `monitorStore.inputWarning` 만 읽고, 입력 패널과 미터 패널이 같은 컴포넌트(`InputLevelNotice`)로 같은 말을 보인다 |
| 기준·시간 | 순간값 하나, 히스테리시스 없음, 연결 직후 0초부터 | 4.12 표: 신호 없음(5초 < −70, 해제 ≥ −60)·작음(3초 최대 < −36, 해제 ≥ −30)·큼(≥ −0.5, 3초 깨짐 없으면 해제), 연결 직후 1초는 버림 |
| 정상 입력 | 경고 없음 | 경고 없음(7초까지) |
| 작은 입력(−40 dBFS) | 0.16초부터 '입력이 너무 작습니다'(타건 때 0.1초 꺼졌다 켜짐) | 5.2초에 '입력이 작습니다' 하나, 유지 |
| 한계 초과(0 dBFS) | 0.11초부터 타건마다 '0dBFS 에 근접했습니다' 가 0.2초쯤 깜박임 | 2.1초에 '입력이 너무 큽니다' 하나, 마지막 깨짐 뒤 3초 유지 |
| 디지털 무음 | 경고 없음 | 6.2초에 '입력 신호가 없습니다' |
| 한 번 치고 멈춤 | 3.88초부터 11.58초까지 '입력이 너무 작습니다' | 12초까지 경고 없음, 완전히 조용해진 5초 뒤(≈13초) '신호 없음' |
| 파일 모드 | 0 dBFS 파일은 0.24초부터 깜박임, −40 dBFS 파일은 0.30초부터 '너무 작습니다' | 판정하지 않음(재생·일시정지 모두) |
| 미터의 클리핑 표시 | 입력 막대의 순간 클립 | 판정된 '너무 큼'(출력 쪽 클립은 그대로) |
| 문구 | 화면 코드 안의 문자열 | `ko.level` 세 문장(4.12 표 그대로) |
| 시험 신호 | REF-PC 등 부록 A 신호 | + `lvl-small`·`lvl-hot`·`lvl-silent`·`lvl-stop`(L-126). WAV 는 빠진 것만 만든다 |
| `npm test` | 37개 통과(374.0초) | 38개 통과(399.5초 — 새 시험 `test:level-warning` 3.8초. 시간은 기계 상태에 따른 변동이라 느려졌다는 뜻이 아니다) |
| `npm run e2e` | 158개 통과(5.2분) | 176개 통과(8.1분, 새 시험 18개의 시간 합 145.8초, 기준선 `e2e.json` 불변) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e --ext .ts` 오류 0. 정규식 단언 목록(`regex-assertions.md`)은 지금 코드와 같다(바뀐 것 없음).
  - 코드 커밋 `58732a2`(작업 트리 깨끗)에서 `npm test` 38개 모두 통과(399.5초, `test:probe` 367.6초·`test:level-warning` 3.8초·`test:howl` 4.2초 포함), `npm run e2e` 176개 모두 통과(8.1분, 기준선 `e2e.json` 불변). `test:level-warning` 은 37건이다. 그 뒤의 `7065a4c`·`b9a09dc` 는 주석만 바꿨다(e2e 시험 파일 두 줄, `signals.ts` 한 줄). 그래서 타입 검사·린트·정규식 목록만 다시 돌렸다.
  - **새 시험이 정말 잡는지**: (1) 신규 e2e 18개를 S2.5 이전 코드(`1248c57`)의 빌드에 돌리면(시험 파일만 복사) **13개 실패·5개 통과**한다. 실패는 옛 경고가 연결 직후부터 뜨거나(`legacy@0.16`), 타건마다 깜박이거나(`legacy@0.11 → 없음@0.28 → legacy@2.09 → …`), 무음에 경고가 없거나(`(변화 없음)`), 멈춘 연주에 `legacy@3.88 → 없음@11.58` 이고, 파일 모드는 0 dBFS 파일이 깜박이고 −40 dBFS 파일에 경고가 뜬다. 통과한 5개는 옛 앱도 맞던 동작이다(정상 신호 2개·무음 파일·파일 일시정지·관찰 도구 점검). (2) **변이 시험**(소스를 일부러 틀리게 바꿔 시험이 실패하는지 본다): `test:level-warning` 은 11종 중 10종을 적발하고 1종이 살아남는데, 그것(우선순위 high > silent > low 를 바꿈)은 소리가 같아지는 **등가 변이**다 — 세 플래그가 서로를 지우며 설정되어 동시에 참이 되지 않으므로, 무작위 입력 720만 단계로 원본과 견주어 출력 차이 0 을 확인했다(L-122). e2e 는 변이 8종을 모두 적발한다: 창 최대값이 오래됐을 때 판단을 미루는 조건 제거(`low@6.43`)·파일 재생도 판정(파일 모드 3개 `high@2.15`·`silent@6.13`·`low@4.10`, 일시정지 시험 `silent@6.91`)·미터 패널의 경고 표시 제거·연결 직후 1초 버림 제거('1초보다 일찍 떴습니다')·미터 클리핑 표시가 판정을 따르지 않음·입력 패널의 경고 표시 제거·**판정을 '미터 패널이 보일 때만' / '입력 패널이 보일 때만' 하게 바꿈**(휴대폰 시험 7개 중 각각 5개 실패, `(변화 없음)`. 실패하지 않은 2개는 그 탭을 고른 시험과 경고가 없어야 하는 정상 신호). (3) **변이가 시험의 구멍을 찾았다**: 첫 판에서 '연결을 끊을 때 판정기를 비우는 줄 제거'(N6)가 살아남았다 — 시계가 거꾸로 가면 비우는 규칙이 가려서 detach 가 비우지 않아도 통과했다. 판정기가 비워졌는지를 직접 보는 검사를 더해 적발된다.
- 만난 문제
  - **설계서 '현재'가 기준선과 달랐다**(L-127). 정상 입력의 경고도 일시정지한 파일의 경고도 기준선에서는 없었다. 시험은 그것을 나눠 본다: 오경고를 기대하던 옛 코드 시험 13개가 실패하고, 옛 앱도 맞던 5개는 통과한다. 일시정지 시험은 옛 앱에서도 통과하므로 변이(파일 재생도 판정)로 잡히는지를 따로 확인했다.
  - **표를 글자 그대로 구현하면 연주를 멈춘 뒤에 거짓 '작음' 이 뜬다.** 한 번 친 큰 소리가 3초 창을 벗어나면 창의 최대값이 줄어드는 여운(−36 dBFS 아래, −60 dBFS 위)으로 바뀌어 6.3초에 '입력이 작습니다' 가 뜬다 — 수용 기준이 막으려는 증상 그대로다. 표를 글자 그대로 구현한 참조 모델로 재현했고, 창의 최대값이 최근 2초 안의 것일 때만 '작음' 을 세우고 지우도록 조건을 하나 보탰다(L-119). 대가로 타건 간격이 2초보다 긴 아주 느린 연주는 '작음' 이 늦거나 안 뜬다.
  - **브라우저에서 '작음' 이 4초대가 아니라 5.2초에 떴다.** 브라우저의 AudioContext 는 44.1 kHz 이고 가짜 마이크의 48 kHz WAV 를 리샘플해서 타건마다 피크가 ±0.01 dB 흔들린다. 앞 타건이 조금 더 크면 창의 최대값으로 남고, 그 타건이 2초(`lowFreshSeconds`)보다 오래되어 판단이 그 타건이 창을 벗어나는 5.1초까지 미뤄진다. 피크가 0.01 dB 씩 줄어드는 신호로 판정기를 돌리면 같은 5.13초가 나오고, 피크가 같으면 4.06~4.14초다(L-121). 늦어지는 폭은 최대 1초이고 시험 범위(3.8~7초) 안이라 고치지 않았다.
  - **e2e 첫 실행에서 17개가 모두 실패했다.** 관찰 도구의 선택자 `.level-warning` 이 미터 패널의 **출력** 경고(숨겨진 `<p class="level-warning">`)까지 입력 경고로 읽었다. 입력 경고 요소에 `data-level-warning` 를 달고 도구가 그 속성(과 옛 앱의 연결 패널 안 경고)만 읽게 했다. 옛 앱의 경고는 'legacy' 로 기록해 같은 시험을 옛 코드에도 돌릴 수 있다.
  - **0 dBFS 신호가 타건마다 깜박였다.** REF-PC 를 한 번에 −12 dBFS 로 맞추면 첫 타건만 목표 레벨이고 뒤의 타건은 1~3 dB 낮다. 시험 신호는 타건마다 피크를 맞춘다(L-126).
  - **시험 주석이 옛 앱의 수치를 틀리게 적고 있었다**(3.7초, 실측 3.88초). 실측대로 고쳤다(`7065a4c`).
  - 변이 시험 뒤의 `dist/` 는 변이를 되돌려(바이트 비교) 깨끗이 다시 빌드했고 `E2E_SKIP_BUILD` 로 변이 빌드를 시험하지 않았다.
- 사람 확인 필요
  - **실제 기타·인터페이스로 문턱과 시간을 정한다**(설계서 6.5). 표의 모든 수치(−70·−60·−36·−30·−0.5 dBFS, 1·3·5초)와 이 Step 이 보탠 2초는 초기값이다. '작음' 이 너무 일찍·늦게 뜨는지, 연주 중 '신호 없음' 이 거짓으로 뜨지 않는지, 깨질 때만 '너무 큼' 이 뜨는지는 실제 연주로 봐야 한다.
  - **잡음 바닥이 −70~−60 dBFS 인 인터페이스.** 그 구간은 어느 경고도 아니라서(L-122) 케이블을 뽑아도 '신호 없음' 이 안 뜰 수 있다. 문턱을 올릴지 정한다.
  - **아주 느린 연주**(타건 간격이 2초보다 긴 경우)에서 '작음' 이 늦거나 안 뜨는 것을 받아들일지(L-119).
  - **휴대폰 '페달'·'프리셋' 탭에서는 경고가 보이지 않는다**(L-128). 연주 화면에서 케이블이 빠졌을 때 알아차릴 작은 표시가 필요한지는 디자인 결정이다. 파일 재생 중에도 입력 경고가 없다(L-120) — 파일 전용 안내가 필요한지는 S2.6 에서 본다.
  - **문구와 읽히는 느낌**: 문구는 4.12 표의 문장 그대로다. 휴대폰 화면에서 한 줄에 읽히는지, '너무 큽니다' 가 `role="alert"` 로 읽히는 것이 시끄럽지 않은지 사람이 본다.
  - **실제 기기에서의 시간**: 가짜 마이크는 44.1 kHz 와 일정한 보고 간격이다. 실제 휴대폰·인터페이스의 시작 지연·보고 간격에서도 같은 시각에 뜨는지 본다.
- 남은 위험
  - 문턱·시간이 모두 초기값이다(6.5). '작음' 은 타건 피크가 미세하게 줄어드는 신호에서 최대 1초 늦을 수 있다(L-121).
  - 한 번의 −55 dBFS 잡음(연주 ≥ −60 으로 셈)은 '신호 없음' 을 '작음' 으로 바꿔 놓고, 5초 무음이 다시 찰 때까지 간다(표대로, L-122).
  - 입력 채널을 바꾸면 최근 3초의 판정 기록에 이전 채널의 피크가 섞여 있다(최대 3초).
  - 판정은 오디오 시계로 흐른다. 오디오 컨텍스트가 멈춰 보고가 오지 않으면 판정도 멈추고 마지막 경고가 화면에 남는다. 문서가 숨겨졌을 때의 판정은 e2e 로 보지 않았다(판정이 타이머·`requestAnimationFrame` 을 쓰지 않는 것은 Node 시험이 `MonitorService` 에 보고를 직접 흘려 확인한다).
  - 휴대폰 16개 조합(4종 × 4탭) 가운데 9개는 판정 시각을 따로 재지 않는다(L-125). 표시는 모든 조합에서 본다.

---

## S2.6 음원 파일 모드: 반복·탐색·Space

- 브랜치·병합: `refactor/s2-6-file-mode` → `phase/2`. 커밋 `4d730be`(C1 — 엔진·스토어·`FilePlayer`·Space·CSS 와 Node 시험 `test:file-mode`) · `1cd7c70`(C2 — e2e E-10 15개와 관찰 도우미) · 이 보고서를 담은 문서 커밋(`docs(S2.6): …` — 기록 L-129~L-139·README 갱신). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 소리가 바뀌지 않아 기준선 JSON 은 건드리지 않았다.
- 해결 항목: R2-5(음원 파일 모드가 한 번 재생하면 끝, Space), 4.11 '파일 재생' 표. **설계서 '현재' 와 달리 기준선에는 반복(`loop = true`)·탐색 막대·파일 모드의 Space 재생/일시정지가 이미 있었다**(L-129). 실제로 재현된 것은 ① 정지하면 파일이 사라지는 것('업로드된 음원 없음', '재생' 꺼짐) ② 그 뒤 Space 가 마이크 연결을 요청하는 것 ③ 브라우저 기본 영문 파일 버튼이 보이는 것 ④ '파일 닫기'·반복 끄기가 없는 것 ⑤ 탐색 막대가 상대 이동이라 잡고 끌 때 재생 위치가 막대를 밀어내는 것이었다. 이 Step 의 일은 ① 열어 둔 파일을 정지·Panic·끝남 뒤에도 남기고 같은 파일로 새 세션(새 `<audio>` 요소·새 Object URL)을 여는 것 ② '파일 닫기'·'반복 재생' 스위치·절대 이동 탐색 막대·한국어 열기 버튼(기본 입력은 숨김) ③ Space 규칙 ④ 그것을 지키는 시험(Node 116건·e2e 15개)이다.
- 변경 파일(14개, 신규 4개, +1,356 / −126줄, 이 문서 커밋 전): 제품 `src/` 8개(+284 / −124) — 신규 `components/FilePlayer.tsx`(174줄: 열기·닫기 버튼, 숨긴 `#audio-file`, 이름·시간, 탐색 막대, 재생·일시정지·정지·±10초, 반복 스위치), 고침 `audio/AudioEngine.ts`(+23 / −2: 반복 설정 `setFileLoop`·절대 이동 `seekUploadedFileTo`·정리 때 옛 요소의 자원 해제)·`store/audioStore.ts`(+61 / −3: `uploadedFile`·`fileLoop`·`seekFileTo`·`setFileLoop`·`closeFile`, 정지가 파일을 놓지 않음, `playFile` 이 세션이 없으면 새 세션을 엶, 끝남이 정지 절차를 돌리지 않음)·`components/ConnectGuitarPanel.tsx`(옛 파일 블록 97줄 삭제)·`components/GlobalKeyboardShortcuts.tsx`(+4: Space 의 파일 분기)·`components/ShortcutHelp.tsx`(+1 / −1: Space 설명)·`styles/panels.css`(브라우저 기본 파일 입력·`::file-selector-button` 꾸밈 삭제, 열기·닫기 2열 `.file-open-actions`·반복 스위치 줄 `.file-loop-control`·블록 제목 `.file-section-title` 추가)·`styles/layout.css`(헤더 도구 패널의 파일 블록 격자 배치를 새 요소 이름으로 옮기고 `::file-selector-button` 규칙 삭제). 시험·도구 6개(+1,072 / −2) — 신규 `scripts/file-mode-regression.mjs`(383줄)·`e2e/tests/e10-file-mode.spec.ts`(498)·`e2e/helpers/file-media.ts`(155), 고침 `package.json`(`test:file-mode`)·`scripts/shortcuts-regression.mjs`(+34: 파일 모드의 Space)·`scripts/connect-errors-regression.mjs`(순서 단언이 `<FilePlayer />` 를 가리킴). **DSP·소리는 바뀌지 않았다**(프로브 24개·값 1,696개 불변).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| E-10 재생이 끝나도 파일이 남고, 반복이 켜져 있으면 처음부터 다시 재생 | 충족(이음매 클릭은 사람 확인) | e2e 3개: 반복 켜짐은 1초 파일(REF-IMPULSE)이 3.5초 동안 두 번 이상 처음으로 돌아오고 `<audio>` 요소는 1개 그대로·파일 이름 그대로. 반복을 끄면 끝에서 멈추고(위치 = 길이, '0:01 / 0:01') 이름이 남고 안내 토스트도 없고, '재생' 은 같은 요소로 처음부터 튼다(400 ms 안에 0.6초 아래). 반복을 끈 값은 정지 뒤 새 요소와 다른 파일에도 이어진다. Node: 끝남이 세션·파일을 건드리지 않음, 늦게 온 `ended` 무시. **이음매 클릭은 설계서가 청취 확인으로 정했다**(L-138) |
| 탐색 막대로 아무 위치로나 이동, ±10초 버튼 유지 | 충족 | e2e 5개: 막대 `fill` 로 30·55·4초 → 요소 위치가 그 자리, ±10초, 0초 아래로는 가지 않음, 읽는 값(`aria-valuetext`)·화면 시간이 위치를 따라감 / 마우스로 20% → 80% 끌어 놓으면 그곳에서 이어 재생되고 막대는 다시 재생 위치를 따라감 / 막대 밖에서 놓아도 같음 / 놓는 신호가 창으로 와도 같음 / 반복을 끄고 끝을 넘겨 이동하면 끝에서 멈춤. Node: 절대 이동·±10초·길이로 자르기(진짜 엔진 메서드) |
| 파일 모드의 Space = 재생/일시정지, 마이크가 켜지는 일 없음 | 충족 | e2e 3개: 재생 중 Space 로 일시정지·다시 재생(같은 요소), 정지·Esc 긴급 정지 뒤의 Space 는 새 세션으로 파일을 다시 틀고 **`getUserMedia` 0회·입력 트랙 없음·오디오 컨텍스트 동시 1개**. 파일이 없으면 Space 는 기타 연결(1회), 파일을 닫은 뒤에도(2회), 기타를 연결했다 끊은 뒤에도 기타를 연결한다(놓은 파일이 보이지 않게 남아 있지 않다). Node: 단축키 명령 단위로 5가지(재생 중이면 일시정지·일시정지 중이면 재생·세션이 끝나도 파일이 있으면 파일 재생·파일이 없으면 기타 연결·기타가 연결돼 있으면 해제) |
| 연결 해제 → 다시 연결해도 같은 파일로 재생(새 `<audio>` 요소) | 충족 | e2e: 정지 → 컨텍스트 `closed`·Object URL 해제·옛 요소의 `src` 속성 없음 → '재생' 은 같은 File 로 두 번째 요소·새 URL·처음부터(컨텍스트 `closed`, `running`). 같은 파일을 선택 창으로 다시 골라도 열리고(세 번째 요소) 이전 URL 은 해제·현재 URL 은 유지·컨텍스트는 동시에 하나. 다른 파일을 열면 이전 URL 해제, '파일 닫기' 는 정지·해제·플레이어 비움 |
| 화면에 브라우저 기본 영문 파일 버튼이 보이지 않음 | 충족 | e2e 2개(데스크톱·휴대폰 390×844 입력 탭): `#audio-file` 은 숨김(`display:none`), 한국어 '음원 파일 열기' 버튼이 파일 선택 창(`filechooser`)을 열고 고른 파일이 재생된다. 휴대폰은 가로 넘침이 없다. Node: 소스 단언 |
| (설계서에 없는 추가 단언) 기타를 연결하면 열어 둔 파일을 놓는다 | 충족 | e2e: 정지한 파일을 둔 채 기타를 연결했다 끊으면 '열린 음원 없음'이고 '재생' 은 꺼져 있다(L-130). Node: 연결 성공은 놓고 실패는 그대로, 파일 열기 실패는 놓고, '파일 닫기' 는 기타 연결을 건드리지 않음 |
| (설계서에 없는 추가 단언) 소리·기존 기준선 불변 | 충족 | `npm test` 의 `test:probe` 가 기존 프로브 1,696개 값을 기준선·허용치 그대로 견주어 통과. `e2e.json`·`audio-probe.json` 불변 |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 정지한 뒤의 파일 | 이름이 '업로드된 음원 없음' 으로 바뀌고 '재생' 이 꺼짐(다시 올려야 함) | 이름·전체 길이가 남고 '재생' 이 같은 File 로 새 세션(새 요소·새 Object URL)을 연다. 놓는 때는 다른 파일 열기·'파일 닫기'·기타 연결 성공·열기 실패(L-130) |
| 정지한 뒤의 Space | 마이크 연결을 요청한다(getUserMedia 1회) | 열어 둔 파일을 다시 튼다(getUserMedia 0회). 파일이 없으면 예전처럼 기타 연결 |
| 파일 열기 | 브라우저 기본 파일 입력(영문 버튼)이 화면에 보임 | 입력은 `display:none`, 한국어 '음원 파일 열기' 버튼 + '파일 닫기' 버튼 |
| 반복 | 항상 켜짐(끌 수 없음. 막대 위에 '재생 위치 · 반복 재생' 이라는 글자만 있음) | '반복 재생' 스위치(기본 켜짐), 재생 중에도 바로 적용, 새 요소·다른 파일에 이어짐, 저장하지 않음(L-133) |
| 끝남(반복을 끈 경우) | `ended` → 세션 전체 정지 + 파일 삭제 코드(반복이 켜져 `ended` 가 오지 않았음) | 세션·파일이 그대로, 끝에서 멈춤. '재생' 은 같은 요소로 처음부터(L-132) |
| 탐색 막대 | '값 − 현재 위치' 의 상대 이동, 잡고 끌 때 재생 위치가 막대를 밀어냄 | 절대 이동(0 ~ 길이로 자름), 잡는 동안 막대가 잡은 값을 보이고 놓으면 재생 위치를 따라감(L-136) |
| 세션이 끝날 때의 `<audio>` | `pause()` 와 Object URL 해제(옛 요소의 `src` 는 그대로라 요소가 자원을 쥐고 있을 수 있음) | `pause()` + `src` 속성 제거 + `load()` 에 이어 Object URL 해제(L-135) |
| 화면 문구 | '업로드된 음원 없음'·'업로드 음원 플레이어'·'재생 위치 · 반복 재생' | '열린 음원 없음'·'음원 파일 플레이어'·'재생 위치'(L-137) |
| `npm test` | 38개 통과(399.5초) | 39개 통과(392.5초 — 새 시험 `test:file-mode` 0.1초. 시간의 거의 전부는 `test:probe` 361.5초이고 기계 상태에 따라 달라진다) |
| `npm run e2e` | 176개 통과(8.1분) | 191개 통과(8.5분, 새 시험 15개의 시간 합 45.2초, 기준선 `e2e.json` 불변) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e --ext .ts` 오류 0. 정규식 단언 목록(`regex-assertions.md`)은 지금 코드와 같다(바뀐 것 없음).
  - 코드 커밋 `1cd7c70` 그대로(그동안 바뀐 것은 문서뿐)에서 `npm test` 39개 모두 통과(392.5초, `test:probe` 361.5초·`test:file-mode` 0.1초 포함), `npm run e2e` 191개 모두 통과(8.5분, 기준선 `e2e.json` 불변). `test:file-mode` 는 116건이다.
  - **새 시험이 정말 잡는지**: (1) 신규 e2e 15개를 S2.6 이전 코드(`bdf265a`)의 빌드에 돌리면(시험 파일만 복사) **12개 실패·3개 통과**한다. 실패는 새 화면 요소(음원 파일 열기·파일 닫기·반복 재생 스위치·'음원 파일 플레이어' 묶음)를 찾지 못하거나 `#audio-file` 이 화면에 보이는 것이고, 통과한 3개는 옛 앱도 맞던 '막대를 끌어도 따라간다'(막대 안·밖·창)다. 실패 이유가 대부분 '새 요소가 없다' 이므로 옛 앱의 증상은 옛 선택자로 따로 쟀다: 파일을 열면 `#audio-file` 이 보이고 '음원 파일 열기'·'파일 닫기'·반복 스위치가 없으며 `loop` 는 항상 참, **정지하면 이름이 '업로드된 음원 없음' 이 되고 '재생' 이 꺼지며, 그 상태에서 Space 는 getUserMedia 를 1회 부른다**. (2) **변이 시험**(소스를 일부러 틀리게 바꿔 시험이 실패하는지 본다, 24종): Node 시험(`test:file-mode`·`test:shortcuts`)은 24종 중 19종을 적발한다. 나머지 5종 중 4종은 화면 전용(놓아도 잡은 값이 안 풀림·놓는 신호를 막대에서만 들음·세션이 없을 때 '재생' 이 꺼짐·반복 스위치가 연결되지 않음)이라 e2e 가 맡고, 1종(`setSelectedDevice` 가 파일을 놓지 않음)은 **동치 변이**다 — 장치 세션이 열려 있다는 것은 파일이 이미 없다는 뜻이라(`start()` 가 놓았고 파일 열기는 세션을 파일 세션으로 바꾼다) 그 줄은 닿는 상태가 없다. e2e 는 Node 가 이미 잡은 4종(정지가 파일의 전체 길이를 지움·파일 열기가 실패해도 파일을 남김·엔진의 처음 반복 값이 꺼짐·끝남 처리가 파일 세션인지 확인하지 않음)과 동치 변이 1종을 뺀 19종을 E-10 전체로 돌려 **첫 판(그때 시험은 13개)에 15종 적발**했다(괄호는 그 변이에서 실패한 시험 수): 정지가 파일을 지움(4개 실패)·세션이 없을 때 '재생' 이 무동작(3)·열기 성공이 File 을 안 들고 있음(3)·'재생' 이 세션이 없으면 꺼짐(4)·Space 의 파일 분기 제거(1)·옛 요소의 `src` 를 안 놓음(1)·Object URL 을 안 해제(2)·재생 중 요소에 반복이 안 닿음(2)·저장소의 반복 처음 값이 꺼짐(3)·끝남이 정지 절차를 돌림(2)·입력을 숨기지 않음(3)·'파일 닫기' 가 세션을 안 끝냄(2)·'파일 닫기' 가 File 을 안 놓음(1)·잡은 값이 안 풀림(2)·반복 스위치가 연결되지 않음(2). (3) **변이가 시험의 구멍을 찾았다**: e2e 에서 살아남은 3종 — 새 요소가 반복 설정을 이어받지 않음, 기타를 연결했을 때 보이지 않게 옛 파일을 남김(이름만 지우고 File 은 남김 — 화면은 같고 Space 가 그 파일을 틀 뿐이다), 놓는 신호를 막대에서만 들음(Chromium 은 막대를 잡고 밖에서 놓아도 신호를 막대로 돌려줘 마우스 시험으로는 구분되지 않는다) — 에 맞춰 시험 둘을 더하고 한 시험에 확인을 더했다(놓는 신호는 창에 직접 `pointerup` 을 보내 구분). 다시 돌려 셋 모두 적발된다. 그리고 Node 시험에서도 3종이 살아남았다(저장소의 반복 처음 값 — `reset()` 이 값을 켜 놓고 시작해 가려졌고, 재생 중 요소에 반복 적용·길이로 자르기 — 엔진을 가짜로 바꿔 진짜 코드를 지나지 않았다) — 처음 값을 `reset()` 전에 보는 검사와 진짜 엔진 메서드를 원형에서 꺼내 가짜 요소에 부르는 검사, 합쳐 14건을 더해 셋 모두 적발된다. 마지막 1종(절대 이동이 길이로 자르지 않음)은 입력의 `max` 가 막아 화면으로는 닿지 않는 방어라 Node 시험만 잡는다. **결과: Node 는 24종 중 19종, e2e 는 돌린 19종 중 18종을 적발하고, 둘을 합치면 동치 변이 1종을 뺀 23종을 모두 잡는다.** 변이는 /tmp 에 복사해 둔 원본으로 되돌리고 `cmp` 로 확인한 뒤 깨끗이 다시 빌드했다.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-129). 반복·탐색 막대·파일 모드 Space 가 이미 있었다. 시험은 그것을 나눠 본다: 옛 앱이 맞던 3개(막대 끌기)는 통과하고 나머지 12개가 실패한다.
  - **막대를 놓는 신호**: 처음에는 막대 자체의 놓기·취소 이벤트로 '잡은 상태' 를 풀었으나, 막대 밖에서 놓으면 풀리지 않을 수 있어 창(window)에서 듣도록 바꿨다(L-136). 그런데 Chromium 은 막대를 잡고 밖에서 놓아도 놓는 신호를 막대로 돌려줘서 마우스 시험으로는 두 방식이 구분되지 않았다('놓는 신호를 막대에서만 듣게' 바꾼 변이가 살아남았다). 창에 직접 `pointerup` 을 보내는 시험(7번)을 더해 구분한다.
  - **Node 시험의 구멍 3곳**(살아남은 변이 3종: 저장소의 반복 처음 값이 꺼짐·엔진이 재생 중 요소에 반복을 안 건넴·절대 이동이 길이로 자르지 않음): 원인은 둘이다 — 처음 값 검사가 `reset()`(반복을 켜 놓고 시작한다)에 가려졌고, 진짜 엔진 메서드가 가짜 엔진 뒤에 숨어 시험이 그 코드를 지나지 않았다. 처음 값을 `reset()` 전에 보는 검사와 진짜 엔진 메서드를 원형에서 꺼내 가짜 요소에 부르는 검사 14건을 더했다. C2 커밋 메시지의 '3곳(…)' 은 이 두 원인을 한 줄에 같이 적어 구멍이 둘처럼 읽힌다. 커밋은 고쳐 쓰지 않는 규칙이라 여기서 바로잡는다 — 살아남은 변이는 3종이다.
  - **'정지' 버튼이 둘이다**(파일 플레이어와 녹음 패널). 관찰 도구의 버튼 선택자는 '음원 파일 플레이어' 묶음 안으로 좁혔다(`file-media.ts`).
  - **변이용 빌드**: 변이 빌드는 `tsc -b` 를 건너뛰고 `npx vite build`(약 4초)로 했다. 끝에 `npm run build` 로 깨끗이 다시 빌드해 `dist/` 가 확정된 코드의 결과임을 확인했다.
- 사람 확인 필요
  - **반복의 이음매 클릭**(설계서가 청취 확인으로 정함, L-138). WAV·MP3·AAC 파일을 반복으로 틀어 끝에서 처음으로 돌아올 때 틈이나 클릭이 거슬리는지 귀로 듣는다. 거슬리면 `AudioBuffer` 반복으로 바꾸는 선택지가 있다.
  - **실제 휴대폰(iOS Safari·Android Chrome)**: '음원 파일 열기' 로 파일 선택 창이 뜨는지, 재생·일시정지·정지·반복·±10초가 되는지, **손가락으로 탐색 막대를 끌 때** 잡는 동안 막대가 재생 위치에 밀리지 않고 놓으면 따라가는지(L-136, 시험은 마우스만).
  - **내가 정한 정책 다섯**이 맞는지: 기타를 연결하면 열어 둔 파일을 놓는 것·파일 열기가 실패하면 이전 파일도 놓는 것(L-130), 파일이 열려 있으면 Space 가 마이크를 켜지 않는 것(L-131), 반복을 끈 파일이 끝나도 세션을 그대로 두는 것(L-132), 반복 값을 저장하지 않는 것(L-133).
  - **화면 배치**: 데스크톱 입력 패널의 '음원 파일' 블록(열기·닫기 버튼 위치, 반복 스위치)과 휴대폰 '입력' 탭(열기·닫기 버튼이 나란히, 이동 버튼 5개가 세로로 쌓이고 그 아래 반복 스위치)이 보기 좋은지는 사람이 본다.
  - 아주 큰 파일(수백 MB)이나 긴 파일에서 열기·탐색·'재생'(새 요소를 만들어 읽는 시간)이 답답하지 않은지.
- 남은 위험
  - 반복은 브라우저의 `audio.loop` 에 맡겨 형식에 따라 이음매에 틈이 날 수 있다(L-138).
  - 반복을 끈 파일이 끝난 뒤에도 오디오 컨텍스트가 열려 있다(L-132). 재생하지 않으니 부하는 거의 없지만, 사용자가 '정지' 를 누르기 전까지 컨텍스트는 남는다.
  - 열어 둔 `File` 이 디스크에서 바뀌거나 지워진 뒤 '재생' 을 누르면 브라우저가 읽지 못해 열기 실패로 처리된다(오류 안내 + 파일을 놓음, L-130). 시험하지 않았다.
  - 탐색 막대는 끌 때마다 소리가 그 자리로 간다(스크럽, L-136). 놓을 때 한 번만 이동하는 방식이 아니라서, 큰 파일에서 끌 때의 느낌은 확인하지 못했다. 키보드로 막대를 움직이면 키마다 이동한다.
  - 놓는 신호를 창에서 듣는 것은 Chromium 에서는 막대로도 오므로 여분의 장치다. 놓는 신호가 막대로 오지 않는 브라우저가 있다면 그것을 위한 것인데, Chromium 외의 브라우저에서는 시험하지 않았다.
  - 버튼에 포커스가 있을 때 Space 는 그 버튼을 누른다(기존 동작). 시험은 포커스를 풀고 누른다.

---

## S2.7 Export·Import 정리: v2 파일 형식·팩토리 제외·충돌 대화상자

- 브랜치·병합: `refactor/s2-7-export-v2` → `phase/2`. 커밋 `6e35aa8`(C1 — 파일 형식 v2·가져오기 계획·붙여넣기/충돌 대화상자) · `f3762ce`(C2 — Node 시험 `test:export-format` 과 e2e E-11) · `ae5c3b2`(C3 — 변이 시험이 찾은 구멍 5곳을 막는 시험 보강과 코드 정리) · `0555345`(C4 — 충돌 대화상자의 처음 포커스를 '사본으로 추가' 로, L-142) · 이 보고서를 담은 문서 커밋(`docs(S2.7): …` — 기록 L-140~L-148·README 갱신). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 소리가 바뀌지 않아 기준선 JSON 은 건드리지 않았다.
- 해결 항목: R2-6(Export 직후 Import 시 팩토리 40개 복제), 4.7 '내보내기 파일 형식 v2'. **설계서 '현재' 는 기준선과 일부 달랐다**(L-140): 내보내기는 이미 내 프리셋만 내보냈고 파일 가져오기 버튼도 있었다. 실제로 재현된 것은 ① 내보낸 JSON 을 화면의 텍스트 칸에도 채움 ② 텍스트 칸이 항상 보이고 '붙여넣은 JSON 가져오기' 가 바로 들어옴 ③ 내 프리셋이 0개여도 빈 파일을 내려받음 ④ **가져오기가 `factory-` id 항목을 새 id 의 사용자 프리셋으로 바꿔 더함**(팩토리 40개가 든 예전 파일 → '42개의 프리셋을 가져왔습니다.', 이것이 R2-6 의 진짜 원인) ⑤ 같은 이름은 묻지 않고 합치고 모든 항목의 `updatedAt` 을 다시 씀 ⑥ 가져온 뒤 탭이 언제나 '내 프리셋' 으로 바뀜이다. 이 Step 의 일은 ① 파일 형식 v2(`format`·`schemaVersion`·`appVersion`·`exportedAt`·`presets`)와 v1·v2 모두 읽는 가져오기 ② 팩토리 제외·똑같은 것 조용히 건너뜀·충돌 묻기·결과 '`N개 가져옴 · M개 건너뜀`' ③ 파일 선택 창이 언제나 먼저 열리고 '텍스트로 붙여넣기' 는 별도 대화상자 ④ 그것을 지키는 시험(Node 147건·e2e 10개)이다.
- 변경 파일(17개, 신규 6개, +1,635 / −58줄, 이 문서 커밋 전): 제품 `src/` 9개(+736 / −50) — 신규 `persistence/exportFormat.ts`(262줄, 화면·저장소를 모르는 순수 함수: 파일 만들기 `buildExportFile`·읽기 `parseImportFile`·계획 `planImport`·적용 `applyImport`·사본 이름·요약 문구)·`components/ModalDialog.tsx`(112줄, 공용 대화상자 틀: 포털·포커스 가둠·Esc·포커스 복귀·휴대폰 시트, L-141)·`components/PresetImportDialogs.tsx`(105줄, 붙여넣기·충돌 대화상자), 고침 `store/presetStore.ts`(+38 / −25: `exportPresets` 가 문자열 또는 `null`, `planImport`·`commitImport` 추가, `importPresets` 삭제)·`components/PresetPanel.tsx`(+69 / −23: 텍스트 칸·`presetJson` 상태 삭제, 대화상자 둘, 충돌을 하나씩 묻는 흐름)·`persistence/appData.ts`(+5: `getPresetCarry`)·`persistence/legacy/presetsV1.ts`(주석만)·`styles/panels.css`(+123)·`styles/responsive.css`(+20, 휴대폰 시트). 시험·도구 8개(+899 / −8) — 신규 `scripts/export-format-regression.mjs`(475줄)·`e2e/tests/e11-export-import.spec.ts`(339줄)·`e2e/helpers/preset-io.ts`(75줄), 고침 `package.json`(`test:export-format`)·`scripts/preset-ab-regression.mjs`·`scripts/preset-loudness-regression.mjs`(내보낸 파일의 새 모양에 맞춤)·`e2e/tests/e05-storage.spec.ts`·`e08-active-led.spec.ts`(텍스트 칸 대신 붙여넣기 대화상자). **DSP·소리는 바뀌지 않았다**(프로브 24개·값 1,696개 불변).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| E-11 내 프리셋이 0개일 때 Export → '내보낼 내 프리셋이 없습니다' 안내, 빈 파일을 만들지 않음 | 충족 | e2e: 안내 문구가 뜨고 600 ms 동안 내려받기가 0번, 화면에 텍스트 칸도 없다. Node: 내 프리셋이 없으면 `exportPresets` 가 `null`(팩토리만 있어도 같음) |
| Export 직후 Import → 파일 선택 창이 뜨고, 같은 파일을 가져오면 '0개 가져옴 · N개 건너뜀', 전체 개수 변화 0 | 충족 | e2e: 내보낸 파일을 파일 선택 창(`filechooser`)으로 가져오면 '0개 가져옴 · 2개 건너뜀', 전체 개수 그대로, **`v2:presets` 원문이 한 글자도 바뀌지 않는다**(저장소를 쓰지 않음). Node: 같은 파일을 다시 가져오면 저장 쓰기 0번, 같은 내용의 다른 id 도 조용히 건너뜀 |
| 예전 형식 내보내기 파일(팩토리 40개 포함) 가져오기 → 팩토리는 추가되지 않고 내 프리셋만 추가 | 충족 | e2e: 팩토리 40개(`factory-sound-N`)와 내 프리셋 2개가 든 v11 파일 → '2개 가져옴 · 40개 건너뜀', 전체 +2, 저장소에 `factory-` id 없음·모두 `origin: 'user'`, 라이브러리 탭이 '내 프리셋' 으로 바뀜. 다시 가져오면 '0개 가져옴 · 42개 건너뜀' 이고 탭은 그대로. Node: **진짜 팩토리 40개**(`defaultPresets.length === 40`)로 — 값이 낡은 팩토리 id·이름+내용이 같은 사본(id 가 달라도)·`origin: 'factory'`·`origin: 'user'` 인데 `factory-` id·스토어 단의 팩토리 사본 모두 제외(L-143) |
| 내보낸 파일에 팩토리 프리셋이 없다 | 충족 | e2e: 파일이 `format`·`schemaVersion: 2`·`appVersion`·`exportedAt`·`presets` 만 갖고 모든 항목이 `origin: 'user'`, 6만 자 아래(옛 팩토리 포함 파일은 264 KB). Node: 키 모양·왕복(내보냄 → 읽음 → 같은 내용)·`factory-` id 는 내보낼 때도 걸러짐 |
| (설계서 4.7) 같은 id → 대화상자(덮어쓰기 / 사본으로 추가 / 건너뛰기), 내용이 같으면 조용히 건너뜀 | 충족(이름 충돌은 내가 더함, L-144) | e2e 5개: 세 가지 선택이 각각 맞게 저장됨(덮어쓰기는 기존 id 유지, 사본은 '이름 (가져옴)'), 충돌이 셋이면 '1/3' 부터 하나씩 묻고 '남은 2개에도 같은 선택 적용' 으로 한 번에 처리('3개 가져옴 · 0개 건너뜀'), Esc 는 가져오기 전체를 취소하고 포커스가 '파일 가져오기' 로 돌아옴, **열린 직후 Enter 는 사본을 만들고 원래 프리셋은 그대로**(L-142). Node: 판정 순서·이름 충돌·파일 안 id 중복(뒤가 이김)·답이 없으면 건너뜀·그 사이 지워진 프리셋을 덮어쓰려 하면 새로 더함 |
| (설계서 4.7) '텍스트로 붙여넣기' 는 별도 버튼 → 대화상자 | 충족 | e2e: 평소에 텍스트 칸이 없고, 버튼이 대화상자를 열어 Tab 이 대화상자 안에서만 돌며, 빈 글·틀린 글은 대화상자 안에 한국어 오류로 알리고(닫히지 않음), 잘 붙이면 닫히고 가져온다. Esc 로 닫으면 포커스가 버튼으로 돌아온다. 휴대폰 390×844: 대화상자가 화면 안, 가로 넘침 0, 버튼 높이 42 px 이상 |
| (설계서에 없는 추가 단언) 틀린 파일은 아무것도 바꾸지 않고 한국어로 알림 | 충족 | e2e: 이 앱의 파일이 아님·더 새로운 버전·JSON 이 아님·항목이 틀림 4가지 메시지, 전체 개수·저장소 원문 불변. Node: 메시지 문구·`__proto__` 안전·옛 파서 동작 불변 |
| (설계서에 없는 추가 단언) 소리·기존 기준선 불변 | 충족 | `npm test` 의 `test:probe` 가 기존 프로브 1,696개 값을 기준선·허용치 그대로 견주어 통과. `e2e.json`·`audio-probe.json` 불변 |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 내 프리셋 0개에서 내보내기 | 빈 파일(`presets: []`)을 내려받고 '내 프리셋을 내보냈습니다.' | 파일 없음, '내보낼 내 프리셋이 없습니다.' |
| 내보내기 뒤 화면 | 같은 JSON 이 텍스트 칸에 채워짐 | 파일만. 텍스트 칸 없음. 메시지 '내 프리셋 N개를 내보냈습니다.' |
| 파일 형식 | `{version: 11, presets: [...]}` | `{format, schemaVersion: 2, appVersion, exportedAt, presets}`, 항목은 `origin: 'user'` 의 v2 프리셋(L-148) |
| 가져오기 입구 | 항상 보이는 텍스트 칸 + '붙여넣은 JSON 가져오기'(파일 선택 창 없이 바로 들어옴) | '파일 가져오기' 는 언제나 파일 선택 창, '텍스트로 붙여넣기' 는 별도 대화상자 |
| 같은 파일 다시 가져오기 | 'N개의 프리셋을 가져왔습니다.', 모든 항목의 `updatedAt` 을 다시 쓰고 저장함 | '0개 가져옴 · N개 건너뜀', 저장소·화면 변화 없음 |
| 팩토리 40개가 든 예전 파일 | '42개의 프리셋을 가져왔습니다.'(팩토리가 내 프리셋 40개로 복제됨) | '2개 가져옴 · 40개 건너뜀' |
| 같은 이름·다른 내용 | 묻지 않고 뒤의 것으로 합침 | 대화상자: 덮어쓰기 / 사본으로 추가 / 건너뛰기(+ 남은 것에도 적용, Esc = 전체 취소) |
| 가져온 뒤 라이브러리 탭 | 언제나 '내 프리셋' | 1개 이상 들어왔을 때만 '내 프리셋', 0개면 그대로 |
| 틀린 파일 | 다른 앱의 JSON 도 '0개의 프리셋을 가져왔습니다.' 로 통과하는 경우가 있음 | 한국어 오류 메시지, 아무것도 바뀌지 않음 |
| `npm test` | 39개 통과(392.5초) | 40개 통과(399.2초 — 새 시험 `test:export-format` 0.2초. 시간의 거의 전부는 `test:probe` 367.0초이고 기계 상태에 따라 달라진다) |
| `npm run e2e` | 191개 통과(8.5분) | 201개 통과(8.7분, 새 시험 10개의 시간 합 17.1초, 기준선 `e2e.json` 불변) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e --ext .ts` 오류 0. 정규식 단언 목록(`regex-assertions.md`)은 지금 코드와 같다(이번에 더한 시험은 `assert.match` 를 쓰지 않아 바뀐 것 없음).
  - 코드 커밋 `0555345` 그대로(그동안 바뀐 것은 문서뿐)에서 `npm test` 40개 모두 통과(399.2초), `npm run e2e` 201개 모두 통과(8.7분, 기준선 `e2e.json` 불변). `test:export-format` 은 147건이다.
  - **새 시험이 정말 잡는지**: (1) **옛 코드에 돌려 보았다**. Node 시험은 옛 코드에 `exportFormat.ts` 가 없어 첫 검사에서 실패한다. e2e 는 시험 파일(그때 9개)을 옛 코드(`544d4df`)의 빌드에 돌리면 **9개 모두 실패**한다: 0개 내보내기는 안내 대신 '내 프리셋을 내보냈습니다.', 내보내기 메시지에 개수가 없음, 예전 형식 파일은 **'42개의 프리셋을 가져왔습니다.'**(팩토리 복제), 충돌 대화상자 셋은 대화상자가 없음, 붙여넣기 시험은 텍스트 칸이 평소에도 보임, 틀린 파일은 다른 파일이 '0개의 프리셋을 가져왔습니다.' 로 통과, 휴대폰 시험은 '텍스트로 붙여넣기' 버튼이 없음. 그 뒤에 더한 'Enter 로 덮어쓰지 않음' 시험은 옛 코드에 충돌 대화상자 자체가 없어 실패할 수밖에 없으므로 따로 돌리지 않았다. (2) **변이 시험**(소스를 일부러 틀리게 바꿔 시험이 실패하는지 본다): 처음 **54종** 중 **49종 적발·5종 생존**. 생존 5종과 조치: ① 가져올 때의 `factory-` id 규칙이 이름+내용 규칙에 가려져 있었다(시험의 팩토리 항목이 모두 지금 팩토리와 값이 같았다) → 값이 낡은 팩토리 id 항목을 더함 ② 새로 더하는 항목에 `updatedAt` 을 안 써도 통과 → 시각 검사를 더함 ③ v1 항목의 `origin` 을 따로 계산하는 코드가 어차피 `planImport` 가 가르는 것과 같아 쓸모없는 변이 → **코드를 단순하게**(v1 은 모두 `user`) 정리해 변이가 사라짐 ④ 스토어가 `planImport` 에 팩토리 목록을 넘기는 줄(`defaultPresets`)이 시험되지 않았다 → 스토어를 거치는 팩토리 사본 검사를 더함 ⑤ 1개 이상 가져오면 탭을 '내 프리셋' 으로 바꾸는 줄이 시험되지 않았다 → 탭 전환 검사를 더함. 고친 뒤 다시 돌려 모두 적발된다. 그리고 C4 로 처음 포커스를 바꾼 뒤 그것을 건드리는 변이 3종(사본 버튼이 덮어쓰기를 부름 D5·충돌 대화상자가 처음 포커스 대상을 넘기지 않음 D6·공용 틀이 그 대상을 무시하고 닫기 버튼에 포커스 M5)을 새 원본으로 다시 돌려 모두 적발했다. **결과: 최종 53종 — Node 시험이 31종(내보내기·읽기·계획·적용 규칙 25 + 스토어 5 + 저장소 연결 1), e2e 가 22종(패널 흐름 9 + 대화상자 6 + 공용 틀 5 + 휴대폰 배치 2)을 모두 적발한다.** 변이는 /tmp 에 복사해 둔 원본으로 되돌리고 `cmp` 로 확인한 뒤 깨끗이 다시 빌드했다.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-140). 내보내기는 이미 팩토리를 뺐고, 진짜 원인은 가져오기가 `factory-` 항목을 내 프리셋으로 바꿔 더하던 것이었다. 그래서 '팩토리 제외' 규칙에 설계서의 두 조건(`origin`·이름+내용)에 더해 `factory-` id 접두사를 세 번째로 넣었다(L-143).
  - **파일 선택 창이 비ASCII 경로의 파일을 전달하지 못했다**(L-147). 처음 e2e 가 파일을 Playwright 의 시험 출력 폴더(한글 제목)에 썼더니 `setFiles` 로 건넨 파일에 대해 앱의 `change` 가 오지 않아 가져오기가 아무 일도 하지 않았다. 앱의 문제가 아니라 이 환경 Chromium 의 한계라 시험이 ASCII 폴더를 쓰게 했다.
  - **처음 포커스를 '덮어쓰기' 에 두었다가 바꿨다**(L-142). 열린 직후 Enter 한 번에 기존 프리셋이 바뀌는 설계였다. 스스로 짚어 '사본으로 추가' 로 바꾸고 e2e 에 Enter 시험을 더했다. 그때 돌고 있던 `npm test` 는 일부러 끝내고 최종 코드로 다시 돌렸다.
  - **시험이 넘겨짚은 것**: 처음 Node 시험은 새로 저장한 프리셋이 목록 끝에 붙는다고 가정했으나 실제로는 최신이 앞이다 → 기대값을 이름 기준으로 고쳤다.
  - **변이가 시험의 구멍 5곳을 찾았다**(위 검증 (2)).
- 사람 확인 필요
  - **실제 브라우저에서 한글 이름의 파일**(예: '프리셋 백업.json')이 파일 선택 창으로 가져와지는지(L-147). 이 환경 Chromium 은 비ASCII 경로를 시험으로 전달하지 못해 확인하지 못했다.
  - **내려받은 파일을 실제로 열어 보기**: 파일 이름 `guitar-pedalboard-presets-YYYY-MM-DD.json`, 내용이 사람이 읽기 좋게 들여쓰기돼 있는지, 휴대폰(iOS Safari·Android Chrome)에서 내려받기·파일 선택이 되는지.
  - **내가 정한 정책**이 맞는지: 이름만 같고 내용이 다른 프리셋도 묻는 것(L-144), Esc·'가져오기 취소' 가 가져오기 전체를 취소하는 것(L-145), 처음 포커스가 '사본으로 추가' 인 것(L-142), 0개를 가져왔을 때 탭을 바꾸지 않는 것(L-146).
  - **대화상자의 모양**: 데스크톱과 휴대폰(아래에서 올라오는 시트)에서 붙여넣기·충돌 대화상자의 글자 크기·간격·버튼 배치가 보기 좋은지, 충돌 대화상자의 네 버튼 줄바꿈이 어색하지 않은지.
  - 아주 큰 파일(수 MB, 프리셋 수백 개)을 가져올 때 대화상자 없이도 반응이 느리지 않은지.
- 남은 위험
  - 같은 이름의 프리셋이 이미 여러 개면 가장 먼저 만난 것과만 비교한다(L-144). 이름이 겹친 프리셋이 처음부터 있던 저장소는 일부 충돌을 놓칠 수 있다(저장 쪽 `savePreset` 이 같은 이름을 덮어써 보통은 생기지 않는다).
  - 사용자가 일부러 `factory-` 로 시작하는 id 를 만든 프리셋은 가져오지 못한다(L-143, 앱은 UUID 를 쓴다).
  - 가져오기에는 아직 '되돌리기' 가 없다. 덮어쓰기는 되돌릴 수 없다(대화상자에 적었고 처음 포커스는 사본이다). 삭제·초기화·덮어쓰기의 되돌리기와 확인은 S2.8 의 일이다. 같은 이름으로 '저장' 할 때의 덮어쓰기 확인(`window.confirm`)도 아직 S2.8 에 남아 있다.
  - 내보낸 파일의 `appVersion`·`exportedAt` 은 읽는 쪽이 쓰지 않는다. 앞으로 앱 버전에 따라 파일을 다르게 읽어야 하면 그때 쓴다(L-148).
  - 가져오는 파일의 크기·항목 수 상한이 없다. 매우 큰 파일은 한 번에 읽어 메모리에 올린다.

---

## S2.8 삭제·초기화·덮어쓰기 안전장치

- 브랜치·병합: `refactor/s2-8-safeguards` → `phase/2`. 커밋 `6f72ba2`(C1 — 되돌리기 알림·같은 이름 대화상자·저장소 거절·엔진 IR 기억) · `fee83c3`(C2 — 기존 시험 3개를 새 동작에 맞춤) · `d98ae2d`(C3 — Node 시험 `test:safeguards`) · `856ba8a`(C4 — e2e E-12) · `b6a9b57`(C5 — 변이 시험이 찾은 시험의 구멍 5곳을 막는 보강) · `68c7107`(e2e 도우미 `saveUserPreset` 주석 한 줄 정정) · 이 보고서를 담은 문서 커밋(`docs(S2.8): …` — 기록 L-149~L-159·README 갱신). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 소리가 바뀌지 않아 기준선 JSON 은 건드리지 않았다.
- 해결 항목: R2-14(삭제·기본 설정은 되돌릴 수 없고 같은 이름 저장은 덮어쓴다). **설계서 '현재' 는 기준선과 달랐다**(L-149): 세 곳 모두 브라우저 기본 확인 창 `window.confirm` 이 이미 있었다(같은 이름 저장·삭제·'기본 페달 설정'). 그래서 실제 틈은 ① 확인을 누르면 되돌릴 수 없음 ② 기본 확인 창은 접근성·시험·휴대폰에서 약함 ③ 같은 이름 저장에 '새 이름으로 저장' 이 없음이다. 이 Step 의 일은 ① 삭제·기본 설정을 묻지 않고 바로 하되 8초 '실행 취소' 알림으로 되돌리기(삭제는 원래 자리·즐겨찾기·최근 사용까지, 기본 설정은 노브·켜짐·순서·음량 보정·불러 둔 IR·프리셋 표시까지) ② 같은 이름 저장은 대화상자(덮어쓰기 / 새 이름으로 저장 / 취소)로만, 그리고 저장소가 묻지 않은 덮어쓰기를 거절하게 해 '묻지 않는 경로 0개' 를 구조로 보장 ③ 그것을 지키는 시험(Node 136건·e2e 14개)이다.
- 변경 파일(17개, 신규 6개, +1,468 / −63줄, 이 문서 커밋 전): 제품 `src/` 9개(+528 / −32) — 신규 `persistence/presetUndo.ts`(58줄, 화면·저장소를 모르는 순수 함수: 자리 찾기 `keysAfter`·`reinsertByKey`, 겹치지 않는 이름 `uniqueRestoredName`·`uniqueNumberedName`)·`store/chainActions.ts`(58줄: 기본 설정의 기억 `captureChainSnapshot`·`isDefaultChain`·실행 `resetToDefaultChain`·되돌리기 `restoreChainSnapshot`)·`components/ConfirmDialog.tsx`(80줄, `ModalDialog` 위의 확인 대화상자)·`components/PresetSaveDialog.tsx`(75줄, 같은 이름 대화상자), 고침 `store/presetStore.ts`(+58 / −8: `savePreset` 이 같은 이름을 거절하고 `overwrite: true` 일 때만 덮어씀, `deletePreset` 이 되돌리기 기록을 돌려 줌, `restoreDeletedPreset` 추가)·`components/PresetPanel.tsx`(+135 / −23: `window.confirm` 세 곳 삭제, 알림·대화상자 연결, 즐겨찾기·최근 목록의 자리 기억)·`audio/AudioEngine.ts`(+36: `snapshotCabinetIrs`·`restoreCabinetIrs`)·`styles/panels.css`(+27)·`components/ModalDialog.tsx`(주석만). 시험·도구 8개(+940 / −31) — 신규 `scripts/safeguards-regression.mjs`(468줄)·`e2e/tests/e12-undo-overwrite.spec.ts`(437줄), 고침 `package.json`(`test:safeguards`)·`e2e/helpers/preset-io.ts`(주석 한 줄)·`scripts/storage-v2-regression.mjs`·`scripts/preset-ab-regression.mjs`·`e2e/tests/s1-4c-preset-loudness.spec.ts`(새 동작에 맞춤, L-159)·`docs/refactoring/regex-assertions.md`(줄 번호만). **DSP·소리는 바뀌지 않았다**(프로브 24개·값 1,696개 불변).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| E-12 삭제 → 실행 취소 → 프리셋과 순서가 그대로 돌아온다 | 충족 | e2e: 'P2' 를 지우면 목록·저장소에서 바로 사라지고(묻지 않음, 저장소에도 바로 반영) 알림 '프리셋을 삭제했습니다: P2' 가 뜨며, '실행 취소' 로 같은 자리·같은 내용(저장소의 프리셋 목록이 지우기 전과 **완전히 같음**)·즐겨찾기까지 돌아온다. 최근 사용 목록의 자리도 돌아오고, 연달아 둘을 지워도 알림이 따로 남아 어느 순서로 되돌려도 원래 순서다. 알림은 7~9.5초(약 8초) 뒤 사라지고 그 뒤에도·새로고침해도 지운 상태다. Node: 자리 계산(맨 앞·맨 끝·이웃이 그 사이 사라짐·여러 개), 이름이 겹치면 '이름 (복원)', 중복 복원 거절, 팩토리는 지울 수 없음, 저장소 반영 |
| Default Chain → 실행 취소 → 모든 노브 값이 돌아온다(널 테스트) | 충족 | e2e: 'Texas Push' 를 불러 Drive 노브를 61 로 바꾸고 Chorus 를 켠 뒤 '기본 페달 설정' → 묻지 않고 처음 값으로(저장소가 **되돌릴 값과 다르고** Drive 가 61 이 아니며 켜진 페달이 기본 5개, 음량 보정 0 dB — 널 테스트: 되돌릴 거리가 없으면 시험이 통과하지 못한다) → '실행 취소' 로 저장소가 처음과 **글자 그대로 같고**, 화면의 노브·스위치·음량 보정·고른 프리셋 표시가 돌아온다. 캐비닛 IR 은 같은 오디오 세션에서 돌아오고, 오디오를 다시 시작한 뒤에는 돌아오지 않으며 그 사실을 안내한다. 이미 기본이면 안내만 하고 알림을 만들지 않는다. Node: 켜짐·순서·음량 보정·노브·IR 각각이 '기본이 아님' 으로 잡힘, 기억→처음 값→되돌리기가 켜짐·순서·음량 보정·저장소를 그대로 복원, 기억한 값은 복사본, 템포 동기 |
| 같은 이름 저장에서 묻지 않고 덮어쓰는 경로 0개 | 충족 | **구조로 보장**: `savePreset` 은 같은 이름이면 아무것도 쓰지 않고 `'exists'` 를 돌려 주고 `overwrite: true` 일 때만 덮어쓴다(Node: 거절한 저장은 프리셋 저장소에 한 글자도 쓰지 않음, 앞뒤 공백·`overwrite: false`·미지정 모두 거절). e2e: 대화상자(덮어쓰기 / 새 이름으로 저장 / 취소)가 뜬 동안 `v2:presets` 원문이 그대로, Esc·취소는 덮어쓰지 않고, **열자마자 Enter 는 사본을 만들고 기존 프리셋은 그대로**, 덮어쓰기는 같은 id·내용만 바뀜, 새 이름이 비었거나 이미 쓰면 이유를 알림. 소스 검사: `src/` 어디에도 브라우저 기본 `confirm`·`alert`·`prompt` 가 없음. e2e 4개(삭제·기본 설정·이미 기본·같은 이름 취소/Esc)는 브라우저 기본 대화상자(`dialog` 이벤트)가 한 번도 뜨지 않음을 직접 단언한다 |
| 토스트의 '실행 취소' 버튼에 키보드로 갈 수 있다(`role="status"`, 포커스 가능) | 충족 | e2e: 키보드로(삭제 버튼에 포커스 + Enter) 지운 뒤 알림이 `role="status"` 이고 **Tab 8번**으로 '실행 취소' 에 닿아 Enter 로 눌러 되돌린다(L-158). 휴대폰 390×844 에서 대화상자가 화면 안·가로 넘침 0·버튼 42 px 이상이고, 알림의 '실행 취소' 를 손가락으로 누를 수 있다 |
| (설계서에 없는 추가 단언) 소리·기존 기준선 불변 | 충족 | `npm test` 의 `test:probe` 가 기존 프로브 1,696개 값을 기준선·허용치 그대로 견주어 통과. `e2e.json`·`audio-probe.json` 불변 |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 내 프리셋 삭제 | `window.confirm` "'이름' 프리셋을 삭제하시겠습니까?" → 확인하면 되돌릴 수 없음 | 묻지 않고 바로(저장소에도 바로 반영), 8초 알림 '프리셋을 삭제했습니다: 이름 [실행 취소]'. 되돌리면 원래 자리·즐겨찾기·최근 사용 목록의 자리까지 복원 |
| '기본 페달 설정' | `window.confirm` 확인 → 노브·켜짐·순서·음량 보정·불러 둔 IR 이 사라지고 되돌릴 수 없음 | 묻지 않고 바로, 8초 알림 '모든 노브를 처음 값으로 되돌렸습니다 [실행 취소]'. 되돌리면 노브·켜짐·순서·음량 보정·고른 프리셋 표시, 같은 오디오 세션이면 IR 까지 복원. 이미 기본이면 알림 없이 안내만 |
| 같은 이름으로 저장 | `window.confirm` '덮어쓰시겠습니까?' — 덮어쓰기 / 취소 둘뿐, `savePreset` 은 부르면 항상 덮어씀 | 대화상자 [덮어쓰기] [새 이름으로 저장] [취소](처음 포커스는 새 이름 칸, Enter = 사본). `savePreset` 은 같은 이름이면 거절하고 `overwrite: true` 일 때만 덮어씀 |
| 브라우저 기본 대화상자 | `window.confirm` 세 곳 | 0곳(소스 검사가 다시 들어오는 것을 막음) |
| `npm test` | 40개 통과(399.2초) | 41개 통과(398.4초 — 새 Node 시험 `test:safeguards` 136건 포함) |
| `npm run e2e` | 201개 통과(8.7분) | 215개 통과(9.4분 — 새 시험 14개의 시간 합 34.9초) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e --ext .ts` 오류 0(`npm run lint` 는 직전 실패한 e2e 실행이 남긴 `test-results/` 찌꺼기를 보므로 e2e 를 한 번 통과시킨 뒤에 돌렸다). 정규식 단언 목록(`regex-assertions.md`)은 지금 코드와 같다(`preset-ab-regression` 의 소스 검사 한 줄이 옮겨져 줄 번호만 바뀌었다).
  - 코드 커밋 `b6a9b57` 그대로(그동안 바뀐 것은 문서와 e2e 도우미의 주석 한 줄뿐)에서 `npm test` 41개 통과(398.4초)·전체 `npm run e2e` 215개 통과(9.4분, 실패·불안정 재시도 0)·`npm run typecheck`·`npm run lint`·e2e 타입검사·e2e eslint 오류 0.
  - **새 시험이 정말 잡는지**: (1) **옛 코드에 돌려 보았다**. e2e E-12 시험 파일(그때 13개)을 옛 코드(`phase/2` 의 `b0b5a3a`)의 빌드에 돌리면 **13개 모두 실패**한다(되돌리기 알림·대화상자·'이미 기본 페달 설정입니다.' 안내가 없고 `window.confirm` 이 뜬다). Node 시험은 옛 코드에 `presetUndo.ts`·`chainActions.ts` 가 없어 첫 검사에서 실패한다. (2) **변이 시험**(소스를 일부러 틀리게 바꿔 시험이 실패하는지 본다): **57종** — 순수 함수 7·스토어 11·체인 9·엔진 5·패널 14(`window.confirm` 되살리기 포함)·대화상자 11. 처음에 **49종 적발·8종 생존**이었다. 생존 8종과 조치: ① 기억한 페달이 스토어의 배열·객체를 그대로 잡아도 통과(스토어가 객체를 고치지 않아 지금은 같은 결과지만 계약이 시험되지 않았다) → 복사본인지 검사를 더함 ② 되돌릴 때 `adoptTempoFromPedals` 를 빼도 통과 → 템포 동기된 Delay 의 BPM 을 탭 템포가 따라가는지 검사를 더함 ③ 지운 프리셋의 '최근 사용' 목록 자리를 기억하지 않아도 통과(즐겨찾기만 시험했다) → e2e 를 더함(E-12 14번째) ④ 제안한 새 이름이 전부 선택되는 `onFocus` 를 빼도 통과 → 선택 범위 검사를 더함 ⑤ 이름을 고치면 오류 안내가 사라지는 줄을 빼도 통과 → 검사를 더함. 고친 뒤 이 5종을 다시 돌려 모두 적발된다. **남은 생존 3종**: ⑥ `deletePreset` 이 기록에서 `isFactory` 를 떼는 줄 — 내 프리셋에는 그 표시가 처음부터 없어 결과가 같은 변이(동등 변이) ⑦ 되돌릴 때 `!result.restored || !result.preset` 에서 앞 조건을 빼도 — 복원이 안 되면 `preset` 도 없으므로 동등 변이 ⑧ 새 이름으로 저장하려는 순간 그 이름이 이미 생긴 경우(`savePendingAs` 의 `result !== 'saved'` 분기) — 같은 탭에서는 대화상자가 이름이 겹치는 것을 먼저 막아 닿을 수 없고 다른 탭에서 그 사이 같은 이름을 저장했을 때만 닿는 방어 코드다. **결과: 57종 중 54종 적발 — Node 시험이 32종, e2e 가 22종.** 변이는 /tmp 에 복사해 둔 원본으로 되돌리고 `cmp` 로 확인한 뒤 깨끗이 다시 빌드했다.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-149). `window.confirm` 이 이미 세 곳에 있었다. 그래서 '묻지 않고 덮어쓴다' 를 막는 일이 아니라 확인 창을 되돌릴 수 있는 방식으로 바꾸고 새 이름 선택을 더하는 일이 됐다.
  - **'숨겼다가 8초 뒤 확정'(설계서) 대신 바로 지우고 바로 저장했다**(L-150). 8초 사이에 탭을 닫으면 지움이 반영됐는지 불분명한 상태를 피했다. 대가는 알림이 사라진 뒤에는 되돌릴 방법이 없다는 것(설계서와 결과는 같다).
  - **저장소 층의 거절로 기존 시험 3곳이 깨졌다**(L-151·L-159). 같은 이름을 덮어쓰던 `storage-v2-regression` 의 3곳에 `overwrite: true` 를 더하고, `preset-ab-regression` 의 소스 검사를 새 파일로 옮기고, e2e `s1-4c` 의 확인 창 수락 두 줄을 없앴다. 시험의 의미는 줄이지 않았다.
  - **시험이 넘겨짚은 것**: v2 저장 상태의 `pedals` 가 배열이 아니라 id 를 키로 하는 객체라 처음 Node 시험이 `find` 로 읽다 실패 → 기대값 읽는 방식을 고쳤다.
  - **변이가 시험의 구멍 5곳을 찾았다**(위 검증 (2)).
- 사람 확인 필요
  - **알림의 8초가 충분한지**: 되돌리기 알림이 마우스를 올리거나 포커스를 두어도 멈추지 않고 8초에 사라진다(L-157). 손이 느린 사용자·키보드·보조 기기로 8초 안에 '실행 취소' 에 닿을 수 있는지.
  - **스크린 리더**: 지운 직후 '프리셋을 삭제했습니다' 알림(`role="status"`)이 읽히고 '실행 취소' 로 닿는지, 키보드로 지운 직후 포커스가 어디에 놓이는지(L-158).
  - **대화상자·알림의 모양**: 같은 이름 대화상자(붉은 테두리의 덮어쓰기, 새 이름 칸)와 되돌리기 알림이 데스크톱·휴대폰(아래에서 올라오는 시트, 도크와의 겹침)에서 보기 좋은지.
  - **내가 정한 정책**이 맞는지: 삭제를 확인 없이 바로 하는 것(L-150), 같은 이름 저장의 처음 포커스가 '새 이름' 칸이고 Enter 가 사본을 만드는 것(L-152), 이미 기본이면 알림 없이 안내만 하는 것(L-155), 오디오를 다시 시작하면 IR 을 되살리지 않는 것(L-154), 이름이 겹치면 '(복원)' 이름으로 돌아오는 것(L-156).
  - **실제 오디오 장치에서** 캐비닛 IR 을 불러 두고 '기본 페달 설정' → '실행 취소' 했을 때 소리가 IR 이 적용된 것으로 돌아오는지(e2e 는 화면의 IR 이름으로 확인했다. 소리까지는 프로브가 보지 않는다).
- 남은 위험
  - **덮어쓰기에는 실행 취소가 없다**(L-152). 대화상자가 '되돌릴 수 없습니다' 라고 알리고 처음 포커스는 사본 쪽이지만, 일부러 덮어쓰면 옛 내용은 사라진다. 설계서 범위 밖이라 더하지 않았다(필요하면 같은 알림을 줄 수 있다).
  - 알림이 사라진(8초) 뒤에는 삭제·기본 설정을 되돌릴 수 없고(L-157), 알림이 떠 있는 동안 탭을 닫거나 새로고침해도 되돌릴 수 없다(지움은 이미 저장돼 있다, L-150).
  - 되돌리기도 이 탭이 기억하는 프리셋 목록 전체를 저장하므로, 두 탭에서 같은 시간에 고치면 나중에 쓴 쪽이 이긴다(기존 저장과 같다).
  - 가져오기(S2.7)의 덮어쓰기에는 아직 되돌리기가 없다.
  - `savePendingAs` 의 '그 사이 같은 이름이 생겼다' 분기와 `reset` 이 IR 을 잃었을 때의 안내 문구는 같은 탭에서 만들기 어려워 e2e 가 일부만 본다(위 생존 변이 ⑧).

---

## S2.9 MIDI 자동 재연결·방향·토글

- 브랜치·병합: `refactor/s2-9-midi` → `phase/2`. 커밋 `ac2d137`(C1 — `midi/` 폴더로 나눔·권한을 가리는 연결·재연결 배너·학습 방식 판정) · `3f901d8`(C2 — 기존 midi 시험을 새 구조에 맞춤 + Node 시험 `test:midi-reconnect`) · `ca44377`(C3 — e2e E-13) · `26f23d5`(C4 — 변이 시험이 찾은 도달할 수 없는 줄 한 줄 제거) · `66758ed`(C5 — 변이 시험이 찾은 시험의 구멍 메우기) · `ead0dd0`(C6 — 시험 하나 더) · 이 보고서를 담은 문서 커밋(`docs(S2.9): …` — 기록 L-160~L-168·README 갱신). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 소리가 바뀌지 않아 기준선 JSON 은 건드리지 않았다.
- 해결 항목: R2-9(새로고침 뒤 풋스위치가 반응하지 않음·값 방향·토글). **설계서 '현재' 는 기준선과 달랐다**(L-160): 앱을 열 때의 자동 연결·'64 이상 = 켜짐'(S2.4)·카드의 토글 방식 버튼이 이미 있었다. 실제 틈은 ① 연결이 권한을 가리지 않아 권한이 아직 허용되지 않은 브라우저에서 **열자마자 권한 창이 뜨거나** 조용히 실패하고 알 길이 없음 ② 카드가 연결 여부를 보여 주지 않음 ③ 학습할 때 방식을 정하는 길이 없음 ④ 연결·장치 감시·메시지 해석이 `audioStore.ts` 에 섞여 시험하기 어려움이었다. 이 Step 의 일은 ① 권한이 허용돼 있을 때만 열 때 자동 연결하고 아니면 배너 버튼으로(사용자 동작에서만 권한 창) ② 카드에 '매핑됨 · 연결됨 / 장치 없음 / 연결 안 됨' ③ 학습 중 누름 → 뗌이 1초 안에 이어지면 토글로 자동 지정하고 알림 ④ 장치를 뽑았다 꽂으면 리스너가 저절로 다시 붙음 ⑤ 위를 지키는 시험(Node `test:midi-reconnect` + 기존 midi 시험, e2e 15개)이다.
- 변경 파일(17개, 신규 6개, +2,006 / −198줄, 이 문서 커밋 전): 제품 `src/` 11개(+535 / −144) — 신규 `audio/midi/MidiService.ts`(223줄: 권한 확인·`MIDIAccess`·입력 장치 리스너 붙이고 떼기·뽑았다 꽂기, 저장소·화면·페달을 모름)·`audio/midi/MidiRouter.ts`(157줄: 학습·방식 확인·켜고 끄기, 바깥과 `MidiRouterPorts` 로만 이야기)·`audio/midi/index.ts`(5줄)·`components/MidiReconnectBanner.tsx`(30줄), 이름 바꿈 `audio/midi.ts` → `audio/midi/mapping.ts`(`git mv`, 순수 함수 + `MidiMode` 타입), 고침 `store/audioStore.ts`(MIDI 부분이 서비스·라우터를 이어 붙이는 얇은 층으로, `midiLink`·`midiPermission` 상태, `connectSavedMidi({ force, userAction })`)·`components/AppShell.tsx`(배너)·`components/PedalCard.tsx`(연결 표시)·`components/MidiAdvancedControls.tsx`(사용자 동작 표시)·`styles/panels.css`·`styles/responsive.css`. 시험·도구 6개(+1,471 / −54) — 신규 `scripts/midi-reconnect-regression.mjs`(944줄)·`e2e/tests/e13-midi.spec.ts`(350줄), 고침 `e2e/helpers/mocks.ts`(모의에 권한 상태·`reconnect`·`listening`·`permission`·`setPermission`·`setPromptAnswer`)·`scripts/midi-regression.mjs`(새 구조·새 규칙에 맞춤, L-167)·`package.json`(`test:midi-reconnect`)·`docs/refactoring/regex-assertions.md`(줄 번호만). **DSP·소리는 바뀌지 않았다**(프로브 24개·값 1,696개 불변).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 매핑 저장 → 새로고침 → (권한 granted) 학습 없이 풋스위치가 반응하고 상태가 '매핑됨 · 연결됨' | 충족 | e2e: 저장된 매핑(Delay=CC 80 토글, Drive=CC 81 래치)과 권한 granted 로 열면 학습·버튼 없이 카드가 '매핑됨 · 연결됨 · Ch 1 · CC 81' 이고 풋스위치 메시지가 페달을 켜고 끈다. 직접 학습해 저장한 매핑도 새로고침 뒤 바로 반응한다. Node: 저장소에 이어 붙어 `connectSavedMidi()` → 허용 시 연결·리스너 붙음, 새로고침(dispose 뒤 재연결)에도 반응 |
| 권한 prompt 상태 → 배너 버튼으로 다시 연결, 로드할 때 권한 창이 저절로 뜨지 않음 | 충족 | e2e: prompt 로 열면 **권한 창 0번·`requestMIDIAccess` 0번**이고 배너 'MIDI 풋스위치 다시 연결' 이 보이며, 버튼을 눌러야 권한 창이 한 번 뜨고 연결된다(키보드 Tab·Enter 로도, 휴대폰 390×844 에서도 버튼이 화면 안·42 px 이상). 권한 창에서 거부하면 '막혀 있습니다' 를 알리고, 사용자가 브라우저 설정에서 허용하면 저절로 이어서 연결한다. 처음부터 denied 면 요청하지 않고 막힘을 알린다. 권한 조회를 지원하지 않는 브라우저(`unknown`)도 열 때는 요청하지 않는다(L-163). 저장된 매핑이 없으면 권한도 요청하지 않고 배너도 없다. 고급 설정(볼륨·와우·프리셋 CC)만 저장돼 있어도 열 때 권한 창이 뜨지 않는다 |
| latch: 127 → 켜짐, 0 → 꺼짐 / toggle: 누를 때마다 전환, 뗌 무시 | 충족 | e2e: 래치(Drive)는 127 에 켜지고 0 에 꺼지며, 토글(Delay)은 누를 때마다 전환하고 뗌은 무시한다. 방식 버튼으로 래치↔토글을 오가고 저장된 이름은 `momentary`(L-161). Node: 경계 63/64, Note On/Off·Note On 세기 0, 누른 채 반복되는 값은 한 번만, 뗌만 온 토글은 전환하지 않음, 학습·방식 변경 뒤 눌림 기억 비움 |
| 학습 중 누름 → 뗌이 1초 안에 이어지면 toggle 로 자동 지정 | 충족 | e2e: 누름·뗌을 잇달아 보내면 카드가 '방식: 토글', 저장된 매핑에 `mode: 'toggle'`, 알림(누른 뒤 1초 안에 뗌이 이어져 토글로 지정했고 카드의 '방식' 버튼으로 바꿀 수 있다는 내용)이 뜨고 **학습 때의 누름·뗌은 페달을 움직이지 않으며**, 이후 누를 때마다 전환한다. 신호가 한 번뿐이면 '방식: 래치' 이고 1초 뒤 래치로 정했다는 알림이 뜬다. Node: 경계(정확히 1000 ms 는 토글, 1001 ms 는 래치 — 그 뗌은 보통 처리), 다른 채널·CC 의 뗌·방식을 사용자가 바꾼 뒤·판정 중 매핑이 바뀐 뒤의 뗌은 판정에 쓰지 않음, Note 로 학습, 1초 알림은 실제 타이머로 |
| 장치를 뺐다 다시 꽂으면 리스너가 저절로 다시 붙음 | 충족 | e2e: 같은 장치를 뽑으면 '매핑됨 · 장치 없음', 다시 꽂으면 '매핑됨 · 연결됨' 이고 리스너가 다시 붙어(`listening` 1) 학습·새로고침 없이 반응한다. 다른 장치를 새로 꽂아도 붙는다. Node: 같은 입력 객체가 되살아나는 경우·새 객체가 같은 id 로 대신하는 경우·재검색이 중복으로 붙이지 않는 경우(리스너 대입 횟수) |
| (설계서에 없는 추가 단언) 소리·기존 기준선 불변 | 충족 | `npm test` 의 `test:probe` 가 기존 프로브 1,696개 값을 기준선·허용치 그대로 견주어 통과. `e2e.json`·`audio-probe.json` 불변 |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 열 때 연결 | 저장된 매핑이 있으면 권한과 상관없이 `requestMIDIAccess` 를 바로 불러, 권한이 prompt 면 **페이지를 열자마자 권한 창이 뜰 수 있음** | 권한이 granted 일 때만 연결. prompt·알 수 없음이면 권한 창 없이 '연결 필요', denied 면 요청하지 않고 막힘 안내 |
| 연결을 못 했을 때 | 설정 패널 안의 작은 오류 문구뿐 | 화면 위쪽 배너 '저장된 MIDI 풋스위치가 아직 연결되지 않았습니다' + 'MIDI 풋스위치 다시 연결' 버튼(키보드·휴대폰 가능) |
| 카드 표시 | '매핑됨 · Ch 1 · CC 81' | '매핑됨 · 연결됨 · Ch 1 · CC 81'(연결됨 / 장치 없음 / 연결 중 / 연결 안 됨, L-162) |
| 학습 방식 | 항상 래치로 시작, 토글은 카드의 '방식' 버튼으로만 | 학습 중 누름 → 뗌이 1초 안에 이어지면 토글로 자동 지정하고 알림. 아니면 래치로 두고 1초 뒤 알림 |
| 권한이 나중에 허용되면 | 새로고침해야 함 | 연결을 기다리던 중이었다면 저절로 이어서 연결 |
| 코드 구성 | `midi.ts` 한 파일 + `audioStore.ts` 안의 연결·해석 | `midi/{mapping, MidiService, MidiRouter, index}` — 서비스·라우터를 가짜 브라우저·가짜 포트로 Node 에서 시험 |
| `npm test` | 41개 통과(398.4초) | 42개 통과(390.5초 — 새 Node 시험 `test:midi-reconnect` 포함). 첫 전체 실행은 41/42(399.4초): 시간 비율 프로브 한 건(P-17 `ratio.monitorOverheadInAllOn` 0.365, 허용 ±0.3)이 실패했고 같은 코드로 다시 돌리자 통과(L-168) |
| `npm run e2e` | 215개 통과(9.4분) | 230개 통과(9.9분 — 새 시험 15개) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e --ext .ts` 오류 0(`npm run lint` 는 앞서 실패한 e2e 실행이 남긴 `test-results/` 찌꺼기를 보므로 전체 e2e 를 한 번 통과시킨 뒤 다시 돌렸다). 정규식 단언 목록(`regex-assertions.md`)은 지금 코드와 같다. 코드·시험 커밋 `ead0dd0` 그대로(그 뒤 바뀐 것은 문서뿐)에서 전체 `npm run e2e` **230개 통과**(9.9분, 실패·불안정 재시도 0)·`npm test` **42개 통과**(390.5초). 첫 `npm test` 는 41/42 였다 — 시간을 재는 프로브 한 건이 허용치를 벗어났고(L-168), 같은 코드로 다시 돌리자 통과했다. 이 Step 은 DSP 를 건드리지 않았다.
  - **새 시험이 정말 잡는지**: (1) **옛 코드에 돌려 보았다**. e2e E-13 시험 파일을 옛 코드(`phase/2` 의 `fcd0bde`)의 빌드에 돌리면 **15개 중 12개가 실패한다**(통과한 3개는 옛 코드도 그렇게 동작하는 변하지 않은 동작의 가드: 저장된 매핑이 없으면 권한도 요청하지 않고 배너도 없음·학습이 막혀도 저장된 매핑이 없으면 배너 없음·설정 저장은 사용자 동작이라 권한을 요청함 — 이 가드들이 새 코드에서도 통과하는 것이 '기존 동작을 깨지 않았다' 는 증거다). Node 시험 `test:midi-reconnect` 는 옛 코드에 `midi/` 폴더가 없어 첫 가져오기에서 실패한다. (2) **변이 시험**(소스를 일부러 틀리게 바꿔 시험이 실패하는지 본다): 처음 **111종** — 라우터 33·해석 6·서비스 38·저장소 20·화면 14. 처음에 **77종 적발·34종 생존**이었다. 생존 34종을 하나씩 따졌다. ① **시험의 구멍 21종**에 시험을 더했다: 뗌만 온 토글은 전환하지 않음(R2)·재학습 뒤 첫 누름이 '이미 눌림' 으로 먹히지 않음(R11)·끝난 판정의 늦은 타이머가 알림을 만들지 않음(R21)·판정 중 매핑이 바뀌면 래치 알림도 없음(R22)·이미 연결돼 있을 때 다시 부르면 놓친 장치를 훑음(V5·V35)·권한이 prompt·denied 로 바뀐 값이 상태에 반영됨(V18)·**권한이 허용이 아닌 값으로 바뀌어도 연결하지 않음(V23)**·바뀌기 전의 옛 권한 감시가 늦게 불려도 무시(V19)·떨어진 리스너를 다시 붙임(V30)·같은 id 의 새 입력 객체가 옛 입력의 리스너를 대신함(V28)·지원하지 않는 브라우저의 dispose(V37)·dispose 뒤 새 연결이 옛 대기 요청을 재사용하지 않음(V38)·없는 페달 학습(T7)·학습 중 페달이 사라지면 학습 끝(T20)·학습 성공이 이전 오류를 지움(T21)·dispose 뒤 방식 알림 없음(T10)·끝난 세션의 늦은 실패가 오류를 띄우지 않음(T9)·알림 8초(T15)·e2e: 방식 버튼으로 래치 되돌리기(C1)·저장된 매핑이 없을 때 막혀도 배너 없음(B1). 그 밖에 **고급 설정의 마운트·저장·연결 호출이 사용자 동작인지(AD1~AD3) 3종**은 Node 소스 검사가 이미 잡고 있었다 — 첫 실행이 화면 변이에는 e2e 만 돌려서 살아남은 것으로 보였을 뿐이다(Node 시험도 함께 돌려 다시 확인). ② **중복 안전장치 1종**(V31): `syncInputs` 에서 '다른 입력이면 리스너를 뗀다' 는 줄은 앞 단계가 이미 같은 일을 하므로 어떤 시험도 달라지지 않았다. 지우고 `refactor` 커밋으로 남겼다. 이때 지운 줄이 변이 V28 에서만 옛 입력을 떼 주던 것임이 드러나 그 경우를 직접 보는 시험을 더했다. ③ **동등 변이 9종**(결과가 달라질 수 없는 변경): R8(방식 확인이 먹은 뗌의 결과를 무시 — 곧바로 토글이 된 매핑이 뗌을 무시하므로 같음)·V11(dispose 가 `wantsAutoConnect` 를 끄지 않음 — 권한 감시도 함께 떼어져 닿을 수 없음)·V15(권한 API 없음 검사 생략 — 조회가 예외로 같은 `unknown` 으로 감)·V20·V21·V22(권한이 허용으로 바뀐 뒤 이어 연결하는 조건 셋 중 하나를 뺌 — `connect()` 앞머리가 같은 일을 함)·V24(`attach` 의 옛 `access` 정리 — 이미 연결돼 있으면 `connect()` 가 일찍 돌아가 닿을 수 없음)·V29(뽑힌 입력을 기억 목록에서 지우지 않음 — 같은 id 가 다시 꽂히면 덮어쓰이고 화면·리스너에 차이 없음)·T6(매핑을 지울 때 눌림 기억·방식 확인을 따로 비우지 않음 — 지운 뒤 학습이 비우고 방식 확인은 매핑이 사라진 것을 스스로 알아챔). **결과: 111종 중 줄을 지운 1종을 빼면 110종, 101종 적발 — Node 시험이 90종, e2e 가 11종 — 9종은 동등 변이.** 변이는 /tmp 에 복사해 둔 원본으로 되돌리고 `cmp` 로 확인한 뒤 깨끗이 다시 빌드했다.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-160). 이미 있는 자동 연결을 만드는 일이 아니라 권한을 가려서 열자마자 권한 창이 뜨는 것을 막고 연결 상태를 보여 주는 일이 됐다.
  - **기존 midi 시험이 새 규칙과 부딪혔다**(L-167). 학습 직후의 뗌이 이제 1초 안이면 토글 지정으로 읽혀, 옛 시험이 학습 직후 보내던 뗌의 시각을 늦췄다(단언은 그대로).
  - **시험의 단언이 비어 있던 곳이 있었다**. 처음 쓴 Node 시험의 한 블록(연결을 시도한 적이 없을 때의 권한 변경)은 아무것도 보지 못하는 시험이라 지웠다(그 경로에서는 `onchange` 를 붙이지 않는다). 대신 권한 변경 경로는 시도한 뒤의 경우로 시험한다.
  - **e2e 로 라벨이 셋에 걸렸다**: '마스터 볼륨' 이라는 이름이 설정 밖에도 있어 `getByLabel` 이 여러 요소를 잡았다 → 설정 패널 안으로 좁혔다.
  - **변이가 시험의 구멍 21곳을 찾았다**(위 검증 (2)). 가장 중요한 것은 V23: '권한이 허용이 아닌 값으로 바뀌어도 연결하지 않음' 이 시험되지 않아, 이 줄이 틀렸다면 사용자가 브라우저 설정에서 권한을 '다시 묻기' 로 바꾸는 순간 앱이 권한 창을 띄웠을 것이다.
- 사람 확인 필요
  - **실제 풋스위치**: 래치형(밟으면 127, 떼면 0)과 토글형(밟을 때만 신호)을 각각 학습시켰을 때 자동 지정이 맞는지, 특히 **래치형 스위치를 1초 안에 밟았다 떼면 토글로 지정되는 것**(L-165)이 사용에서 거슬리는지. Note 로 보내는 풋스위치도 같은지.
  - **실제 브라우저의 권한 창**: Chrome 에서 권한이 '묻기' 일 때 열자마자 창이 뜨지 않고 배너 버튼을 눌렀을 때만 뜨는지, 허용·거부·'차단됨' 상태에서 배너 문구가 맞는지. Firefox·Safari 에서 권한 조회가 지원되지 않을 때(`unknown`, L-163) 배너 버튼 한 번으로 연결되는지(새로고침마다 필요한 것이 거슬리는지).
  - **실제로 뽑았다 꽂기**: 케이블을 뽑았다 꽂았을 때 카드가 '장치 없음' ↔ '연결됨' 으로 바뀌고 학습 없이 다시 반응하는지(e2e 는 모의 장치로만 확인했다). 휴대폰(USB OTG)에서도 같은지.
  - **배너·알림의 모양과 읽어 주기**: 배너(`role="status"`)와 방식 알림이 데스크톱·휴대폰에서 보기 좋은지, 스크린 리더가 읽어 주는지.
  - **내가 정한 정책**이 맞는지: 저장 이름을 `momentary` 로 둔 것(L-161), 세 번째 문구 '연결 안 됨'(L-162), 알 수 없는 권한을 사용자 동작으로 미루는 것(L-163), 학습 때의 뗌을 먹는 것(L-165).
- 남은 위험
  - **래치 스위치를 1초 안에 밟았다 떼며 학습시키면 토글로 지정될 수 있다**(설계서가 정한 규칙, L-165). 알림이 알리고 카드의 '방식' 버튼으로 고친다.
  - 권한 조회가 없는 브라우저는 새로고침마다 배너 버튼을 한 번 눌러야 한다(L-163).
  - 모든 MIDI 입력 장치에 같은 매핑이 적용된다(기존과 같음). 장치를 고르는 것은 S2.13 의 범위다.
  - `MIDIMessageEvent.timeStamp` 가 없는 환경에서는 `performance.now()` 로 대신하므로 1초 판정이 메시지가 아니라 도착 시각 기준이 된다(최신 브라우저는 모두 제공).
  - 이 Step 은 실제 하드웨어·실제 권한 창을 보지 못했다(사람 확인 필요에 올림). e2e 는 모의 `navigator.requestMIDIAccess`·`navigator.permissions` 위에서 돈다.

---

## S2.10 지연·끊김 표시

- 브랜치·병합: `refactor/s2-10-latency` → `phase/2`. 커밋 `c08bfa8`(C1 — 입력·처리·출력 지연 계산과 세션 기준 끊김 표시, 게이트 글리치 집계 삭제, Node 시험) · `a5fbd01`(C2 — e2e E-14 6개) · `4094ab3`(C3 — 변이 시험이 찾은 시험의 구멍을 Node 시험으로 메우고 동작이 같은 조건 한 줄 정리) · `8925707`(C4 — E-14 ⑥⑦ 세션 시작 기준선과 한 줄 요약 확인 추가) · 이 보고서를 담은 문서 커밋(`docs(S2.10): …` — 기록 L-169~L-178·README 갱신). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 소리가 바뀌지 않아 기준선 JSON 은 건드리지 않았다.
- 해결 항목: R2-10(지연·글리치 숫자가 실제와 다름), D11(끊김은 `playbackStats` 로 실측, 미지원은 '측정 불가'). **설계서 '현재' 는 기준선과 달랐다**(L-169): 'ASIO' 문구는 이미 없었고 화면의 끊김은 이미 `underrunEvents` 를 읽었으며 게이트의 `glitch-report` 는 화면이 읽지 않는 죽은 계측이었다. 실제 틈은 ① 합계가 출력만 더하고 입력·처리가 빠짐 ② 끊김이 세션 시작이 아니라 컨텍스트 생성 이후의 누적값 ③ 입력·출력 값을 못 읽을 때 무엇이 빠졌는지 알 길이 없음이었다. 이 Step 의 일: ① 지연 = 입력 + 처리 + 출력 항목별 표시(`engine/latency.ts` 순수 함수 + `BaseEffect.latencySeconds` + P-16 표 `params/latency.json`) ② 못 읽는 항목은 '미포함'(합계에서도 빠짐) ③ 끊김 = 세션 시작 대비 증가분, 미지원은 '측정 불가'(이유는 툴팁) ④ 합계 20 ms 초과 시 줄이는 방법 안내 ⑤ 게이트의 죽은 글리치 집계 삭제 ⑥ 위를 지키는 시험.
- 변경 파일(19개, 신규 3개, +1,285 / −128줄, 이 문서 커밋 전): 제품 `src/` 15개(+450 / −102) — 신규 `audio/engine/latency.ts`(261줄: 단위 변환·입력/출력 읽기·합계·'미포함' 판정·끊김 기준선·화면 문구)·`audio/params/latency.json`(P-16 실측 표), 고침 `audio/AudioEngine.ts`(`readLatency`·`readProcessingLatency`·`readUnderrunCount`·`markSessionStart`)·`audio/nodes/BaseEffect.ts`(`latencySeconds`)·`Drive`·`Crunch`·`Fuzz`·`Cab`(지연 값)·`NoiseGateEffect.ts`·`worklets/noise-gate-processor.ts`(글리치 집계 삭제)·`audio/types.ts`·`store/audioStore.ts`(1초/틱 읽기)·`components/Meter.tsx`·`ConnectGuitarPanel.tsx`·`styles/panels.css`. 시험 4개(+835 / −26) — 신규 `e2e/tests/e14-latency.spec.ts`(8개), 고침 `scripts/latency-regression.mjs`(전면 다시 씀)·`scripts/recording-regression.mjs`(스토어 읽기 주기·필드별 갱신·정지 초기화)·`scripts/fuzz-gate-regression.mjs`(지문 공식, L-174). **DSP·소리는 바뀌지 않았다**(프로브 24개·값 1,696개 불변).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| Chrome: 지연 표시에 입력·처리·출력 세 항목이 보이고, 합계에 입력 지연과 처리 지연이 들어간다 | 충족 | e2e ①: 연결하면 `입력 … ms(트랙 통계)`·`처리 … ms(페달 … + 리미터 …)`·`출력 … ms(버퍼 … + 장치 …)` 가 보이고 합계 = 입력 + 처리 + 출력(±0.2 ms), 처리 = 페달 + 리미터. 페달 지연은 P-16 기준선(`audio-probe.json`)의 Drive + Cab 값과 같고(±0.15 ms) Drive 를 끄면 2 ms 넘게 줄었다가 켜면 돌아온다. 연결 상태 줄·미터 아래 한 줄 요약의 합계도 같은 값. 음원 파일 모드(⑦)는 '입력 없음(음원 파일)' |
| 과부하 시험(시험 전용 부하 워클릿) → 화면의 끊김 수 = `playbackStats.underrunEvents` 증가분 | 충족 | e2e ②: 오디오 스레드를 붙잡는 워클릿으로 실제 끊김을 만들고, 브라우저의 값이 가라앉은 뒤 화면 증가분이 브라우저 증가분과 같다. 연결 전은 '--'. e2e ⑥⑦: 시작 전에 쌓인 5건은 세지 않고 시작한 뒤의 증가분(3건·2건)만 보인다(장치·파일 모드) |
| `playbackStats` 를 지운 모의 환경 → '측정 불가' | 충족 | e2e ③: `playbackStats` 가 `undefined` 면 '측정 불가' 이고 툴팁에 이유(`playbackStats`)가 있으며 지연 표시는 그대로. e2e ④: `track.stats`·`latency` 설정·`baseLatency`·`outputLatency` 를 지우면 '입력 지연 미포함'·'출력 지연 미포함' 이고 합계는 처리만 남는다 |
| 화면과 README 에 'ASIO' 가 한 번도 나오지 않는다 | 충족 | e2e ⑤: 합계가 20 ms 를 넘으면 안내 문구(정확한 문장)가 뜨고, 화면의 `outerHTML`·`innerText` 와 README 에 /asio/i 가 없다. Node: 소스·README 검사 |
| (설계서에 없는 추가 단언) 휴대폰에서 가로 넘침 없음, 소리·기존 기준선 불변 | 충족 | e2e ⑧: 390×844 에서 새 문구가 가로로 넘치지 않는다. `npm test` 의 `test:probe` 가 기존 프로브 값을 기준선·허용치 그대로 견주어 통과, `e2e.json`·`audio-probe.json` 불변. 게이트 지문은 옛 코드와 새 코드가 같다(L-174) |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 지연 합계 | 출력(`baseLatency + outputLatency`)만 더함. 입력은 따로 적고 처리는 '추정 미지원' | 입력 + 처리(켜진 페달 + 리미터) + 출력. 항목별로 보이고 못 읽은 항목은 '미포함'(합계에서도 빠짐) |
| 입력 지연 | `getSettings().latency` 만 | `track.stats.latency`(ms, 0 이면 건너뜀) → `getSettings().latency`(초) → 없으면 '입력 지연 미포함'. 파일 모드는 '입력 없음(음원 파일)' |
| 처리 지연 | 표시 없음 | 켜진 페달의 `latencySeconds` 합(P-16 실측: 오버샘플링 2.941/2.705 ms·컨볼버 0.089 ms) + 리미터 룩어헤드(약 1 ms). 기본 구성 약 3.0 ms(44.1 kHz)·2.8 ms(48 kHz) |
| 끊김 | '출력 버퍼 부족 N회'(컨텍스트 생성 이후 누적), 미지원 '측정 미지원' | '끊김 N회'(세션 시작 대비 증가분), 미지원 '측정 불가'(툴팁에 이유), 연결 전 '--' |
| 안내 | 출력 지연 20 ms 초과 → 짧은 안내 | 합계 20 ms 초과 → '지연을 줄이려면: 유선 헤드폰 사용 · 블루투스 끄기 · …'(L-171) |
| 게이트 워클릿 | 쓰이지 않는 `glitch-report` 집계 | 삭제(소리·`gate-state` 불변) |
| 읽는 주기 | 매 틱 | 처리 지연은 매 틱, 브라우저가 주는 값은 1초마다(L-175) |
| `npm test` | 42개 통과(390.5초) | 42개 통과(395.0초) |
| `npm run e2e` | 230개 통과(9.9분) | 238개 통과(10.2분 — 새 시험 8개) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e --ext .ts` 오류 0(`npm run lint` 는 앞서 실패한 e2e·변이 실행이 남긴 `test-results/` 찌꺼기를 보므로 전체 e2e 를 한 번 통과시킨 뒤 다시 돌렸다). 정규식 단언 목록(`regex-assertions.md`)은 지금 코드와 같다. 코드·시험 커밋 `8925707` 그대로(그 뒤 바뀐 것은 문서뿐)에서 전체 `npm run e2e` **238개 통과**(10.2분)·`npm test` **42개 통과**(395.0초). 이 Step 은 DSP 를 건드리지 않았다.
  - **새 시험이 정말 잡는지**: (1) **옛 코드에 돌려 보았다**. e2e E-14 시험 파일을 옛 코드(`phase/2` 의 `c27785a`)의 빌드에 돌리면 **8개 모두 실패한다**(옛 화면에는 입력·처리·출력 항목도 새 끊김 표시도 없어서다. 옛 코드가 그대로 통과하는 가드 시험은 없다 — 수용 기준이 모두 새 동작이기 때문이다). Node 시험 `test:latency` 는 옛 코드에 `engine/latency.ts` 가 없어 첫 가져오기에서 실패한다. (2) **변이 시험**(소스를 일부러 틀리게 바꿔 시험이 실패하는지 본다): 처음 **82종** — 지연 계산 37·표 값 4·`BaseEffect`/페달 9·`AudioEngine` 12·스토어 14·화면 6(단위 ×1000 빠짐, 통계/설정 우선순위, 0 건너뛰기, 합계에서 입력·처리·출력 빼기, 임계 `>`/`>=`·30, 기준선 빼기, 1초 주기·`>=`, 활성 검사, Cab 끄기 우회, 표 값, 'ASIO' 문구, 화면 문구 등). 처음에 **72종 적발·10종 생존**(Node 시험 67종, e2e 5종)이었다. 생존 10종을 하나씩 따졌다. ① **시험의 구멍 8종**에 시험을 더했다: 세션 시작 기준선을 적지 않음 — 장치(E2)·파일(E3) 모드 → e2e ⑥⑦(시작 전 5건이 세어지지 않음) · 읽음의 한 필드만 바뀌면 화면에 반영되지 않음 — 리미터(S10)·입력 출처(S11)·장치 출력(S12)·입력(S13) → Node 스토어 시험(필드마다 혼자 바꿔 본다) · 정지해도 끊김 수가 안 비워짐(S14) → Node 정지 시험 · 한 줄 요약의 지연이 합계가 아님(U5) → e2e ①. ② **중복 조건 1종**(S4): `refreshMeters` 의 `state.latency.sampleRate === 0` 는 바로 뒤 `sampleRate !== 컨텍스트 값` 조건에 포함돼 동작이 같아 지웠다(`4094ab3`). ③ **동등 변이 1종**(E9): 정지 때 기준선을 `null` 로 되돌리는 줄 — 정지하면 컨텍스트가 없어 끊김 읽음이 `null` 이 되고 다음 세션은 시작할 때 기준선을 다시 적으므로 어떤 경로로도 결과가 달라지지 않는다(방어용으로 남겼다). **결과: 82종 중 줄을 지운 1종을 빼면 81종, 80종 적발 — Node 시험 72종, e2e 8종 — 1종은 동등 변이.** 변이는 /tmp 에 복사해 둔 원본으로 되돌리고 `cmp` 로 확인했다.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-169, L-170). 'ASIO' 문구도 화면에 쓰이는 게이트 글리치도 없었고 컴프레서·오버샘플링은 이미 목표 상태였다.
  - **처리 지연이 연결 직후 0.0 ms 로 보였다**. 처음엔 모든 읽음을 1초마다 했더니 효과 그래프가 만들어지기 전의 읽음이 1초 동안 남았다(E-14 ① 이 잡았다). 처리 지연은 우리 쪽 값이라 매 틱 읽도록 나눴다(L-175).
  - **헤드리스 Chromium 의 `track.stats.latency` 는 0 이 아니라 약 0.1 ms** 라서 '입력을 못 읽음' 모의가 통하지 않았다 → 시험이 `MediaStreamTrack.prototype.stats` 도 지운다.
  - **게이트 시험의 지문이 `glitch-report` 를 해시에 넣고 있었다**(L-174). 골든 값을 새로 적되, 옛 코드·새 코드가 같은 값을 내는 것을 둘 다 돌려 확인했다.
  - **휴대폰 시험이 처음 시간 초과**: 연결 버튼이 도크가 닫혀 있으면 안 보인다 → `setMobileDock` 으로 연 뒤 연결하는 흐름으로 고쳤다.
  - **변이가 시험의 구멍 8곳을 찾았다**(위 검증 (2)). 가장 중요한 것은 세션 시작 기준선(E2·E3): 이 줄이 빠지면 앱을 연 뒤 소리가 나오기 전에 쌓인 끊김이 화면에 남는데 어떤 시험도 몰랐다.
- 사람 확인 필요
  - **실제 장치의 값**: 오디오 인터페이스·USB 마이크·블루투스 이어폰·내장 마이크에서 '입력'(트랙 통계/장치 설정값)·'출력'(버퍼 + 장치) 값이 그럴듯한지, 특히 블루투스에서 출력이 크게 나오고 안내가 뜨는지. 브라우저가 주는 값이라 실제 왕복 지연(루프백 측정)과 다를 수 있다.
  - **끊김**: 실제 PC 에서 CPU 를 쓰는 다른 작업을 돌릴 때 '끊김 N회' 가 늘고 귀로 들리는 끊김과 맞는지. Firefox·Safari 에서 '측정 불가' 와 툴팁이 맞게 뜨는지(L-173 의 기준선이 최대 1초 묵을 수 있는 점 포함).
  - **문구와 모양**: 항목 문구(L-177), 안내 문구, 데스크톱·휴대폰에서 지연 영역의 모양과 스크린 리더가 읽어 주는 방식.
  - **내가 정한 정책**: 합계에 임계 20 ms 를 건 것(L-171), `track.stats.latency` 0 을 건너뛰는 것(L-172), Cab '끄기'에서 지연 0(L-176).
- 남은 위험
  - 입력·출력 지연은 브라우저가 알려 주는 값이라 실제 왕복 지연이 아니다(화면에 그렇게 적었다). 일부 브라우저는 값을 주지 않아 '미포함' 으로 합계가 작게 나올 수 있다.
  - 끊김 수는 브라우저가 1초마다 갱신하는 누적값의 세션 대비 증가분이라 정밀한 계수가 아니다(L-173).
  - `playbackStats`·`track.stats` 는 Chromium 계열 전용이다. 다른 브라우저에서는 끊김이 '측정 불가', 입력은 설정값 또는 '미포함' 이다.
  - 새 지연을 더하는 페달이 생기면(S3.x) `processingLatencySeconds`·`latency.json` 을 함께 고쳐야 한다(Node 시험이 소스 검사로 알려 준다).
  - 이 Step 은 실제 장치를 보지 못했다(사람 확인 필요에 올림).

---

## S2.11 키보드 단축키

- 브랜치·병합: `refactor/s2-11-shortcuts` → `phase/2`. 커밋 `14de06e`(C1 — `input/` 으로 나누고 `Shift + 1~6` 추가, 도움말 표 일원화) · `f56af83`(C2 — Node 시험을 새 모듈에 맞추고 새 시험 추가) · `016fd0c`(C3 — e2e E-15 6개) · `e3516a2`(C4 — 변이 시험이 찾은 구멍을 메우는 Node 시험과 E-15 ⑦) · `8e7a3c6`(C5 — 정규식 단언 목록 재생성) · 이 보고서를 담은 문서 커밋(`docs(S2.11): …` — 기록 L-179~L-185·e2e README·README 갱신). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 소리가 바뀌지 않아 기준선 JSON 은 건드리지 않았다.
- 해결 항목: R2-12(단축키 3가지 문제), D13(10~15번째 페달 `Shift + 1~6`). **설계서 '현재' 는 기준선과 달랐다**(L-180): 한글 입력 상태의 T·A·B 는 이미 동작했고(키 해석이 `code` 기준), Esc 는 S1.2 부터 녹음을 저장하는 긴급 정지였다. 실제 틈은 ① `Shift + 1~6`(L-179: L-4 의 '`0 Q W E R Y` 유지'를 뒤집지 않고 더함) ② 키를 해석하는 곳과 실행하는 곳을 `src/input/` 로 나눔(L-181) ③ 도움말이 따로 적은 목록이라 실제 키와 어긋날 수 있던 것(L-182) ④ 이것들을 지키는 E-15 시험이었다.
- 변경 파일(13개, +944 / −288줄, 이 문서 커밋 전): 제품 `src/` 7개(+287 / −185) — 신규 `input/shortcutKeys.ts`(128줄: 키 표·`resolveShortcutCommand`·`SHORTCUT_HELP_ROWS`, 기존 `components/keyboardShortcuts.ts` 49줄을 옮겨 고침)·`input/ShortcutService.ts`(145줄: 컨트롤 포커스 규칙·`executeShortcutCommand`·`createShortcutKeydownHandler`), 고침 `components/GlobalKeyboardShortcuts.tsx`(130 → 39줄: 처리기를 만들어 전역 리스너 하나에 다는 일만)·`components/ShortcutHelp.tsx`(키 표를 그대로 그림)·`components/HistoryControls.tsx`·`hooks/useSidebar.ts`(가져오기 경로). 시험: `e2e/tests/e15-shortcuts.spec.ts`(신규 7개), `scripts/shortcuts-regression.mjs`(대폭 확장)·`tap-tempo`·`preset-ab`·`file-mode`-regression(읽는 소스 경로), `docs/refactoring/regex-assertions.md`(재생성, 줄 번호만 바뀜).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 한글 입력 상태 모의(`key: 'ㅅ'`, `code: 'KeyT'`) → 탭 템포 동작. A·B도 같음 | 충족 | e2e ①: `ㅅ`(KeyT)·조합 중 `Process`(KeyT) 가 탭 템포가 되고(탭 1회→2회, `preventDefault` 불림), `ㅁ`(KeyA)·`ㅠ`(KeyB, 조합 중)가 A·B 슬롯을 켠다(켜진 페달이 슬롯의 상태로 바뀌고 `aria-pressed` 가 옮겨 감). 관계없는 한글 키(`ㅋ`=KeyX)는 가로채지 않는다. Node: 한글 `ㅅ ㅁ ㅠ ㅂ ㅈ ㄷ ㄱ`(T A B Q W E R) 를 눌러 본다. **기준선도 이미 통과하는 시험이다**(L-180) |
| 녹음 중 Esc → 정지 + 녹음 파일 남음(S1.2) | 충족 | e2e ②: 녹음 버튼을 누른 채(포커스가 버튼에 있다) 3초 뒤 Esc → 500 ms 안에 입력 트랙 ended·컨텍스트 closed·'기타 연결하기' 화면, 토스트 '… 녹음은 저장했습니다.', '다운로드' 가 켜지고 받은 파일의 길이 = 녹음 시간 ±0.5초. e2e ⑦: 도움말이 열려 있으면 Esc 는 도움말만 닫는다(포커스가 대화상자 밖이어도). **기준선도 이미 통과하는 시험이다** |
| Shift + 1~6 → 10~15번째 페달 전환, 도움말에 표시 | 충족 | e2e ③: `Shift+Digit1`~`6` 이 Chorus·Flanger·Phaser·Tremolo·Delay·Reverb 를 하나씩 켜고(다른 페달은 그대로) 한 번 더 누르면 끄며, 윗줄 `0 Q W E R Y` 로 켠 같은 페달을 `Shift + 1~6` 으로 끌 수 있다. 한글 입력 상태·기호 `key`(`!@#$%^`)에서도 같고, `Shift+7`·`Shift+0` 은 아무 일도 없고 가로채지 않는다. e2e ④: 도움말에 'Shift + 1–6' 행이 보이고 일곱 행(`1–9 / 0 / Q W E R Y`·`Shift + 1–6`·`Space`·`T`·`A / B`·`Esc`·`?`)이 그대로 그려지며, 열려 있는 동안 Shift+1·1·T 는 아무 일도 하지 않는다. **옛 코드에서는 ③④⑥ 이 실패한다** |
| 입력 칸에 포커스가 있을 때 단축키가 동작하지 않음 | 충족 | e2e ⑤: 프리셋 이름 입력 칸에 포커스가 있을 때 T·Shift+1·Space·A·4 를 누르면 입력 칸에 `t! a4` 가 그대로 들어가고 탭·페달·토스트는 불변, 한글 `ㅅ`·Shift+1 이벤트는 처리되지 않는다(`preventDefault` 없음). Node: 입력 칸·select·버튼 포커스에서 `createShortcutKeydownHandler` 가 아무 일도 하지 않고 `preventDefault` 도 부르지 않음 |
| (설계서에 없는 추가 단언) 반복·Ctrl/⌘/Alt 조합·목록에 없는 키 | 충족 | e2e ⑥: 키를 누르고 있는 반복(T·1·Shift+1)·Ctrl+T·⌘+1·Alt+Shift+1·Ctrl+Shift+3·Ctrl+A·Z·Enter·Shift+T 는 처리하지도 `preventDefault` 를 부르지도 않고(브라우저 기본 동작을 가로채지 않는다), 같은 키의 반복이 아닌 입력은 처리한다 |

**전후**

| 항목 | 전 | 후 |
|---|---|---|
| 10~15번째 페달 | 윗줄 `0 Q W E R Y` | `0 Q W E R Y` 와 **`Shift + 1~6`**(같은 여섯 페달, L-179) |
| 키 해석·실행 위치 | `components/keyboardShortcuts.ts`(해석, 49줄) + `GlobalKeyboardShortcuts.tsx`(포커스 규칙·실행·리스너, 130줄) | `input/shortcutKeys.ts`(해석·키 표·도움말 표) + `input/ShortcutService.ts`(포커스 규칙·실행·keydown 처리기) + 컴포넌트(리스너·도움말 열기, 39줄) |
| 도움말 키 목록 | 컴포넌트 안의 따로 적은 상수 6행 | 키 표 옆의 `SHORTCUT_HELP_ROWS` 7행 — 시험이 적힌 키를 눌러 봄. Esc 행에 '녹음 중이면 녹음을 저장' |
| 한글 입력·Esc 긴급 정지·입력 칸 가드 | 이미 동작(시험은 일부만) | 같은 동작, 한글 T·A·B·Q·W·E·R(Node)와 T·A·B(e2e)·Esc 녹음 저장·입력 칸 포커스를 시험이 지킴 |
| `npm test` | 42개 통과(395.0초) | 42개 통과(413.3초) |
| `npm run e2e` | 238개 통과(10.2분) | 245개 통과(10.5분 — 새 시험 7개) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e --ext .ts` 오류 0(`npm run lint` 는 전체 e2e 를 돌려 `test-results/` 를 비운 뒤에 돌렸다). 정규식 단언 목록은 `docs/refactoring/tools/list-regex-assertions.mjs` 의 출력과 같다.
  - **새 시험이 정말 잡는지**: (1) **옛 코드에 돌려 보았다**. e2e E-15 시험 파일을 옛 코드(`phase/2` 의 `561a947`)의 빌드에 돌리면 **③④⑥ 이 실패하고**(`Shift + 1~6` 도, 도움말의 'Shift + 1–6' 행도 없다) ①②⑤⑦는 통과한다 — 기준선이 이미 맞는 동작(L-180)이라 당연하다. 이 시험들은 이후 리팩토링이 한글 입력·Esc 녹음 저장·입력 칸 가드를 깨뜨리는 것을 막는 회귀 방지 시험이다. (2) **변이 시험**: 구현에 56가지 결함(`src/input/shortcutKeys.ts` 31 — 반복·Ctrl·⌘·Alt 무시 빼기, 도움말 키 `?`·Shift+Slash 빼기, 조합 중 처리, Shift 분기·첫 인덱스·키 개수·키 표 오타·T/A/B/Space/Esc 매핑·code 대신 key 판단·fallback 의 Shift·대소문자·`Esc`/`Spacebar`, 도움말 표의 라벨·shift 표시·Esc 문구·슬롯 바꿔치기 / `src/input/ShortcutService.ts` 17 — 도움말이 열려 있을 때의 분기·`stopPropagation`·`preventDefault`·`closeHelp`, 막는 규칙(조합 중·Esc 소유 대상·select·dialog·range 입력)·페달 인덱스·Esc·탭 실행·슬롯 실행 결과 / `components/GlobalKeyboardShortcuts.tsx` 5 — 캡처 옵션·`helpOpenRef` 갱신·도움말 상태·상태 낭독 문구 / `components/ShortcutHelp.tsx` 3 — 행 빼기·라벨↔설명 바꿔치기)을 하나씩 넣고 Node 시험 5개(`shortcuts`·`tap-tempo`·`preset-ab`·`file-mode`·`responsive-a11y`), 살아남으면 빌드해서 e2e(E-15 + E-01 의 도움말 대화상자 시험)를 돌렸다. 처음에 **52개를 잡고 4개가 살아남았다**(L-185): 실행 못 한 키의 `preventDefault`(V6)·빈 슬롯의 결과값(V17)·캡처 옵션(G1)·포커스가 대화상자 밖일 때의 Esc(G3). 시험을 보강한 뒤 4개 모두 잡는다 — **56개 모두 잡힘**(Node 시험 53개, e2e 3개: 상태 낭독 문구·도움말 열기·도움말 상태 갱신). 동작이 같은 변이 하나(V1: `index > 14` → `> 15`)는 소스 단언만이 잡는다. 사용한 변이 도구는 `/tmp` 에 있어 저장소에 넣지 않았다.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-180). 한글 입력·Esc 녹음 저장은 이미 되어 있었다.
  - **파일을 옮기니 시험 5개가 소스를 못 읽었다**: `tap-tempo`·`preset-ab`·`file-mode`·`shortcuts` 는 옛 경로를 읽고 있었다. 읽는 경로를 새 파일로 고쳤다(옛 정규식 단언은 의미를 지킨 채 새 위치를 가리킨다).
  - **도움말이 열려 있을 때의 Esc 우선순위를 보는 소스 단언을 동작 시험으로 바꿨다**: 처리기 하나로 합치면서 `createShortcutKeydownHandler` 에 도움말 분기가 들어가, 가짜 이벤트로 눌러 `closeHelp`·`preventDefault`·`stopPropagation` 호출과 긴급 정지가 불리지 않음을 본다.
  - **변이가 시험의 구멍 4곳을 찾았다**(L-185). 가장 중요한 것은 포커스가 대화상자 밖일 때의 Esc(G3) — 기존 E-01 은 포커스가 대화상자 안에 있어 대화상자 자신이 Esc 를 받는 경로만 지났다.
- 사람 확인 필요
  - **실제 한글 입력기**: Windows·macOS 한국어 입력기로 한글 모드에서 T·A·B·Q·W·E·R·Y·`Shift + 1~6` 이 동작하는지(시험은 같은 모양의 이벤트를 보낸 것이다, L-184). 특히 조합 중인 글자가 있는 상태에서의 Esc.
  - **실제 키보드 배열**: 한국어 키보드뿐 아니라 영문(미국)·일본어·한영 겸용 배열에서 `Shift + 1~6` 과 `?`(Shift + `/`)가 같은 키에서 나오는지. 물리 키 기준이라 배열이 달라도 같은 자리여야 한다.
  - **문구**: 도움말의 'Shift + 1–6'·Esc 행 설명(L-182). 스크린 리더가 읽어 주는 방식.
  - **내가 정한 정책**: 윗줄 `0 Q W E R Y` 를 지우지 않고 `Shift + 1~6` 을 더한 것(L-179).
- 남은 위험
  - 한글 입력기가 보내는 이벤트를 실제로 만들지 못했다(L-184). 입력기에 따라 `isComposing`·`code` 가 드물게 다르면 시험이 놓칠 수 있다(`code` 가 비는 환경은 `key` 로 알아보되 조합 중이면 무시한다).
  - `Shift + 1~6` 은 `key` 가 아니라 `code`(`Digit1`~`Digit6`)로 알아본다. 숫자 줄이 아닌 키패드(`Numpad1`)는 단축키가 아니다(기존과 같다).
  - 도움말과 실제 키는 같은 표에서 나오지만 도움말 설명 문장 자체의 정확성은 시험이 보지 못한다(Esc 행의 '녹음' 한 단어와 Shift 행의 '10–15번째 페달'만 확인).
  - 새 단축키를 더하면 `shortcutKeys.ts` 의 키 표와 도움말 행(`samples` 포함)을 함께 고쳐야 한다(Node 시험이 어긋나면 알려 준다).

---

## S2.12 튜너

- 브랜치·병합: `refactor/s2-12-tuner` → `phase/2`. 커밋 `2ce6657`(C1 — `getPitchReading`·표시 함수·기타/크로매틱 전환) · `6282190`(C2 — Node 시험) · `33c5ffb`(C3 — e2e E-16 8개와 음원 5개) · `02f5a4d`(C4 — 도달할 수 없는 동률 처리 걷어냄) · `54726c4`(C5 — 변이 시험 전 보강) · `b3dab66`(C6 — 살아남은 변이를 잡는 보강) · `d51f43c`(C7 — responsive-a11y 의 튜너 소스 단언을 새 위치로) · `e50ddd5`(정규식 단언 목록 재생성) · 이 보고서를 담은 문서 커밋(`docs(S2.12): …`). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 튜너는 마이크 입력만 읽고 소리 경로는 바뀌지 않아 기준선 JSON 은 건드리지 않았다.
- 해결 항목: R2-13(튜너가 옥타브를 구분 못 함), P-22(튜너 정확도). **설계서 '현재' 는 기준선과 달랐다**(L-186): 하한 28/55 Hz·분석 창 2.5주기·`chromatic` 프리셋은 이미 있었다. 실제 틈은 줄을 고를 때 옥타브를 접던 것(D2 → D3 '정확함')과 크로매틱·옥타브 안내를 드러낼 화면이었다.
- 변경 파일(`git diff --shortstat 638d66d HEAD`, 이 문서 커밋 전): 13 files changed, 1017 insertions(+), 196 deletions(-). 제품 `src/` — 신규 `audio/utils/tunerDisplay.ts`(`describeTuner`), 고침 `audio/utils/tunings.ts`(`getPitchReading` 다시 씀, `GUITAR_TUNING_OPTIONS`·`OCTAVE_MATCH_TOLERANCE_CENTS`·`STRING_CHECK_CENTS`), `audio/types.ts`(`PitchReading` 의 `octaveMismatch` → `octavesAbove`·`checkString`), `store/audioStore.ts`(`isSamePitch`), `components/Meter.tsx`(전환 버튼·표시 함수), `styles/panels.css`, `audio/testing/signals.ts`(음원 5개). 시험: `e2e/tests/e16-tuner.spec.ts`(신규 8개), `scripts/tuner-reading-regression.mjs`(신규, `test:tuner-reading`), `scripts/tuner-regression.mjs`(기대값 갱신·분석 창 시험), `scripts/responsive-a11y-regression.mjs`(튜너 소스 단언을 새 위치로), `docs/refactoring/regex-assertions.md`(재생성).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 표준 튜닝에서 D2(73.4 Hz) → '6번 줄 · 200센트 낮음'(예전: 'D3 · 정확함') | 충족 | e2e ①: 화면에 `D2`, `6번 줄(E2)`, `200센트 낮음`, `-200 ¢`, 상태 색 `is-far`, 목표음 칸 `6번 E2` 강조, 센트 막대 `aria-valuenow=-50`(끝에서 멈춤). Drop D 로 바꾸면 `6번 줄(D2)` `정확함`. Node: D2 → 6번 줄 E2, 센트 −200 |
| C3(130.8 Hz) → 기타 모드 '4번 줄(D3) · 200센트 낮음', 크로매틱 모드 'C3' | 충족 | e2e ②: 기타 모드 `C3` `4번 줄(D3)` `200센트 낮음`, '크로매틱' 을 누르면 `C3` `정확함` 이고 줄 이름이 없다. Node: 같은 값과 크로매틱 `stringLabel` null |
| B1(61.74 Hz) 감쇠 소리 ±2센트 | 충족 | e2e ③: 크로매틱에서 `B1` 이고 `|센트| ≤ 2`(실제 값 소수점 이하는 화면에 반올림). 기타 모드에서는 `6번 줄(E2)` `500센트 낮음`(L-189). Node: B1 을 −2~+2센트 어긋나게 넣은 읽기가 −2~+2센트 |
| 6번 줄을 맞추는데 E3 가 들어오면 '한 옥타브 높음' 안내 | 충족 | e2e ④: `E3`, `6번 줄(E2)보다 한 옥타브 높습니다`, 상태 색 `is-far`, 목표음 칸 `6번 E2`. Node: E3 가 −40~+40센트 어긋나도 안내(경계 ±49 안내, ±51 안내 없음) |
| P-22 회귀(샘플레이트 4종·개방현 정확도) | 충족 | `npm test` 의 `test:tuner`·프로브 P-22 불변(개방현 ≤0.04센트, B1·C2 0.00센트). 분석 창이 28/55 Hz 의 2.5주기 이상인 것을 8~192 kHz 에서 시험으로 추가 |
| (설계서에 없는 추가 단언) 600센트 넘게 멀면 줄 번호 확인, 기타/크로매틱 전환, 휴대폰 | 충족 | e2e ⑤ C5(523 Hz): `줄 번호를 확인하세요`, 센트 `-- ¢`, 줄 이름·목표음 강조 없음(크로매틱으로 바꾸면 `C5`). e2e ⑥: 눌림 표시·튜닝 목록 4개·크로매틱에서 목록 꺼짐+목표음 그룹 `hidden`·돌아오면 직전 튜닝(Open G). e2e ⑦: 개방 6번 줄 `정확함`. e2e ⑧: 390 px 폭에서 긴 안내가 넘치지 않음 |

**전후**

| 소리 | 전(옛 `getPitchReading`, 표준 튜닝) | 후 |
|---|---|---|
| D2 | 4번 줄 D3, 센트 0, 옥타브 확인 · 목표 D3 | 6번 줄(E2) · 200센트 낮음 |
| C3 | 2번 줄 B3, 센트 +100, 옥타브 확인 | 4번 줄(D3) · 200센트 낮음 |
| B1 | 2번 줄 B3, 센트 0, 옥타브 확인 | 6번 줄(E2) · 500센트 낮음 (크로매틱: B1 ±2센트) |
| E3 | 6번 줄 E2, 센트 0, 옥타브 확인 · 목표 E2 | 6번 줄(E2)보다 한 옥타브 높습니다 |
| A3 / D4 / E5 | 5번 줄 A2 / 4번 줄 D3 / 1번 줄 E4, 센트 0, 옥타브 확인 | 5번 줄(A2) / 4번 줄(D3) / 1번 줄(E4)보다 한 옥타브 높습니다 |
| C5 | 2번 줄 B3, 센트 +100, 옥타브 확인 | 줄 번호를 확인하세요 |
| 개방 6번 줄 E2 | 6번 줄, 정확함 | 6번 줄(E2), 정확함 (같음) |

| 항목 | 전 | 후 |
|---|---|---|
| 줄 선택 | 센트를 옥타브로 접어 가장 가까운 줄(D2 → D3 와 같음) | 접지 않고 가장 가까운 줄, 위쪽 옥타브만 안내, 600센트 넘게 멀면 확인 요청 |
| 크로매틱 | 튜닝 목록 맨 아래 | '기타/크로매틱' 버튼, 목록에는 기타 튜닝 4개 |
| 줄 문구 | `6번 줄 · 목표 E2`, `옥타브 확인 · 목표 D3` | `6번 줄(E2)` + 상태 문구 |
| 표시 문구 위치 | `Meter.tsx` 안에 흩어짐 | 순수 함수 `describeTuner`(Node 에서 모든 경우를 시험) |
| `npm test` | 42개 통과(413.3초) | 43개 통과(424.2초) |
| `npm run e2e` | 245개 통과(10.5분) | 253개 통과(11.4분 — 새 시험 8개) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e --ext .ts` 오류 0(`npm run lint` 는 전체 e2e 를 돌려 `test-results/` 를 비운 뒤에 돌렸다). 정규식 단언 목록은 `docs/refactoring/tools/list-regex-assertions.mjs` 의 출력과 같다(새 정규식 단언 없음).
  - **새 시험이 정말 잡는지**: (1) **옛 코드에 돌려 보았다**. e2e E-16 시험 파일을 옛 코드(`phase/2` 의 `638d66d`)의 빌드에 돌리면 **8개 모두 실패**한다 — 줄 이름 표시(`.tuner-string`)·전환 버튼·새 문구가 없고, 읽기값도 위 '전' 표와 같다(옛 `getPitchReading` 과 새것을 같은 소리로 나란히 돌려 표를 만들었다). 그래서 e2e 8개는 모두 '새 동작을 증명하는' 시험이다(이번에는 S2.11 과 달리 기준선이 이미 맞는 시험이 없다). (2) **변이 시험**: 63가지 결함을 하나씩 넣고 Node 시험(`tuner-reading`·`tuner`), 구현이 화면 쪽(`Meter.tsx` 17개)이면 바로 빌드해서 e2e E-16 을 돌렸다. 처음에 **59개를 잡고 4개가 살아남았다**(L-193) — 시험을 보강한 뒤 **63개 모두 잡힌다**(Node 시험 46개, e2e 17개). 사용한 변이 도구는 `/tmp` 에 있어 저장소에 넣지 않았다.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-186). 하한·분석 창·크로매틱은 이미 있었다.
  - **최종 검증의 `npm test` 에서 `test:responsive-a11y` 가 실패했다**: 튜너의 '정확함'·'높음/낮음'·센트 막대 값을 만드는 계산이 `Meter.tsx` 에서 `tunerDisplay.ts` 로 옮겨졌는데, 이 시험이 옛 위치의 문자열을 소스에서 찾고 있었다(동작 문제가 아니라 시험의 경로 문제). 변이 시험의 Node 시험 목록에 이 시험을 넣지 않아 그때는 못 봤다. 같은 문자열을 새 파일에서 찾고 Meter 가 그 값을 aria 로 쓰는지 보게 고친 뒤(`d51f43c`) 정규식 목록을 다시 만들고(`e50ddd5`) `npm test` 를 처음부터 다시 돌려 43개 모두 통과를 확인했다.
  - **시험 기대값을 내가 잘못 계산했다**: E3 를 51센트 올리면 가장 가까운 줄은 D3 가 아니라 G3(249센트)다(E3 는 D3 보다 200센트 높고 G3 보다 300센트 낮다). 코드가 아니라 시험의 계산이 틀렸고, 시험을 고쳤다.
  - **경계값 시험이 부동소수점에 걸렸다**: 5·15센트에 정확히 맞춘 입력은 읽은 값이 경계의 어느 쪽인지 정해지지 않아 변이를 못 가렸다. 경계에서 조금 떨어진 값으로 바꿨다(L-193).
  - **`hidden` 이 눈에 안 보여서 시험이 통과했다**: 크로매틱의 목표음 칸은 비어 있어(높이 0) `toBeHidden()` 이 `hidden` 속성이 없어도 통과한다. 속성을 직접 보게 했다.
- 사람 확인 필요
  - **실제 기타·마이크**: 합성한 뜯은 현 소리와 다른 실제 기타(특히 6번 줄을 낮춰 튜닝하는 중의 불안정한 소리, 배음이 센 소리)에서 줄·옥타브 안내가 안정적으로 나오는지. 옥타브 안내 경계(±50센트)·600센트 경계는 내가 정한 값이다(L-188·L-189).
  - **7현 기타·베이스**: 기타 모드는 6현 표준 계열 튜닝만 안다. 7번 줄(B1)은 크로매틱으로 본다(L-189).
  - **문구**: '6번 줄(E2)보다 한 옥타브 높습니다'·'줄 번호를 확인하세요'·'기타/크로매틱' 버튼 이름(L-191). 스크린 리더가 읽어 주는 방식(막대 `aria-valuetext`).
  - 휴대폰 실기에서 전환 버튼과 긴 안내 문구가 한 줄에 잘 들어가는지(시험은 390 px 폭 한 가지를 봤다).
- 남은 위험
  - 옥타브 안내는 소리의 '기본음'이 제대로 잡혔다는 전제다. 저음 줄은 기본음이 약해 워클렛이 한 옥타브 위를 잡는 일이 있고 그때 안내가 나온다 — 그것이 바로 이 안내의 목적이지만, 반대(실제로 한 옥타브 높게 친 것을 낮게 읽는 오류)는 아래쪽 안내를 하지 않아서 알리지 못한다(L-188).
  - 기준음(A4 400~480 Hz)은 옛 규칙 그대로이고 범위 밖 값은 440 으로 본다(시험에 추가).
  - 크로매틱에서 기타로 돌아갈 때의 직전 기타 튜닝은 저장하지 않는다(새로고침하면 Standard, L-190).

---

## S2.13 입출력 장치 자동 관리

- 브랜치·병합: `refactor/s2-13-devices` → `phase/2`. 커밋 `c87d06a`(C1 — `DeviceManager`·입력 장치 기억·출력 폴백·e2e E-17 13개·Node 시험) · `b62ccce`(C2 — 쓰지 않는 함수 제거) · `89c09e3`(C3 — 동등 변이로 확인된 쓸모없는 인자 정리) · `abb0061`(C4 — 변이 시험에서 살아남은 11개를 잡는 시험 보강) · 이 보고서를 담은 문서 커밋(`docs(S2.13): …`). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 소리를 처리하는 경로는 바뀌지 않아(출력 장치를 정하는 방법만 바뀐다) 기준선 JSON 은 건드리지 않았다.
- 해결 항목: R2-15(입출력 장치 관리가 수동). **설계서 '현재' 는 기준선과 달랐다**(L-194): `devicechange` 듣기·사라진 장치 처리·`device-lost` 정지·`setSinkId` 출력 메뉴와 출력 id 저장은 이미 있었다. 실제 틈은 입력 장치 기억·출력 장치를 못 열 때 연결을 막던 오류·이름으로 장치 찾기·권한 전 목록 처리·`devicechange` 묶기·미지원 문구였다.
- 변경 파일(`git diff --shortstat 441fef8 HEAD`, 이 문서 커밋 전): 11 files changed, 1725 insertions(+), 62 deletions(-). 제품 `src/` — 신규 `audio/devices/DeviceManager.ts`(순수 함수), 고침 `store/audioStore.ts`(입출력 기억·선택 맞추기·연결할 때 안내·`devicechange` 감시를 스토어로), `audio/AudioEngine.ts`(출력 폴백·`consumeOutputFallback`), `components/DeviceSelector.tsx`(저장된 장치 한 칸·빈 항목 숨김·미지원 문구), `components/ConnectGuitarPanel.tsx`(듣기를 스토어로), `i18n/ko.ts`(`devices` 문구), `styles/panels.css`(`.device-note`). 시험: `e2e/tests/e17-devices.spec.ts`(신규 13개), `e2e/helpers/mocks.ts`(`mockDevices`), `scripts/device-manager-regression.mjs`(신규, `test:device-manager`, 235건), `package.json`.

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| `devicechange` 모의 → 1초 안에 목록 갱신, 새로고침 버튼이 필요 없다 | 충족 | e2e ①: USB 입력·출력 장치를 더하면 1초 안에 두 메뉴에 옵션이 생기고 빼면 1초 안에 사라진다. 연달아 6번 신호가 와도 목록 읽기는 한 번의 갱신(입력+출력 2번) 이하(Node: 6번 → 1번). 이 두 번째는 옛 코드에서 실패한다(묶기 없음). 목록 갱신 자체는 기준선에 이미 있었다(L-194) |
| 연주 중 고른 장치 제거 → 세션 정지(`device-lost`) + 안내, 화면이 연결 상태로 남지 않는다 | 충족 | e2e ②: 연결한 뒤 장치를 빼면 1.5초 안에 '연결' 버튼이 돌아오고 안내 '입력 장치 연결이 끊겼습니다. 장치를 다시 연결한 뒤 연결하기를 누르세요.' 가 뜨며 '연결 해제'·Panic 버튼이 사라지고, 열려 있던 AudioContext 0개·마이크 트랙 모두 `ended`·입력 메뉴는 기본 장치. 장치를 돌려주면 기억해 둔 장치가 다시 골라진다(자동 재연결은 하지 않는다). Node: 스토어가 `isRunning` false·`inputMode` idle·기억 유지 |
| Chrome·Edge: 출력 장치를 바꾸면 그 장치로 소리가 나가고(`setSinkId`) 다음 방문에 기억된다 | 충족 | e2e ③: 연결 전에 고르면 연결할 때, 연결 중에 고르면 바로 그 장치 id 로 `setSinkId` 가 불리고 오류가 없으며, 새로고침 뒤에도 같은 장치가 골라져 있고 연결하면 그 장치로 보낸다. ④: 저장해 둔 출력 장치가 사라졌으면 연결을 막지 않고 기본 출력으로 연결하며 '저장된 출력 장치를 쓸 수 없어 시스템 기본 출력으로 연결했습니다.' 를 알리고(L-197), id 만 바뀐 장치는 이름으로 찾아 그 장치로 보낸다. 출력 `setSinkId` 와 기억은 기준선에 이미 있었다(L-194) |
| Firefox·Safari: 출력 메뉴를 숨기고 시스템 설정 안내를 보여 준다 | 충족 | e2e ⑤: `setSinkId` 가 없으면 출력 메뉴가 없고 '출력 장치는 시스템 설정에서 바꿔 주세요.' 가 보이며 연결은 된다. ⑧: 390 px 폭에서 가로로 넘치지 않는다. 문구는 설계서와 같다(L-201) |
| 고른 입력 장치를 다음 방문에 기억하고, 없으면 기본 장치 + 안내 | 충족 | e2e ⑥: 고른 장치가 새로고침 뒤에도 골라져 있고 `getUserMedia` 가 `exact:<id>` 로 요청된다. 기본 입력 장치를 고르면 기억이 지워진다. id 만 바뀐 장치는 이름으로 찾아 연결한다. 장치가 없으면 기본 장치로 연결하며 '저장된 입력 장치를 찾지 못해 기본 장치로 연결했습니다.' 를 한 번만 알리고(다음 연결에서는 없음), 장치가 돌아오면 다시 고른다 |
| (설계서에 없는 추가 단언) 마이크 권한 전의 빈 목록 | 충족 | e2e ⑦: 권한 전(id·이름이 빈 목록)에서 새로고침해도 기억한 입력·출력 장치가 지워지지 않고 이름으로 보이며(옵션은 '기본'과 기억한 장치 둘뿐, 빈 항목은 그려지지 않는다) 권한을 받은 뒤 `exact:<id>` 로 연결하고 안내가 없다(L-199) |

**전후**

| 상황 | 전(`441fef8`) | 후 |
|---|---|---|
| 고른 입력 장치를 다음 방문에 | 기본 장치로 돌아간다(기억 없음) | 같은 장치로 연결한다(`exact:<id>`). 없으면 이름으로 찾고, 그것도 없으면 기본 장치 + 안내 |
| 저장된 출력 장치가 뽑혀 있을 때 연결 | '선택한 출력 장치에 연결할 수 없습니다…' 오류로 **연결이 안 된다** | 기본 출력으로 연결되고 '저장된 출력 장치를 쓸 수 없어…' 를 알린다(L-197) |
| 장치 하나를 꽂았을 때 목록 읽기 | 신호마다 읽는다(묶지 않는다) | 120 ms 안에 온 신호를 하나로 묶어 읽는다 |
| id 가 바뀐(이름은 같은) 장치 | 못 찾아 선택이 풀린다 | 이름으로 찾아 갈아탄다(연주 중에는 분실로 본다) |
| 마이크 권한 전 목록 | (기억이 없어 해당 없음) | 판단을 보류하고 기억을 지키며 이름으로 보여 준다 |
| 출력 미지원 문구 | '이 브라우저는 출력 장치 선택을 지원하지 않습니다. 시스템 기본 출력을 사용합니다.' | '출력 장치는 시스템 설정에서 바꿔 주세요.'(설계서 문구) |
| 연결 단계에서 열지 못해 기본 장치로 내려온 선택 | (기억이 없어 해당 없음) | 장치가 목록에 계속 있어도 `devicechange` 가 되돌리지 않는다. 뽑았다 꽂으면 되돌린다(L-198) |

| 항목 | 전 | 후 |
|---|---|---|
| 장치 판단 코드 | `audioStore.ts`·`ConnectGuitarPanel` 에 흩어짐 | 순수 함수 모듈 `DeviceManager.ts`(Node 에서 모든 경우를 시험) |
| `devicechange` 듣는 곳 | 패널(마운트될 때만) | 스토어(한 번만 등록, 패널이 없어도 갱신) |
| `npm test` | 43개 통과(424.2초) | 44개 통과(443.4초) |
| `npm run e2e` | 253개 통과(11.4분) | 266개 통과(11.7분 — 새 시험 13개) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e` 오류 0(`npm run lint` 는 전체 e2e 를 돌려 `test-results/` 를 비운 뒤에 돌렸다). 정규식 단언 목록은 `docs/refactoring/tools/list-regex-assertions.mjs` 의 출력과 같다(새 정규식 단언 없음). 같은 소스를 읽는 Node 시험 22개는 따로 돌려 모두 통과를 확인했고 `npm test` 전체도 통과했다.
  - **새 시험이 정말 잡는지**: (1) **옛 코드에 돌려 보았다**. e2e E-17 시험 파일을 옛 코드(`phase/2` 의 `441fef8`)의 빌드에 돌리면 13개 중 **10개가 실패하고 3개가 통과한다**(L-204). 통과한 3개는 기준선에 이미 있던 동작을 못 박는 것이다(목록 갱신·출력 `setSinkId`·기본 장치를 고르면 기억을 지움). (2) **변이 시험**: 71가지 결함을 하나씩 넣고 Node 시험(`device-manager`·`connect-errors`·`output-device`)을 돌렸고 화면·문구 쪽은 빌드해서 E-17 도 돌렸다. 처음에 **60개를 잡고 11개가 살아남았다**(L-205) — 이 중 하나는 동등 변이라 코드를 정리했고(`89c09e3`) 나머지 10개는 시험을 보강한 뒤(`abb0061`) 모두 잡는다. 최종적으로 **70개 모두 잡힌다**(Node 시험 64개, e2e 6개). 사용한 변이 도구는 `/tmp` 에 있어 저장소에 넣지 않았다.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-194). 목록 갱신·분실 정지·출력 메뉴가 이미 있어 틈을 다시 찾아야 했다.
  - **Chromium 가짜 장치의 id 가 새로고침마다 바뀐다**: '다음 방문에도 기억' 시험이 옛 코드에서 엉뚱한 이유(id 불일치)로 실패했다. 모의가 `종류:이름` 의 안정된 id 를 주도록 다시 만들고 옛 코드에서 다시 돌렸다(L-203).
  - **연결한 뒤 출력 메뉴가 보이지 않았다**: 데스크톱에서는 연결하면 패널이 한 줄로 줄어 출력 메뉴가 숨는다. 시험이 '입력 설정' 으로 펼친 뒤 고르게 했다.
  - **Node 시험 작성 중**: `node:timers` 의 `setTimeout` 은 콜백 방식이라 `node:timers/promises` 를 써야 했고, 엔진 시험이 가짜로 바꿔 둔 `consumeOutputFallback` 대신 실제 메서드(프로토타입)를 불러야 했으며, 패널 소스 단언이 주석을 잡아 `addEventListener('devicechange'` 로 좁혔고, ESLint 가 `DOMException` 을 모르는 전역으로 보았다.
  - **쓰지 않는 함수(`resolveRememberedOutput`)** 가 남아 있어 지웠다(`b62ccce`).
- 사람 확인 필요
  - **실제 장치**: USB 오디오 인터페이스·헤드셋·블루투스를 연주 중에 뽑고 꽂았을 때 목록이 1초 안에 바뀌는지, 안내가 뜨는지, 같은 장치를 다시 꽂으면 (연주 중이 아니면) 다시 골라지는지. 브라우저·OS 마다 `devicechange` 가 오는 횟수와 시점이 다르다(L-202).
  - **`setSinkId`**: Chrome·Edge 에서 실제 출력 장치로 소리가 나가는지, Firefox·Safari 에서 출력 메뉴가 숨고 안내가 보이는지.
  - **장치 id·이름의 실제 안정성**: 같은 사이트에서 방문 사이에 id 가 같은지, 사이트 데이터를 지운 뒤에 이름으로 찾아지는지, 이름이 같은 장치가 둘일 때 어느 쪽이 골라지는지(먼저 나오는 쪽).
  - **문구와 동작 변화**: '저장된 입력 장치를 찾지 못해 기본 장치로 연결했습니다.'(설계서 문구)·'저장된 출력 장치를 쓸 수 없어 시스템 기본 출력으로 연결했습니다.'(내가 정했다, L-197)·'출력 장치는 시스템 설정에서 바꿔 주세요.', 스크린 리더 낭독. 저장된 출력 장치를 못 쓸 때 오류 대신 알림으로 연결되는 동작 변화가 괜찮은지.
- 남은 위험
  - 기억한 입력 장치가 목록에 보이는데 열리지 않으면(드라이버 문제 등) 연결할 때마다 기본 장치로 내려오고 '찾지 못해' 가 아닌 '기본 장치로 연결했습니다' 안내를 받는다. 장치를 뽑았다 꽂기 전에는 자동으로 되돌리지 않는다(L-198 ⑤, 의도한 것).
  - 연주 중에는 출력 장치 선택을 건드리지 않는다. 연주 중 출력 장치가 뽑히면 브라우저가 알아서 기본 출력으로 돌리고 화면의 출력 메뉴는 쉬는 중에 목록을 읽을 때(`devicechange`·새로고침) 맞춰진다.
  - 이름으로 찾기는 이름이 같은 다른 장치를 같은 장치로 볼 수 있다(같은 모델 두 대).

---

## S2.14 앱 아이콘과 파비콘

- 브랜치·병합: `refactor/s2-14-icons` → `phase/2`. 커밋 `4cd5710`(C1 — maskable 아이콘·`favicon.svg`·manifest `lang`/`id`·`index.html` 아이콘 링크 정리·아이콘 만드는 도구) · `812a52e`(C2 — PWA 시험을 `dist/` 의 실제 파일·PNG 크기·maskable 안전 영역 검사로, e2e E-18 6개) · 이 보고서를 담은 문서 커밋(`docs(S2.14): …`). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). 소리 처리 경로는 바뀌지 않는다(정적 파일·manifest·`index.html` 링크뿐).
- 해결 항목: R2-11(앱 설치 아이콘·파비콘 없음). **설계서 '현재' 는 기준선과 달랐다**(L-206): 192·512·apple-touch·`favicon.ico` 는 이미 있었고 설치 오류도 0건이었다. 실제 틈은 maskable·`favicon.svg`·manifest `lang`/`id`·중복 아이콘 링크·경로 문자열만 보던 PWA 시험이었다.
- 변경 파일(`git diff --shortstat 1890f7a HEAD`, 이 문서 커밋 전): 7 files changed, 411 insertions(+), 8 deletions(-). 제품 — 신규 `public/favicon.svg`·`public/pwa-512x512-maskable.png`, 고침 `vite.config.ts`(manifest `lang`·`id`·maskable 항목, `includeAssets`)·`index.html`(아이콘 링크 세 개). 도구 — 신규 `docs/refactoring/tools/make-maskable-icon.mjs`. 시험 — 고침 `scripts/pwa-regression.mjs`, 신규 `e2e/tests/e18-pwa-icons.spec.ts`. 기존 `pwa-192x192.png`·`pwa-512x512.png`·`apple-touch-icon.png`·`favicon.ico` 는 그대로다.

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 배포 사이트에서 아이콘 6종이 모두 200(현재 192·512가 404) | 부분 충족 | e2e ①: 같은 `dist/` 를 배포와 같은 base 경로로 내보내는 `vite preview` 에서 6종 모두 200 이고 content-type 이 맞다. ②: 브라우저가 모두 그림으로 읽고 PNG 선언 크기 = 실제 크기. **공개 사이트(GitHub Pages)에서의 200 은 이 환경의 네트워크 제한으로 확인하지 못했다**(L-206, L-212). 기준선에서도 192·512 는 있었다 |
| CDP `Page.getInstallabilityErrors` 결과 0건 | 충족 | e2e ⑤: 폴링 끝에 0건이고 `Page.getAppManifest` 오류도 0건. 옛 빌드에서도 0건이었다(L-206) — 이 시험은 앞으로의 회귀를 막는다 |
| PWA 테스트가 경로 문자열이 아니라 `dist/` 의 실제 파일 존재·PNG 크기를 검사 | 충족 | `pwa-regression.mjs`: 아이콘마다 `dist/` 에서 실제 파일을 읽어 PNG 헤더·선언 크기 = 실제 크기·그림 유무를 본다. maskable 은 불투명·안전 영역(반지름 0.4×폭), apple-touch 180, `favicon.ico` [16, 32], `favicon.svg` 정사각 viewBox, `index.html` 링크 정확히 3개와 파일 존재(L-211) |
| (설계서에 있는 설명) maskable 은 가운데 80% 안전 영역 안에 그림 | 충족 | Node: 그림의 가장 먼 점이 반지름 0.4×폭 이하. e2e ⑥: 캔버스 픽셀로 같은 검사 + 모서리까지 불투명. 실제 값은 187.7 px ≤ 204.8 px(L-208) |

**전후**

| 상황 | 전(`1890f7a`) | 후 |
|---|---|---|
| manifest 아이콘 | 2개(192·512, `any`) | 3개(192·512 `any`, 512 `maskable` 별도 항목) |
| manifest `lang`·`id` | 없음 | `lang: 'ko'`, `id` = `start_url`(기존 설치의 정체성 유지, L-209) |
| 파비콘 | `favicon.ico` 뿐(+ 중복 링크) | `favicon.svg` + `favicon.ico`(32 px), 링크 정확히 3개(L-210) |
| PWA 시험이 보는 것 | 경로 문자열 | `dist/` 의 실제 파일·PNG 크기·안전 영역·링크(L-211) |
| Android 설치 아이콘 | 마스크용 아이콘이 없어 플랫폼이 `any` 아이콘을 알아서 맞춘다 | 마스크용 아이콘이 있어 안전 영역 안에서 보인다(실제 기기 확인 필요) |

| 항목 | 전 | 후 |
|---|---|---|
| `npm test` | 44개 통과(443.4초) | 44개 통과(478.1초) |
| `npm run e2e` | 266개 통과(11.7분) | 272개 통과(12.5분 — 새 시험 6개) |
| 프로브 | 24개, 값 1,696개 | 24개, 값 1,696개(불변) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e` 오류 0(`npm run lint` 는 전체 e2e 를 돌려 `test-results/` 를 비운 뒤에 돌렸다). 정규식 단언 목록은 `pwa-regression.mjs` 의 줄 번호가 바뀌어 `list-regex-assertions.mjs` 의 출력으로 다시 만들었고, 새 정규식 단언은 없다. `pwa-regression`·`app-notices`·`safe-storage`·`responsive-a11y` 는 따로 돌려 통과를 확인했고 `npm test` 전체도 통과했다.
  - **새 시험이 정말 잡는지**: (1) **옛 코드에 돌려 보았다**. E-18 을 옛 코드(`phase/2` 의 `1890f7a`) 빌드에 돌리면 **6개 모두 실패한다**(L-212). 옛 빌드에서도 설치 오류는 0건이어서 ⑤ 는 아이콘 3개 단언에서만 실패한다. (2) **변이 시험**: 24가지 결함을 하나씩 넣고 빌드한 뒤 돌렸다. Node 시험이 **24개 모두**, E-18 이 **22개**를 잡고 2개(16 px 없는 `favicon.ico`·viewBox 없는 `favicon.svg`)는 E-18 이 파일 안쪽을 보지 않아 놓친다 — Node 시험의 몫이다(L-213).
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-206). 404 를 고치는 일이 아니라 빠진 것을 채우는 일이 되었다.
  - **TypeScript 오류**: E-18 에서 CDP 가 돌려주는 설치 오류 목록의 타입이 맞지 않아 `unknown[]` 로 받았다.
  - **ESLint**: `scripts/*.mjs` 에서 `Buffer` 를 전역으로 쓰면 `no-undef` 라 `node:buffer` 에서 가져왔다.
  - **단언 오타**: 처음 `pwa-regression` 에 쓸모없는 문자열 치환(`'image/maskable'.replace(…)`)이 들어가 있어 `'image/png'` 로 고쳤다.
- 사람 확인 필요
  - **공개 사이트**: 배포 뒤 `…/Guitar-Pedalboard/` 아래 `pwa-192x192.png`·`pwa-512x512.png`·`pwa-512x512-maskable.png`·`apple-touch-icon.png`·`favicon.svg`·`favicon.ico` 6개가 200 인지.
  - **실제 설치**: Android·데스크톱 Chrome 에서 '설치' 가 되고 홈 화면·작업 표시줄 아이콘이 마스크(원·둥근 사각 등)에 잘리지 않고 보기 좋은지, 이미 설치한 앱이 중복 설치 없이 그대로 업데이트되는지(`id` 를 `start_url` 과 같게 한 이유, L-209).
  - **아이폰**: 홈 화면에 추가했을 때 180 px 아이콘이 보기 좋은지.
  - **파비콘**: 탭의 16 px 에서 페달 그림이 알아볼 만한지.
  - **디자인**: 기존 아이콘의 그림을 SVG 로 옮겼다(L-207). 새 그림을 원하면 디자이너가 `favicon.svg` 의 페달 그룹을 바꾸고 도구로 maskable 을 다시 만든다.
- 남은 위험
  - 공개 사이트가 지금 404 를 준다면 그 원인은 이 저장소의 파일이 아니라 배포(base 경로·Pages 설정)일 수 있다. 그 경우 이 Step 으로는 고쳐지지 않는다.
  - `id` 를 `start_url` 과 같게 두었으므로 나중에 `base`(배포 주소)를 바꾸면 설치된 앱의 정체성도 바뀐다.
  - 안전 영역은 '지름 80% 원' 으로 읽었다. 플랫폼마다 마스크가 달라(원·둥근 사각·네모) 실제 기기에서 보지 않으면 모른다.

---

## S3.1 Delay·Reverb Mix — 원음은 그대로, 효과음만 더하기

- 브랜치·병합: `refactor/s3-1-additive-mix` → `phase/3`(이 Step 에서 `phase/2` 의 끝 `0eccbc5` 에서 만들었다). 커밋 `8fe91a8`(C1 — `mixLaw` 옵션·`mixGains`·Node 시험 `test:mix-law`) · `04e9cc0`(C2 — 변이 시험에서 드러난 헛도는 소스 단언 보강) · 이 보고서를 담은 문서 커밋(`docs(S3.1): …`). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다). **소리는 바뀌지 않는다**(L-215).
- 해결 항목: R3-7(Delay·Reverb Mix가 원음을 줄임). **설계서 '현재' 는 기준선과 달랐다**(L-215): 딜레이·리버브의 원음은 이미 1.0 이었고 P-15 는 0 dB 였다. 이 Step 의 실제 일은 합성 방식을 형 이름 분기에서 `mixLaw` 옵션으로 올리고 시험으로 못 박는 것이다.
- 변경 파일(`git diff --shortstat 0eccbc5 HEAD`, 이 문서 커밋 전): 6 files changed, 287 insertions(+), 8 deletions(-). 제품 — 신규 `src/audio/nodes/mixLaw.ts`(순수 함수), 고침 `BaseEffect.ts`(생성자 옵션 `mixLaw`, 목표 게인을 `mixGains` 로)·`DelayEffect.ts`·`ReverbEffect.ts`(`{ mixLaw: 'additive' }`). 시험 — 신규 `scripts/mix-law-regression.mjs`, `package.json`(`test:mix-law`).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| P-15: Delay Mix 30%에서 원음 레벨 변화 0 ± 0.1 dB(현재 −3 dB). Reverb도 같음 | 충족(이미 충족이었다) | 프로브 P-15: `delay.dryChangeDb` 0·`reverb.dryChangeDb` 0·`delay.pcDryChangeDb` 0, 44.1·48 kHz 모두. 기준선과 같다(L-217). Node 시험이 같은 값을 소리 없이 지킨다: 딜레이·리버브의 원음 게인 목표값은 Mix 10·30·60·100% 모두 1(0 dB) |
| 두 페달을 쓰는 프리셋의 음량 변화를 기록 | 충족 | 변화 0 dB. 전체 프로브(P-05 포함)가 기준선과 같다 — 숫자 1,576개 중 P-17 의 시간 측정 33개만 다르고 나머지 1,543개는 같다(L-217·L-218) |
| (설계서 S3.1 변경) 나머지 이펙트는 지금 방식 그대로 | 충족 | Node: 드라이브·크런치·퍼즈·EQ 는 원음 = 1 − Mix, 효과음 = Mix. 소스 단언: `mixLaw` 를 고르는 클래스는 딜레이·리버브 둘뿐 |

**전후**

| 상황 | 전(`0eccbc5`) | 후 |
|---|---|---|
| 딜레이·리버브의 원음 | 1.0(`this.type === 'delay' \|\| … 'reverb'` 로 분기) | 1.0(`mixLaw: 'additive'` 를 고른다) — 소리는 같다 |
| 합성 방식을 정하는 곳 | `BaseEffect` 안의 형 이름 분기 | 생성자 옵션 `mixLaw`(기본 `crossfade`) + 순수 함수 `mixGains` |
| 새 페달이 딜레이처럼 원음 위에 얹으려면 | `BaseEffect` 를 고쳐 형 이름을 더한다 | 그 클래스가 `{ mixLaw: 'additive' }` 를 고른다 |
| 합성 규칙의 시험 | 프로브 P-15 하나(소리로만) | P-15 + Node 시험 `test:mix-law` 144건(게인 목표값·소스 단언) |

| 항목 | 전 | 후 |
|---|---|---|
| `npm test` | 44개 통과(478.1초) | 45개 통과(438.1초) |
| `npm run e2e` | 272개 통과(12.5분) | 272개 통과(12.1분 — 화면을 바꾸지 않았다) |
| 프로브 | 24개 | 24개, 기준선과 같다(P-17 의 시간 측정만 매번 달라진다) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e` 오류 0(`npm run lint` 는 전체 e2e 를 돌려 `test-results/` 를 비운 뒤에 돌렸다). 정규식 단언 목록은 `list-regex-assertions.mjs` 의 출력과 같다(새 정규식 단언 없음). 페달 클래스를 불러 쓰는 다른 Node 시험 12개도 `npm test` 전체에서 통과했다.
  - **새 시험이 정말 잡는지**: (1) **옛 코드에 돌려 보았다**(L-219): 새 API 를 직접 보는 73건은 옛 코드에 없는 모듈이라 성립하지 않고, 동작만 보는 71건은 옛 코드에서도 통과한다(동작이 기준선에 이미 있었다). (2) **변이 시험**: 20가지 결함을 하나씩 넣고 Node 시험을 돌려 **20개 모두 잡았다**. 처음에는 한 변이(형 이름 분기 되살리기)를 엉뚱한 단언이 잡고 있어 헛도는 소스 단언을 찾아 고쳤다(`04e9cc0`).
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-215). 소리를 고치는 일이 아니라 구조를 정리하는 일이 되었다.
  - **서브클래스 필드는 생성자 안에서 아직 없다**: 합성 방식을 필드로 두면 `BaseEffect` 가 처음 라우팅을 맞출 때 읽지 못한다. 생성자 인자로 받게 했다(L-216).
  - **가짜 오디오 컨텍스트**: 처음 만든 가짜가 `AudioWorkletNode`(퍼즈의 게이트)와 `new GainNode(...)`(코러스)를 몰랐다. 앞의 것은 가짜 클래스를 더했고 뒤의 것은 이 시험에서 코러스를 빼고 소스 단언으로만 보기로 했다(L-217).
  - **헛도는 소스 단언**: `split('applyRouting')[1]` 이 첫 호출 줄 뒤의 짧은 조각만 읽고 있었다(L-219).
- 사람 확인 필요
  - 없다 — 소리가 바뀌지 않았다. Phase 3 전체의 청취 확인(설계서 6.5)에서 딜레이·리버브를 켠 프리셋의 원음이 줄어들지 않는지 한 번 더 들어 보면 된다.
- 남은 위험
  - 딜레이·리버브의 Mix 를 100% 로 올리면 원음 1.0 + 효과음 1.0 이 더해져 최대 +6 dB 가 된다. 기준선에서도 그랬고(마스터 리미터와 리버브·딜레이의 자체 보정이 맡는다) 이 Step 은 바꾸지 않았다. 필요하면 S3.8 의 음량 보정에서 다룬다.
  - `hasTrails` 가 아직 형 이름('delay'·'reverb')을 본다. 꼬리를 남기는 페달이 늘면 같은 방식의 옵션으로 올린다.

---

## S3.2 Cab 좌우 대칭과 무작위 성분 줄이기

- 브랜치·병합: `refactor/s3-2-cab-ir` → `phase/3`. 커밋 `a8fddcf`(C1 — 120 ms 디바운스 + 20 ms 페이드 교체, 렌더 시각 타이머, Node 시험 `test:cab-swap`) · `77e68be`(C2 — 페이드를 `fadeParam` 으로, 프로브 P-25) · `ebd3081`(P-25 수용 기준) · `1052a89`(`baseline:` P-25 신규 기준선) · `d34c62b`(변이 시험에서 살아남은 셋을 시험에 추가) · 이 보고서를 담은 문서 커밋(`docs(S3.2): …`). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다).
- 해결 항목: R3-2(Cab 좌우 음량 차), D7. **설계서 '현재' 는 기준선과 달랐다**(L-220): 좌우 IR 은 이미 같고 P-09 는 0 dB 였으며 기본 설정의 응답 편차는 3 dB 이하였다. 이 Step 의 실제 일은 변경 3(노브 조작 중 클릭 없애기)이다.
- 변경 파일(`git diff --shortstat 66b3f32 HEAD`, 이 문서 커밋 전): 13개, 신규 3개, +919 / −45줄. 제품 — 고침 `CabEffect.ts`(IR 교체 상태 기계: 디바운스·페이드·교체·되살리기, 타이머 주입)·`smoothing.ts`(`fadeParam`)·`offline/renderChain.ts`·`offline/effectFactory.ts`(렌더 시각 타이머 배선)·`audio/testing/probes.ts`(P-25), 신규 `utils/timers.ts`·`offline/contextTimers.ts`. 시험 — 신규 `scripts/cab-swap-regression.mjs`, 고침 `cabinet-ir-regression.mjs`·`latency-regression.mjs`·`package.json`(`test:cab-swap`), `docs/baseline/`(P-25 기준선·수용 기준).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| 마이크 위치 노브를 끄는 동안 클릭음이 없음(출력 1차 차분 피크 증가 +6 dB 이하 ★) | 충족 | 새 프로브 P-25: 44.1 kHz 최대 +3.66 dB·48 kHz 최대 +2.28 dB(드래그 구간만 0.0~2.6 dB). 이전 코드 +23 dB(L-223·L-224) |
| P-09: 80 Hz~5 kHz 단일 음에서 좌우 음량 차 0.5 dB 이하(현재 최대 14 dB) | 충족(이미 충족이었다) | 프로브 P-09 0 dB, 기준선과 같다. Node 시험이 5개 모델 × 4가지 설정의 좌우 IR 이 비트 단위로 같음을 지킨다(L-220) |
| P-04(Cab 음량 보정) 유지 | 충족 | 프로브 P-04 기준선과 같다(기본 +0.04 / +0.04 dB, 최대 0.17 / 0.19 dB) |
| (변경 2) 1/3 옥타브 평활 응답 대비 편차 3 dB 이하 ★ | 충족(이미 충족이었다) | 기본 설정에서 5개 모델 모두 3 dB 이하(최대 Jensen 2.83 dB). Node 시험이 지킨다. 마이크·거리 끝값에서는 3.2~7.5 dB(마이크 위치가 응답을 바꾸는 것이라 무작위 성분 문제가 아니다, L-220) |

**전후**

| 상황 | 전(`66b3f32`) | 후 |
|---|---|---|
| 마이크 위치·거리·모델·사용자 IR 을 바꿀 때 | 컨볼버 버퍼를 바로 교체(클릭, P-25 최대 +23 dB) | 컨볼버 가지를 20 ms 에 내리고 교체한 뒤 20 ms 에 되살린다(P-25 최대 +3.7 dB) |
| 마이크·거리 노브를 끄는 동안 | 입력마다 IR 을 다시 만든다(31번 = 클릭 31번) | 마지막 입력 120 ms 뒤 한 번만 만든다 |
| 꺼졌다가 같은 설정으로 돌아올 때 | IR 을 다시 만든다 | 컨볼버에 남은 IR 을 그대로 쓴다(소리는 같다) |
| 오프라인 렌더(프로브)의 타이머 | 이펙트가 창 타이머를 쓰는 곳은 리버브뿐(렌더 도중 바뀌지 않는다) | 렌더 시각으로 재는 타이머를 이펙트에 넘길 수 있다 |

| 항목 | 전 | 후 |
|---|---|---|
| `npm test` | 45개 통과(약 8분) | 46개 통과(414.4초) |
| `npm run e2e` | 272개 통과(12.5분) | 272개 통과(11.4분 — 화면을 바꾸지 않았다) |
| 프로브 | 24개, 값 1,696개 | 25개(P-25 추가), 값 1,714개(기존 값 불변, P-17 의 시간 측정만 매번 달라진다) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e` 오류 0(`npm run lint` 는 전체 e2e 뒤에 돌렸다). 정규식 단언 목록은 `list-regex-assertions.mjs` 의 출력과 같다.
  - **새 시험이 정말 잡는지**: (1) **이전 코드에 P-25 를 돌려 보았다** — 최대 +23.1 / +23.2 dB(L-224). (2) **변이 시험**: Node 시험에 38개, 프로브에 4개 — 모두 잡았다(처음 3개가 살아남아 시험을 보강했다). 잡지 못하는 것은 실제 시계 어긋남을 흡수하는 10 ms 여유 하나뿐이다.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-220): 변경 1·2 는 이미 되어 있었다.
  - **`rampParam` 이 Chrome 에서 페이드가 아니다**(L-222): 리버브의 방식을 재사용하라는 설계서를 그대로 따르면 클릭이 되었다. P-25 가 알려 주었고 `fadeParam` 으로 피했다. **새 결함 F-5(고치지 않음)**: 같은 패턴이 입력 게인·마스터·프리셋 trim·리버브 교체·페달 켜기 끄기에도 있다.
  - **시험 하네스**: 오프라인 렌더에서 타이머를 쓰려면 렌더 도중 멈춰 콜백을 실행해야 한다(`suspend`). 타이머는 요청한 시간보다 일찍 울리면 안 되어 올림하고, 지금 퀀텀 안에는 걸 수 없어 최소 한 퀀텀 뒤로 했다(L-221). 기존 Node 시험 둘은 '바로' 확인하던 것을 타이머를 비운 뒤 확인하게 고쳤다(L-225).
  - **변이 하나가 기존 시험을 무한 반복에 빠뜨렸다**: 시간 제한으로 잡았고 새 시험은 단언으로 잡는다(L-224).
- 사람 확인 필요
  - **실제 기기에서 노브를 끌 때 클릭이 없는지, 소리가 바뀌는 데 약 0.14초가 걸리는 것이 거슬리지 않는지** 들어 본다(오프라인 렌더로만 재었다). Phase 3 전체의 청취 확인(설계서 6.5)에서 Cab 모델 5개를 돌려 보며 같이 확인하면 된다.
  - **F-5**: 실시간에서도 `rampParam` 이 끊김으로 들리는지(입력 게인·마스터 볼륨을 움직일 때, 리버브 모드를 바꿀 때, 페달을 켜고 끌 때) 한 번 확인한다.
- 남은 위험
  - 컨볼버가 새 IR 로 바뀌면 입력 이력이 비어 있어 되살리는 20 ms 동안 응답이 채워지는 과도 구간이 남는다. 두 컨볼버를 크로스페이드하면 없앨 수 있지만 설계서 범위 밖이고 CPU 가 두 배가 된다.
  - 사용자 IR 을 고르면 약 20 ms 뒤에 소리가 들어온다(전에는 바로).

---

## S3.3 Delay Tape 모드 흔들림 줄이기

- 브랜치·병합: `refactor/s3-3-tape-flutter` → `phase/3`. 커밋 `1ee48cd`(와우·플러터 두 LFO, Node 시험 `test:delay-tape`, 프로브 P-26, P-10·P-26 수용 기준) · `c6ba79b`·`5c5f3b0`(P-26 허용 오차·셋째·넷째 반복음 기준을 되먹임 루프 퀀텀 지연에 맞춤, F-6) · `3877958`(`baseline:` P-10 갱신·P-26 신규) · `cca2387`(`baseline:` P-05 Tape 프리셋 2개, L-231) · `298b99b`(두 LFO 를 합산 게인으로 모아 꽂음, L-232) · `2cef4e4`(`baseline:` P-10 minHz 끝자리) · 이 보고서를 담은 문서 커밋(`docs(S3.3): …`). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다).
- 해결 항목: R3-3(Tape 음정 흔들림). **설계서 '현재' 는 기준선과 달랐다**(L-226): 코드는 이미 지연 깊이 0.2 ms 였고 P-10 은 ±0.55% 로 수용 기준을 맞추고 있었다. 이 Step 의 실제 일은 와우·플러터 두 LFO 로 나누는 것이다.
- 변경 파일(`git diff --shortstat f0fa7c1 HEAD`, 이 문서 커밋 전): 6 files changed, 479 insertions(+), 40 deletions(-). 제품 — 고침 `DelayEffect.ts`(와우·플러터 두 LFO 와 깊이 상수 내보내기)·`audio/testing/probes.ts`(P-26). 시험 — 신규 `scripts/delay-tape-regression.mjs`, 고침 `package.json`(`test:delay-tape`), `docs/baseline/`(P-10 갱신·P-26 신규·수용 기준·허용 오차).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| P-05 유지(설계서 매 Step 뒤 확인) | 충족 | 값 27개가 움직였고 15개가 허용 오차를 넘었다(0.01~0.10 dB, Tape 프리셋 둘만, L-231). 편차는 ±1 dB 안(최대 0.969 dB)이라 수용 기준(±2 dB)에 여유가 있다. 기준선 갱신, 트림은 S3.8 |
| P-10: 1 kHz 반복음의 순간 주파수 편차 ±0.6% 이하(약 ±10센트) | 충족(이미 충족이었고 더 좋아졌다) | 44.1 kHz ±0.415%·48 kHz ±0.392%(전 ±0.55%). 기준선 `tolerances.json` 의 `criteria` 에 걸었다 |
| Ambient Delay·Tape Swell 청취: 멀미 나는 음정 흔들림 없이 테이프 질감이 남는다 | **사람 확인 필요** | 들어 보지 못했다(L-227). 숫자는 설계서의 것(와우 ±0.3%·플러터 ±0.1%) |
| (선택) 핑퐁 타이밍: 첫 반복이 T/2, 120 BPM 1/4 에서 반복이 500·1,000·1,500 ms | 일부 충족·설계서 모순(L-228) | 프로브 P-26: 250 / 750 / 1,250 / 1,750 ms 를 좌·우·좌·우로(첫 반복 T/2 충족). '500·1,000·1,500' 는 핑퐁이 아닌 모드의 시각이다. 셋째 이후는 루프 퀀텀 지연 때문에 최대 +2.9 ms(F-6, L-229) |

**전후**

| 상황 | 전(`f0fa7c1`) | 후 |
|---|---|---|
| Tape 의 지연 흔들림 | 단일 LFO 4.2 Hz·0.2 ms(±0.53%) | 와우 0.8 Hz·0.597 ms(±0.3%) + 플러터 6.5 Hz·0.0245 ms(±0.1%) |
| P-10 1 kHz 반복음의 순간 주파수 | 994.6~1,005.5 Hz(±0.55%) | 996.5~1,004.2 Hz(44.1 kHz, ±0.415%)·996.4~1,003.9 Hz(48 kHz, ±0.392%) |
| Tape 가 아닐 때의 LFO | 0.1 Hz 로 천천히, 깊이 0 | 두 LFO 모두 같은 주파수로 돌고 깊이만 0(주파수를 바꾸지 않아 위상이 튀지 않는다) |
| 핑퐁 반복음 시각 | (재지 않았다) | 250 / 750 / 1,250(+0 또는 한 퀀텀) / 1,750(+한 퀀텀) ms 를 프로브 P-26 이 잰다 |

| 항목 | 전 | 후 |
|---|---|---|
| `npm test` | 46개 통과(약 7분) | 47개 통과(422.0초) |
| `npm run e2e` | 272개 통과(11.4분) | 272개 통과(11.7분 — 화면을 바꾸지 않았다) |
| 프로브 | 25개, 값 1,714개 | 26개(P-26 추가), 값 1,730개(P-10 4개 값과 P-05 27개 값(Tape 프리셋 둘)이 바뀌고 P-26 이 늘었으며 나머지 값은 불변, P-17 의 시간 측정만 매번 달라진다) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e` 오류 0(`npm run lint` 는 전체 e2e 뒤에 돌렸다). 정규식 단언 목록은 `list-regex-assertions.mjs` 의 출력과 같다.
  - 전체 프로브를 한 번 더 돌려 기준선 숫자 1,730개 중 P-17(렌더 시간 측정 38개 — 매번 달라져 따로 규칙을 둔다, L-168)을 뺀 1,692개를 견주니 **1,689개가 완전히 같고** 셋만 허용 오차 안에서 달랐다: P-10 `minHz` 둘(0.02·0.03 Hz — 합산 게인으로 모은 뒤 부동소수점 끝자리, `baseline:` 커밋으로 갱신)과 P-26 셋째 반복음(한 퀀텀, F-6).
  - **새 시험이 정말 잡는지**: (1) **이전 코드와 비교** — P-10 ±0.55% → ±0.4%, P-26 은 같은 값(L-230). (2) **변이 시험**: `DelayEffect` 에 35개 — **34개를 잡았다**. 살아남은 하나는 같은 값을 다시 쓰는 동등 변이.
- 만난 문제
  - **설계서 '현재' 가 기준선과 달랐다**(L-226): 수용 기준(P-10)은 이미 충족이었다.
  - **설계서의 핑퐁 타이밍 문장이 모순이다**(L-228): 첫 반복 T/2 와 500·1,000·1,500 ms 는 함께 될 수 없다. T/2 규칙(M-7)이 이미 지켜지고 있음을 확인하는 쪽으로 읽었다.
  - **새 결함 F-6(고치지 않음)**(L-229): 되먹임 루프 한 바퀴마다 Chrome 이 렌더 퀀텀(2.7~2.9 ms)을 더 늦추고, 그것이 실행마다 있거나 없다. 처음에는 기준선이 실행마다 어긋났다(P-26 셋째 반복음 1,250.0 또는 1,252.7). 허용 오차(새 프로브에만 ±3.2 ms)와 기준으로 흡수했다.
  - **두 LFO 를 따로 꽂으면 오프라인 렌더가 비결정적이 되었다**(L-232): 전체 프로브를 다시 돌려 P-18 의 널 값이 −200 ↔ −123.8 dB 로 흔들리는 것을 보고 알았다. 합산 게인 하나로 모아 꽂아 고쳤다(커밋 `298b99b`, 6번 모두 −200).
  - **첫 `npm test` 에서 `test:probe` 가 P-05 때문에 실패했다**(L-231): Tape 프리셋 둘의 음량이 허용 오차를 넘어 움직여서다. 의도한 소리 변화이고 수용 기준에 여유가 있어 P-05 만 `baseline:` 커밋으로 갱신했다(트림 재계산은 S3.8). 위 `npm test` 47개 통과는 그 갱신과 합산 게인 수정(L-232) 뒤의 두 번째 전체 검증이다.
  - **프로브 하네스**: `--skip-build` 는 이전 빌드를 쓰므로 새 프로브(P-26)를 만들 때는 빼야 한다('없는 프로브' 오류로 알았다).
- 사람 확인 필요
  - **Ambient Delay·Tape Swell 프리셋을 들어 본다**(설계서의 '귀로 맞춘다'): 멀미 나는 음정 흔들림 없이 테이프 질감이 남는지. 질감이 약하면 와우·플러터 깊이(`TAPE_WOW_DEPTH_S`·`TAPE_FLUTTER_DEPTH_S`)를 조금 올려도 ±0.6% 까지 여유가 있다(지금 ±0.4%).
  - **F-6**: 실제 연주에서 딜레이 반복 간격(특히 Slapback 과 짧은 시간)이 거슬리는지.
  - **새 프로브의 허용 오차**: `tolerances.json` 의 규칙 `P-26.tap*.ms`(±3.2 ms)를 사람이 승인해 주기 바란다(L-229).
- 남은 위험
  - 두 LFO 의 지연 변조는 샘플 단위 보간 없이 DelayNode 의 `delayTime` 을 쓰므로 Chrome 이 지연을 보간해 주는 것에 기댄다(P-10 이 실제 소리로 확인한다).
  - F-6 은 모든 딜레이 모드에 해당하고 고치지 않았다.

---

## S3.4 Flanger·Phaser 워클릿

- 브랜치·병합: `refactor/s3-4-flanger-phaser-worklet` → `phase/3`. 커밋 `62bf11d`(Phaser 1차 올패스 워클릿·active·Node 시험·P-11/P-12/P-17 기준) · `faafebe`·`284b64a`(변이 시험 보강) · `166bf17`(`baseline:` P-03·P-11·P-12) · `fb2dba1`(계수 8샘플마다·P-17 4단/12단) · `e32f3bf`(`baseline:` P-17) · 이 보고서를 담은 문서 커밋(`docs(S3.4): …`). **main 에는 병합하지 않는다**(병합하면 Pages 가 자동 배포된다).
- 해결 항목: R3-4(Flanger·Phaser 피드백 2.7 ms 지연), R4-2(Phaser CPU). **R3-4 의 원인은 이미 없었다**(두 이펙트 모두 이미 샘플 단위 피드백 워클릿, L-233·L-234). 이 Step 의 실제 일은 Phaser 를 고른 단수만 계산하는 1차 올패스로 다시 쓰고 꺼진 상태의 계산을 없애는 것이다.
- 변경 파일(`git diff --shortstat e90b5b0 HEAD`, 이 문서 커밋 전): 8 files changed, 660 insertions(+), 110 deletions(-). 제품 — 고침 `worklets/phaser-processor.ts`(전체)·`nodes/PhaserEffect.ts`(active 예약)·`nodes/BaseEffect.ts`(상수 내보내기)·`audio/testing/probes.ts`(P-11 sweep.comb, P-12 modelError, P-17 4단/12단). 시험 — 고침 `scripts/phaser-regression.mjs`·`scripts/flanger-regression.mjs`, `docs/baseline/`(P-03·P-11·P-12·P-17 갱신·수용 기준).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| P-05 유지(설계서 매 Step 뒤 확인) | 충족 | 값이 허용 오차(±0.05 dB) 안이라 갱신하지 않았다(L-235) |
| P-11: 지연 2 ms 고정에서 첫 노치 250 Hz ±5% | 충족 | 247.6 Hz(44.1 kHz)·252.0 Hz(48 kHz). `criteria` 에 걸었다 |
| P-11: 기본 LFO 한 주기 동안 첫 노치 약 177~425 Hz(44.1·48 kHz 모두) | 충족(기본값 스윕은 측정이 흔들려 보조 지표로 재었다, L-233) | `sweep.comb`: 172.3~419.9 Hz(44.1 kHz)·175.8~421.9 Hz(48 kHz). Node 시험이 두 샘플레이트에서 지연 2.825/1.175 ms 확인 |
| P-12: 설계한 노치·공진 밖의 빗살 리플 ≤ 3 dB ★ | **해석에 따라 충족** — `modelErrorDb` 0.93 dB(44.1·48 kHz), 원래 지표 `combRippleDb` 는 10.6 / 9.7 dB 로 3 dB 초과 | 설계한 공진(7.2 kHz 부근 +14 dB)이 이동 평균보다 좁지 않아 남은 값(L-234). **사람의 승인 필요** |
| P-17: 꺼진 Phaser 의 렌더 시간 기여 0 | 사실상 충족 — 0.088 → 0.013(44.1 kHz)·0.073 → 0.011(48 kHz) | 남은 0.01 안팎은 워클릿 노드 호출 최소 비용(L-236). `criteria` ≤ 0.04 |
| P-17: 켠 상태는 고른 단수에 비례 | **시간으로는 보이지 못했다** | 단 계산이 싸서 4단 대 12단 시간 비 1.3~1.5. 고른 단만 계산하는 것은 Node 시험이 상태로 확인(L-237) |
| Flanger·Phaser 프리셋 청취: 움직이는 '제트' 소리 | **사람 확인 필요** | 들어 보지 못했다. 노치 수가 절반이 되어 결이 달라졌다(L-235) |

**전후**

| 상황 | 전(`e90b5b0`) | 후 |
|---|---|---|
| Phaser 구조 | 2차 올패스(biquad) 12단을 항상 계산 → 4·6·8·12단째 탭(12 ms) | 1차 올패스를 고른 단수까지만 계산, 탭 가중치 합 1 을 20 ms 에 걸쳐 이동 |
| 꺼진 Phaser | 입력이 있으면 계속 계산(렌더 시간 기여 0.088 / 0.073) | `active` 0 이면 계산 생략, 상태 비움(0.013 / 0.011) |
| 켠 Phaser(6단) | 0.088 / 0.076 | 0.032 / 0.029 |
| P-12 노치 개수(6단, 피드백 90%) | 6 | 3 |
| P-12 `combRippleDb` | 17.1 / 16.6 dB | 10.6 / 9.7 dB |
| P-12 `modelErrorDb`(새 지표) | 13.6 / 13.0 dB | 0.93 / 0.93 dB |

| 항목 | 전 | 후 |
|---|---|---|
| `npm test` | 47개 통과(약 7분) | 47개 통과(467.5초) |
| `npm run e2e` | 272개 통과(11.5분) | 272개 통과(11.6분 — 화면을 바꾸지 않았다) |
| 프로브 | 26개, 값 1,730개 | 26개, 값 1,750개(P-11 6개·P-12 4개·P-17 10개가 늘고 P-03 4개·P-12 14개 값이 바뀌었다) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e` 오류 0(`npm run lint` 는 전체 e2e 뒤에 돌렸다). 정규식 단언 목록은 `list-regex-assertions.mjs` 의 출력과 같다.
  - 전체 프로브를 한 번 더 돌려 기준선 숫자 1740개 중 P-17(38개, 렌더 시간 측정이라 매번 달라진다, L-168)을 뺀 1702개를 견주니 1701개는 **완전히 같고** 1개(48 kHz P-03 `peakWithoutLimiterDb` 68.399 → 68.4 dB)만 반올림 차이 0.001 dB 로 다르다(P-03·P-11·P-12 포함, 허용 범위 안).
  - **새 시험이 정말 잡는지**: (1) **이전 코드와 비교** — L-239. (2) **변이 시험**: Phaser 44개 중 **43개**, Flanger 5개 중 **4개**를 잡았고 나머지는 동등 변이(L-239).
- 만난 문제
  - **44.1 kHz 의 P-11 스윕이 수용 범위를 벗어났다**(L-233): 프로세서가 아니라 기본값 노치가 얕아 측정이 흔들린 것이다.
  - **P-12 의 원래 지표는 3 dB 에 이르지 못했다**(L-234): 설계한 공진·노치가 지표의 이동 평균 폭보다 좁지 않다. 설계 전달함수와의 차이를 새 지표로 걸었다.
  - **시간으로는 '단수에 비례' 를 보이지 못했다**(L-237). 단 계산이 싸서 고정 비용에 묻힌다.
  - 처음 구현은 샘플마다 sin·exp·tan 을 불러 켠 Phaser 가 0.060 이었다 → 계수 8샘플마다로 0.030 안팎(최종 기준선 0.032 / 0.029).
- 사람 확인 필요
  - **Flanger·Phaser 를 쓰는 프리셋을 들어 본다**(설계서 수용 기준): 움직이는 '제트' 소리가 나는지. Phaser 는 노치 수가 절반이 되어 결이 달라졌다(6단 기준 6 → 3개). 부족하면 단수 기본값을 6 → 8 로 올리는 쪽이 옛 소리에 가깝다.
  - **P-12 해석 승인**(L-234): `modelErrorDb ≤ 3 dB` 로 갈음해도 되는지, 아니면 피드백 경로에 고역 감쇠를 넣어 원래 지표 `combRippleDb` 를 3 dB 로 맞추는 설계 변경을 별도 Step 으로 할지.
  - **켜고 끌 때 딸깍 소리**: 끌 때 게이트가 닫힌 뒤 워클릿을 멈추도록 했으니(L-236) 실기기에서 Phaser 를 빠르게 켜고 끄며 클릭이 없는지 확인한다(P-23 은 바이패스 클릭을 재지만 Phaser 가 켜진 상태에서 재지 않는다).
- 남은 위험
  - Phaser 가 꺼지면 상태를 비우므로 다시 켤 때 필터가 빈 상태에서 시작한다(게이트가 12 ms 에 걸쳐 열려 들리지 않아야 하나 실기기 확인이 필요하다).
  - 꺼진 상태의 남은 비용(0.01)은 S4.2 에서 그래프에서 떼어야 없어진다.

---

## S3.5 Drive·Crunch 이득 곡선과 노브 범위

- 브랜치·병합: `refactor/s3-5-drive-crunch-curves` → `phase/3`. 커밋 `6c92eee`(Distortion 이득·`withBias`·Bias ±0.3·P-27) · `38898a0`(`DriveEffect` 곡선 재생성 시험) · `6abcf57`(공장 프리셋 트림 14개 재계산) · `52876ae`(변이 시험 보강) · `2ae6d80`(`baseline:` P-03·P-05·P-13·P-14·P-23 갱신, P-27 추가).
- 해결 항목: R3-5(Distortion 이 낮은 노브에서 무왜곡), 10월 계획서 M-2(Bias 의 DC·데드존·무음). **R3-6(Crunch Gain 이 20~30% 에서 최대)은 재현되지 않아 해결할 것이 없었다**(L-241).
- 변경 파일(`git diff --shortstat 0912cbb HEAD`, 이 문서 커밋 전): 10 files changed, 1022 insertions(+), 387 deletions(-). 제품 — 고침 `audio/utils/curves.ts`(`distortionGain`·`withBias`·`DRIVE_BIAS_LIMIT`, 곡선 4097개·최종 클램프 ±2)·`audio/nodes/DriveEffect.ts`(바이어스 갱신 문턱 0.005)·`audio/params/definitions/drive.ts`(Bias ±0.3)·`components/effects/DrivePedal.tsx`(슬라이더가 ParamDef 를 읽음)·`audio/testing/probes.ts`(P-13·P-14 지표 추가, P-27 신규)·`presets/factoryTrims.json`(14개 트림). 시험 — 새 `scripts/drive-curve-regression.mjs`·`package.json`(`test:drive-curve`). 기준 — `docs/baseline/audio-probe.json`·`tolerances.json`(`criteria` 7개).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| P-05 유지(설계서 매 Step 뒤 확인) | 충족 — **트림을 다시 계산한 뒤** | 다시 계산하기 전에는 편차 3.02 / 2.88 dB·전환 5.74 / 5.28 dB·리미터 1.80 / 1.82 dB 로 S1.4c 기준 셋이 깨졌다. 트림 14개를 고친 뒤 0.54 / 0.97 dB·3.23 / 2.99 dB·0.94 / 0.98 dB(L-244) |
| P-13: Distortion THD 가 노브를 따라 단조 증가 | 충족 | 0 → 7.9 → 19.4 → 27.8 → … → 43.1%(한 칸 최소 0.16%p). `criteria` `minStepPercent ≥ 0` |
| P-13: 노브 30% 에서 같은 위치 Overdrive 이상 | 충족 | 27.8% 대 20.9%(+6.9%p, 수정 전 −3.3). 노브 10% 부터 모든 칸에서 최소 +1.9%p(`minAheadOfOverdrive`) |
| P-14: Crunch THD 가 10% 간격마다 증가, 구간당 ≥ 1%p ★ | **이미 충족 — 고치지 않았다** | 한 칸 최소 1.47%p(−18 dBFS). −12 dBFS 에서는 0.81%p(90~100% 포화, 참고). R3-6 은 재현되지 않았다(L-241) |
| Bias 전 범위 무음 없음(RMS ≥ −30 dBFS) | 충족 | P-27 `minRmsDb` −19.79 / −19.80 dBFS(수정 전 Bias ±1 은 −142 ~ −200). Bias ±1 은 ±0.3 과 같은 소리(`clampDiffDb` 0) |
| 곡선의 0점 값 = 0(DC 없음) | 충족 | Node 시험이 곡선 1,260개에서 `curve[2048] === 0`(수정 전 곡선은 0.05 넘게 벗어남을 재현) |
| 해당 프리셋 청취 / 프리셋 값 조정 여부를 사람에게 묻기 | **사람 확인 필요** | 듣지 못했다. 프리셋 값은 바꾸지 않았다(L-247) |

**전후**

| 상황 | 전(`0912cbb`) | 후 |
|---|---|---|
| Distortion 이득(노브 0 / 20 / 50 / 100%) | 0.2 / 6.2 / 34.4 / 254.6배 | 6.5 / 13.5 / 40.7 / 255배(로그 간격). 노브 68~100% 는 옛 값의 +9% 이내 |
| Distortion THD(노브 10 / 20 / 30%) | 0 / 0 / 22.2% | 7.9 / 19.4 / 27.8% |
| 같은 위치 Overdrive THD(10 / 20 / 30%) | 8.2 / 18.2 / 25.5% | 6.0 / 14.0 / 20.9%(Bias 의미 변경, L-242) |
| Bias 범위 | ±1, 입력에 `0.35·bias` 를 먼저 더함 | ±0.3, 이득 뒤에 더하고 `shape(bias)` 를 뺌 |
| 곡선의 입력 0 출력 | Bias 가 있으면 0 이 아님(0.05 넘게 벗어남) | 항상 정확히 0 |
| Bias ±1 의 출력(P-27) | −142 ~ −200 dBFS(무음) | −19.8 dBFS 이상 |
| 곡선 표본 수 | 4096 | 4097(x = 0 이 표본) |
| P-05 최대 편차·전환·리미터(44.1 kHz) | (S3.5 코드 + 옛 트림) 3.02 dB·5.74 dB·1.80 dB | 0.54 dB·3.23 dB·0.94 dB |

| 항목 | 전 | 후 |
|---|---|---|
| `npm test` | 47개 통과(467.5초) | 48개 통과(439.4초) |
| `npm run e2e` | 272개 통과(11.6분) | 272개 통과(12.1분 — 화면 구성을 바꾸지 않았다) |
| 프로브 | 26개, 값 1,750개 | 27개, 값 1,826개(P-27 48개·P-14 24개·P-13 4개가 늘고 P-03 6개·P-05 281개·P-13 44개·P-23 8개 값이 바뀌었다) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e` 오류 0(`npm run lint` 는 전체 e2e 뒤에 돌렸다). 정규식 단언 목록은 `list-regex-assertions.mjs` 의 출력과 같다.
  - 전체 프로브를 한 번 더 돌려 새 기준선과 견줬다: 27개 프로브 전체의 값 1,826개가 기준선과 일치했다(413.5초, 허용 오차 규칙 안). P-17 의 렌더 시간도 이번에는 허용 안에 들었다(L-168 의 흔들림은 그대로 가능).
  - **새 시험이 정말 잡는지**: (1) **이전 코드와 비교** — L-243 에 적었다(`0912cbb` + 새 프로브로 P-13·P-14·P-27 의 옛 값을 얻었다). (2) **변이 시험**: 35개 중 처음 33개를 잡았고 살아남은 C16·C18 은 단언을 보강해 **모두 잡는다**(L-246).
- 만난 문제
  - **Bias 의미를 바꾸자 P-05 가 어긋났다**: Overdrive 에 Bias 가 큰 프리셋(blues-lead 0.14)의 출력이 3 dB 가까이 올라 편차·전환·리미터 기준 셋이 깨졌다 → 트림을 다시 계산했다(L-244). S3.8 이 하는 일을 조금 앞당긴 것이다.
  - **R3-6 이 재현되지 않았다**(L-241): 설계서가 '20~30% 에서 최대' 라고 쓴 현상이 기준선에는 없었다. 귀로 들었을 때의 이야기일 수 있다.
  - **설계서의 '노브 30%까지 0%' 는 '20%까지' 가 맞다**(L-240). 또 설계서의 최종 클램프 ±1 은 바이어스를 빼면 한쪽이 1.3 까지 가므로 ±2 로 늘렸다(L-242).
  - 시험 숫자 보정: Distortion 이득이 옛 값과 '7% 안' 이라 쓴 가정이 틀려(노브 60% 에서 +11.7%) 단언을 노브 68~100% 의 +10% 이내로 바꿨다. 곡선이 Float32 라 끝에서 끝까지 폭의 오차 한도를 1e-12 → 1e-6 으로 고쳤다.
- 사람 확인 필요
  - **Drive 를 쓰는 프리셋 청취**(설계서 수용 기준): blues-lead·texas-push·soulful-neck·solo-boost(Overdrive + Bias)는 더 대칭인 소리로 달라졌고, Distortion 프리셋은 거의 같다. 프리셋의 Bias 를 올려 옛 소리에 맞출지 정한다(L-247).
  - **Distortion 낮은 노브**: 노브 0~30% 가 옛보다 훨씬 많이 깨진다(노브 0 이 6.5배). 의도에 맞는지 듣는다.
  - **Crunch Gain 이 정말 20~30% 에서 최대로 들리는지**(R3-6): 들린다면 taper 를 따로 손본다.
- 남은 위험
  - 트림은 새 소리에 맞췄을 뿐 소리의 성격은 그대로 바뀌어 있다. 프리셋 값을 바꾸면 트림을 다시 계산해야 한다(`npm run trims`).
  - 저장된 사용자 프리셋의 Bias 가 ±0.3 보다 큰 경우 불러올 때 ±0.3 으로 잘려 소리가 달라진다(옛 소리가 이미 거의 무음이던 구간이다).
  - S3.7(오버샘플링 4배 → 2배)에서 곡선 모양이 한 번 더 달라질 수 있다(`oversample` 은 이 Step 에서 이미 2x 였다).

---

## S3.6 Compressor 직접 구현

- 브랜치·병합: `refactor/s3-6-compressor-worklet` → `phase/3`. 커밋: 905e275(플래그·워클릿 새 경로·Node 시험), 4f0bc11(P-28·수용 기준), c0faeae(기준선), 597628d(변이 시험 보강)
- 해결 항목: R3-1(Compressor Mix 빗살)·D5 일부. **R3-1 의 원인(6 ms 룩어헤드)은 이미 없었다**(L-248). 이 Step 의 실제 일은 기능 플래그 모듈과 컴프레서 새 경로(자동 메이크업 제거 등)다.
- 변경 파일(`git diff --shortstat a536930 HEAD`, 이 문서 커밋 전): 8개 파일, +714 −3줄. 제품 — 새 `config/flags.ts`·고침 `audio/worklets/compressor-processor.ts`(경로 2 추가, 경로 1 그대로)·`audio/nodes/CompressorEffect.ts`(플래그 읽기)·`audio/testing/probes.ts`(P-28). 시험 — 새 `scripts/compressor-v2-regression.mjs`·`package.json`(`test:compressor-v2`). 기준 — `docs/baseline/audio-probe.json`·`tolerances.json`(`criteria` 4개).

| 수용 기준 | 결과 | 근거 |
|---|---|---|
| P-05 유지(설계서 매 Step 뒤 확인) | 충족 — 값이 그대로 | 기본값이 꺼져 있어 프리셋 소리가 같다(전체 프로브 기준선 일치) |
| P-08: 0.1~1 kHz 리플 ≤ ±0.5 dB — Mix 75%·45% | **이미 충족**(옛 경로 0.006 / 0.004 dB), 새 경로도 충족(0.004 / 0.002 dB) | 설계서의 '현재 2.2 dB, 11 dB' 는 이 저장소에 없었다(L-248). `criteria` `P-28.mix*.rippleDb ≤ 0.5` |
| 'Headphone Safe Start'(Mix 45%) 6번·2번 줄 개방음 감소 ≤ 1 dB | 충족(간접) | Mix 45% 리플 0.002 dB 라 홈이 없다. 음 단위로는 재지 않았다 |
| P-16: Compressor 처리 지연 0 샘플 | **이미 충족** | 옛 경로 `latencyMs.compressor` 0.998 ms = 빈 체인(리미터 1 ms)과 같음. 새 경로 추가 지연 0(`criteria` `≤ 0.01 ms`) |
| GR 표시 = 워클릿 실측값(P-21) | **새 경로 충족, 옛 경로(현재 기본값)는 아님** | 새 경로 표시−실측 +0.91 dB(`criteria` ±1.5). 옛 경로는 −11.05 dB(자동 메이크업). 기본값을 켜면 해결된다 |
| 38개 프리셋의 음량 변화 기록 | 충족 | 38개, 새 − 옛 −0.02 ~ −8.02 dB, 중앙값 −4.4 dB(P-28 `presetDeltaDb.*`, L-251) |
| 청취 승인 | **사람 확인 필요** | 듣지 못했다. 기본값은 꺼져 있다(L-253) |

**전후**

| 상황 | 전(`c0faeae` 이전) | 후 |
|---|---|---|
| 플래그 시스템 | 없음 | `src/config/flags.ts`, `?ff=newCompressor`, 기본값 꺼짐 |
| 컴프레서 워클릿 | 피크 검출기·자동 메이크업(최대 +12 dB)·GR 20 Hz | 같음(경로 1, 기본값) + 경로 2: 5 ms RMS·메이크업 없음·GR 30 Hz(플래그 켬) |
| 표시 감소량 − 실제 출력 변화(−10 dBFS 지속음, Mix 100%) | −11.05 dB | 경로 1 −11.05 dB(그대로), 경로 2 +0.91 dB |
| 프리셋 음량(Compressor 켜진 38개) | 기준 | 경로 2: −0.02 ~ −8.02 dB |

| 항목 | 전 | 후 |
|---|---|---|
| `npm test` | 48개 통과(439.4초) | 49개 통과(563.0초) |
| `npm run e2e` | 272개 통과(12.1분) | 272개 통과(11.9분 — 화면을 바꾸지 않았다) |
| 프로브 | 27개, 값 1,826개 | 28개, 값 1,926개(P-28 100개가 늘었다. 기존 값은 모두 같다) |

- 검증
  - `npm run typecheck`·`npm run lint`·`npx tsc -p tsconfig.e2e.json --noEmit`·`npx eslint e2e` 오류 0(`npm run lint` 는 전체 e2e 뒤에 돌렸다). 정규식 단언 목록은 `list-regex-assertions.mjs` 의 출력과 같다.
  - 전체 프로브를 한 번 더 돌려 새 기준선과 견줬다: 기준선과 일치(527.0초, 28개 프로브)
  - **새 시험이 정말 잡는지**: (1) **이전 코드 비교** — 옛 경로가 코드에 남아 있어 P-28 이 새·옛을 한 실행에서 나란히 잰다(L-252). (2) **변이 시험**: 32개 중 처음 26개를 잡았고 살아남은 6개는 단언을 보강해 **모두 잡는다**(L-252).
- 만난 문제
  - **설계서의 '현재' 가 이 저장소와 달랐다**(L-248): 6 ms 지연 네이티브 컴프레서는 없다. 수용 기준 대부분이 이미 충족이라, 이 Step 은 자동 메이크업·플래그 같은 남은 틈만 메웠다.
  - **RMS 검출기의 '시작이 덜 눌림' 가정이 처음엔 틀렸다**: 짧은 버스트·클릭은 RMS 가 5 ms 동안 기억해 오히려 더 오래 누른다. 지속음 시작 직후(첫 128 표본)만 덜 눌리므로 시험을 그 모양으로 바꿨다.
  - **피크 검출기의 사인 감소량이 −14.6 dB**(−15 아님): 사인의 골짜기마다 레벨이 내려가 평균이 덜 눌린다. RMS 검출기는 −15.0 에 가깝다(허용 0.5 dB).
  - 표시 감소량 − 실제 변화가 0 이 아니라 +0.9 dB 남는다: 220 Hz 처럼 낮은 음을 5 ms RMS 가 따라 흔들려서다. `criteria` 를 ±1.5 dB 로 걸었다.
- 사람 확인 필요
  - **새 경로를 들어 본다**(설계서 수용 기준): `?ff=newCompressor` 로 열어 Compressor 프리셋을 옛 경로와 번갈아 듣는다. 승인하면 기본값을 켠다(L-253).
  - **수동 메이크업이 필요한가**(L-250): 새 경로에서 압축을 세게 걸면 조용해진다.
- 남은 위험
  - 기본값이 꺼져 있는 동안 두 경로가 코드에 공존한다(옛 경로는 다음 릴리스에서 지운다). 옛 경로를 고칠 일이 생기면 두 군데를 봐야 한다.
  - 기본값을 켜면 프리셋 38개의 음량이 달라지므로 `npm run trims` 를 같은 때 돌려야 P-05 기준이 지켜진다(S3.8).

---
