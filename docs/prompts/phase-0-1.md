# Guitar Pedalboard 리팩토링 — Claude Code 작업 지시문 (Phase 0~1)

> 「Guitar Pedalboard 리팩토링 설계 문서 v1.0」의 Phase 0(안전망)과 Phase 1(안전과 핵심 조작)을 **Claude Code 세션 14번**으로 실행하기 위한 지시문 모음이다. Step 하나에 지시문 하나이며, 각 블록을 새 세션에 그대로 붙여 넣으면 된다. 브랜치 이름은 미리 채워 두었다.

| 항목 | 내용 |
|---|---|
| 기준 문서 | `docs/refactoring-design.md`(설계 문서 v1.0을 저장소에 넣은 것) |
| 범위 | S0.1~S0.4, S1.1~S1.8(S1.4는 a·b·c) — 14개 |
| 지시문 형식 | 설계서 부록 D 템플릿: 역할 → 목표 → 먼저 읽을 것 → 작업 → 하지 말 것 → 검증 → 완료 기준 → 멈추고 물어볼 조건 → 보고 형식 → 공통 규칙 |
| 결정 사항 | 설계서 2장의 기본 가정(D1~D16)을 따른다. 바꾼 결정이 있으면 지시문 맨 끝에 한 줄 덧붙인다(아래 0.5) |

## 목차

- [0. 사용법](#0-사용법)
- [1. Phase 0 — 안전망](#1-phase-0--안전망)
- [2. Phase 1 — 안전과 핵심 조작](#2-phase-1--안전과-핵심-조작)
- [3. Phase 1 마무리](#3-phase-1-마무리)

---

## 0. 사용법

### 0.1 준비 (한 번만)

1. 설계 문서 `guitar-pedalboard-refactoring-design.md`를 저장소의 `docs/refactoring-design.md`로, 이 파일을 `docs/prompts/phase-0-1.md`로 넣고 main에 커밋한다.
2. main에서 통합 브랜치 `phase/0`을 만든다. Phase 0이 끝나면 main에서 `phase/1`을 만든다.
3. Step 브랜치는 그 Phase의 통합 브랜치에서 만들고, PR도 통합 브랜치로 보낸다. Phase가 끝나면 `phase/N` → main PR로 한 번에 배포한다.
   - 이유: main에 병합하면 GitHub Pages가 바로 배포된다. 'Phase 단위 배포'(설계서 0.3-3)를 지키려면 통합 브랜치가 필요하다.
4. S0.2가 끝나면 GitHub 설정에서 main과 `phase/*`에 'verify 통과 필수' 브랜치 보호 규칙을 켠다.
5. 로컬에서 E2E·프로브를 돌리려면 Chrome이 있어야 한다. S0.4 뒤에는 `npx playwright install chromium`도 한 번 실행한다.

### 0.2 세션 진행표

| 순서 | Step | 브랜치 | 선행 | 규모 | 사람이 할 일 |
|---|---|---|---|---|---|
| 1 | S0.1 코드 지도 | `refactor/s0-1-code-map` | — | S | 보고의 '설계서를 고쳐야 할 점' 검토 |
| 2 | S0.2 CI 게이트 | `refactor/s0-2-ci-gate` | S0.1 | S | 브랜치 보호 규칙 켜기 |
| 3 | S0.3 렌더 프로브 | `refactor/s0-3-render-probe` | S0.2 | L | — |
| 4 | S0.4 E2E 하네스 | `refactor/s0-4-e2e-harness` | S0.3 | M | — |
| — | Phase 0 마무리 | `phase/0` → main | S0.1~S0.4 | — | PR 병합(앱 변화 없음) |
| 5 | S1.1 Crunch 곡선 | `refactor/s1-1-crunch-curve` | Phase 0 | S | 세 프리셋에서 줄을 막고 30초 듣기 |
| 6 | S1.2 정지 정리 | `refactor/s1-2-session-teardown` | Phase 0 | M | — |
| 7 | S1.3 입력 채널 | `refactor/s1-3-input-stage` | S1.2 | M | (가능하면) 2입력 인터페이스 1번 입력으로 확인 |
| 8 | S1.4a 리미터 | `refactor/s1-4a-limiter` | Phase 0 | M | — |
| 9 | S1.4b Cab 보정 | `refactor/s1-4b-cab-makeup` | S1.4a | S | S1.4c와 같은 배포에 넣기 |
| 10 | S1.4c 프리셋 음량 | `refactor/s1-4c-preset-trims` | S1.4b | M | 'Headphone Safe Start' 예외 여부 결정(D6) |
| 11 | S1.5 출력 가드 | `refactor/s1-5-output-guard` | S1.2, S1.3, S1.4a | L | (가능하면) 휴대폰으로 작은 음량 하울링 시험 |
| 12 | S1.6 휴대폰 도크 | `refactor/s1-6-mobile-dock` | S1.5 | M | 실제 휴대폰으로 확인 |
| 13 | S1.7 저장 안전 | `refactor/s1-7-safe-storage` | Phase 0 | M | — |
| 14 | S1.8 노트북 배치 | `refactor/s1-8-desktop-layout` | S1.6 | L | 카드 배치를 크게 바꿀 때 Figma 시안 확인 |
| — | Phase 1 마무리 | `phase/1` → main | 위 전부 | — | 3장 사람 확인 → v2.1.0 배포 |

- S0.4는 설계서와 달리 S0.3 **뒤에** 한다. 가짜 마이크로 쓰는 WAV 파일을 S0.3이 만들기 때문이다.
- S1.7은 Phase 0만 끝나면 언제 해도 된다. 흰 화면 문제를 먼저 막고 싶으면 S1.1 바로 다음에 해도 좋다. S1.2는 토스트를 최소 형태로 만들고, S1.7이 그것을 확장한다.

### 0.3 한 Step의 흐름 (매번 같음)

1. 통합 브랜치를 최신으로 받은 뒤 **새 Claude Code 세션**을 연다(이전 대화 없이).
2. 해당 Step 블록을 통째로 붙여 넣는다.
3. 세션이 '멈추고 물어볼 조건'에 걸려 질문하면 답한다. 판단이 어려우면 "설계서 기본 가정대로"라고 답한다.
4. 끝나면 보고(변경 파일·완료 기준 표·전후 비교·남은 위험)와 PR 본문 초안을 읽는다.
5. **또 다른 새 세션**에서 0.4의 검증 프롬프트로 완료 기준을 다시 확인한다. 만든 세션이 스스로 채점하지 않게 하려는 것이다.
6. 통과하면 push → 통합 브랜치로 PR → 병합.
7. 규모 L Step이 한 세션에 끝나지 않으면 같은 브랜치에서 0.4의 '이어서 하기' 프롬프트로 계속한다.

### 0.4 공통 보조 프롬프트

**검증 프롬프트**(모든 Step 공통 — `{Step ID}`만 바꾼다):

```text
docs/refactoring-design.md 와 docs/prompts/phase-0-1.md 의 {Step ID} '완료 기준'을 하나씩 직접 확인해 줘.
- 코드는 고치지 마. 확인만 한다.
- 실행: npm run typecheck && npm run lint && npm test, 그리고 기준에 적힌 프로브(npm run probe -- --only ...)와 시나리오(npm run e2e -- --grep ...).
- 각 기준마다 통과/실패와 근거(실행한 명령과 출력 요약, 파일·줄, 스크린샷 경로)를 적는다.
- 사람이 들어 봐야 하는 항목은 '사람 확인 필요'로 표시한다.
- 지시문에 없던 변경(범위 밖 파일 수정, 저장 키 변경, 기준선 완화)이 있으면 따로 적는다.
마지막에 표 하나로 보고해: | 기준 | 결과 | 근거 |
```

**이어서 하기 프롬프트**(규모 L Step이 한 세션에 끝나지 않았을 때):

```text
브랜치 {Step 브랜치}에서 {Step ID} 작업을 이어서 한다.
먼저 git log 와 git diff {통합 브랜치}...HEAD 로 지금까지 한 일을 확인하고,
docs/prompts/phase-0-1.md 의 {Step ID} 지시문에서 아직 끝나지 않은 작업과 완료 기준만 이어서 해.
범위·하지 말 것·멈추고 물어볼 조건·보고 형식·공통 규칙은 처음 지시문과 같다.
```

### 0.5 결정을 바꿨을 때

설계서 2장의 기본 가정과 다르게 정한 것이 있으면, 해당 지시문 맨 끝에 한 줄을 덧붙인다. 예:

```text
[결정 변경] D6: 프리셋 기준 음량은 −18 dBFS. 'Headphone Safe Start'만 −24 dBFS.
[결정 변경] D16: Playwright 대신 기존 CDP 코드를 분리해 재사용.
```

### 0.6 모든 지시문에 들어 있는 공통 규칙

각 블록 끝에 같은 내용이 들어 있다(브랜치 이름만 다름). 여기서 한 번 설명한다.

- 기준 문서는 `docs/refactoring-design.md`다. 지시문과 설계서가 다르면 세션이 멈추고 묻는다.
- 시작하기 전에 읽은 내용을 바탕으로 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다(추가는 지시문이 허락한 것만). 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가(지시문에 적힌 것 제외), git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 사람이 허락할 때만 한다.
- 줄 번호는 커밋 `4ac9cf7` 기준이고, S0.1 이후에는 `docs/refactoring/code-map.md`가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.

---

## 1. Phase 0 — 안전망

고치기 전에 지금의 소리와 화면을 수치로 기록하고, 테스트가 배포를 막을 수 있게 만든다. **이 Phase에서는 앱 동작을 바꾸지 않는다**(타입을 넓히는 것만 예외).

### S0.1 코드 지도 갱신과 현황 조사

```text
[역할]
너는 Web Audio·React/TypeScript 코드베이스를 분석하는 시니어 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard 에서 작업한다.

[목표]
리팩토링 설계서의 모든 Step이 가리키는 코드 위치를 실제 코드와 맞춰 '코드 지도'를 만들고, 저장 형식과 테스트 현황을 조사한다. 이 Step에서는 앱 코드를 한 줄도 고치지 않는다.

[먼저 읽을 것]
- docs/refactoring-design.md 전체(특히 0.4절, 3장, 4.7절, 5장 각 Step의 '대상 파일')
- package.json, src/ 폴더 구조, scripts/ 의 테스트 14개

[작업]
1. git log -1 --format=%h 를 확인한다. 4ac9cf7 이 아니면 보고 첫 줄에 적고, 아래 모든 위치를 실제 코드 기준으로 다시 찾는다.
2. docs/refactoring/code-map.md 를 만든다. 설계서 5장의 Step(S0.1~S5.6)마다 행을 두고
   | Step | 설계서의 대상 파일·줄 | 실제 경로·함수·줄 범위 | 상태(확인됨 / 위치 다름 / 없음) |
   를 채운다. '(추정)'이라고 적힌 경로는 실제 경로로 바꿔 적는다.
3. 같은 파일에 '현황' 절을 만들고 다음을 기록한다.
   a. 저장 키 목록(guitar-pedalboard:* 전부)과 각 값의 구조(예시 JSON)
   b. PedalState 의 실제 타입 정의와 위치
   c. 팩토리 프리셋 40개의 정의 위치와 프리셋 객체 구조
   d. MIDI 매핑 저장 형식
   e. 단축키 1~9가 '체인 위치' 기준인지 '이펙트 종류' 기준인지
   f. 이펙트 15종의 기본 순서와 기본 상태(enabled·bypassed 값)
   g. Compressor 의 파라미터 키 목록과 범위(Attack·Sustain·Ratio·Tone·Mix 등)
4. 테스트 14개를 '동작 검증' / '소스 문자열 검사'로 나누고, assert.match(소스, …) 같은 정규식 단언의 위치를 파일·줄로 모두 목록화한다. 합계를 보고서 수치(337곳)와 비교한다.
5. e2e/fixtures/storage-v1/ 에 v1 저장 데이터 픽스처 6종을 실제 저장 형식 그대로 JSON으로 만든다.
   1) 기본 상태만  2) 사용자 프리셋(enabled·bypassed 4가지 조합)  3) 깨진 JSON  4) 꺼진 페달 Mix 0
   5) Reverb decay 7.5  6) Bypass를 대상으로 한 MIDI 매핑
   가능하면 앱을 실행해 localStorage 를 덤프하고, 어려우면 저장 코드를 읽어 그 형식대로 만든다. 어느 방법을 썼는지 적는다.
   같은 폴더에 README.md 를 두고 픽스처마다 어떤 상황인지 한 줄씩 적는다.
6. 프리셋 이름 가운데 특정 제품·브랜드를 떠올리게 하는 표현을 목록으로 만든다(설계서 D3 검토용, 판단은 하지 않는다).

[하지 말 것]
- src/ 코드 수정(이 Step은 문서와 픽스처만 만든다)
- 상표·법률에 대한 판단

[검증]
$ git diff --stat            # 변경이 docs/ 와 e2e/fixtures/ 에만 있어야 한다
$ npm run typecheck && npm run lint

[완료 기준]
- code-map.md 에 5장 모든 Step의 대상 경로가 '확인됨' 또는 '위치 다름(실제 위치 기재)'으로 표시됨
- 저장 키·타입·MIDI 형식이 마이그레이션 픽스처로 바로 쓸 수 있을 만큼 구체적임
- 정규식 단언 합계가 337곳과 같거나, 다르면 이유가 적혀 있음
- 픽스처 6종과 README 가 있음

[멈추고 물어볼 조건]
- 커밋이 4ac9cf7 과 달라 설계서 내용과 크게 어긋날 때(어긋나는 Step 목록과 함께)
- 설계서가 말하는 기능·파일이 아예 없을 때

[보고 형식]
1) 기준 커밋  2) code-map 요약(확인됨 / 위치 다름 / 없음 개수, '없음' 목록)  3) 현황 a~g 요약
4) 정규식 단언 합계  5) 픽스처 목록  6) 설계서를 고쳐야 할 점

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/0 에서 refactor/s0-1-code-map 을 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S0.2 테스트 일괄 실행과 CI 게이트

```text
[역할]
너는 Vite 프로젝트와 GitHub Actions 테스트 인프라를 맡은 시니어 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
테스트 14개를 한 명령으로 돌리고, PR과 배포 전에 CI가 typecheck·lint·test 를 실행해 실패하면 배포를 막게 한다. 앱 동작은 바꾸지 않는다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S0.2, 6.4절, 0.3절
- docs/refactoring/code-map.md 의 S0.2 행
- package.json, .github/workflows/deploy.yml(32~35행), scripts/responsive-a11y-regression.mjs(250~253행), scripts/*.mjs

[작업]
1. 테스트가 이미 쓰는 esbuild 를 devDependencies 에 추가한다(버전은 lockfile·node_modules 에 있는 것과 맞춘다).
2. package.json 에 "engines": { "node": ">=22" } 를 넣고, CI 의 Node 버전도 22 이상으로 고정한다.
3. scripts/run-all-tests.mjs 를 만든다. package.json 의 test:* 스크립트를 이름순으로 하나씩 실행하고, 결과(통과/실패·걸린 시간)를 한 줄씩 출력하며, 하나라도 실패하면 종료 코드 1을 낸다. "test": "node scripts/run-all-tests.mjs" 를 추가한다.
4. responsive-a11y-regression.mjs: process.env.CI === 'true' 인데 Chrome(또는 WebSocket)이 없으면 'skipped'를 출력하고 통과하던 것을 실패로 바꾼다. CI 가 아닌 로컬에서는 지금처럼 건너뛰어도 된다.
5. .github/workflows/verify.yml 을 새로 만든다. on: pull_request(모든 브랜치), push(main, phase/**). 단계: npm ci → typecheck → lint → test. ubuntu 러너의 Chrome 경로를 CHROME_PATH 환경변수로 넘긴다.
6. deploy.yml: build 앞에 typecheck → lint → test 를 넣거나 verify 를 needs 로 건다. 테스트가 실패하면 배포 단계가 실행되지 않아야 한다.

[하지 말 것]
- 테스트 단언 내용 수정(실행 방식만 바꾼다)
- 배포 대상과 base 경로(VERCEL 분기) 변경
- esbuild 외 의존성 추가

[검증]
$ npm ci && npm test                          # 14개 결과 줄, 종료 코드 0
테스트 하나를 임시로 깨서 npm test → 종료 코드 1 확인 → 되돌린다
$ CI=true CHROME_PATH=/no/such/chrome npm run <responsive-a11y 스크립트 이름>   # 실패해야 한다
워크플로 파일은 actionlint 가 있으면 검사하고, 없으면 YAML 문법만 확인한다

[완료 기준]
- npm test 한 번에 14개 결과가 나오고, 하나를 일부러 깨면 종료 코드 1
- main 배포 워크플로가 테스트 실패 시 배포하지 않음
- PR에서 verify 가 돈다(브랜치 보호 규칙은 사람이 GitHub 설정에서 켠다)

[멈추고 물어볼 조건]
- CI 러너에서 Chrome을 찾을 방법이 없을 때
- 기존 테스트가 지금 이미 실패하고 있을 때(어느 것인지 보고)

[보고 형식]
1) 변경 파일  2) npm test 출력 요약  3) 일부러 깬 테스트와 결과  4) 워크플로 변경 요약
5) 내가 GitHub 설정에서 할 일(브랜치 보호 규칙 항목)

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/0 에서 refactor/s0-2-ci-gate 를 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가(이 Step의 esbuild 제외), git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S0.3 오디오 렌더 프로브와 기준선

```text
[역할]
너는 Web Audio DSP를 측정하는 테스트 하네스를 만드는 시니어 오디오 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
실제 이펙트 클래스와 워클릿을 OfflineAudioContext 에서 돌려 소리를 수치로 재는 '오디오 렌더 프로브'와 기준선을 만든다. DSP 동작은 바꾸지 않는다 — 지금의 결함이 그대로 기준선에 기록돼야 한다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S0.3, 6.2절(프로브 목록 P-01~P-23), 부록 A(기준 신호), 0.4절
- docs/refactoring/code-map.md
- src/audio/nodes/BaseEffect.ts 와 이펙트 클래스 생성자들(src/audio/nodes/*Effect.ts)
- src/audio/AudioEngine.ts(loadWorklets 499~513행, createProcessingGraph 554~577행), src/audio/worklets/*.ts
- src/store/presetStore.ts(팩토리 프리셋), vite.config.ts, scripts/responsive-a11y-regression.mjs(Chrome 탐색·CDP 코드)

[작업]
1. 타입 넓히기: 이펙트 생성자의 컨텍스트 타입을 AudioContext → BaseAudioContext 로(BaseEffect.ts:14, :32 등). 동작 변화는 없어야 한다.
2. src/audio/testing/signals.ts: 부록 A의 신호(REF-PC, REF-NOISE, REF-DECAY, REF-SINE, REF-SINES, REF-IMPULSE, H-1~H-4, G-1~G-3)를 고정 시드로 결정적으로 만드는 함수. 같은 신호를 WAV로 저장하는 scripts/make-fixture-wavs.mjs → e2e/fixtures/*.wav(S0.4의 가짜 마이크용, 48 kHz, 스테레오 신호는 채널별로 다르게 만들 수 있게).
3. 오프라인 렌더 공통 코드는 src/audio/offline/ 에 둔다(나중에 앱의 '음량 맞추기'도 같이 쓴다). 테스트 전용 측정 코드는 src/audio/testing/renderProbe.ts 에 둔다.
   - 하네스: OfflineAudioContext(2, 샘플레이트 × 길이, 샘플레이트) → 워클릿 등록 → 실제 이펙트 클래스로 체인 구성(프리셋 적용 포함) → 렌더
   - 측정 함수: RMS·피크(dBFS), FFT 전달함수와 리플, THD, 순간 주파수, 노치 추적, 임펄스 지연, 렌더 소요 시간
4. probe.html: vite --mode test 빌드에서만 build.rollupOptions.input 에 포함한다. 결과는 window.__probe 에 JSON으로 둔다.
5. scripts/lib/chrome.mjs: responsive-a11y-regression.mjs 의 Chrome 탐색·CDP 코드를 분리한다(새 의존성 없이). responsive-a11y 테스트도 이것을 쓰게 바꾼다(동작은 같게).
6. scripts/audio-render-probe.mjs: vite preview --mode test 로 띄운 probe.html 을 헤드리스 Chrome 으로 열어 결과를 받는다. 44100 Hz와 48000 Hz 두 번. 옵션 --only P-01,P-04(일부만), --update(기준선 갱신).
7. 지금 잴 수 있는 프로브를 구현한다: P-01~P-06, P-08~P-18, P-20~P-23(정의는 설계서 6.2절 표). P-07·P-19 는 새 구성 요소가 필요하므로 만들지 않는다. 지금 구조로 잴 수 없는 항목은 이유와 함께 'pending' 으로 둔다.
8. docs/baseline/audio-probe.json(기준선)과 docs/baseline/tolerances.json(항목별 허용 오차)을 만들고, 기준선 대비 허용 오차를 넘으면 실패하는 비교기를 만든다.
9. package.json: "probe": "node scripts/audio-render-probe.mjs", 그리고 npm test 가 probe 를 포함하게 한다.

[하지 말 것]
- 이펙트의 곡선·연결·파라미터 기본값 등 DSP 동작 변경(타입 넓히기만 허용)
- 측정값이 보고서와 다르다고 코드를 고치기(다르면 보고만)
- 새 의존성 추가(브라우저 실행은 scripts/lib/chrome.mjs 로)

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run probe                          # 두 번 연속 실행해 결과 차이가 허용 오차 안인지 확인
$ npm run probe -- --only P-04,P-15
$ node scripts/make-fixture-wavs.mjs && ls e2e/fixtures/*.wav

[완료 기준]
- 기준선 JSON에 잴 수 있는 프로브 전부 × 샘플레이트 2개가 기록됨
- 기록값이 보고서 현상과 같은 방향: P-01 잡음 증폭이 큼(잡음 출력과 연주음 차 약 10 dB), P-04 Cab 켬/끔 차 약 15 dB, P-05 프리셋 분포 폭 약 27 dB, P-15 Delay 원음 −3 dB, P-11 Flanger 반복 간격 약 4.7 ms
- 같은 코드로 두 번 돌리면 차이가 허용 오차 안(결정적 재현)
- e2e/fixtures 에 부록 A 신호의 WAV가 있음

[멈추고 물어볼 조건]
- OfflineAudioContext 에서 워클릿 등록이 실패해 일부 항목을 잴 수 없을 때(대안을 제시하고 대기)
- 측정값이 보고서와 반대 방향일 때(예: Cab 켬/끔 차가 1 dB)
- 프로브를 위해 이펙트 코드 구조를 바꿔야 할 것 같을 때

[보고 형식]
1) 변경 파일  2) 프로브 값 표(P-ID | 44.1k | 48k | 보고서 값 | 같은 방향?)  3) pending 항목과 이유
4) 결정적 재현 확인 결과  5) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/0 에서 refactor/s0-3-render-probe 를 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S0.4 브라우저 시나리오 하네스

```text
[역할]
너는 Playwright로 오디오 웹앱의 브라우저 시나리오 테스트를 만드는 시니어 프론트엔드 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
가짜 마이크, 화면 10종, 저장소·MIDI·가시성 모의를 갖춘 E2E 하네스를 만들고, 지금 상태의 측정값(휴대폰 스위치 도달성, 데스크톱 글자 겹침)을 기준으로 기록한다. 앱 코드는 바꾸지 않는다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S0.4, 6.3절(E-01~E-23), 2.2절 D16
- scripts/lib/chrome.mjs, scripts/responsive-a11y-regression.mjs(기존 화면 검사 방식)
- e2e/fixtures/*.wav, e2e/fixtures/storage-v1/(S0.1·S0.3 산출물)

[작업]
1. @playwright/test 를 devDependencies 에 추가한다(D16). playwright.config.ts: chromium, baseURL 은 vite preview, 실행 인자 --use-fake-ui-for-media-stream, --use-fake-device-for-media-stream, --use-file-for-fake-audio-capture=<WAV 경로>. WAV 경로는 테스트마다 바꿀 수 있게(project 또는 fixture 로).
2. 화면 프로필 10종: 390×844, 360×640, 412×915, 768×1024, 1024×768, 1280×800, 1366×768, 1440×900, 1536×864, 1920×1080(필요하면 1680×1050 추가).
3. e2e/helpers/ 에 공통 도우미를 만든다.
   a. reachable(locator): 요소를 화면 가운데로 스크롤한 뒤 중심점의 document.elementFromPoint 가 그 요소(또는 자손)인지
   b. overlapsInCard(card): 같은 카드 안 텍스트 노드 상자끼리 겹치는 수
   c. visibleRatio(locator): 뷰포트와 위를 덮는 요소를 빼고 요소가 실제로 보이는 비율
   d. mockStorage('blocked' | 'quota'): addInitScript 로 localStorage 접근자(SecurityError) 또는 setItem(QuotaExceededError)을 바꿔 치기
   e. mockMidi(): navigator.requestMIDIAccess 대체(가짜 입력 장치, 메시지 주입, 연결/분리 이벤트)
   f. setHidden(): visibilityState 대체 + visibilitychange 발생, 그리고 두 번째 탭을 앞으로 가져오는 방식 — 둘 다
   g. mockGetUserMediaError(name): getUserMedia 를 해당 오류 이름(NotAllowedError 등)으로 거부
   h. trackAudioContexts(): addInitScript 로 AudioContext 생성자를 감싸 만들어진 컨텍스트와 상태를 추적
4. 테스트 이름 앞에 E-ID 를 붙인다(예: 'E-04 휴대폰 스위치 도달성'). npm run e2e -- --grep "E-04" 로 고를 수 있어야 한다.
5. 기준 기록 테스트 두 개(지금은 실패가 정상이므로 '기록 모드' — CI 실패로 세지 않게 태그나 test.fixme 로 구분하고, 측정값은 docs/baseline/e2e.json 에 쓴다):
   - E-04: 390×844·360×640·412×915에서 15개 페달 스위치 도달 비율
   - E-06: 768~1920 px에서 카드 안 겹침 수와 스위치 노출 비율
   기록 모드는 S1.6(E-04)과 S1.8(E-06)에서 정식 단언으로 바뀐다.
6. E-23(시작 회귀)은 정식 테스트로: 로드 직후 AudioContext 0개·getUserMedia 0회, 서비스 워커가 캐시한 뒤 오프라인 새로고침에서 앱이 열림.
7. 가짜 마이크 연결 시나리오 1개: '기타 연결하기' → 출력 미터가 반응하는지.
8. package.json 에 "e2e": "playwright test", verify.yml 에 npx playwright install --with-deps chromium 과 npm run e2e 를 추가한다.

[하지 말 것]
- 앱 코드 수정
- 기존 responsive-a11y 테스트 삭제(이 Step에서는 그대로 둔다)
- Playwright 외 의존성 추가

[검증]
$ npx playwright install chromium
$ npm run e2e
$ npm run e2e -- --grep "E-23"
$ PR 에서 verify 워크플로 통과 확인(가능하면)

[완료 기준]
- npm run e2e 가 CI 에서 돌고, 기준 측정값(예: 1280 px 겹침 45곳 근처, 휴대폰 스위치 도달 0%)이 보고서 수치와 같은 방향으로 재현됨
- 가짜 마이크 WAV가 앱 입력으로 들어와 출력 미터가 반응함
- E-23 통과

[멈추고 물어볼 조건]
- 헤드리스 Chromium 에서 가짜 마이크 WAV가 앱 입력으로 들어오지 않을 때
- 기준 측정값이 보고서와 크게 다를 때(예: 1280 px 겹침 0)

[보고 형식]
1) 변경 파일  2) 기준 측정표(E-04, E-06 화면별)  3) 도우미 목록과 사용 예  4) CI 결과  5) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/0 에서 refactor/s0-4-e2e-harness 를 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가(이 Step의 @playwright/test 제외), git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

**Phase 0 마무리**: 네 Step이 `phase/0`에 모이면 `phase/0` → main PR을 병합한다. 앱 화면은 바뀌지 않으며, 이후 main에 들어오는 모든 변경은 테스트를 통과해야 배포된다. 그다음 main에서 `phase/1`을 만든다.

---

## 2. Phase 1 — 안전과 핵심 조작

귀를 다치게 하거나 기본 조작을 막는 7건과 저장 오류를 고친다. 보고서 권장대로 작은 수정(Crunch 곡선, Panic 정리, 좌우 입력)부터 시작한다. 모든 Step 브랜치는 `phase/1`에서 만든다.

### S1.1 Crunch 곡선 0점 연속화

```text
[역할]
너는 기타 이펙트 DSP(웨이브셰이퍼 곡선)를 다루는 시니어 오디오 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
Crunch 페달의 왜곡 곡선이 0에서 계단처럼 뛰는 결함(보고서 R1-6)을 고쳐, 연주하지 않을 때의 큰 잡음과 음 끝이 줄지 않는 현상을 없앤다. Gain 노브 곡선(R3-6, S3.5 범위)은 건드리지 않는다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.1, 6.2절 P-01·P-02·P-05
- docs/refactoring/code-map.md 의 S1.1 행
- src/audio/utils/curves.ts 의 createCrunchCurve(38~55행, 원인은 46행), src/audio/nodes/CrunchEffect.ts
- docs/baseline/audio-probe.json 의 P-01·P-02·P-05

[작업]
1. 46행의 x + (x > 0 ? sag * 0.18 : -sag * 0.08) 를 없애고, 양·음 영역의 기울기만 다르고 f(0) = 0 인 연속 비대칭 곡선으로 바꾼다. 설계서 S1.1의 코드 스케치를 출발점으로 하되, 기존 함수의 나머지 처리(하드 클립·바디 성분 등)와 합친다.
2. 단위 테스트(curves.test.ts 또는 기존 단위 테스트 위치)에 단언을 추가한다: gain 0~100(10 간격)에서 |y[N/2] − y[N/2 − 1]| < 0.01, f(0) = 0, 곡선 단조 증가.
3. 프로브 P-01·P-02 를 기록에서 판정으로 바꾼다(아래 완료 기준 수치).
4. 기준선을 갱신한다: npm run probe -- --update, 커밋 메시지 'baseline: S1.1 크런치 0점 연속화'.

[하지 말 것]
- Crunch 이외의 곡선(Drive·Fuzz) 수정
- Gain 노브 범위·곡선(taper) 변경
- 프리셋 값 변경

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run probe -- --only P-01,P-02,P-05

[완료 기준]
- gain 0~100 전 구간에서 곡선 가운데 인접 샘플 차 < 0.01
- P-01: 무연주 잡음(−90 dBFS) 출력과 연주음 출력의 차 ≥ 30 dB(현재 10 dB)
- P-02: 입력이 55 dB 줄 때 출력이 25 dB 이상 줄어듦(현재 5 dB)
- British Crunch · Plexi Lead · Thrash Rhythm 의 연주음 출력 레벨 변화 ±3 dB 이내(P-05)

[멈추고 물어볼 조건]
- 30 dB·25 dB 목표를 맞추려면 곡선 모양(음색)이 크게 바뀌어야 할 때 — 두 수치는 설계서의 초기 목표(★)라 조정할 수 있다
- 세 프리셋의 레벨 변화가 ±3 dB 를 넘을 때

[보고 형식]
1) 변경 파일  2) P-01·P-02·P-05(세 프리셋) 전후 표  3) 곡선 표본값 전후(x = −0.01, −0.001, 0, 0.001, 0.01, gain 0·50·100)
4) 내가 들어 볼 것(세 프리셋에서 줄을 손으로 막고 30초)

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-1-crunch-curve 를 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S1.2 모든 정지를 하나의 정리 절차로 (AudioSession)

```text
[역할]
너는 Web Audio 세션 수명주기와 녹음을 다루는 시니어 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
Panic 버튼·Esc·하울링 차단·연결 해제가 모두 하나의 정리 절차(AudioSession.stop)를 지나게 해, 정지 뒤 마이크와 오디오 엔진이 반드시 꺼지고 녹음은 버리지 않고 저장되게 한다(R1-3, R1-2의 녹음 폐기, R2-12의 Esc).

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.2, 4.2절(상태 기계·정리 순서표·이유별 안내), 6.3절 E-01
- docs/refactoring/code-map.md 의 S1.2 행
- src/store/audioStore.ts(1036~1068행 하울링·녹음, 1055행 finishActiveRecording('abort'))
- src/audio/AudioEngine.ts(연결·해제·dispose 경로), src/audio/recording.ts
- src/components/GlobalKeyboardShortcuts.tsx(Esc), Panic 버튼이 있는 컴포넌트

[작업]
1. src/audio/engine/AudioSession.ts 를 만든다. 상태 idle · starting · running · stopping · error, start(source), stop(reason) — 설계서 4.2절 인터페이스 그대로.
2. 지금 '연결 해제'가 하는 정리 코드를 teardown() 으로 옮기고, 4.2절 순서표를 그대로 구현한다.
   ① 출력 무음(약 10 ms 램프) → ② 녹음 중이면 finalize 대기(MediaRecorder stop 이벤트까지, 최대 2초) → ③ 입력 트랙 전부 stop
   → ④ 파일 모드면 pause(File 객체는 보존) → ⑤ 워클릿 포트 닫기·노드 disconnect → ⑥ await context.close()
   → ⑦ 세대 번호 증가(기존 sessionGeneration 재사용)·상태 idle → ⑧ 이유별 안내
3. Panic 버튼과 Esc → stop('panic'), 하울링 차단 → stop('howl'), 연결 해제 → stop('user-disconnect'). 하울링 감시 자체(rAF)는 이 Step에서 그대로 두고 '차단하는 지점'만 바꾼다. 기존의 '출력만 끄기' 코드는 지운다.
4. 녹음: 'abort' 경로를 지우고 finalize 로 Blob 을 남긴다. 정지 뒤에도 '녹음 다운로드' 버튼이 활성이어야 한다.
5. Esc: 대화상자·메뉴가 열려 있으면 그것만 닫고 Panic 하지 않는다.
6. 이유별 안내 토스트(4.2절 표 문구 그대로). 토스트 컴포넌트가 없으면 src/components/Toast.tsx 를 최소 형태(role="status", 자동으로 사라짐, 같은 문구 중복 방지)로 만든다. S1.7 에서 확장한다.
7. 단위 테스트: 정지 이유 5가지(user-disconnect, panic, howl, device-lost, error)가 모두 같은 teardown 을 지나는지, 순서 ①~⑧ 이 지켜지는지(호출 기록으로).
8. E2E E-01(e2e/helpers 의 trackAudioContexts 사용): Panic·Esc·하울링 차단(모의 호출) 각각 → 500 ms 안에 입력 트랙 ended, AudioContext closed, 화면 '기타 연결하기'. 녹음 중 Panic → 다운로드 가능·재생 길이 확인. 정지 → 연결 10회 반복 시 동시에 열린 AudioContext ≤ 1.

[하지 말 것]
- 정지 이유마다 다른 정리 코드 만들기(하나의 경로가 이 Step의 핵심이다)
- 하울링 감시 로직 자체 변경(S1.5 범위)
- 입력 채널·리미터 작업(S1.3·S1.4 범위)

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run e2e -- --grep "E-01"
$ npm run e2e -- --grep "E-23"

[완료 기준]
- E-01: Panic·Esc·하울링 차단(모의) 뒤 500 ms 안에 모든 입력 트랙 readyState === 'ended', AudioContext.state === 'closed', 화면이 '기타 연결하기' 상태
- 녹음 중 Panic → 녹음 파일을 다운로드할 수 있고, 재생 길이 = 녹음 시간 ±0.5초
- 대화상자가 열린 상태의 Esc 는 대화상자만 닫음
- 정지 → 다시 연결을 10번 반복해도 AudioContext 가 동시에 2개 이상 생기지 않음

[멈추고 물어볼 조건]
- MediaRecorder 의 stop 이벤트가 2초 안에 오지 않는 경우가 있을 때
- 기존 '연결 해제' 코드가 튜너 등 다른 기능과 얽혀 있어 옮기면 동작이 바뀔 때

[보고 형식]
1) 변경 파일  2) 정리 순서표 ①~⑧ ↔ 코드 위치(파일:줄)  3) E-01 결과  4) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-2-session-teardown 을 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S1.3 입력 채널 처리 (InputStage)

```text
[역할]
너는 Web Audio 입력 라우팅을 다루는 시니어 오디오 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
2입력 오디오 인터페이스의 1번 입력에 꽂은 기타가 왼쪽에서만 들리는 문제(R1-4)를 고친다. 입력을 '자동(기본) / 1번 / 2번 / 스테레오'로 처리하는 InputStage 를 만든다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.3, 4.4절(모드 표·그래프·gain 값·InputStage 인터페이스), 6.2절 P-06, 6.3절 E-02
- docs/refactoring/code-map.md 의 S1.3 행
- src/audio/AudioEngine.ts(121~135행 입력 연결, 127행 channelCount), src/components/DeviceSelector.tsx
- IO 설정 저장 코드(키 guitar-pedalboard:io), src/audio/worklets/tuner-processor.ts(139~159행 '센 채널 고르기')
- src/audio/engine/AudioSession.ts(S1.2 결과)

[작업]
1. src/audio/engine/InputStage.ts: 4.4절 그래프 — ChannelSplitter → gainL·gainR → mono GainNode(channelCount 1, channelCountMode 'explicit') → inputTrim. stereo 모드는 source 를 inputTrim 에 바로 잇는다. setMode 는 20 ms 램프, 모노 ↔ 스테레오 전환은 8 ms 페이드 후 재연결.
2. 모드별 gain: auto 판정 전 0.5/0.5, ch1 1/0, ch2 0/1.
3. auto 판정: 채널별 RMS 를 받아 신호가 300 ms 이상 들어온 뒤 한쪽이 15 dB 이상 크면 그 채널만 쓴다(20 ms 크로스페이드). 이 Step에서는 InputStage 안의 AnalyserNode 2개로 재고, S1.5 에서 level-meter 워클릿 값으로 바꾼다. 판정은 세션마다 한 번, 결과는 장치별로 저장.
4. 트랙 getSettings().channelCount 가 1이면 채널 메뉴를 숨긴다.
5. DeviceSelector 에 '입력 채널' 메뉴(자동 / 1번 입력 / 2번 입력 / 스테레오)와 판정 결과 한 줄('1번 입력에서만 소리가 들어와 1번 입력을 씁니다')을 넣는다.
6. 장치별 모드 저장: 지금의 IO 저장 키(guitar-pedalboard:io)에 필드를 '추가'만 한다. 기존 필드는 바꾸지 않는다(v2 전환은 S2.4).
7. 튜너가 InputStage 출력(모노)을 쓰게 연결한다.
8. 테스트: 프로브 P-06(왼쪽에만 신호가 있는 스테레오 입력)을 판정으로, E2E E-02(scripts/make-fixture-wavs.mjs 에 '왼쪽만 신호'인 스테레오 WAV 를 추가해 가짜 마이크로 사용)를 새로 만든다.

[하지 말 것]
- 체인·이펙트 수정
- IO 저장 키의 기존 필드 변경·삭제
- 튜너 알고리즘 수정

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run probe -- --only P-06
$ npm run e2e -- --grep "E-02"

[완료 기준]
- P-06 / E-02: 왼쪽에만 신호가 있는 스테레오 입력 → 자동 판정 뒤 출력 좌우 RMS 차 ≤ 1 dB, 레벨 손실 ≤ 0.5 dB(합칠 때의 −6 dB 가 남지 않음)
- '1번 / 2번 / 스테레오'를 고르면 20 ms 페이드로 바로 반영되고 장치별로 기억됨
- 양쪽에 같은 신호(진짜 모노 장치) → 자동 판정이 '합침'을 유지하고 레벨 변화 없음
- 기존 튜너 테스트 통과

[멈추고 물어볼 조건]
- 헤드리스 가짜 마이크가 2채널을 주지 않아 E-02 를 만들 수 없을 때(대안: 프로브로만 검증 — 제안하고 대기)
- IO 저장 형식에 필드를 추가하면 기존 코드가 깨질 때

[보고 형식]
1) 변경 파일  2) P-06·E-02 결과(좌우 RMS, 레벨 손실)  3) 채널 메뉴 화면 캡처 경로  4) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-3-input-stage 를 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다(이 Step의 IO 필드 추가 제외). 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S1.4a 마스터 리미터

```text
[역할]
너는 실시간 오디오 안전장치(리미터)를 구현하는 시니어 오디오 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
마지막 출력 단계에 리미터를 넣어, 어떤 노브 조합에서도 출력(스피커·헤드폰·녹음)이 −1 dBFS 를 넘지 않게 한다(R1-5). 새 워클릿을 별도 TS 파일로 불러오는 방식도 이 Step에서 검증한다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.4a(리미터 코드 스케치), 4.1절 규칙 6, 4.3절 신호 흐름, 4.5절 GS-6·GS-7, 6.2절 P-03·P-23
- docs/refactoring/code-map.md 의 S1.4a 행
- src/audio/AudioEngine.ts(createProcessingGraph 554~577행, 574~575행 masterGain → destination, createRecorderStream 314~325행, loadWorklets 499~513행)
- vite.config.ts(PWA 프리캐시 설정), src/audio/worklets/*.ts(기존 문자열 방식)

[작업]
1. src/audio/worklets/limiter.worklet.ts: 설계서 S1.4a 스케치대로(룩어헤드 1 ms, ceiling −1 dBFS, 즉시 어택, 릴리즈 80 ms, 마지막 clamp). 최근 100 ms 최대 감소량을 30 Hz 로 port 에 보낸다({ type: 'limiter', maxGrDb }).
2. 불러오기: import limiterUrl from './worklets/limiter.worklet.ts?worker&url' → audioWorklet.addModule(limiterUrl). dev·build·preview 모두에서 동작하는지 확인한다. 워클릿 전역 타입(AudioWorkletProcessor, registerProcessor, sampleRate)은 src/audio/worklets/worklet-env.d.ts 에 선언한다.
3. src/audio/engine/OutputStage.ts: masterGain → limiter → [destination, outputMeter, recorderDestination]. 녹음도 리미터 뒤에서 한다.
4. vite-plugin-pwa 프리캐시에 워클릿 청크가 들어가는지 확인하고, 안 들어가면 globPatterns·includeAssets 를 고친다.
5. 프로브: P-03(전 페달 켬 + Level 200% + Graphic EQ 전 밴드 +12 dB)과 '기본 구성 Cab 끔' 피크를 판정으로, P-23(바이패스 클릭·노드 생성 0)을 회귀로. REF-PC 기본 구성의 리미터 최대 감소량도 기록한다.
6. E-23 에 단언 추가: 오프라인 새로고침 뒤 연결할 때 리미터 워클릿 로드 성공.

[하지 말 것]
- 리미터 파라미터를 화면에 노출
- 기존 워클릿 3개의 불러오기 방식 변경(S4.9 범위)
- 프리셋·Cab 음량 수정(S1.4b·S1.4c 범위)

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run build && npm run preview        # 빌드 결과에서 워클릿 로드 확인
$ npm run probe -- --only P-03,P-23
$ npm run e2e -- --grep "E-23"

[완료 기준]
- P-03: 전 페달 켬 + Level 200% + Graphic EQ 전 밴드 +12 dB → 출력 샘플 피크 ≤ −1.0 dBFS(허용 −0.9)
- 기본 구성에서 Cab 끔 → 출력 피크 ≤ −1.0 dBFS
- 녹음 파일에도 같은 피크 제한
- P-23: 바이패스·체인 재배치에서 클릭 없음, 새 노드 생성 0
- E-23: 오프라인 새로고침 뒤 리미터 워클릿 로드 성공

[멈추고 물어볼 조건]
- ?worker&url 방식이 AudioWorklet 에서 동작하지 않거나 프리캐시에 넣을 수 없을 때(다른 방식 후보와 장단점을 적고 대기)
- REF-PC 기본 구성에서 리미터 감소량이 3 dB 를 넘어 소리가 눈에 띄게 눌릴 때

[보고 형식]
1) 변경 파일  2) 워클릿 불러오기 검증 결과(dev / build / 오프라인)  3) P-03 전후, REF-PC 기본 구성 리미터 최대 감소량  4) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-4a-limiter 를 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S1.4b Cab 음량 보정

S1.4b만 배포하면 Cab을 쓰는 프리셋이 약 15 dB 커진다. **S1.4c와 같은 배포에 넣는다**(둘 다 `phase/1`에 병합한 뒤 Phase 1 배포 때 함께 나간다).

```text
[역할]
너는 캐비닛 IR(컨볼루션)을 다루는 오디오 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
Cab 페달이 음량을 15 dB 낮추는 문제(R1-5)를 고쳐, Cab 을 켜고 끌 때의 음량 차를 1.5 dB 이하로 만든다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.4b, 4.5절 GS-1·GS-3, 6.2절 P-04·P-05
- docs/refactoring/code-map.md 의 S1.4b 행
- src/audio/nodes/CabEffect.ts(54~91행), src/audio/utils/cabinet.ts(17~68행 IR 합성)

[작업]
1. IR 을 만든 직후 에너지 정규화(Σh² = 1 기준) 함수를 cabinet.ts 에 추가해 적용한다. ConvolverNode.normalize 는 false 로 두고 직접 정규화한다(값을 예측할 수 있게).
2. 모델별, 마이크 위치 양끝(0·100)별로 REF-PC 켬/끔 RMS 차를 P-04 로 재고, 남는 차이를 보정하는 dB 상수 표(모델 → 보정 dB)를 cabinet.ts 에 둔다. 마이크 위치에 따른 차이가 크면 위치에 따른 보간식을 쓴다.
3. P-04 를 판정으로 바꾸고 기준선을 갱신한다('baseline: S1.4b Cab 음량 보정').

[하지 말 것]
- IR 모양(음색) 변경 — 좌우 대칭·무작위 성분은 S3.2 범위
- 프리셋 값 변경

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run probe -- --only P-04,P-05

[완료 기준]
- P-04: 모든 Cab 모델과 마이크 위치 0·100 에서 REF-PC 켬/끔 RMS 차 ≤ 1.5 dB
- P-05 의 변화(Cab 을 쓰는 프리셋이 커짐)를 기록 — S1.4c 에서 다시 맞춘다

[멈추고 물어볼 조건]
- 마이크 위치·거리에 따라 차이가 6 dB 넘게 달라져 상수 표로 맞출 수 없을 때

[보고 형식]
1) 변경 파일  2) 모델·위치별 P-04 표(전후)  3) P-05 변화 요약  4) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-4b-cab-makeup 을 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S1.4c 프리셋 음량 정렬

```text
[역할]
너는 오디오 앱의 음량 정렬(게인 스테이징)을 맡은 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
팩토리 프리셋 40개의 음량을 같은 기준(REF-PC 입력 시 출력 RMS −20 dBFS ± 2 dB, 결정 D6)으로 맞춘다(R1-5). 지금은 −51 ~ −24 dBFS 로 최대 27 dB 차이가 난다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.4c, 4.5절(GS-2·GS-7, trim 공식), 2.1절 D6, 6.2절 P-05
- docs/refactoring/code-map.md 의 S1.4c 행
- src/store/presetStore.ts(팩토리 정의·불러오기), src/audio/AudioEngine.ts(체인 출력 → masterGain 구간), src/components/PresetPanel.tsx
- src/audio/offline/(S0.3 에서 만든 오프라인 렌더 공통 코드)

[작업]
1. AudioEngine: 체인 출력과 masterGain 사이에 presetTrim GainNode 를 넣는다. 프리셋을 불러올 때 30 ms 램프로 적용하고, 사용자가 노브를 바꿔도 trim 은 그대로 둔다.
2. scripts/compute-preset-trims.mjs: src/audio/offline/ 의 렌더 코드를 써서 40개 프리셋의 REF-PC 출력 RMS 를 재고 trimDb = PRESET_TARGET_RMS_DBFS − 측정값(±24 dB 로 clamp) → src/presets/factoryTrims.json(생성물, 커밋). 상수 PRESET_TARGET_RMS_DBFS = -20 은 한 곳에만 둔다.
3. 프리셋 패널에 '음량 보정 +x.x dB'를 표시한다.
4. 사용자 프리셋: 기본 trim 0. '음량 맞추기' 버튼 → 현재 프리셋을 REF-PC 로 오프라인 렌더(2초) → trim 계산·저장. 앱 코드는 src/audio/testing/ 을 import 하지 않는다(공통 코드는 src/audio/offline/). 저장은 기존 프리셋 저장 형식에 trimDb 필드를 '추가'만 한다.
5. P-05 를 판정으로 바꾸고(−20 ± 2), 클린 ↔ 드라이브 전환 시 RMS 변화와 REF-PC 리미터 최대 감소량 측정을 추가한다. 기준선을 갱신한다('baseline: S1.4c 프리셋 음량 정렬').

[하지 말 것]
- 프리셋의 노브 값 변경(trim 으로만 맞춘다)
- 프리셋 저장 형식의 기존 필드 변경(trimDb 추가만)
- 특정 프리셋(예: 'Headphone Safe Start')의 예외를 임의로 정하기

[검증]
$ npm run typecheck && npm run lint && npm test
$ node scripts/compute-preset-trims.mjs
$ npm run probe -- --only P-05

[완료 기준]
- P-05: 40개 프리셋의 REF-PC 출력 RMS 가 −20 ± 2 dBFS(현재 −51 ~ −24)
- 클린 ↔ 드라이브 프리셋 전환 시 RMS 변화 ≤ 4 dB(현재 약 20 dB)
- REF-PC 에서 리미터 최대 감소량 ≤ 1 dB
- '음량 맞추기'가 사용자 프리셋을 −20 ± 1 dBFS 로 맞춤

[멈추고 물어볼 조건]
- trim 이 ±24 dB 범위를 넘는 프리셋이 있을 때(프리셋 자체가 이상할 수 있음)
- 리미터 감소량이 1 dB 를 넘는 프리셋이 있을 때(목표값 조정 여부)
- 'Headphone Safe Start'를 예외로 둘지 결정이 필요할 때(D6 비고 — 기본은 예외 없음)

[보고 형식]
1) 변경 파일  2) 프리셋 40개 표(이름 | 전 RMS | trimDb | 후 RMS | 리미터 최대 감소량)  3) 전환 시 변화가 큰 쌍 상위 5개  4) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-4c-preset-trims 를 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다(이 Step의 trimDb 추가 제외). 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S1.5 출력 가드와 MonitorService (하울링 감지 v2)

```text
[역할]
너는 실시간 오디오 안전장치(하울링 감지)와 오디오 스레드 측정을 설계하는 시니어 오디오 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
하울링 감시와 레벨 측정을 화면 그리기(requestAnimationFrame)에서 떼어 오디오 스레드(AudioWorklet)로 옮긴다. 판정 기준은 출력 음량이 아니라 '입력에서 한 음이 줄지 않고 1초 넘게 이어짐'이다(R1-2, 결정 D9). 휴대폰의 어느 탭에서도, 브라우저 탭이 가려져도 보호가 동작해야 한다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.5, 4.3절(신호 흐름·포트 메시지·판정 알고리즘·그 이유), 부록 A(H-1~H-4, G-1~G-3), 부록 B(판정 기본값), 6.2절 P-07·P-17, 6.3절 E-03
- docs/refactoring/code-map.md 의 S1.5 행
- src/audio/engine/OutputStage.ts · InputStage.ts · AudioSession.ts(S1.2~S1.4a 결과)
- src/store/audioStore.ts(33~34행 차단 상수, 1047~1068행 rAF 감시), src/components/Meter.tsx(162~172행), src/components/AppShell.tsx(77행)

[작업]
1. src/audio/worklets/level-meter.worklet.ts: 통과형. 채널별 피크·RMS(dBFS)·클립을 30 Hz 로 port 에 보낸다({ type: 'level', tap: 'in' 또는 'out', peakDb, rmsDb, clipped, frame }).
2. src/audio/worklets/output-guard.worklet.ts: 입력 2개(0 = 프로그램 신호 통과, 1 = 분석 전용 입력 스테이지 탭), 출력 1개. 4.3절 알고리즘 그대로:
   hop 1024, 창 2048(Hann), 워클릿 안에 직접 작성한 radix-2 실수 FFT, fPeak(포물선 보간), tonal(상위 8개 피크 ±2빈 에너지 / 80 Hz~8 kHz 전체),
   후보 조건(RMS ≥ −50 dBFS, tonal ≥ 0.80, 기준 대비 ±20센트), 후보 1.0초 지속 + 그 구간 RMS 기울기 ≥ −1.0 dB/s → 10 ms 램프 무음 + { type: 'howl-cut', freqHz }.
   명령 { type: 'arm', mode: 'device' 또는 'file' }(file 이면 판정 끔), { type: 'reset' } 처리. 판정 상수는 파일 맨 위 한 곳에 부록 B 값으로 둔다.
3. 배치(4.3절 흐름): source → level-meter#in → InputStage → inputTrim → (체인, 튜너, 장치 모드일 때만 guard 입력 1)
   체인 → presetTrim → masterGain → guard 입력 0 → limiter → level-meter#out → [destination, recorder]
4. src/audio/monitor/MonitorService.ts 와 src/store/monitorStore.ts: 포트 메시지를 받아 최신값을 보관(최대 30 Hz), 'howl-cut' 을 받으면 AudioSession.stop('howl'). S1.3 의 auto 채널 판정 입력을 level-meter#in 의 채널값으로 바꾼다(AnalyserNode 2개 제거).
5. rAF 감시 삭제: audioStore 의 −3 dBFS·1.2초 감시 코드와 Meter.tsx 의 감시·레벨 판정 코드를 지운다. Meter 는 monitorStore 를 읽어 그리기만 한다(보이지 않으면 그리지 않아도 된다).
6. 프로브 P-07: 부록 A 신호 7종(H-1~H-4, G-1~G-3)을 가드에 넣어 차단 여부·차단까지 시간·오차단 수를 잰다. 파일 모드의 H-1 도 포함. P-17: 가드·미터 추가 전후의 렌더 시간.
7. E2E E-03: 휴대폰 화면의 '입력'·'미터'·'프리셋' 탭 각각, 문서 숨김, 두 번째 탭을 앞으로 가져온 상태 — H-1 가짜 마이크 WAV 로 1.5초 안에 차단. 파일 모드에서 H-1 을 재생하면 차단 없음. 녹음 중 차단되면 녹음 파일이 남음.

[하지 말 것]
- 판정을 출력 레벨 기준으로 되돌리거나 섞기
- 판정 수치를 부록 B 와 다르게 바꾸기(바꿔야 하면 멈추고 묻는다)
- 하울링 감지에 기능 플래그 두기(옛 방식은 보호가 안 되므로 되돌릴 대상이 아니다)
- 휴대폰 도크·레이아웃 변경(S1.6 범위)

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run probe -- --only P-07,P-17
$ npm run e2e -- --grep "E-03"
$ npm run e2e -- --grep "E-01"     # 차단 → 정리 경로 회귀

[완료 기준]
- H-1(1 kHz −20 dBFS 지속) → 1.5초 안에 차단: 데스크톱, 휴대폰의 모든 탭, 문서 숨김 상태 모두
- H-2(2.5 kHz, −50 → −6 dBFS 로 커지는 음) → 1.5초 안에 차단
- H-3(800 Hz 왜곡된 지속음) → 1.5초 안에 차단
- H-4(기본 구성, 입력 한계 +20 dB 상당의 지속음 — 보고서 재현 조건) → 차단
- G-1(196 Hz 서스테인 리드, 입력 −4 dB/s 감쇠, 비브라토) 60초 → 오차단 0회
- G-2(110 Hz 감쇠 톱니파를 2초마다, 60초) → 오차단 0회
- G-3(무음 + −70 dBFS 잡음, 60초) → 오차단 0회
- 파일 모드에서 H-1 재생 → 차단 없음(리미터만 동작)
- 차단 시 녹음 파일이 남음
- P-17: 가드·미터로 늘어난 렌더 시간 ≤ 전체 페달 처리의 5%

[멈추고 물어볼 조건]
- 위 기준을 맞추려면 부록 B 수치를 바꿔야 할 때(어느 수치를 어떻게, 왜 — 신호별 결과와 함께)
- G-1 오차단과 H-x 미탐이 충돌해 수치 조정으로 둘 다 맞출 수 없을 때(설계서의 2단계 대응 대안을 제시)
- AudioWorkletNode 의 입력 2개 구성이 기대대로 동작하지 않을 때

[보고 형식]
1) 변경 파일  2) P-07 신호별 표(신호 | 차단 여부 | 차단까지 시간 | 오차단 수)  3) E-03 탭·가시성별 결과
4) P-17 전후  5) 남은 위험(오차단·미탐 가능성, 실기기 시험이 필요한 항목)

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-5-output-guard 를 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S1.6 휴대폰 하단 패널 접기

```text
[역할]
너는 모바일 우선 레이아웃과 접근성을 다루는 시니어 프론트엔드 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
휴대폰에서 하단 패널(입력·미터·프리셋)이 화면 높이의 66% 를 덮어 페달 아래쪽 스위치를 누를 수 없는 문제(R1-1)를 고친다. 기본은 접힌 도크이고, 펼쳐도 페이지 끝까지 스크롤하면 모든 스위치에 닿게 한다. 휴대폰 전용 화면은 만들지 않는다(결정 D2).

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.6, 4.10절(레이아웃 표, CSS, --dock-h), 6.3절 E-04
- docs/refactoring/code-map.md 의 S1.6 행
- src/components/AppShell.tsx(14~18행 탭 정의, 102~150행 도크), src/styles/responsive.css(160~230행, 167~173행 .mobile-control-dock)
- docs/baseline/e2e.json(E-04 기준값)

[작업]
1. 모바일 탭 맨 앞에 '페달' 탭을 추가하고 기본으로 선택한다. '페달' 탭에서는 도크가 탭 줄(약 56 px)만 남긴다.
2. '입력'·'미터'·'프리셋' 탭은 최대 50dvh 로 펼친다. 같은 탭을 다시 누르면 접힌다(접힘 = '페달' 탭 상태).
3. 도크에 ResizeObserver 를 붙여 실제 높이를 :root 의 --dock-h 에 기록하고, .app-main 에 padding-bottom: calc(var(--dock-h, 0px) + env(safe-area-inset-bottom) + 16px) 를 준다.
4. 페달 스위치의 터치 영역을 44×44 px 이상으로(보이는 크기는 그대로 두고 터치 영역만 넓혀도 된다).
5. 탭 전환이 보호(S1.5 출력 가드)와 무관한지 확인하고, E-03 에 '페달' 탭 상태를 추가한다.
6. E-04 를 기록 모드에서 판정 테스트로 바꾼다: 390×844 · 360×640 · 412×915, 도크 접힘·펼침 두 상태에서 15개 페달의 모든 스위치 도달.

[하지 말 것]
- 휴대폰 전용 화면 새 설계(D2)
- 데스크톱 레이아웃(S1.8 범위)
- 페달 카드 내부 배치 변경

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run e2e -- --grep "E-04"
$ npm run e2e -- --grep "E-03"     # 탭 전환과 보호 독립 회귀

[완료 기준]
- 390×844 · 360×640 · 412×915 에서 15개 페달의 모든 스위치 도달 — 도크 접힘·펼침 모두(현재 0%)
- 390×844 첫 화면에 페달 노브 2개 이상이 완전히 보임
- 도크를 펼친 상태에서 끝까지 스크롤하면 마지막 페달 아래쪽 끝이 도크 위로 나옴
- E-03 의 '페달' 탭 상태에서도 H-1 이 1.5초 안에 차단됨

[멈추고 물어볼 조건]
- 페달 카드 높이(약 858 px)가 화면보다 커서, 도크를 펼친 상태의 도달성을 맞추려면 카드 배치를 바꿔야 할 때

[보고 형식]
1) 변경 파일  2) E-04 화면·도크 상태별 도달 비율 전후  3) 스크린샷 경로(전후)  4) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-6-mobile-dock 을 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S1.7 저장 오류 처리와 오류 화면

```text
[역할]
너는 브라우저 저장소와 오류 처리를 다루는 시니어 프론트엔드 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
저장소가 막히거나 가득 차도 앱이 멈추거나 흰 화면이 되지 않게 한다(R2-1). 모든 저장을 SafeStorage 하나로 모으고, 화면 전체의 오류는 한국어 안내 화면으로 받는다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.7, 4.8절(SafeStorage 인터페이스, 상황별 동작 표, 오류 경계), 2.2절 D10, 6.3절 E-05
- docs/refactoring/code-map.md 의 S1.7 행
- src/store/pedalStore.ts(307~327행), src/store/presetStore.ts(436~443행), src/components/PresetPanel.tsx(37~40행), src/store/audioStore.ts(IO·MIDI 저장)
- src/main.tsx, ESLint 설정 파일, src/components/Toast.tsx(S1.2 의 최소 형태)

[작업]
1. src/persistence/SafeStorage.ts: 4.8절 인터페이스(mode, get, set, setDebounced — 기본 300 ms, pagehide 와 visibilitychange(hidden) 에서 밀린 저장을 바로 씀 — remove, usageBytes). 어떤 경우에도 throw 하지 않는다.
2. 시작할 때 localStorage 접근을 try/catch 로 검사한다.
   - SecurityError → memory 모드 + 안내 1회('브라우저 설정 때문에 설정을 저장할 수 없습니다. 이번 방문 동안만 유지됩니다.')
   - setItem 의 QuotaExceededError → 값은 메모리에 유지 + 안내 1회(같은 주소 kimyounggaur.github.io 의 다른 앱 데이터를 언급하는 4.8절 문구)
   - 깨진 값 → ':corrupt-{시각}' 키에 원문 보관을 시도한 뒤 기본값 + 안내
3. 모든 localStorage 직접 호출을 SafeStorage 로 바꾼다. 키 이름은 그대로 둔다(v2 네임스페이스 전환은 S2.4).
4. ESLint: no-restricted-globals 와 no-restricted-properties 로 localStorage 직접 참조를 금지한다(SafeStorage.ts 만 예외).
5. Toast 확장: 종류(info · warn · error), 같은 키 중복 방지, 액션 버튼 자리(S2.8 의 '실행 취소'용), role="status".
6. src/app/AppErrorBoundary.tsx: 오류가 나면 먼저 AudioSession.stop('error') 로 소리를 끈 뒤 한국어 화면 — 제목 '문제가 생겨 화면을 표시하지 못했습니다', 버튼 '다시 시도', '설정을 초기화하고 다시 시작'(확인 뒤 guitar-pedalboard: 키만 지움), '오류 정보 복사'.
7. main.tsx: createRoot().render() 를 try/catch 로 감싸 React 가 아예 뜨지 못하면 정적 HTML 안내를 넣는다. window 의 error·unhandledrejection 은 토스트로 알린다.
8. 테스트: SafeStorage 단위 테스트(차단, 가득 참, 깨진 값). E2E E-05 — 차단·가득 참 모의에서 Bypass·On/Off·노브·프리셋 불러오기 동작 + 안내 1회, 렌더 중 예외 주입 시 오류 화면 + 소리 정지.

[하지 말 것]
- 저장 키 이름·값 형식 변경(S2.4 범위)
- 팩토리 프리셋 저장 방식 변경(S2.4·S2.7 범위)

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run e2e -- --grep "E-05"
$ grep -rn "localStorage" src --include=*.ts --include=*.tsx     # SafeStorage.ts 외 0건

[완료 기준]
- 사이트 데이터 차단 모의: 흰 화면 없이 표시, Bypass·On/Off·노브·프리셋 불러오기 동작, 안내 1회
- 저장 공간 가득 참 모의: 위 조작 동작, 안내 1회(되풀이 표시 없음)
- 렌더 중 예외 주입: 한국어 오류 화면이 뜨고 소리가 멈춤
- 린트: localStorage 직접 참조 0건

[멈추고 물어볼 조건]
- 저장 시점이 바뀌어(디바운스) 즉시 저장을 가정한 기존 코드가 깨질 때
- 오류 경계로 잡을 수 없는 오류 종류가 있을 때

[보고 형식]
1) 변경 파일  2) localStorage 호출 교체 목록(이전 위치 → SafeStorage 메서드)  3) E-05 결과  4) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-7-safe-storage 를 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다. 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

### S1.8 노트북 화면 배치

```text
[역할]
너는 반응형 레이아웃(CSS Grid, 컨테이너 쿼리)과 접근성을 다루는 시니어 프론트엔드 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[목표]
화면 폭 768~1536 px 에서 페달 글자가 겹치고 스위치가 잘리는 문제(R1-7)를 고친다. 페달 칸 최소 폭 300 px 의 자동 칸 수, 컨테이너 쿼리, 접을 수 있는 오른쪽 패널, 화면 위쪽 영역 압축으로 해결한다.

[먼저 읽을 것]
- docs/refactoring-design.md 의 S1.8(목표 표), 4.10절(레이아웃 표, CSS 스케치, 위쪽 압축), 6.3절 E-06
- docs/refactoring/code-map.md 의 S1.8 행, docs/baseline/e2e.json(E-06 기준값)
- src/styles/layout.css(페달 그리드), src/styles/pedals.css(Compressor·Noise Gate·Tremolo·Delay·Cab 카드 구간)
- src/components/PedalCard.tsx(아래쪽 MIDI 학습·스위치 영역), src/components/AppShell.tsx, src/components/ConnectGuitarPanel.tsx, src/components/PedalBoard.tsx(83~90행 로고)

[작업]
1. 페달 그리드: grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr)).
2. .pedal-card 에 container-type: inline-size. 카드가 340 px 이하로 좁으면 노브 줄이 2열로 줄바꿈된다. 노브 라벨은 한 줄 + 말줄임, 전체 이름은 title 과 aria-label 로.
3. Tremolo SHAPE 의 3버튼은 카드가 좁을 때 select 로 바뀐다. MIDI 학습 버튼은 별도 줄에 둔다.
4. 오른쪽 패널: 768~1279 px 에서는 기본 접힘(버튼을 누르면 덮어 쓰는 서랍), 1280 px 이상에서는 기본 펼침 + 접기 버튼. 상태는 SafeStorage 로 기억한다(새 키 guitar-pedalboard:ui 추가 허용).
5. 위쪽 압축: 연결 후에는 ConnectGuitarPanel 을 한 줄 상태 바(장치·채널·지연·연결 해제)로 접는다. 데스크톱 로고 높이 ≤ 56 px.
6. E-06 을 기록 모드에서 판정 테스트로 바꾼다: 768 · 1024 · 1280 · 1366 · 1440 · 1536 · 1680 · 1920 px, 오른쪽 패널 펼침·접힘 두 상태에서 카드 안 텍스트 겹침 0, 스위치 노출 100%. 그리고 1280×800 에서 첫 페달 위쪽 끝 ≤ 320 px, 높이 900 px 화면에서 첫 줄 스위치 노출.
7. 카드 내부 배치를 크게 바꿔야 한다고 판단되면 구현하기 전에 멈추고 묻는다(Figma 시안으로 먼저 확인하기로 했다).

[하지 말 것]
- 스톰프박스 외형(색·질감·모양)의 큰 변경
- 글자 크기·대비 전면 수정(S4.5 범위 — 겹침을 없애는 데 필요한 최소 변경만)
- 노브 조작 방식 변경(S4.4 범위)

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run e2e -- --grep "E-06"
$ npm run e2e -- --grep "E-04"     # 휴대폰 회귀

[완료 기준]
화면 폭별 목표(오른쪽 패널 펼침·접힘 모두):
  768 px    겹침 0곳(현재 37)   스위치 노출 100%(현재 33%)
  1280 px   겹침 0곳(현재 45)   스위치 노출 100%(현재 0%)
  1366 px   겹침 0곳(현재 32)   스위치 노출 100%(현재 50%)
  1440 px   겹침 0곳(현재 18)   스위치 노출 100%(현재 94%)
  1536 px   겹침 0곳(현재 11)   스위치 노출 100%
  1680 px 이상  겹침 0곳         스위치 노출 100%
- 1280×800 에서 첫 페달 카드 위쪽 끝 ≤ 320 px(현재 604 px)
- 높이 900 px 화면에서 첫 줄 페달의 스위치가 스크롤 없이 보임
- 오른쪽 패널의 접힘·펼침 상태를 기억

[멈추고 물어볼 조건]
- 겹침을 없애려면 카드 내부 배치나 스톰프박스 외형을 크게 바꿔야 할 때(바꿀 안 2개를 스크린샷과 함께 제시)
- 320 px·900 px 목표(설계서의 초기 목표 ★)가 카드 높이 때문에 불가능할 때

[보고 형식]
1) 변경 파일  2) E-06 화면 폭별 표(겹침·노출 전후)  3) 스크린샷 경로(1280·1440 전후)  4) 남은 위험

[공통 규칙]
- 기준 문서는 docs/refactoring-design.md 다. 이 지시문과 설계서가 다르면 멈추고 묻는다.
- 브랜치: phase/1 에서 refactor/s1-8-desktop-layout 을 만들어 작업하고, 하위 작업마다 커밋한다.
- 시작하기 전에 구현 계획을 5줄 이내로 먼저 적고 진행한다.
- 대상 파일 밖은 고치지 않는다. 파일 이동과 로직 변경을 한 커밋에 섞지 않는다.
- 저장 키·저장 필드 이름을 바꾸지 않는다(이 Step의 guitar-pedalboard:ui 추가 제외). 기준선·허용 오차를 근거 없이 완화하지 않는다.
- 의존성 추가, git 히스토리 재작성, 저장소 공개 범위 변경, push·PR 생성은 내가 허락할 때만 한다.
- 줄 번호는 커밋 4ac9cf7 기준이고, docs/refactoring/code-map.md 가 우선이다.
- 끝나면 PR 본문 초안(설계서 7.1 템플릿)을 함께 출력한다.
```

---

## 3. Phase 1 마무리

### 3.1 배포 전 사람 확인

자동 테스트가 대신할 수 없는 항목이다(보고서도 확인하지 못했다). 결과는 `docs/listening/YYYY-MM-DD.md`에 적는다(날짜, 장비, 브라우저, 항목별 OK·문제).

- [ ] 실제 기타 + 2입력 인터페이스 1번 입력 + 유선 헤드폰: 기본 구성에서 소리가 양쪽 귀에 고르게 들린다(S1.3)
- [ ] British Crunch · Plexi Lead · Thrash Rhythm: 줄을 손으로 막았을 때 '지글거리는' 잡음이 없다(S1.1)
- [ ] 'Headphone Safe Start' ↔ 'Texas Push'를 오가도 음량이 크게 튀지 않는다(S1.4c)
- [ ] Cab을 켜고 꺼도 음량이 비슷하고, 어떤 조합에서도 소리가 깨지지 않는다(S1.4a·b)
- [ ] 휴대폰 스피커 + 내장 마이크, **작은 음량부터**: 하울링이 1~2초 안에 끊긴다. 일반 연주(퍼즈 서스테인 포함)에서는 끊기지 않는다(S1.5)
- [ ] Panic을 누르면 브라우저의 마이크 사용 표시가 꺼진다(S1.2)
- [ ] 실제 휴대폰(가능하면 iPhone·Android 하나씩)에서 모든 페달 스위치를 누를 수 있다(S1.6)
- [ ] 노트북(1280·1440 px)에서 페달 글자가 겹치지 않는다(S1.8)

### 3.2 릴리스 준비 프롬프트

```text
phase/1 을 main 에 병합하기 위한 릴리스 준비를 해 줘. 코드는 고치지 마.
1) git log main..phase/1 로 포함된 Step 목록과 커밋 수를 정리한다.
2) docs/refactoring-design.md 9장 추적표에서 이번에 끝난 항목(R1-1~R1-7, R2-1)에 완료 표시를 하고, 6.2·6.3 표의 '현재' 값 옆에 결과값을 적는다.
3) docs/listening/ 의 최신 기록을 읽고, 문제로 적힌 항목이 있으면 맨 위에 경고로 보고한다.
4) CHANGELOG.md 에 v2.1.0 항목을 쓴다(사용자가 느끼는 변화 위주, 한국어, 10줄 안팎).
5) phase/1 → main PR 본문 초안을 쓴다(포함 Step, 해결 항목, 사람 확인 결과, 남은 위험).
6) 배포 후 확인할 것 목록을 만든다(GitHub Pages 와 Vercel 둘 다: E-23 시작 회귀, 오프라인 새로고침, 실제 휴대폰).
push·PR 생성·태그는 하지 말고 초안만 보여 줘.
```

### 3.3 배포 후

- `phase/1` → main 병합 → 배포 확인 → 태그 `v2.1.0`.
- main에서 `phase/2`를 만든다. Phase 2 지시문(S2.1~S2.14)은 같은 형식으로 이어서 만든다.
