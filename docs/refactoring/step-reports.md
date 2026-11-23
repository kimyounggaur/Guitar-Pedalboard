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
  - **실제 하울링**(스피커 + 마이크)에서 자동 정지와 안내가 뜨는지. 감지 방식은 S1.5 에서 바뀐다.
  - 토스트가 휴대폰 화면에서 도크·페달을 가리지 않는지(위치는 S1.7 에서 다듬음).
  - USB 오디오 장치를 연결한 채 뽑았을 때 '입력 장치 연결이 끊겼습니다' 안내.
- 남은 위험
  - 하울링 감지기는 아직 출력 쪽·−22 dBFS 방식이다(S1.5 에서 입력 쪽 −50 dBFS·±20 cents 로 교체). 정지 문구의 주파수(`StopDetail.howlFrequencyHz`)는 그때 채운다.
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
  - 판정용 레벨 폴링은 S1.5 에서 `onChannelLevels` 직접 호출로 바뀐다(L-25). 그때 P-06·E-02 를 다시 돌려 확인한다.
  - 프로브가 새 `P-06` 정의를 쓰므로 이전 기준선과 키가 다르다(L-28). 별도 `baseline:` 커밋으로 갱신했다.

---
