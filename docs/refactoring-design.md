# Guitar Pedalboard 리팩토링 설계 문서

> 11월 12일 점검 보고서가 찾은 결함·개선 38건과 보완 기능 6건을 증상마다 따로 고치지 않고, 그 밑에 있는 **구조적 원인 12가지**를 바로잡는 방식으로 묶은 실행 설계서다. Phase 0(측정 안전망)부터 Phase 5(보완 기능)까지 **Step 51개**로 나눴고, Step마다 대상 파일·변경 설계·수용 기준·테스트·주의 사항을 적었다.

| 항목 | 내용 |
|---|---|
| 문서 버전 | v1.0 · 2026-11-23 |
| 대상 | `kimyounggaur/Guitar-Pedalboard` — GitHub Pages(https://kimyounggaur.github.io/Guitar-Pedalboard/), Vercel |
| 기준 코드 | 커밋 `4ac9cf7`(2026-09-28). 보고서 작성 시점(11/12)에도 최신 커밋 |
| 주 근거 | 「Guitar Pedalboard 웹앱 점검 보고서」(2026-11-12, 이하 **보고서**) |
| 보조 근거 | 「32_기타페달보드_개선계획서」(2026-10-23, 이하 **10월 계획서**) — 같은 커밋을 읽은 문서. 코드 위치·줄 번호·코드 스케치의 출처 |
| 확보하지 못한 자료 | 보고서가 언급한 `guitar-pedalboard-review-tech-appendix.md`(코드 위치·측정 원자료). 프로젝트 지식에 없어 10월 계획서의 코드 위치로 대신했고, S0.1에서 재확인한다 |
| 기술 스택 | Vite 7 · React 19 · TypeScript · zustand 5 · dnd-kit · vite-plugin-pwa. Web Audio API 직접 사용(Tone.js 없음), AudioWorklet 3개, Web Worker 1개 |
| 코드 규모 | TSX 35개 4,709줄 · TS 44개 8,765줄 · CSS 6,916줄 · 테스트 스크립트 14개(10월 계획서 집계) |

## 목차

- [0. 이 문서의 사용법](#0-이-문서의-사용법)
- [1. 목표와 범위](#1-목표와-범위)
- [2. 결정 사항](#2-결정-사항)
- [3. 현재 구조와 문제의 뿌리 (As-Is)](#3-현재-구조와-문제의-뿌리-as-is)
- [4. 목표 설계 (To-Be)](#4-목표-설계-to-be)
- [5. 단계별 실행 계획](#5-단계별-실행-계획)
- [6. 테스트 전략](#6-테스트-전략)
- [7. 배포·브랜치·롤백](#7-배포브랜치롤백)
- [8. 위험과 대응](#8-위험과-대응)
- [9. 추적표 (보고서 항목 → Step)](#9-추적표-보고서-항목--step)
- [10. 완료 정의](#10-완료-정의)
- [부록](#부록)

---

## 0. 이 문서의 사용법

### 0.1 읽는 순서

- **결정하는 사람(앱 주인)**: 1장 목표 → 2장 결정 사항 → 5.0 로드맵 개요 → 9장 추적표
- **구현하는 사람(Claude Code 세션 포함)**: 4장 목표 설계 → 맡은 Step → 6장 테스트 → 부록 D 작업 지시 템플릿

### 0.2 ID 규칙

| 접두어 | 뜻 | 예 |
|---|---|---|
| R1-n | 보고서 1순위(안전·핵심 조작) n번 | R1-3 Panic 뒤에도 마이크가 켜져 있음 |
| R2-n | 보고서 2순위(표시와 실제 동작이 다름) n번 | R2-6 Export 직후 Import 시 팩토리 프리셋 복제 |
| R3-n | 보고서 3순위(음질) 표의 n번째 행 | R3-1 Compressor의 Mix |
| R4-n | 보고서 4순위(성능·가독성·유지보수) 표의 n번째 행 | R4-1 로고 이미지 |
| RX-n | 보고서 '보완하면 좋은 기능' n번째 | RX-1 WAV 녹음 |
| D1~D7 | 보고서 '결정이 필요한 사항' | D5 지연을 줄이는 방법 |
| D8~D16 | 이 문서가 추가한 결정 | D9 하울링 판정 수치 |
| C1~C12 | 구조적 원인(3장) | C1 감시가 화면 그리기에 묶임 |
| S{Phase}.{n} | 실행 Step | S1.2 |
| P-nn / E-nn | 오디오 렌더 프로브 / 브라우저 시나리오 테스트(6장) | P-04, E-01 |
| GS-n | 게인 스테이징 규칙(4.5) | GS-6 최종 리미터 |
| ★ | 보고서에 없는, 이 문서가 정한 초기 목표치. 실측·청취 뒤 사람 승인으로 조정 가능 | — |

### 0.3 실행 단위와 규칙

1. **1 Step = 1 브랜치 = 1 PR = Claude Code 1세션**이 기본이다. Step 안의 하위 작업은 커밋으로 나눈다. 규모 L인 Step은 세션을 여러 번 써도 되지만 PR은 하나다.
2. Step의 **수용 기준을 모두 통과해야 병합**한다. 수용 기준을 바꿔야 할 것 같으면 구현을 멈추고 사람에게 묻는다.
3. **Phase 단위로 배포**한다(Phase 2는 2a·2b로 나눠 배포할 수 있다). 각 Phase는 혼자 배포하고 혼자 되돌릴 수 있어야 한다.
4. 파일 이동(이름 바꾸기)과 로직 변경을 같은 PR에 섞지 않는다.
5. 기존 테스트가 결함 구조를 강제하는 경우(예: 플랜저 테스트가 피드백 사이클 코드를 요구), 그 코드를 고치는 Step에서 해당 단언을 동작 단언으로 함께 바꾼다.
6. 이 문서를 저장소에 `docs/refactoring-design.md`로 커밋하고, 모든 세션이 먼저 읽게 한다.

### 0.4 줄 번호와 수치에 대한 주의

- 대상 파일의 줄 번호는 10월 계획서가 커밋 `4ac9cf7`에서 읽은 값이다. 착수할 때 `git log -1 --format=%h` 결과가 다르면 S0.1에서 코드 지도를 먼저 갱신한다. 경로 뒤에 '(추정)'이 붙은 것은 10월 계획서에도 없어 폴더 구조로 추정한 경로다.
- '현재값'은 보고서 측정치다(Chrome 153, 합성 기타 신호, 음질은 48 kHz 오프라인 렌더). 이 문서의 프로브는 신호를 새로 정의하므로(부록 A) 절대값이 보고서와 조금 다를 수 있다. **판정은 S0.3에서 새로 기록한 기준선 대비 변화와 이 문서의 목표값으로 한다.**

---

## 1. 목표와 범위

### 1.1 목표 — 측정할 수 있는 형태로

| ID | 목표 | 판정 기준(요약) | 관련 원인 |
|---|---|---|---|
| G1 | 청력 안전 | 어떤 노브·프리셋 조합에서도 최종 출력 샘플 피크 ≤ −1.0 dBFS. Panic·Esc·하울링 차단 뒤 0.5초 안에 마이크 트랙 종료(`readyState === 'ended'`)와 오디오 엔진 종료 | C2, C4 |
| G2 | 보호의 독립성 | 하울링 감시와 레벨 측정이 화면 탭·브라우저 탭 가시성과 상관없이 동작. 순음 하울링을 모든 탭 상태에서 1.5초 안에 차단 | C1 |
| G3 | 음량 일관성 | 팩토리 프리셋 40개의 기준 신호 출력 RMS가 −20 dBFS ± 2 dB(D6). Cab 켬/끔 차이 ≤ 1.5 dB | C4 |
| G4 | 조작 가능성 | 폭 360~412 px 휴대폰에서 15개 페달의 모든 스위치를 누를 수 있음. 768~1920 px에서 카드 안 글자 겹침 0곳, 스위치 100% 노출 | C9 |
| G5 | 정직한 표시 | 화면의 모든 수치가 실제 오디오 상태나 파라미터 값에서 나옴. 장식용 수치 0개, 이름과 기능이 다른 조절기 0개. 잴 수 없으면 '측정 불가' | C7, C8 |
| G6 | 견고성 | 저장소가 막히거나 가득 차도 모든 조작이 됨 + 안내 1회. 흰 화면 0 | C6 |
| G7 | 음질 | 3순위 7건의 측정 현상이 각 Step 목표치 안으로 들어옴. 기본 구성 처리 지연 10 ms → 약 2.7 ms(D5) | C4, C8 |
| G8 | 유지보수성 | 소리를 재는 테스트가 배포 전에 CI에서 돎. 소스 문자열 정규식 단언 0개 | C11 |

### 1.2 하지 않는 것

- 프레임워크·빌드 도구 교체(React, zustand, Vite 유지)
- 휴대폰 전용 화면 새 설계(D2에 따라 '톤 확인용'을 유지)
- 튜너 MPM 알고리즘과 리버브 IR 워커 구조 교체
- 새 이펙트 종류 추가(RX 범위 제외)
- 31번 앱 '기타 멀티이펙터' 저장소와의 통합(10월 계획서 Phase 6) — 별도 문서로 다룬다

### 1.3 그대로 지킬 것

보고서와 10월 계획서가 확인한 강점이다. 리팩토링이 이것을 깨면 회귀로 본다.

| 강점 | 근거 | 지키는 테스트 |
|---|---|---|
| 빌드·타입체크·린트 통과, 앱에 포함되는 라이브러리의 알려진 취약점 0 | 보고서 | CI(S0.2) |
| 튜너가 시험음 기준 6개 개방현을 0센트 오차로 읽음, 4개 샘플레이트 회귀 테스트 | 보고서, `tuner-processor.ts:170-347` | 기존 튜너 테스트 + P-22 |
| 기타 연결 전에는 마이크·AudioContext를 만들지 않음, 오프라인에서도 열림 | 보고서 | E-23 |
| 단일 AudioContext, `getUserMedia` 처리 옵션(echoCancellation·noiseSuppression·autoGainControl) 끔 | `AudioEngine.ts:113`, `:121-130` | E-23 |
| 노드 재연결 없는 12 ms 크로스페이드 바이패스, 체인 재배치 페이드 | `BaseEffect.ts:127-177`, `AudioEngine.ts:680-696` | P-23 |
| 리버브 IR을 워커에서 만들고 LRU 캐시·웻 페이드로 교체 | `impulseCache.ts`, `ReverbEffect.ts:119-160` | 기존 테스트 |
| 자동 접근성 검사의 확정 위반 0 | 보고서 | E-21 |

---

## 2. 결정 사항

보고서는 7가지 결정을 요청했다. 이 문서는 **보고서 추천안을 기본 가정으로 채택**해 설계했다. 다르게 정하면 '다르게 정하면' 열의 영향이 생긴다.

### 2.1 보고서의 결정 7가지

| ID | 결정할 것 | 기본 가정(추천안) | 반영 Step | 다르게 정하면 |
|---|---|---|---|---|
| D1 | On/Off와 Bypass를 합칠지 | 하나로 합친다. 저장 형식을 v2로 자동 변환 | S2.4 | 둘 다 유지: S2.4가 'LED = 실제 활성 여부' 표시와 프리셋의 스위치 사용 통일로 축소(S). 두 스위치의 혼란은 남는다 |
| D2 | 휴대폰 지원 수준 | '톤 확인용' 유지 + 페달 조작 가능 | S1.6 | 휴대폰 전용 화면: 별도 설계 문서 필요(L 이상) |
| D3 | 실제 제품명 표기(TS-9, Tube Screamer, Crunch Box) | 일반 이름으로 바꾼다(부록 C 대체표) | S4.8 | 유지: 상표 위험 감수. 법적 판단은 전문가 확인 필요(보고서) |
| D4 | Source 폴더의 스톡 이미지·제품 사진 | 공개 저장소에서 뺀다 | S4.8(결정되면 Phase 0과 함께 먼저 처리 가능) | 유지: 라이선스 확인 전까지 공개 상태 지속 |
| D5 | 지연을 줄이는 방법 | 왜곡 페달 오버샘플링 4배 → 2배, Compressor 직접 구현. 기본 구성 처리 지연 10 ms → 약 2.7 ms | S3.6, S3.7 | 4배 유지: S3.7 생략, 처리 지연 약 4 ms(Compressor 직접 구현만, 보고서 수치로 추산) |
| D6 | 프리셋 기준 음량 | 같은 연주 기준 −20 dBFS 근처(현재 중앙값 −31 dBFS). 정확한 값은 실제 기타로 들어 보고 확정 | S1.4c, S3.8 | 값만 바꾸면 된다: 상수 `PRESET_TARGET_RMS_DBFS` 하나로 다시 계산. 특정 프리셋만 예외(예: 'Headphone Safe Start'를 낮게 유지)로 두려면 그 프리셋의 목표값만 따로 지정 |
| D7 | Cab 시뮬레이터 방향 | 지금 방식을 보정한 뒤 실제 캐비닛 IR 도입을 검토 | S1.4b, S3.2, S5.4 | IR 즉시 도입: 무료 사용이 허용된 IR 확보가 선행 조건 |

### 2.2 이 문서가 추가하는 결정

착수 전에 확인을 권하지만, 확인이 없으면 기본 가정대로 진행한다.

| ID | 결정할 것 | 기본 가정 | 반영 Step | 이유 |
|---|---|---|---|---|
| D8 | Git 히스토리에서 이미지까지 지울지(`git filter-repo`) | 하지 않는다. 현재 트리에서만 제거 | S4.8 | 되돌리기 어렵고 기존 클론이 모두 깨진다. 필요하면 사람이 따로 실행 |
| D9 | 하울링 판정 수치 | 부록 B 기본값(입력 쪽에서 '줄지 않는 한 음'이 1.0초) | S1.5 | 실제 하울링 시험을 하지 못했다(보고서). 수치 변경은 사람 승인 |
| D10 | 저장 키와 스키마 버전 | `guitar-pedalboard:v2:*` 네임스페이스, v1 키는 2개 릴리스 동안 보존 | S1.7, S2.4 | 같은 주소(kimyounggaur.github.io)의 다른 앱과 저장 공간을 함께 쓴다 |
| D11 | 끊김(글리치) 지표 | Chromium 계열의 `AudioContext.playbackStats`로 실측, 지원하지 않는 브라우저는 '측정 불가' | S2.10 | 가짜 0 표시 금지(G5). Chromium 전용 API |
| D12 | 최소 글자 크기 | 11 px 최소(보고서), 노브 라벨 12 px·값 13 px 권장 | S4.5 | 보고서 기준 + 프로젝터·휴대폰 판독 |
| D13 | 10~15번째 페달 단축키 | `Shift + 1~6` | S2.11 | 숫자 줄 하나로 기억 가능, 한글 입력 상태와 무관(`code` 기준) |
| D14 | Reverb Decay 6~10초 구간 | 노브 범위를 6초까지로 줄인다. 저장값 6.2초·7.5초는 6.0초로 바꾸며 소리 변화는 없다 | S2.2 | 6~10초는 6초와 같은 소리(보고서). 10초 IR은 CPU 부담이 크다 |
| D15 | Fuzz의 Gate 슬라이더 | 기능을 이름에 맞춘다(퍼즈 안에 실제 게이트 구현) | S2.2 | 지금은 Level과 겹치는 출력 감쇠뿐. 퍼즈는 잡음을 크게 키우므로 게이트가 쓸모 있다 |
| D16 | 브라우저 시험 도구 | `@playwright/test`(개발 의존성) 도입 | S0.4 | 가짜 마이크 파일, 화면 10종, 저장소·MIDI 모의를 짧게 쓸 수 있다. 대안: 기존 CDP 코드를 분리해 재사용 |

### 2.3 10월 계획서와 달라진 점

두 문서가 함께 있으므로, 충돌하는 곳은 **이 문서를 따른다**. 10월 계획서의 코드 위치·코드 스케치는 참고 자료로 계속 쓴다.

| 주제 | 10월 계획서 | 이 문서 | 이유 |
|---|---|---|---|
| 범위 | 문제 40개 + 31번 앱 수렴(Phase 6) | 보고서 38건 + 보완 6건, 31번 앱 수렴 제외 | 보고서가 더 최신이고 범위가 넓다 |
| 페달 칸 최소 폭 | 240 px | 300 px | 보고서 실측: 칸이 267 px 이상일 때 겹침 0 |
| 하울링 판정 | 출력 피크 −6 dBFS + 명료도 0.95 + ±10센트, 1.2초 | 입력 쪽 '줄지 않는 한 음' 1.0초, 레벨 하한 −50 dBFS | 기본 구성은 입력을 20 dB 넘겨도 출력 최고치가 −8 dBFS라 레벨 기준에 닿지 않는다(보고서) |
| 차단 뒤 동작 | 출력 이득 0 | '연결 해제'와 같은 전체 정리 + 녹음 저장 | R1-3 |
| 글리치 표시 | 삭제 | `playbackStats`로 실측, 미지원 시 '측정 불가' | 보고서 권장, API 확인(D11) |
| 입력 채널 | 왼쪽/오른쪽/합산 | 자동(기본)/1번/2번/스테레오 | 보고서: 기본은 하나로 합쳐 양쪽으로 |
| 컴프레서 | 기본 Mix 100 + 원음 지연 보정 | 직접 구현(지연 0, D5). 원음 지연 보정은 임시안 | D5 |
| 최소 글자 | 12 px | 11 px(라벨 12 px 권장) | 보고서 |
| 로고 목표 | 60 KB 이하 | 50 KB 이하 | 보고서 |

---

## 3. 현재 구조와 문제의 뿌리 (As-Is)

### 3.1 구조 요약 (10월 계획서 2.3절 기준)

```text
Guitar-Pedalboard/
├─ index.html                  logo.png preload, /src/main.tsx
├─ vite.config.ts              base 분기(VERCEL), PWA, sourcemap: true
├─ src/
│  ├─ audio/
│  │  ├─ AudioEngine.ts        771줄 싱글턴: 컨텍스트·입력·체인·미터·튜너·녹음 스트림
│  │  ├─ nodes/                BaseEffect + 이펙트 15종 + MeterNode·TunerNode
│  │  ├─ worklets/             noise-gate · envelope-follower · tuner (TS 안의 문자열 → Blob URL)
│  │  ├─ workers/              impulse.worker.ts (리버브 IR 생성)
│  │  └─ utils/                curves · cabinet · impulseCache · tunings · smoothing
│  ├─ store/                   audioStore 1,083줄 · pedalStore 987줄 · presetStore 566줄 · __migration_check 1,077줄(DEV 전용)
│  ├─ components/              AppShell · PedalBoard · PedalCard · effects/(15개) · Meter · PresetPanel
│  └─ styles/                  8개, pedals.css 4,251줄
├─ scripts/                    회귀 테스트 14개(.mjs)
├─ public/logo.png             1,620 KB (2048×1021)
├─ assets/                     옛 빌드 산출물 776 KB(.gitignore에 있으나 추적 중)
└─ Source/                     참고 이미지·AI 기획 문서
```

이펙트 15종(기본 순서): Noise Gate · Compressor · Auto Wah · Drive · Crunch · Fuzz · Graphic EQ · EQ · Cab · Chorus · Flanger · Phaser · Tremolo · Delay · Reverb. 앱을 처음 열면 Noise Gate·Compressor·Drive·EQ·Cab 5개만 실제로 켜져 있다(10월 계획서). 정확한 순서는 S0.1에서 확인한다.

현재 신호 흐름:

```text
getUserMedia(처리 옵션 off, channelCount ideal 2) 또는 <audio> 파일
 → MediaStreamSource → inputGain(±24 dB) ─┬→ inputMeter(Analyser)
                                          ├→ TunerNode(튜너를 켤 때만)
                                          └→ chainInput → 페달 1..15(BaseEffect)
 → masterGain(0.9) ─┬→ outputMeter(Analyser)   ← 미터 패널이 활성일 때만 rAF로 읽음(하울링 감시 포함)
                    ├→ MediaStreamDestination   (녹음 중)
                    └→ destination              ← 리미터 없음

BaseEffect 내부
 input ─┬→ bypassAll ────────────────────────────────→ output
        └→ effectGate ─┬→ dryGain ─────────────────┐
                       └→ 이펙트 → wetGain → makeup ┴→ levelGain(최대 2배) → output
```

### 3.2 증상 → 구조적 원인

보고서의 38건은 아래 12가지 원인으로 모인다. 4장의 설계는 원인을 하나씩 없애는 방향이다.

| ID | 구조적 원인 | 드러난 증상 | 대응 설계 |
|---|---|---|---|
| C1 | 안전·측정 로직이 화면 그리기에 묶여 있다. 하울링 감시와 레벨 갱신이 `requestAnimationFrame` 루프 안에 있고, 그 루프는 미터 패널이 활성일 때만 돈다(`Meter.tsx:162-172`, `AppShell.tsx:77`) | R1-2, R2-8 | 4.3 출력 스테이지·MonitorService |
| C2 | 세션을 끝내는 길이 여러 개다. Panic·Esc·하울링 차단은 출력만 끄고 '연결 해제'만 마이크·엔진을 끈다. 녹음은 `finishActiveRecording('abort')`로 버린다(`audioStore.ts:1055`) | R1-3, R1-2(녹음 폐기), R2-12(Esc), R2-15(장치 분리) | 4.2 AudioSession |
| C3 | 입력 라우팅 계층이 없다. 스트림을 `inputGain`에 바로 잇고(`AudioEngine.ts:121-135`) 채널 선택·모노화·장치 변경 감지가 없다 | R1-4, R2-15, R2-7 일부 | 4.4 InputStage·DeviceManager |
| C4 | 게인 스테이징 규칙이 없다. 프리셋 음량 기준이 없고, Cab 음량 손실을 보정하지 않으며, 이펙트마다 원음·효과음 합성 법칙이 다르고, 컴프 처리음의 지연을 맞추지 않으며, 마지막에 리미터가 없다(`AudioEngine.ts:574-575`) | R1-5, R3-1, R3-7, R1-2(기본 구성은 차단 기준에 닿지 않음) | 4.5 게인 스테이징, 4.6 지연 예산 |
| C5 | 상태를 두 플래그로 표현하고 저장 형식에 버전이 없다. `enabled`와 `bypassed`(`BaseEffect.ts:129`), 꺼진 페달의 Mix 0% 저장, 팩토리·사용자 프리셋을 함께 내보냄 | R2-4, R2-2, R2-6, R2-14 | 4.7 상태 모델 v2 |
| C6 | 저장이 예외에 약하다. `localStorage.setItem`에 예외 처리가 없고(`pedalStore.ts:307-327`, `presetStore.ts:436-443`), 같은 주소의 다른 앱과 공간을 함께 쓰며, 화면 전체 오류를 받는 경계가 없다 | R2-1 | 4.8 SafeStorage·오류 경계 |
| C7 | 화면 수치가 실측이 아니다. 고정 숫자 GR 미터, 장식 막대, 출력 쪽만 더한 지연, 근거 없는 글리치 카운터(`noise-gate-processor.ts:46-70`) | R2-3 일부, R2-10, R2-8 | 4.12 표시 원칙 |
| C8 | 파라미터 정의(이름·범위·단위·기본값·노브 곡선)가 UI·DSP·프리셋에 흩어져 서로 어긋난다 | R2-3, R3-5, R3-6 | 4.9 파라미터 스키마 |
| C9 | 배치가 고정 칸 수(4칸)와 항상 열린 고정 도크(최대 66dvh, `responsive.css:167-173`)에 기댄다 | R1-1, R1-7, R4-5 일부 | 4.10 레이아웃 규칙 |
| C10 | 입력 처리 정책이 없다. 단축키를 눌린 글자(`key`)로 판단하고, Esc·Space의 의미가 상황별로 정해져 있지 않으며, MIDI는 학습할 때만 연결한다 | R2-12, R2-5, R2-9 | 4.11 입력 처리 |
| C11 | 테스트가 소스 문자열 검사 위주(13개 테스트, 337곳)이고 배포 과정에서 돌지 않는다 | R4-7(그리고 모든 회귀 위험) | 6장 |
| C12 | 저장소 위생: 옛 빌드·참고 이미지 추적, 타사 제품명 표기, 목록에 없는 도구(esbuild), README와 다른 수치 | R4-8, R4-9, D3, D4 | S4.8, S4.9 |

---

## 4. 목표 설계 (To-Be)

### 4.1 레이어와 책임

```text
┌─ UI (React) ─────────────────────────────────────────────────────────────┐
│ AppShell · PedalBoard · PedalCard · KnobControl · Meter · Tuner · PresetPanel │
│ Toast · ConfirmDialog · FilePlayer · AppErrorBoundary                    │
└──────────────▲───────────────────────────────────────┬───────────────────┘
               │ 셀렉터로 필요한 조각만 구독              │ 액션 호출
┌──────────────┴─ Stores (zustand) ──────────────────────▼───────────────────┐
│ sessionStore · pedalStore · presetStore · monitorStore · uiStore · settingsStore │
└──────────────▲───────────────────────────────────────┬───────────────────┘
               │ 이벤트                                  │ 명령
┌──────────────┴─ Services ──────────────────────────────▼───────────────────┐
│ AudioSession · DeviceManager · MonitorService · Recorder · MidiService    │
│ ShortcutService · SafeStorage · Migrations                                │
└──────────────▲───────────────────────────────────────┬───────────────────┘
               │ 워클릿 port 메시지                       │ 그래프 조립
┌──────────────┴─ Audio graph ───────────────────────────▼───────────────────┐
│ AudioEngine(조립) · InputStage · Chain(BaseEffect × 15) · OutputStage       │
│ 워클릿: level-meter · output-guard · limiter · noise-gate · envelope · tuner │
│         (Phase 3) compressor · flanger · phaser                           │
└────────────────────────────────────────────────────────────────────────────┘
```

규칙:

1. UI는 AudioNode를 직접 만지지 않는다. 순서는 UI → 스토어 액션 → 서비스다.
2. **안전 판단(하울링 차단, 출력 제한)은 오디오 스레드(워클릿)에서 끝난다.** 메인 스레드는 결과를 받아 정리하고 안내만 한다. 그래서 화면이 멈추거나 탭이 가려져도 보호가 동작한다.
3. 저장은 SafeStorage로만 한다. 다른 코드는 `localStorage`를 직접 부르지 않는다(ESLint `no-restricted-globals`·`no-restricted-properties`로 강제).
4. 화면 문구는 `src/i18n/ko.ts`에서만 가져온다.
5. 파라미터의 이름·범위·단위·기본값·노브 곡선은 `src/audio/params/`에서만 정의한다.
6. 새 워클릿은 처음부터 별도 TS 파일로 만들고 `import url from './x.worklet.ts?worker&url'`로 불러온다. S1.4a에서 이 방식이 빌드·오프라인 프리캐시까지 되는지 먼저 확인하고, 안 되면 멈추고 묻는다.

### 4.2 AudioSession — 세션 상태 기계와 하나뿐인 정리 절차 (C2)

```text
idle ──start()──▶ starting ──준비 완료──▶ running ──stop(reason)──▶ stopping ──정리 완료──▶ idle
                     │                                                   │
                     └────── 실패 ──────▶ error ◀──── 정리 중 예외 ────────┘
                                           └── 사용자가 안내 확인 ──▶ idle
```

```ts
// src/audio/engine/AudioSession.ts
export type SessionSource =
  | { kind: 'device'; deviceId?: string }
  | { kind: 'file'; file: File };

export type StopReason =
  | 'user-disconnect' // '연결 해제' 버튼
  | 'panic'           // Panic 버튼, Esc
  | 'howl'            // 출력 가드가 하울링을 차단함
  | 'device-lost'     // 입력 장치가 빠짐
  | 'error';          // 오류 경계, 엔진 예외

export interface StopResult {
  reason: StopReason;
  recording?: { blob: Blob; mimeType: string; durationSec: number }; // 녹음 중이었으면 보존
}

export interface AudioSession {
  readonly state: 'idle' | 'starting' | 'running' | 'stopping' | 'error';
  start(source: SessionSource): Promise<void>;
  stop(reason: StopReason): Promise<StopResult>; // 모든 종료가 이 함수 하나를 지난다
}
```

정리 절차 `teardown()` — 순서가 중요하다:

| 순서 | 동작 | 이유 |
|---|---|---|
| 1 | 출력을 즉시 무음으로: OutputStage 출력 이득을 약 10 ms 램프로 0(`setTargetAtTime(0, t, 0.003)`) | 귀 보호가 가장 먼저 |
| 2 | 녹음 중이면 `recorder.finalize()`를 기다림(MediaRecorder `stop` 이벤트까지, 최대 2초) → Blob 보존 | 컨텍스트를 먼저 닫으면 마지막 조각이 사라진다 |
| 3 | 입력 스트림의 모든 트랙 `track.stop()` | 마이크 표시등이 꺼진다(R1-3) |
| 4 | 파일 모드면 `audio.pause()`. File 객체는 버리지 않는다 | R2-5: 파일 유지 |
| 5 | 워클릿 포트 닫기, 노드 `disconnect()` | 메시지·메모리 누수 방지 |
| 6 | `await context.close()` | 엔진 종료(R1-3) |
| 7 | 세대 번호 증가(기존 `sessionGeneration` 재사용), 상태 `idle` | 늦게 도착한 비동기 결과를 무시 |
| 8 | 이유별 안내(아래 표) | 사용자가 무슨 일이 있었는지 안다 |

| 이유 | 안내 | 녹음 |
|---|---|---|
| user-disconnect | (안내 없음) | 저장, '녹음을 저장했습니다' 토스트 |
| panic | '긴급 정지했습니다. 마이크와 오디오를 모두 껐습니다.' | 저장 |
| howl | '하울링(약 {freq} Hz)이 감지되어 정지했습니다. 스피커 음량을 줄이거나 헤드폰을 쓰세요.' | 저장 |
| device-lost | '입력 장치 연결이 끊겼습니다. 장치를 다시 연결한 뒤 연결하기를 누르세요.' | 저장 |
| error | 오류 경계 화면(4.8) | 저장 시도 |

부르는 곳: '연결 해제' 버튼 → `stop('user-disconnect')`, Panic 버튼·Esc → `stop('panic')`, 출력 가드의 `howl-cut` 메시지 → `stop('howl')`, DeviceManager의 장치 분리 감지 → `stop('device-lost')`, AppErrorBoundary → `stop('error')`. 정지할 때마다 AudioContext를 닫고 시작할 때 새로 만들므로 '컨텍스트는 한 번에 하나' 원칙이 그대로 유지된다.

### 4.3 출력 스테이지와 MonitorService (C1, C7)

목표 신호 흐름:

```text
[장치] MediaStreamSource ─▶ level-meter#in(원신호, 채널별 측정) ─▶ InputStage(채널 선택·모노화) ─▶ inputTrim(±24 dB) ─┬─▶ 체인 입력
[파일] MediaElementSource ──┘                                                                                    ├─▶ TunerNode(켤 때만)
                                                                                                                  └─▶ output-guard 입력 1(분석 전용, 장치 모드만)

체인(페달 1..15) ─▶ presetTrim(프리셋 음량 보정, 4.5) ─▶ masterGain(0.9) ─▶ output-guard 입력 0
output-guard(하울링 판정 + 안전 무음) ─▶ limiter(−1 dBFS, 룩어헤드 1 ms) ─▶ level-meter#out ─┬─▶ destination(출력 장치)
                                                                                              └─▶ Recorder(녹음 중)
```

**MonitorService**의 책임:

- 워클릿 메시지(레벨 30 Hz, 가드 이벤트, 리미터 감소량)를 받아 `monitorStore`에 최신값을 둔다. 화면 미터는 자기 rAF에서 `monitorStore.getState()`를 읽어 그리기만 한다(React 리렌더 없음).
- 레벨 경고(4.12)를 판정한다. 화면 탭과 무관하다.
- `howl-cut`을 받으면 `AudioSession.stop('howl')`을 부른다. 무음 처리는 이미 워클릿에서 끝난 상태다.

포트 메시지 형식:

```ts
// 워클릿 → 메인
type LevelMsg = {
  type: 'level'; tap: 'in' | 'out';
  peakDb: number[]; rmsDb: number[]; // 채널별
  clipped: boolean; frame: number;   // frame = currentFrame
};
type GuardMsg =
  | { type: 'howl-suspect'; freqHz: number; heldMs: number } // 판정 진행 중(로그·디버그용)
  | { type: 'howl-cut'; freqHz: number }                     // 이미 무음 처리 완료
  | { type: 'limiter'; maxGrDb: number };                    // 최근 100 ms 최대 감소량

// 메인 → 워클릿
type GuardCmd =
  | { type: 'arm'; mode: 'device' | 'file' } // file이면 하울링 판정을 끈다(리미터는 유지)
  | { type: 'reset' };                        // 새 세션에서 무음 해제
```

**하울링 판정 알고리즘**(D9, 수치는 부록 B):

```text
분석 신호: output-guard 입력 1 = 입력 스테이지 출력(모노, 트림 뒤). 장치 모드에서만.
매 hop(1024 샘플, 48 kHz에서 약 21 ms)마다 최근 2048 샘플(Hann 창)로:
  levelDb = RMS(dBFS)
  spectrum = 2048점 실수 FFT 크기
  fPeak   = 80 Hz~8 kHz에서 가장 큰 성분의 주파수(포물선 보간)
  tonal   = 상위 8개 피크(각 ±2 빈)의 에너지 / 80 Hz~8 kHz 전체 에너지
후보 프레임 = levelDb ≥ −50 dBFS 이고 tonal ≥ 0.80 이고 |fPeak − f기준| ≤ 20센트
  (후보가 끊기면 f기준과 타이머를 처음부터)
후보가 1.0초 이어지면: 그 1.0초 동안 levelDb의 기울기(선형회귀) ≥ −1.0 dB/s 인지 본다
  → 참이면 하울링: 즉시 출력 무음(10 ms 램프) + 'howl-cut' 전송, reset 전까지 무음 유지
```

- **왜 입력 쪽인가**: 기타 줄의 원신호는 반드시 줄어든다. Compressor나 Fuzz가 출력을 평평하게 만들어도 입력은 줄어든다. 하울링은 스피커 소리가 마이크로 되돌아오므로 입력이 줄지 않거나 커진다. 그래서 '입력에서 한 음이 줄지 않고 1초 넘게 이어짐'이 보고서가 권한 기준을 가장 직접 구현한다. 출력 레벨을 보지 않으므로 기본 구성(출력 최고 −8 dBFS)에서도 동작한다.
- **왜 FFT인가**: 튜너의 MPM은 70 Hz~1.4 kHz 범위에 맞춘 것이라 2~5 kHz 하울링에는 맞지 않는다. 2048점 FFT를 hop마다 한 번 돌려도 계산량은 초당 수백만 회 수준이라 오디오 스레드에 부담이 작다(P-17로 확인).
- **파일 모드**: 마이크가 없으면 되먹임도 없으므로 판정을 끈다. 리미터는 유지한다.
- **오차단 대안**: 인터페이스 앞에 외부 컴프·퍼즈를 연결하면 입력 자체가 줄지 않아 오차단이 날 수 있다. 실기기 시험에서 그런 일이 생기면 '1.0초에 −10 dB로 줄이고 경고 → 2.0초에 차단'의 2단계 방식으로 바꾼다(부록 B, 사람 승인).

### 4.4 InputStage와 DeviceManager (C3)

**InputStage 모드**:

| 모드 | 화면 이름 | 동작 | 기본 |
|---|---|---|---|
| auto | 자동 | 처음에는 1번·2번을 합친다(각 ×0.5). 신호가 300 ms 이상 들어온 뒤 한쪽이 15 dB 이상 크면 그 채널만 쓴다(20 ms 크로스페이드) + 안내 '1번 입력에서만 소리가 들어와 1번 입력을 씁니다' | ✓ |
| ch1 | 1번 입력 | 1번 채널만, 양쪽 출력에 똑같이 | |
| ch2 | 2번 입력 | 2번 채널만, 양쪽 출력에 똑같이 | |
| stereo | 스테레오 | 두 채널을 그대로 체인에 보냄(지금 동작) | |

트랙의 `getSettings().channelCount`가 1이면 메뉴를 숨긴다. 자동 판정 결과와 사용자가 고른 모드는 장치별로 기억한다.

```text
source(2ch) ─▶ ChannelSplitter(2) ─┬─ 0 ─▶ gainL ─┐
                                   └─ 1 ─▶ gainR ─┴─▶ mono(GainNode: channelCount 1, 'explicit') ─▶ inputTrim
stereo 모드: source ─────────────────────────────────────────────────────────────────────▶ inputTrim
            (모노 ↔ 스테레오 전환은 체인 재배치처럼 8 ms 페이드 후 재연결)
```

| 모드 | gainL | gainR |
|---|---|---|
| auto(판정 전) | 0.5 | 0.5 |
| ch1 또는 auto→1번 | 1 | 0 |
| ch2 또는 auto→2번 | 0 | 1 |

모노 신호가 스테레오 체인에 들어가면 Web Audio 업믹스 규칙에 따라 양쪽에 같은 소리가 간다(보고서의 '양쪽에 똑같이'). 튜너는 InputStage 출력(모노)을 쓰고, 튜너 워클릿의 '센 채널 고르기'(`tuner-processor.ts:139-159`)는 InputStage로 옮긴 뒤 남겨 둬도 무방하다.

```ts
// src/audio/engine/InputStage.ts
export type InputChannelMode = 'auto' | 'ch1' | 'ch2' | 'stereo';

export class InputStage {
  readonly output: AudioNode;                           // inputTrim에 연결
  constructor(context: BaseAudioContext, source: AudioNode, channelCount: number);
  setMode(mode: InputChannelMode): void;                // 램프로 gainL/gainR 변경
  onChannelLevels(rmsDb: [number, number]): void;       // MonitorService가 호출 → auto 판정
  readonly decision: 'pending' | 'sum' | 'ch1' | 'ch2'; // 화면 표시용
}
```

**DeviceManager**:

| 기능 | 설계 |
|---|---|
| 목록 자동 갱신 | `navigator.mediaDevices`의 `devicechange` 이벤트 → `enumerateDevices()` 재실행. '새로고침' 버튼은 예비용으로 남김 |
| 연주 중 장치 분리 | 트랙 `ended` 이벤트 또는 `devicechange` 뒤 선택 장치가 목록에 없음 → `AudioSession.stop('device-lost')` |
| 출력 장치 선택 | `'setSinkId' in AudioContext.prototype`이면 '출력 장치' 메뉴 표시, 바꾸면 `context.setSinkId(id)`. Chrome·Edge 110 이상 지원, Firefox·Safari 미지원 → 메뉴를 숨기고 '출력 장치는 시스템 설정에서 바꿔 주세요' 안내 |
| 장치 기억 | 입력·출력 장치의 `deviceId`와 `label`을 저장. 다음 연결 때 id로 찾고, 없으면 label로, 그래도 없으면 기본 장치 + 안내 '저장된 입력 장치를 찾지 못해 기본 장치로 연결했습니다'(R2-7의 '아무 안내 없이 버튼만 원래대로' 해결) |

### 4.5 게인 스테이징 규칙 (C4)

| ID | 규칙 | 적용 |
|---|---|---|
| GS-1 | 프리셋·Cab 음량은 기준 신호 REF-PC(합성 파워코드, 입력 피크 −12 dBFS — 부록 A)로 판정한다 | 모든 음량 판정 |
| GS-2 | REF-PC를 넣었을 때 출력 RMS = −20 dBFS(D6) ± 2 dB. 프리셋마다 `trimDb`를 두고 `presetTrim` 노드(체인 뒤, masterGain 앞)에 적용 | 팩토리 40개. 사용자 프리셋은 '음량 맞추기' 버튼 |
| GS-3 | Cab 켬/끔 RMS 차 ≤ 1.5 dB. IR을 만든 직후 에너지 정규화 + 모델별 보정값(P-04로 측정해 상수 표로) | `CabEffect.ts`, `cabinet.ts` |
| GS-4 | 시간계(Delay·Reverb)는 원음을 항상 1.0으로 두고 효과음만 Mix만큼 더한다 | R3-7 |
| GS-5 | 원음과 처리음을 섞는 이펙트는 두 경로의 지연이 같아야 한다(처리음이 늦으면 원음도 같은 만큼 늦춘다). 직접 구현하는 컴프는 지연 0 | R3-1 |
| GS-6 | 최종 리미터: ceiling −1 dBFS(샘플 피크), 룩어헤드 1 ms, 즉시 어택, 릴리즈 80 ms, 녹음에도 적용, 화면에 노출하지 않음 | R1-5 |
| GS-7 | 리미터는 사고 방지용이지 톤 장치가 아니다. GS-2가 맞춰진 상태의 REF-PC에서 리미터 최대 감소량 ≤ 1 dB ★ | P-05 |
| GS-8 | Compressor의 GR 표시는 실제 감소량이다(네이티브: `DynamicsCompressorNode.reduction`, 직접 구현: 워클릿이 전송) | R2-3 |

```ts
// scripts/compute-preset-trims.mjs — 프로브(S0.3)를 재사용
const PRESET_TARGET_RMS_DBFS = -20;                         // D6: 이 값 하나만 바꾸면 전부 다시 계산
trimDb = PRESET_TARGET_RMS_DBFS - measureRmsDbfs(preset, REF_PC);
trimDb = Math.max(-24, Math.min(24, trimDb));               // 비정상 값 방지
// 결과는 src/presets/factoryTrims.json 으로 저장해 커밋한다(생성물)
```

### 4.6 지연 예산 (D5)

| 구간 | 현재 | 목표 | 방법 |
|---|---|---|---|
| Compressor(기본 켜짐) | 약 6 ms(브라우저 컴프의 룩어헤드) | 0 ms | 워클릿 직접 구현(S3.6) |
| Drive(기본 켜짐) | 약 4 ms(4배 오버샘플링) | 약 2.7 ms 이하(보고서 추정, 실측으로 확정) | 2배 오버샘플링(S3.7) |
| Crunch·Fuzz(켤 때) | 각 약 4 ms | 각 2배 오버샘플링 값 | S3.7 |
| 리미터 | 0(없음) | 1.0 ms | 룩어헤드(GS-6) |
| **기본 구성 처리 합계** | **약 10 ms** | **약 3.7 ms(페달 약 2.7 + 리미터 1.0)** | |

화면의 지연 표시(R2-10):

```text
표시 지연 = 입력 + 처리 + 출력
  입력 = track.stats.latency(Chromium 125 이상) → 없으면 track.getSettings().latency → 둘 다 없으면 '입력 지연 미포함'
  처리 = Σ(활성 페달의 latencySeconds) + 리미터 룩어헤드
  출력 = context.baseLatency + context.outputLatency(없는 값은 '미포함'으로 표기)
```

- `BaseEffect`에 `get latencySeconds(): number`(기본 0)를 둔다. 오버샘플링 지연은 P-16으로 샘플레이트·배수별로 재서 `src/audio/params/latency.json`에 둔다.
- API마다 단위가 다르다(초 또는 밀리초). 구현 시 MDN으로 단위를 재확인하고 `latency.ts`에서 ms로 통일한다.

### 4.7 상태 모델 v2와 프리셋 형식 (C5)

```ts
// v1(현재 — S0.1에서 실제 타입 확인)
interface PedalStateV1 {
  id: PedalId; type: EffectType;
  enabled: boolean;   // 발스위치(LED)
  bypassed: boolean;  // Bypass 토글
  params: Record<string, number | string | boolean>; // mix 포함
}

// v2
interface PedalStateV2 {
  id: PedalId; type: EffectType;
  active: boolean;     // 소리에 걸리는가 = LED
  params: EffectParams; // 4.9 스키마로 검증된 값
}

interface PresetV2 {
  schemaVersion: 2;
  id: string;                     // crypto.randomUUID()
  name: string;
  origin: 'factory' | 'user';
  chain: PedalId[];               // 페달 순서
  pedals: Record<PedalId, PedalStateV2>;
  trimDb: number;                 // GS-2
  createdAt: string; updatedAt: string; // ISO 8601
}
```

v1 → v2 변환 규칙:

| 규칙 | 내용 | 해결 |
|---|---|---|
| M1 | `active = enabled && !bypassed` | R2-4 |
| M2 | `active`가 false이고 `params.mix === 0`이면 그 이펙트의 기본 Mix로 바꾼다(꺼져 있으므로 소리 변화 없음) | R2-2 |
| M3 | 파라미터를 4.9 스키마 범위로 clamp(예: Reverb decay 7.5 → 6.0) | R2-3, D14 |
| M4 | MIDI 매핑 대상 `…:enabled`·`…:bypass` → `…:active` | R2-9 |
| M5 | 팩토리 프리셋은 저장소에 두지 않는다(코드에 있음). 사용자 프리셋 중 팩토리와 내용이 똑같은 사본(이름+내용 해시 일치)이 있으면 '팩토리 프리셋과 똑같은 사본 N개가 있습니다. 정리할까요?'를 한 번 묻는다 | R2-6 후유증 |
| M6 | `trimDb`가 없으면 0 | GS-2 |
| M7 | 모르는 필드는 `_extra`에 보존, 깨진 JSON은 원문을 따로 보관한 뒤 기본값 | 데이터 손실 방지 |

변환 절차(앱 시작 때):

1. `guitar-pedalboard:schema` 키를 읽는다(없으면 v1).
2. v1이면 v1 키를 모두 읽어 메모리에서 변환한다.
3. v2 데이터를 `guitar-pedalboard:v2:state`와 `guitar-pedalboard:v2:presets` 두 키에 쓰고, **둘 다 성공한 뒤에만** schema 키를 2로 쓴다. 실패하면 이번 방문은 메모리의 v2로 동작하고 다음 방문에 다시 시도한다.
4. v1 키는 지우지 않는다(백업). 2개 릴리스 뒤 정리 Step에서 지운다.
5. 변환은 멱등이다(두 번 돌려도 결과가 같다).
6. 여러 탭: `storage` 이벤트로 v1 키가 다시 쓰이는 것을 감지하면 '다른 탭에서 이전 버전이 열려 있습니다. 그 탭을 닫고 새로고침해 주세요.'를 띄운다.

내보내기 파일 형식 v2:

```json
{
  "format": "guitar-pedalboard-presets",
  "schemaVersion": 2,
  "appVersion": "2.2.0",
  "exportedAt": "2026-11-23T02:00:00.000Z",
  "presets": []
}
```

- `presets`에는 `origin === 'user'`만 넣는다.
- 가져오기는 v1(배열 또는 객체)과 v2를 모두 받는다 → 변환 → 팩토리 항목 제외(`origin` 또는 이름+해시 일치) → 같은 id가 있으면 대화상자(덮어쓰기 / 사본으로 추가 / 건너뛰기) → 내용이 똑같으면 조용히 건너뜀 → 결과 토스트 'N개 가져옴 · M개 건너뜀'.

### 4.8 저장과 오류 경계 (C6)

```ts
// src/persistence/SafeStorage.ts
export type WriteResult = { ok: true } | { ok: false; reason: 'blocked' | 'quota' | 'unknown' };

export interface SafeStorage {
  readonly mode: 'persistent' | 'memory';                                   // 접근 불가면 memory
  get<T>(key: StorageKey, fallback: T, validate?: (v: unknown) => v is T): T; // 절대 throw하지 않음
  set(key: StorageKey, value: unknown): WriteResult;                         // 절대 throw하지 않음
  setDebounced(key: StorageKey, value: unknown, ms?: number): void;          // 기본 300 ms, pagehide에서 flush
  remove(key: StorageKey): void;
  usageBytes(): number;                                                      // 'guitar-pedalboard:' 키만 합산
}
```

| 상황 | 감지 | 동작 | 안내(1회) |
|---|---|---|---|
| 사이트 데이터 저장 차단 | `window.localStorage` 접근 시 `SecurityError` | memory 모드로 시작, 앱은 정상 표시 | '브라우저 설정 때문에 설정을 저장할 수 없습니다. 이번 방문 동안만 유지됩니다.' |
| 저장 공간 가득 참 | `setItem`의 `QuotaExceededError` | 값은 메모리에 유지, 조작 계속 | '저장 공간이 가득 차 설정이 저장되지 않았습니다. 같은 주소(kimyounggaur.github.io)에 올린 다른 앱의 데이터가 공간을 쓰고 있을 수 있습니다.' |
| 깨진 값 | `JSON.parse` 실패 또는 검증 실패 | 원문을 `…:corrupt-{시각}` 키에 보관 시도 → 기본값 | '저장된 설정 일부를 읽지 못해 기본값으로 시작합니다.' |

- 노브를 끄는 동안에는 저장하지 않고, 조작이 멈추고 300 ms 뒤 한 번 저장한다(R4-3). `pagehide`와 `visibilitychange`(hidden)에서 밀린 저장을 바로 쓴다.
- 팩토리 프리셋은 코드에 있으므로 저장하지 않는다(공간 절약). 설정 화면에 '이 앱이 쓰는 저장 공간: n KB'를 보여 준다.

**오류 경계**:

- `<AppErrorBoundary>`가 앱 전체를 감싼다. 오류가 나면 먼저 `AudioSession.stop('error')`로 소리를 끈 뒤 한국어 화면을 보여 준다: 제목 '문제가 생겨 화면을 표시하지 못했습니다', 버튼 '다시 시도'(경계 초기화), '설정을 초기화하고 다시 시작'(확인 후 `guitar-pedalboard:` 키만 지우고 새로고침), '오류 정보 복사'(오류 이름·메시지·앱 버전·브라우저).
- `main.tsx`의 `createRoot().render()`를 try/catch로 감싸, React가 아예 뜨지 못하면 정적 HTML 안내를 넣는다(흰 화면 0).
- `window`의 `error`·`unhandledrejection`은 토스트 '예기치 못한 오류가 생겼습니다'로 알리고 앱을 멈추지 않는다.

### 4.9 파라미터 스키마 — 한 곳에서 정의 (C8)

```ts
// src/audio/params/types.ts
export interface ParamDef {
  key: string;            // 저장 키 — 바꾸지 않는다
  label: string;          // 짧은 화면 이름, 예: 'LOW CUT'
  name: string;           // 전체 이름(툴팁·aria-label), 예: '로우컷 주파수'
  unit: 'dB' | 'Hz' | 'ms' | 's' | '%' | ':1' | '';
  min: number; max: number; step: number; default: number;
  taper: 'linear' | 'log' | 'audio';                       // 노브 위치 ↔ 값 곡선
  format?: (v: number) => string;                          // 값 표시, 예: 1600 → '1.6 kHz'
  disabledWhen?: (params: Record<string, unknown>) => boolean; // 예: Delay sync 켜짐 → time 비활성
}
export interface EffectSchema { type: EffectType; params: ParamDef[]; defaultMix?: number }
```

이 스키마를 쓰는 곳: KnobControl(라벨·값 표시·곡선·더블클릭 기본값·비활성), 이펙트 클래스(값 해석), 마이그레이션(clamp), 프리셋 검증, 테스트(화면에 그려진 모든 조절기에 정의가 있는지, 정의가 모두 쓰이는지).

이름·범위·기능 바로잡기(R2-3):

| 위치 | 지금 화면 | 실제로 하는 일 | 조치 | 새 표기(짧게 / 전체) |
|---|---|---|---|---|
| EQ 페달 페이더 1 | 100 | 로우컷 주파수 | 이름 변경 | LOW CUT / 로우컷 주파수(Hz) |
| EQ 페이더 2 | 200 | 저음 증감 | 이름 변경 | BASS / 저음(dB) |
| EQ 페이더 3 | 400 | 중음 증감 | 이름 변경 | MID / 중음(dB) |
| EQ 페이더 4 | 800 | 중음 주파수 | 이름 변경 | MID FREQ / 중음 주파수(Hz) |
| EQ 페이더 5 | 1.6k | 중음 폭 | 이름 변경 | MID Q / 중음 폭(Q) |
| EQ 페이더 6 | 3.2k | 고음 증감 | 이름 변경 | TREBLE / 고음(dB) |
| EQ 페이더 7 | 6.4k | 프레즌스 증감 | 이름 변경 | PRESENCE / 프레즌스(dB) |
| Noise Gate | Mode 노브 | 열리고 닫히는 기준의 간격(0~10 dB) | 이름 변경 | HYST / 열림·닫힘 간격(dB) |
| Compressor | Tone 노브 | 압축이 시작되는 구간의 완만함 | 이름 변경 | KNEE / 압축 시작 완만함(dB) |
| Compressor | Gain Reduction 미터 | 노브 위치로 계산한 고정 숫자(소리가 없어도 −5.9 dB) | 기능 변경 | 실제 감소량(GS-8) |
| Fuzz | Gate 슬라이더 | 출력을 최대 7 dB 낮출 뿐 | 기능 변경(D15) | GATE / 퍼즈 게이트 — 0 = 끔, 1~100 → 문턱 −80 ~ −30 dBFS |
| Reverb | Decay 6~10초 구간 | 6초와 같은 소리 | 범위 변경(D14) | DECAY / 잔향 길이(기존 최솟값 ~ 6 s) |
| Delay | Sync를 켰을 때의 D.Time | 돌려도 변화 없음, 비활성 표시 없음 | 비활성 표시 | 흐리게 + 조작 막음 + '1/4 · 500 ms'처럼 동기된 값 표시 |
| 프리셋 패널 | Output의 Peak·RMS 막대 | 46%·32% 고정 장식 | 삭제 | — |
| 프리셋 패널 | Store 탭 | 눌러도 동작 없음 | 삭제 | — |

### 4.10 레이아웃 규칙 (C9)

| 화면 폭 | 오른쪽 패널(입력·미터·프리셋) | 페달 그리드 | 하단 도크 |
|---|---|---|---|
| 767 px 이하(휴대폰) | 없음 → 하단 도크 | 1칸 | 탭 줄만 보이게 접힌 상태가 기본. 탭을 누르면 최대 50dvh로 펼침 |
| 768~1279 px | 기본 접힘, 버튼을 누르면 덮어 쓰는 서랍으로 펼침 | 최소 300 px 자동 칸 | 없음 |
| 1280 px 이상 | 기본 펼침(430~500 px), 접기 버튼 | 최소 300 px 자동 칸 | 없음 |

```css
.pedal-grid {
  display: grid;
  gap: var(--space-4);
  grid-template-columns: repeat(auto-fill, minmax(min(300px, 100%), 1fr));
}
.pedal-card { container-type: inline-size; }
@container (max-width: 340px) {
  .pedal-card .knob-row { grid-template-columns: repeat(2, 1fr); } /* 겹치지 않고 줄을 바꾼다 */
}
.knob-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; } /* 전체 이름은 title·aria-label */
.app-main { padding-bottom: calc(var(--dock-h, 0px) + env(safe-area-inset-bottom) + 16px); }
```

- `--dock-h`는 도크에 붙인 ResizeObserver가 실제 높이로 갱신한다. 도크가 펼쳐져도 페이지 끝까지 스크롤하면 마지막 페달이 도크 위로 올라온다(R1-1).
- 화면 위쪽 압축: 연결 후에는 큰 연결 안내(`ConnectGuitarPanel`)를 한 줄 상태 바(장치·채널·지연·연결 해제)로 접는다. 데스크톱 로고 높이 ≤ 56 px. 목표: 1280×800에서 첫 페달 위쪽 끝 ≤ 320 px ★(현재 604 px).
- 터치 화면의 스위치 터치 영역 ≥ 44×44 px.

글자·대비 토큰(D12):

```css
:root {
  --fs-min: 11px;    /* 이보다 작은 글자 금지 */
  --fs-label: 12px;  /* 노브 라벨 */
  --fs-value: 13px;  /* 노브 값 */
  --c-text-on-light: #1f2430; /* 밝은 카드 위 글자: 대비 4.5:1 이상이 되는 값으로 확정 */
  --c-text-on-dark: #e8ecf3;
}
```

글자 대비 ≥ 4.5:1, 상태 표시(LED 켜짐/꺼짐)는 배경 대비 ≥ 3:1이고 색만으로 구분하지 않는다(모양·aria 상태 함께).

### 4.11 입력 처리 — 단축키·MIDI·파일 재생 (C10)

**단축키**(ShortcutService, `KeyboardEvent.code` 기준):

| 키(code) | 동작 | 비고 |
|---|---|---|
| Digit1~Digit9 | 체인 1~9번째 페달 켜기/끄기 | 위치 기준인지 이펙트 기준인지는 현재 방식 유지(S0.1 확인) |
| Shift + Digit1~Digit6 | 10~15번째 페달 | D13 |
| KeyT | 탭 템포 | |
| KeyA / KeyB | A/B 슬롯 전환 | |
| Space | 장치 모드: 연결/연결 해제 · 파일 모드: 재생/일시정지 | 파일 모드에서 마이크로 바뀌지 않음(R2-5) |
| Escape | 대화상자·메뉴가 열려 있으면 그것만 닫음. 없으면 Panic(녹음 저장 후 정지) | R2-12 |
| Shift + Slash(?) | 단축키 도움말 | |

- 공통: 입력 칸·선택 상자·contenteditable에 포커스가 있으면 무시, Ctrl·⌘·Alt와 함께 누르면 무시(표에 있는 조합 제외), 토글 계열은 `event.repeat` 무시, 처리한 키만 `preventDefault`.
- `code`를 쓰는 이유: 한글 입력 상태에서 T를 누르면 `key`는 'ㅅ'(또는 'Process')이지만 `code`는 항상 'KeyT'다.

**MIDI**(MidiService):

| 항목 | 지금 | 바꾼 뒤 |
|---|---|---|
| 시작할 때 연결 | 'MIDI 학습'을 눌러야 연결 | 저장된 매핑이 있으면 시작할 때 연결. `navigator.permissions.query({ name: 'midi' })`가 granted면 자동, prompt면 배너의 'MIDI 풋스위치 다시 연결' 버튼(사용자 동작으로 권한 요청 — 로드하자마자 권한 창이 뜨지 않게) |
| 상태 표시 | '매핑됨'만 | '매핑됨 · 연결됨' / '매핑됨 · 장치 없음' 구분 |
| 장치 재연결 | 없음 | `MIDIAccess.onstatechange`로 새 입력에 리스너를 다시 붙임 |
| 값 방향 | 127 = 효과 꺼짐 | 64 이상 = 켜짐 |
| 동작 방식 | 래치 하나(방향 반대) | `latch`(64 이상 켜짐, 미만 꺼짐)와 `toggle`(누를 때마다 전환, 뗌 무시). 학습 중 1초 안에 누름(64 이상) → 뗌(64 미만)이 이어서 오면 `toggle`, 한 번만 오면 `latch`로 자동 지정, 사용자가 바꿀 수 있음 |
| 대상 | enabled 또는 bypass | `active`(스키마 v2) |

Note On(velocity > 0)은 누름, Note Off 또는 velocity 0은 뗌으로 본다.

**파일 재생**(R2-5):

| 항목 | 설계 |
|---|---|
| 파일 유지 | 재생이 끝나도 File을 보존. 다른 파일을 열거나 '파일 닫기'를 누를 때만 놓는다 |
| 반복 | '반복 재생' 기본 켜짐(`audio.loop = true`) |
| 탐색 | 탐색 막대(현재 시간 / 전체 길이), ±10초 버튼 유지 |
| Space | 재생/일시정지 |
| 세션을 다시 시작할 때 | `createMediaElementSource`는 요소마다 한 번만 부를 수 있으므로 세션마다 새 `<audio>` 요소와 Object URL을 만들고 이전 URL은 해제 |
| 파일 열기 버튼 | 숨긴 `input type=file` + 한국어 버튼 '음원 파일 열기'(브라우저 기본 'Choose File' 노출 금지) |

### 4.12 표시 원칙과 레벨 경고 (C7)

1. 화면의 수치는 실측(워클릿·브라우저 통계) 또는 파라미터 값에서만 나온다. 고정값·장식 수치 금지.
2. 잴 수 없으면 0이 아니라 '측정 불가'(툴팁에 이유)로 쓴다.
3. 경고는 근거가 있을 때만 띄우고, 띄울 때와 지울 때 시간 간격(히스테리시스)을 둔다.

레벨 경고(MonitorService가 판정, 기준은 level-meter#in의 선택 채널 원신호):

| 상태 | 조건 | 표시 | 해제 |
|---|---|---|---|
| 신호 없음 | 장치 모드에서 5초 동안 피크 < −70 dBFS | '입력 신호가 없습니다. 케이블과 입력 채널(1번/2번)을 확인하세요.' | 피크 ≥ −60 dBFS |
| 너무 작음 | 최근 3초 안에 연주가 있었고(피크 ≥ −60 dBFS) 그 3초의 최대 피크 < −36 dBFS | '입력이 작습니다. 인터페이스 게인이나 입력 트림을 올리세요.' | 3초 최대 피크 ≥ −30 dBFS |
| 너무 큼 | 원신호 피크 ≥ −0.5 dBFS(인터페이스 단계에서 깨짐) | '입력이 너무 큽니다. 인터페이스 게인을 낮추세요.' | 3초 동안 깨짐 없음 |
| 판단하지 않음 | 파일 일시정지, 세션 정지, 연결 직후 1초 | 경고 없음 | — |

수치는 초기값이다. 실제 기타로 조정한다(6.5).

끊김 표시(D11): '끊김' = `context.playbackStats.underrunEvents`의 세션 시작 대비 증가분. 브라우저가 1초마다 갱신하므로 1초마다 다시 읽는다. 지원하지 않으면 '측정 불가'. 지연 경고의 'ASIO 드라이버' 안내는 '지연을 줄이려면: 유선 헤드폰 사용 · 블루투스 끄기 · 다른 오디오 앱 닫기 · 인터페이스를 48 kHz로 설정 · 노트북 전원 연결'로 바꾼다.

### 4.13 문구와 언어

- 문구 카탈로그 `src/i18n/ko.ts`: `export const ko = { session: { panicDone: '…' }, … } as const`. 키 경로로 쓰고, 없는 키는 타입 오류가 나게 한다.
- 원칙: 안내·버튼·오류는 한국어로 쓴다. 페달 면의 짧은 이름(NOISE GATE 등)과 노브 약어는 디자인 요소라 영문을 허용하되 `aria-label`·툴팁은 한국어 전체 이름으로 한다. 내부 ID(`noiseGate` 등)는 화면에 나오지 않는다. 개발자용 문구('드래그 종료 후 체인을 재연결합니다')는 드래그 중 상태 문구로만 쓴다.
- 예: 'Preset saved' → '프리셋을 저장했습니다', 'Signal Chain Updated' → '페달 순서를 바꿨습니다'.

연결 오류 안내(R2-7):

| 오류 이름 | 상황 | 안내 |
|---|---|---|
| NotAllowedError | 마이크 권한 거부·차단 | '마이크 권한이 차단되어 있습니다. 주소창의 자물쇠 아이콘에서 마이크를 허용한 뒤 다시 연결해 주세요.' |
| NotFoundError | 입력 장치 없음 | '입력 장치를 찾을 수 없습니다. 오디오 인터페이스나 마이크가 연결되어 있는지 확인해 주세요.' |
| NotReadableError | 다른 프로그램이 사용 중, 하드웨어 오류 | '입력 장치를 열 수 없습니다. 장치를 쓰는 다른 프로그램을 닫고 다시 시도해 주세요.' |
| OverconstrainedError | 저장된 장치 ID가 없음 | 기본 장치로 자동 재시도 후 '저장된 입력 장치를 찾지 못해 기본 장치로 연결했습니다.' |
| SecurityError | 보안 출처가 아님 | '이 주소에서는 마이크를 쓸 수 없습니다. https 주소로 접속해 주세요.' |
| AbortError | 장치 시작 실패 | '장치를 시작하지 못했습니다. 장치를 다시 꽂고 시도해 주세요.' |
| 워클릿 로드 실패 | `audioWorklet.addModule` 예외 | '오디오 엔진을 시작하지 못했습니다. 브라우저를 최신 버전으로 업데이트해 주세요.' |
| 그 밖 | — | '연결하지 못했습니다(오류: {name}). 페이지를 새로 고친 뒤 다시 시도해 주세요.' |

### 4.14 목표 디렉터리 구조

```text
src/
├─ app/AppErrorBoundary.tsx            [신규] S1.7
├─ audio/
│  ├─ AudioEngine.ts                   [변경] 그래프 조립만 담당(입·출력 스테이지에 위임)
│  ├─ engine/
│  │  ├─ AudioSession.ts               [신규] S1.2 상태 기계·하나뿐인 정리 절차
│  │  ├─ InputStage.ts                 [신규] S1.3
│  │  ├─ OutputStage.ts                [신규] S1.4a, S1.5
│  │  ├─ latency.ts                    [신규] S2.10
│  │  └─ errors.ts                     [신규] S2.3
│  ├─ devices/DeviceManager.ts         [신규] S2.13
│  ├─ monitor/MonitorService.ts        [신규] S1.5
│  ├─ midi/MidiService.ts              [이동·변경] S2.9(기존 midi.ts)
│  ├─ recording.ts                     [변경] S1.2(finalize), S5.1(WAV)
│  ├─ params/                          [신규] S2.2 파라미터 스키마, latency.json
│  ├─ nodes/                           [변경] BaseEffect(latencySeconds·mixLaw·idle), 이펙트별 수정
│  ├─ worklets/
│  │  ├─ limiter.worklet.ts            [신규] S1.4a
│  │  ├─ level-meter.worklet.ts        [신규] S1.5
│  │  ├─ output-guard.worklet.ts       [신규] S1.5
│  │  ├─ flanger.worklet.ts            [신규] S3.4
│  │  ├─ phaser.worklet.ts             [신규] S3.4
│  │  └─ compressor.worklet.ts         [신규] S3.6
│  └─ testing/renderProbe.ts·signals.ts [신규] S0.3
├─ persistence/
│  ├─ SafeStorage.ts                   [신규] S1.7
│  ├─ schema.ts                        [신규] S2.4
│  ├─ exportFormat.ts                  [신규] S2.7
│  └─ migrations/v1-to-v2.ts           [신규] S2.4
├─ presets/
│  ├─ normalize.ts                     [신규] S2.1
│  └─ factoryTrims.json                [생성물] S1.4c, S3.8
├─ input/ShortcutService.ts            [신규] S2.11
├─ i18n/ko.ts                          [신규] S2.3 → S4.6
├─ config/flags.ts                     [신규] Phase 3
├─ store/                              [변경] sessionStore·monitorStore·uiStore 신규, 기존 3개는 서비스 호출로 축소
└─ components/                         [변경] KnobControl·Toast·ConfirmDialog·FilePlayer 신규
probe.html · scripts/audio-render-probe.mjs · scripts/compute-preset-trims.mjs     [신규] S0.3, S1.4c
e2e/ · playwright.config.ts                                                         [신규] S0.4
docs/refactoring-design.md(이 문서) · docs/refactoring/code-map.md · docs/baseline/ · docs/listening/
```

파일 이동은 그 파일을 다루는 Step에서만 하고, 같은 PR에 로직 변경을 섞지 않는다(0.3-4).

---

## 5. 단계별 실행 계획

### 5.0 로드맵 개요

규모: **S** = Claude Code 세션 1회(검증 포함) · **M** = 1~2회 · **L** = 3회 이상 또는 사람의 청취·실기기 확인이 필요.

| Phase | 목표 | Step | 해결 항목 | 규모 구성 | 대략 세션 수 | 선행 | 배포 |
|---|---|---|---|---|---|---|---|
| 0 안전망 | 소리·화면을 재는 테스트와 CI 게이트, 기준선 기록 | S0.1~S0.4 | R4-7(기반), R4-9 일부 | S2 · M1 · L1 | 약 7 | — | 앱 변화 없음 |
| 1 안전과 핵심 조작 | 청력 안전, 보호 독립, 조작 가능 | S1.1~S1.8(S1.4는 a·b·c) | R1-1~R1-7, R2-1 | S2 · M6 · L2 | 약 20 | Phase 0 | v2.1 |
| 2 믿을 수 있는 표시 | 표시 = 실제 동작 | S2.1~S2.14 | R2-2~R2-15 | S6 · M6 · L2 | 약 24 | S1.2, S1.5, S1.7 | 2a(S2.1~S2.7) v2.2, 2b(S2.8~S2.14) v2.3 |
| 3 음질 | 3순위 7건, 처리 지연 | S3.1~S3.8 | R3-1~R3-7, D5 | S4 · M2 · L2 | 약 14 + 청취 | Phase 0, S1.4 | v2.4(청취 승인 후) |
| 4 성능·정리 | 속도, 읽기 편함, 안전한 수정 | S4.1~S4.9 | R4-1~R4-9 | S4 · M5 | 약 14 | S4.4는 S1.8·S2.2 뒤 | v2.5 |
| 5 보완 기능(선택) | 연습 도구 확장 | S5.1~S5.6 | RX-1~RX-6 | S2 · M4 | 약 10 | Phase 1~2 | 기능별 |

보고서 권장 순서(안전 → 표시 → 음질 → 성능)를 따르되, 보고서 말미의 권고대로 **소리를 재는 테스트를 맨 먼저**(Phase 0) 만든다.

임계 경로(늦어지면 전체가 늦어지는 줄):

```text
Phase 1: S0.3 → S1.4a → S1.5 → S1.6 → S1.8
          S0.4 → S1.2 → S1.3 ─┘(S1.5의 선행)
Phase 2: S1.7 → S2.1 → S2.2 → S2.4 → S2.7 · S2.9 · S2.11
Phase 3: S0.3 → S3.4 · S3.6 → S3.7 → S3.8(청취 승인)
```

Step 공통 형식: 표(해결 항목·규모와 선행·대상 파일) → 현재 → 변경 → 수용 기준(체크리스트) → 테스트 → 주의.

---

### 5.1 Phase 0 — 안전망

**목표**: 고치기 전에 지금의 소리와 화면을 수치로 기록하고, 테스트가 배포를 막을 수 있게 만든다.
**규칙**: 이 Phase에서는 앱 동작을 한 줄도 바꾸지 않는다(기준선이 오염된다). 타입을 넓히는 것(`AudioContext` → `BaseAudioContext`)만 예외다.

#### S0.1 코드 지도 갱신과 현황 조사

| 항목 | 내용 |
|---|---|
| 해결 | 선행 작업 — 확보하지 못한 기술 부록을 대신함 |
| 규모·선행 | S · 없음 |
| 산출물 | `docs/refactoring/code-map.md`, `e2e/fixtures/storage-v1/*.json`(마이그레이션 픽스처) |

**작업**

1. `git log -1 --format=%h` 확인. `4ac9cf7`이 아니면 이 문서의 줄 번호를 모두 '재확인 필요'로 표시한다.
2. 5장 모든 Step의 '대상 파일'에 대해 실제 경로·함수 이름·줄 범위를 표로 기록한다. '(추정)' 경로를 실제 경로로 바꾼다.
3. 현재 저장 키 목록(`guitar-pedalboard:*`)과 값 구조, `PedalState`의 실제 타입, 팩토리 프리셋 정의 위치, MIDI 매핑 형식, 단축키 1~9가 체인 위치 기준인지 이펙트 기준인지, 이펙트 기본 순서를 기록한다.
4. 테스트 14개를 '동작 검증'과 '소스 문자열 검사'로 나누고, 정규식 단언 337곳의 위치를 목록으로 만든다.
5. 실제 브라우저의 v1 저장 데이터를 6종 픽스처로 만든다: 기본 상태만, 사용자 프리셋(enabled·bypassed 조합 4가지), 깨진 JSON, 꺼진 페달 Mix 0, Reverb decay 7.5, Bypass를 대상으로 한 MIDI 매핑.
6. 프리셋 이름 가운데 특정 제품을 떠올리게 하는 표현을 목록으로 만든다(D3 검토용).

**수용 기준**

- [ ] code-map.md에 5장 모든 Step의 대상 경로가 '확인됨'으로 표시됨
- [ ] 저장 키·타입·MIDI 형식이 7장 마이그레이션 픽스처로 바로 쓸 수 있을 만큼 구체적임
- [ ] 정규식 단언 목록의 합계가 보고서의 337곳과 일치(다르면 이유 기록)

**주의**: 코드는 고치지 않는다(문서와 픽스처만).

#### S0.2 테스트 일괄 실행과 CI 게이트

| 항목 | 내용 |
|---|---|
| 해결 | R4-7(배포 과정에서 테스트를 돌리지 않음), R4-9 일부(esbuild 누락) |
| 규모·선행 | S · S0.1 |
| 대상 파일 | `package.json`(scripts, devDependencies, engines), `scripts/run-all-tests.mjs`(신규), `.github/workflows/deploy.yml`(32~35행), `.github/workflows/verify.yml`(신규), `scripts/responsive-a11y-regression.mjs`(250~253행) |

**변경**

1. 테스트가 이미 쓰는 `esbuild`를 devDependencies에 넣는다. Node 버전을 `engines`와 CI에 고정한다(TS 직접 실행을 위해 Node 22 이상).
2. `"test": "node scripts/run-all-tests.mjs"`를 만든다. `test:*` 스크립트를 차례로 실행하고 하나라도 실패하면 종료 코드 1.
3. responsive-a11y 테스트는 `CI=true`인데 Chrome이 없으면 '건너뜀' 대신 실패한다.
4. deploy.yml의 build 앞에 `typecheck → lint → test`를 넣는다. 실패하면 배포하지 않는다. Chrome 경로는 `CHROME_PATH` 환경변수로 준다.
5. PR마다 같은 검사를 하는 `verify.yml`을 추가한다(배포 없음).

**수용 기준**

- [ ] `npm test` 한 번에 14개 결과가 나오고, 테스트 하나를 일부러 깨면 종료 코드 1
- [ ] main 배포 워크플로가 테스트 실패 시 배포하지 않음
- [ ] PR에서 verify가 돈다(병합 차단용 브랜치 보호 규칙은 사람이 GitHub 설정에서 켠다)

#### S0.3 오디오 렌더 프로브와 기준선

| 항목 | 내용 |
|---|---|
| 해결 | R4-7(소리를 재는 테스트), 이후 모든 음질 Step의 판정 도구 |
| 규모·선행 | L · S0.2 |
| 대상 파일 | `src/audio/testing/renderProbe.ts`·`signals.ts`(신규), `probe.html`(신규, `--mode test` 빌드에서만 입력에 포함 — `vite.config.ts`), `scripts/audio-render-probe.mjs`(신규), `docs/baseline/audio-probe.json`·`tolerances.json`(신규), 이펙트 생성자의 컨텍스트 타입(`BaseEffect.ts:14`, `:32` 등) |

**변경**

1. 실제 이펙트 클래스와 워클릿을 `OfflineAudioContext(2, 샘플레이트 × 길이, 샘플레이트)`에서 돌리는 하네스를 만든다. 44.1 kHz와 48 kHz에서 각각 잰다.
2. 부록 A의 기준 신호를 `signals.ts`에 결정적으로(고정 시드) 만든다.
3. 6.2절 프로브 가운데 지금 코드로 잴 수 있는 것(P-01~P-06, P-08~P-18, P-20~P-23)을 모두 구현하고 기준선을 기록한다. P-07·P-19처럼 새 구성 요소가 필요한 것은 해당 Step에서 추가한다.
4. 비교기: 기준선 대비 `tolerances.json`의 허용 오차를 넘으면 실패. 기준선 갱신은 `npm run probe -- --update`로만 하고 커밋 메시지는 `baseline: {Step ID} {이유}`.
5. `npm run probe`를 `npm test`에 넣는다.

**수용 기준**

- [ ] 기준선 JSON에 잴 수 있는 프로브 전부 × 샘플레이트 2개가 기록됨
- [ ] 기록값이 보고서의 현상과 같은 방향: P-01 잡음 증폭이 큼, P-04 Cab 차이 약 15 dB, P-05 분포 폭 약 27 dB, P-15 Delay 원음 −3 dB, P-11 Flanger 반복 간격 약 4.7 ms
- [ ] 같은 코드로 두 번 돌리면 차이가 허용 오차 안(결정적 재현)

**주의**: DSP 동작 변경 금지. 타입 넓히기 외에는 이펙트 코드를 건드리지 않는다. OfflineAudioContext에서 워클릿 등록이 실패해 일부 항목을 잴 수 없으면 대안을 적고 멈춘다.

#### S0.4 브라우저 시나리오 하네스

| 항목 | 내용 |
|---|---|
| 해결 | 화면·상호작용 회귀의 기반(E-xx 전부) |
| 규모·선행 | M · S0.2 |
| 대상 파일 | `e2e/`(신규), `playwright.config.ts`(신규, D16), `e2e/fixtures/*.wav`(가짜 마이크 신호) |

**변경**

1. Chromium 실행 인자: `--use-fake-ui-for-media-stream`, `--use-fake-device-for-media-stream`, `--use-file-for-fake-audio-capture=e2e/fixtures/{신호}.wav`(부록 A 신호를 WAV로 저장해 가짜 마이크로 넣는다).
2. 화면 프로필 10종: 390×844, 360×640, 412×915, 768×1024, 1024×768, 1280×800, 1366×768, 1440×900, 1536×864, 1920×1080. 필요하면 1680×1050 추가.
3. 공통 도우미:
   - 도달성: 요소를 화면 가운데로 스크롤한 뒤 그 중심점의 `document.elementFromPoint`가 그 요소(또는 자손)인지
   - 같은 카드 안 텍스트 상자끼리 겹치는 수
   - 스위치가 화면에 보이는 비율
   - 저장소 차단·가득 참 모의(`addInitScript`로 `localStorage` 접근자와 `setItem`을 바꿔 치기)
   - Web MIDI 모의(`navigator.requestMIDIAccess` 대체)
   - 문서 숨김 모의(`visibilityState` 대체 + 두 번째 탭을 앞으로)
   - `getUserMedia` 오류 모의(각 오류 이름으로 거부)
4. 현재 상태의 스크린샷과 측정값을 기준으로 기록한다(E-04, E-06 기준선).

**수용 기준**

- [ ] `npm run e2e`가 CI에서 돌고, 기준 측정값(예: 1280 px 겹침 45곳, 휴대폰 스위치 도달 0%)이 보고서 수치와 같은 방향으로 재현됨
- [ ] 가짜 마이크 WAV가 앱 입력으로 들어와 출력 미터가 반응함

---

### 5.2 Phase 1 — 안전과 핵심 조작

**목표**: 귀를 다치게 하거나 기본 조작을 막는 7건과 저장 오류를 고친다. 보고서 권장대로 작은 수정(Crunch 곡선, Panic 정리, 좌우 입력)부터 시작한다.
**배포 조건**: S1.1~S1.8 수용 기준 전부 + 6.5 청취 체크리스트 중 '기본 구성·Crunch 계열·채널 쏠림·하울링(작은 음량)' 항목.

#### S1.1 Crunch 곡선 0점 연속화

| 항목 | 내용 |
|---|---|
| 해결 | R1-6 |
| 규모·선행 | S · S0.3 |
| 대상 파일 | `src/audio/utils/curves.ts` `createCrunchCurve`(38~55행, 원인은 46행) |

**현재**: `const asymmetrical = x + (x > 0 ? sag * 0.18 : -sag * 0.08);` — 입력 부호에 따라 다른 상수를 더해 곡선이 0에서 계단처럼 뛴다. 앞단 증폭이 미세 잡음을 이 계단 위로 올려, 연주하지 않을 때도 −90 dBFS 잡음이 −23 dBFS로 나온다. 음이 사라질 때도 출력이 거의 줄지 않는다(입력 −55 dB에 출력 −5 dB). 해당 프리셋: British Crunch, Plexi Lead, Thrash Rhythm.

**변경**: 양·음 영역의 기울기만 다르고 f(0) = 0인 연속 비대칭 곡선으로 바꾼다. 짝수 배음(비대칭 성격)은 유지된다. 아래는 10월 계획서 Step 1.1의 스케치다. 기존 함수의 나머지 처리와 합칠 때 S0.1 코드 지도로 확인한다.

```ts
export function createCrunchCurve(gain: number, samples = 4096): Float32Array {
  const curve = new Float32Array(samples);
  const drive = 1.6 + (gain / 100) * 34;
  const hardClip = 0.86 - (gain / 100) * 0.36;
  const negativeScale = 0.82 - (gain / 100) * 0.1; // 음의 반주기를 덜 밀어 짝수 배음을 만든다
  const posNorm = Math.tanh(drive);
  const negNorm = Math.tanh(drive * negativeScale);
  for (let i = 0; i < samples; i += 1) {
    const x = (i * 2) / (samples - 1) - 1;
    const soft = x >= 0
      ? Math.tanh(drive * x) / posNorm
      : Math.tanh(drive * negativeScale * x) / negNorm; // f(0) = 0, 연속
    const clipped = Math.max(-hardClip, Math.min(hardClip, soft)) / hardClip;
    curve[i] = Math.tanh((soft * 0.7 + clipped * 0.3) * 1.08);
  }
  return curve;
}
```

Gain 노브의 곡선(R3-6, 20~30%에서 이미 최대)은 S3.5에서 다룬다. 이 Step은 0점 불연속만 고친다.

**수용 기준**

- [ ] gain 0~100 전 구간에서 곡선 가운데 인접 샘플 차 `|y[N/2] − y[N/2 − 1]| < 0.01`
- [ ] P-01: 무연주 잡음(−90 dBFS) 출력과 연주음 출력의 차 ≥ 30 dB ★(현재 10 dB)
- [ ] P-02: 입력이 55 dB 줄 때 출력이 25 dB 이상 줄어듦 ★(현재 5 dB)
- [ ] 세 프리셋의 연주음 출력 레벨 변화 ±3 dB 이내 ★

**테스트**: P-01, P-02, 단위 테스트 `curves.test.ts`
**청취**: 세 프리셋에서 줄을 손으로 막고 30초 — '지글거리는' 잡음이 없어야 한다.

#### S1.2 모든 정지를 하나의 정리 절차로 (AudioSession)

| 항목 | 내용 |
|---|---|
| 해결 | R1-3, R1-2(차단 시 녹음 폐기), R2-12(Esc가 녹음 폐기) |
| 규모·선행 | M · S0.4 |
| 대상 파일 | `src/audio/engine/AudioSession.ts`(신규), `src/store/sessionStore.ts`(신규) 또는 `audioStore.ts`의 연결·해제 액션, `audioStore.ts`(1036~1068행 하울링·녹음, 1055행 `finishActiveRecording('abort')`), `src/audio/recording.ts`, `GlobalKeyboardShortcuts.tsx`(Esc), Panic 버튼 컴포넌트(추정: `Meter.tsx` 또는 `AppShell.tsx`) |

**현재**: Panic 버튼·Esc·하울링 차단은 소리 출력만 끊는다. 화면은 '기타 연결하기'로 돌아가지만 5초 뒤에도 마이크 입력과 엔진이 살아 있다. '연결 해제'만 둘 다 정상으로 끈다. 녹음 중이었으면 저장하지 않고 버린다.

**변경**

1. '연결 해제'의 정리 코드를 `AudioSession.teardown()`으로 옮기고 4.2절 순서표대로 정리한다.
2. Panic 버튼, Esc, 하울링 차단이 모두 `stop(reason)`을 부르게 한다. 기존의 '출력만 끄기' 코드는 지운다.
3. 녹음: `abort` 경로를 지우고 `finalize`(MediaRecorder `stop` 이벤트까지 기다림, 2초 시간 제한)로 Blob을 남긴다. 정지 뒤에도 '녹음 다운로드' 버튼을 활성으로 둔다.
4. 이유별 안내(4.2절 표)를 토스트로 띄운다. 토스트 컴포넌트가 아직 없으면 S1.7보다 먼저 최소 형태로 만든다.
5. 이 Step에서는 기존 rAF 하울링 감시를 그대로 두고, 차단할 때 `stop('howl')`만 부르게 바꾼다. 감시를 오디오 스레드로 옮기는 일은 S1.5다.

**수용 기준**

- [ ] E-01: Panic·Esc·하울링 차단(모의) 뒤 500 ms 안에 모든 입력 트랙 `readyState === 'ended'`, `AudioContext.state === 'closed'`, 화면이 '기타 연결하기' 상태
- [ ] 녹음 중 Panic → 녹음 파일을 다운로드할 수 있고, 재생 길이 = 녹음 시간 ±0.5초
- [ ] 대화상자가 열린 상태의 Esc는 대화상자만 닫는다
- [ ] 정지 → 다시 연결을 10번 반복해도 AudioContext가 동시에 2개 이상 생기지 않음

**주의**: 정지 이유마다 다른 정리 코드를 만들지 않는다. 하나의 경로가 이 Step의 핵심이다.

#### S1.3 입력 채널 처리 (InputStage)

| 항목 | 내용 |
|---|---|
| 해결 | R1-4 |
| 규모·선행 | M · S1.2 |
| 대상 파일 | `src/audio/engine/InputStage.ts`(신규), `AudioEngine.ts`(121~135행 입력 연결, 127행 `channelCount`), `src/components/DeviceSelector.tsx`(채널 메뉴), IO 설정 저장(현재 `guitar-pedalboard:io`, v2 키 전환은 S2.4), `tuner-processor.ts`(139~159행 '센 채널 고르기') |

**현재**: 2입력 오디오 인터페이스의 1번 입력에 기타를 꽂으면 왼쪽 출력은 −20 dB, 오른쪽은 무음이다. README가 권장하는 장비 구성에서 바로 생긴다.

**변경**: 4.4절 InputStage를 만든다. 기본은 '자동'. 트랙 `channelCount`가 1이면 메뉴를 숨긴다. 자동 판정 결과를 화면에 한 줄로 보여 주고 바꿀 수 있게 한다.

**수용 기준**

- [ ] P-06 / E-02: 왼쪽에만 신호가 있는 스테레오 입력(인터페이스 1번 입력 재현) → 자동 판정 뒤 출력 좌우 RMS 차 ≤ 1 dB, 레벨 손실 ≤ 0.5 dB(합칠 때의 −6 dB가 남지 않음)
- [ ] '1번 / 2번 / 스테레오'를 고르면 20 ms 페이드로 바로 반영되고 장치별로 기억됨
- [ ] 양쪽에 같은 신호(진짜 모노 장치) → 자동 판정이 '합침'을 유지하고 레벨 변화 없음
- [ ] 튜너 정확도 회귀 없음(기존 튜너 테스트 통과)

#### S1.4 출력 보호와 음량 정렬 (PR 3개)

S1.4b와 S1.4c는 **같은 배포에 넣는다.** S1.4b만 나가면 Cab을 쓰는 프리셋이 약 15 dB 커진다.

##### S1.4a 마스터 리미터 (OutputStage 1단계)

| 항목 | 내용 |
|---|---|
| 해결 | R1-5(마지막 출력 단계에 리미터 없음) |
| 규모·선행 | M · S0.3 |
| 대상 파일 | `src/audio/worklets/limiter.worklet.ts`(신규), `src/audio/engine/OutputStage.ts`(신규), `AudioEngine.ts` `createProcessingGraph`(554~577행, 574~575행 `masterGain.connect(destination)`), `createRecorderStream`(314~325행), `loadWorklets`(499~513행), `vite.config.ts`(워클릿 파일 프리캐시) |

**변경**

1. `masterGain → limiter → [destination, outputMeter, recorder]`로 바꾼다.
2. 리미터 사양(GS-6): ceiling −1 dBFS, 룩어헤드 1 ms, 즉시 어택, 릴리즈 80 ms, 화면 비노출. 감소량 계산 뒤 ceiling으로 한 번 더 자른다(수치 오차 대비).
3. 워클릿을 별도 파일 + `?worker&url`로 불러오는 방식(4.1 규칙 6)을 이 Step에서 검증한다. 오프라인 새로고침 뒤에도 불러와지는지 확인한다.

```js
// limiter.worklet.ts 핵심(10월 계획서 Step 2.1 스케치에서 룩어헤드만 1 ms로)
class LimiterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.look = Math.max(1, Math.round(sampleRate * 0.001));
    this.ceiling = Math.pow(10, -1 / 20);
    this.release = Math.exp(-1 / (sampleRate * 0.08));
    this.lines = [new Float32Array(this.look), new Float32Array(this.look)];
    this.peaks = new Float32Array(this.look);
    this.index = 0;
    this.gain = 1;
  }
  process(inputs, outputs) {
    const input = inputs[0], output = outputs[0];
    for (let i = 0; i < output[0].length; i += 1) {
      let peak = 0;
      for (let ch = 0; ch < output.length; ch += 1) {
        peak = Math.max(peak, Math.abs(((input[ch] || input[0]) || [])[i] || 0));
      }
      this.peaks[this.index] = peak;
      let windowPeak = 0;
      for (let k = 0; k < this.look; k += 1) windowPeak = Math.max(windowPeak, this.peaks[k]);
      const target = windowPeak > this.ceiling ? this.ceiling / windowPeak : 1;
      this.gain = target < this.gain ? target : target + (this.gain - target) * this.release;
      for (let ch = 0; ch < output.length; ch += 1) {
        const line = this.lines[ch] || this.lines[0];
        const delayed = line[this.index];
        line[this.index] = ((input[ch] || input[0]) || [])[i] || 0;
        const y = delayed * this.gain;
        output[ch][i] = Math.max(-this.ceiling, Math.min(this.ceiling, y)); // 마지막 안전망
      }
      this.index = (this.index + 1) % this.look;
    }
    return true;
  }
}
registerProcessor('limiter-processor', LimiterProcessor);
```

**수용 기준**

- [ ] P-03: 전 페달 켬 + Level 200% + Graphic EQ 전 밴드 +12 dB → 출력 샘플 피크 ≤ −1.0 dBFS(허용 −0.9)
- [ ] 기본 구성에서 Cab 끔 → 출력 피크 ≤ −1.0 dBFS(현재 0 dBFS를 넘어 깨짐)
- [ ] 녹음 파일에도 같은 피크 제한
- [ ] P-23: 바이패스·체인 재배치에서 클릭 없음, 새 노드 생성 0(회귀)
- [ ] E-23: 오프라인 새로고침 뒤 연결 시 리미터 워클릿 로드 성공

**주의**: 리미터 파라미터를 화면에 내놓지 않는다. 톤 도구로 쓰지 않는다.

##### S1.4b Cab 음량 보정

| 항목 | 내용 |
|---|---|
| 해결 | R1-5(Cab을 끄면 15 dB 커지며 깨짐), D7 1단계 |
| 규모·선행 | S · S1.4a |
| 대상 파일 | `src/audio/nodes/CabEffect.ts`(54~91행), `src/audio/utils/cabinet.ts`(17~68행 IR 합성) |

**현재**: Cab 페달이 음량을 15 dB 낮춘다. 기본 구성에서 Cab을 끄면 평균 음량이 −23.8 dBFS에서 −8.5 dBFS로 오른다.

**변경**: IR을 만든 직후 에너지 정규화(Σh² = 1 기준) + 모델별 보정 dB 상수(P-04로 재서 `cabinet.ts`에 표로 둔다). ConvolverNode의 `normalize`는 끄고 직접 정규화한다(값을 예측할 수 있게).

**수용 기준**

- [ ] P-04: REF-PC로 Cab 켬/끔 RMS 차 ≤ 1.5 dB — 모든 Cab 모델과 마이크 위치 양끝(0·100)에서
- [ ] Cab을 쓰는 프리셋 음량이 바뀌는 것은 정상(S1.4c에서 다시 맞춤)

##### S1.4c 프리셋 음량 정렬

| 항목 | 내용 |
|---|---|
| 해결 | R1-5(프리셋 사이 최대 27 dB 차이), D6 |
| 규모·선행 | M · S1.4b |
| 대상 파일 | `scripts/compute-preset-trims.mjs`(신규), `src/presets/factoryTrims.json`(생성물), `presetStore.ts`(팩토리 정의·불러오기), `AudioEngine.ts`(체인 출력과 masterGain 사이에 `presetTrim`), 프리셋 패널(보정값 표시·'음량 맞추기' 버튼) |

**현재**: 같은 연주에서 가장 작은 'Headphone Safe Start'는 −51 dBFS, 가장 큰 'Texas Push'는 −24 dBFS. 클린 계열은 대부분 −40~−46 dBFS라 헤드폰 음량을 크게 올리게 되고, 그 상태에서 드라이브 프리셋으로 바꾸면 20 dB 가까이 커진다.

**변경**

1. GS-2 공식으로 팩토리 40개의 trim을 계산해 JSON으로 커밋한다.
2. 프리셋을 불러올 때 `presetTrim.gain`에 30 ms 램프로 적용한다. 사용자가 노브를 바꿔도 trim은 그대로다.
3. 프리셋 패널에 '음량 보정 +x.x dB'를 표시한다.
4. 사용자 프리셋은 기본 trim 0. '음량 맞추기' 버튼 → 현재 프리셋을 REF-PC로 오프라인 렌더(2초) → trim 계산·저장.

**수용 기준**

- [ ] P-05: 40개 프리셋의 REF-PC 출력 RMS가 −20 ± 2 dBFS(현재 −51 ~ −24)
- [ ] 클린 ↔ 드라이브 프리셋 전환 시 RMS 변화 ≤ 4 dB ★(현재 약 20 dB)
- [ ] REF-PC에서 리미터 최대 감소량 ≤ 1 dB(GS-7) ★
- [ ] '음량 맞추기'가 사용자 프리셋을 −20 ± 1 dBFS로 맞춤

**주의**: 'Headphone Safe Start'도 같은 기준으로 맞춘다. 이름의 의도(작게 시작)를 살리려면 D6의 예외 규칙으로 처리하고, 그 결정은 사람이 한다.

#### S1.5 출력 가드와 MonitorService (하울링 감지 v2)

| 항목 | 내용 |
|---|---|
| 해결 | R1-2, (기반) R2-8·R2-10 |
| 규모·선행 | L · S1.2, S1.3, S1.4a |
| 대상 파일 | `src/audio/worklets/output-guard.worklet.ts`·`level-meter.worklet.ts`(신규), `src/audio/monitor/MonitorService.ts`(신규), `src/store/monitorStore.ts`(신규), `OutputStage.ts`(가드 삽입), `audioStore.ts`(33~34행 차단 상수, 1047~1068행 rAF 감시 삭제), `Meter.tsx`(162~172행 — rAF는 그리기 전용으로 축소), `AppShell.tsx`(77행) |

**현재**: 출력이 −3 dBFS 이상으로 1.2초 이어지면 차단하는데, 이 감시가 미터 화면 그리기에 묶여 있다. 휴대폰의 '미터'가 아닌 탭에서는 −1.8 dBFS를 8초 내보내도 차단되지 않았고, 브라우저의 다른 탭을 볼 때도 마찬가지였다. 기본 구성에서는 입력을 한계보다 20 dB 크게 넣어도 출력 최고치가 −8 dBFS라 기준에 닿지 않는다.

**변경**

1. 4.3절 신호 흐름대로 level-meter#in, output-guard, level-meter#out을 넣는다.
2. 하울링 판정을 워클릿으로 옮긴다(4.3 알고리즘, 부록 B 수치). 파일 모드에서는 판정을 끈다.
3. MonitorService가 포트 메시지를 받아 monitorStore를 최대 30 Hz로 갱신하고, `howl-cut`이 오면 `AudioSession.stop('howl')`을 부른다.
4. rAF 루프의 감시·레벨 판정 코드를 지우고 미터 그리기만 남긴다. 미터가 안 보이면 그리지 않아도 된다(보호와 무관해졌으므로).

**수용 기준**(E-03, P-07 — 신호는 부록 A)

- [ ] H-1(1 kHz 순음 −20 dBFS 지속) → 1.5초 안에 차단 — 데스크톱, 휴대폰의 모든 탭, 문서 숨김 상태 모두
- [ ] H-2(2.5 kHz, −50 dBFS에서 −6 dBFS로 커지는 음) → 1.5초 안에 차단
- [ ] H-3(800 Hz 왜곡된 지속음) → 1.5초 안에 차단
- [ ] H-4(기본 구성, 입력 한계 +20 dB 상당의 지속음 — 보고서 재현 조건) → 차단(현재 미차단)
- [ ] G-1(196 Hz 서스테인 리드, 입력 −4 dB/s 감쇠, 비브라토) 60초 → 오차단 0회
- [ ] G-2(110 Hz 감쇠 톱니파를 2초마다, 60초) → 오차단 0회
- [ ] G-3(무음 + −70 dBFS 잡음 60초) → 오차단 0회
- [ ] 파일 모드에서 H-1을 재생 → 차단 없음(리미터만 동작)
- [ ] 차단 시 녹음 파일이 남음(S1.2 경로)
- [ ] P-17: 가드·미터 추가로 늘어난 렌더 시간 ≤ 전체 페달 처리의 5% ★

**주의**: 판정 수치(부록 B)를 바꿔야 할 것 같으면 멈추고 묻는다(D9). 하울링 판정을 출력 레벨 기준으로 되돌리지 않는다.

#### S1.6 휴대폰 하단 패널 접기

| 항목 | 내용 |
|---|---|
| 해결 | R1-1, D2 |
| 규모·선행 | M · S1.5(감시가 탭과 분리된 뒤에 해야 '페달' 탭에서도 보호가 돈다) |
| 대상 파일 | `src/components/AppShell.tsx`(14~18행 탭 정의, 102~150행 도크), `src/styles/responsive.css`(160~230행, 167~173행 `.mobile-control-dock`) |

**현재**: 화면 아래에 고정된 입력·미터·프리셋 패널이 어느 탭에서든 화면 높이의 66%를 차지한다. 높이 858 px인 페달 카드의 아래쪽 324~505 px가 끝까지 내려도 패널 뒤에 가려져, 15개 페달 모두 On/Off·Bypass를 누를 수 없다(390×844, 360×640, 412×915).

**변경**

1. 탭 맨 앞에 '페달'을 추가하고 기본으로 선택한다. '페달' 탭에서는 도크가 탭 줄(약 56 px)만 남긴다.
2. 다른 탭은 최대 50dvh로 펼치고, 같은 탭을 다시 누르면 접는다.
3. ResizeObserver로 도크 높이를 `--dock-h`에 기록해 본문 `padding-bottom`에 반영한다(4.10).
4. 스위치 터치 영역 ≥ 44×44 px.

**수용 기준**(E-04)

- [ ] 390×844, 360×640, 412×915에서 15개 페달의 모든 스위치에 도달 가능 — 도크가 접힌 상태와 펼친 상태 모두(현재 0%)
- [ ] 390×844 첫 화면에 페달 노브 2개 이상이 완전히 보임
- [ ] 도크를 펼친 상태에서 끝까지 스크롤하면 마지막 페달의 아래쪽 끝이 도크 위로 나옴

#### S1.7 저장 오류 처리와 오류 화면

| 항목 | 내용 |
|---|---|
| 해결 | R2-1 |
| 규모·선행 | M · S0.4 |
| 대상 파일 | `src/persistence/SafeStorage.ts`(신규), `pedalStore.ts`(307~327행), `presetStore.ts`(436~443행), `PresetPanel.tsx`(37~40행), `audioStore.ts`(IO·MIDI 저장), `src/app/AppErrorBoundary.tsx`(신규), `src/main.tsx`, `src/components/Toast.tsx`(신규 또는 S1.2의 최소 형태 확장), ESLint 설정 |

**현재**: 설정을 저장하다 오류가 나면 받아 주는 처리가 없다. 사이트 데이터 저장이 막히면 흰 화면만 나오고, 저장 공간이 가득 차면 Bypass·On/Off·노브·프리셋 불러오기가 모두 반응하지 않는다. 이 공간은 kimyounggaur.github.io에 올린 다른 앱과 함께 쓴다.

**변경**: 4.8절 그대로. `localStorage` 직접 호출을 모두 SafeStorage로 바꾸고 린트로 다시 생기지 않게 한다. 토스트·배너 공통 컴포넌트를 마련한다(이후 Step이 재사용).

**수용 기준**(E-05)

- [ ] 사이트 데이터 차단 모의: 흰 화면 없이 표시, Bypass·On/Off·노브·프리셋 불러오기 전부 동작, 안내 1회
- [ ] 저장 공간 가득 참 모의: 위 조작 전부 동작, 안내 1회(되풀이 표시 없음)
- [ ] 렌더 중 예외 주입: 한국어 오류 화면이 뜨고 소리가 멈춤
- [ ] 린트: `localStorage` 직접 참조 0건

#### S1.8 노트북 화면 배치

| 항목 | 내용 |
|---|---|
| 해결 | R1-7 |
| 규모·선행 | L · S1.6 |
| 대상 파일 | `src/styles/layout.css`(페달 그리드), `src/styles/pedals.css`(Compressor·Noise Gate·Tremolo·Delay·Cab 카드 구간), `PedalCard.tsx` 아래쪽(MIDI 학습·스위치 영역), `AppShell.tsx`(오른쪽 패널 접기), `ConnectGuitarPanel.tsx`(연결 뒤 한 줄 상태 바), `PedalBoard.tsx`(83~90행 로고) |

**현재**: 1280 px 이상에서 오른쪽 패널이 430~500 px를 쓰고 남은 공간을 페달 4칸이 나눠, 한 칸이 1280 px에서 167 px, 1440 px에서 207 px까지 좁아진다. 첫 페달은 화면 위에서 604 px 지점에 시작한다.

**변경**: 4.10절. 최소 300 px 자동 칸, 컨테이너 쿼리, 라벨 한 줄 + 말줄임(전체 이름은 툴팁), 공간이 좁으면 Tremolo SHAPE의 3버튼을 선택 상자로, MIDI 학습 버튼은 별도 줄, 오른쪽 패널 접기, 위쪽 압축. 카드 안 배치가 크게 바뀌면 Figma 시안으로 먼저 확인한다.

**수용 기준**(E-06)

| 화면 폭 | 지금 겹침 | 목표 겹침 | 지금 스위치 노출 | 목표 |
|---|---|---|---|---|
| 768 px | 37곳 | 0 | 33% | 100% |
| 1280 px | 45곳 | 0 | 0% | 100% |
| 1366 px | 32곳 | 0 | 50% | 100% |
| 1440 px | 18곳 | 0 | 94% | 100% |
| 1536 px | 11곳 | 0 | 100% | 100% |
| 1680 px 이상 | 0곳 | 0 | 100% | 100% |

- [ ] 위 표의 목표 전부(오른쪽 패널을 펼친 상태와 접은 상태 모두)
- [ ] 1280×800에서 첫 페달 카드 위쪽 끝 ≤ 320 px ★(현재 604 px)
- [ ] 높이 900 px 화면에서 첫 줄 페달의 스위치가 스크롤 없이 보임 ★
- [ ] 오른쪽 패널의 접힘·펼침 상태를 기억

---

### 5.3 Phase 2 — 믿을 수 있는 표시

**목표**: 화면의 이름·숫자·안내가 실제 동작과 같게 만든다. 보고서 권장대로 프리셋 Mix 0%, 조절기 이름, 오류 안내부터 고친다.
**배포**: 2a(S2.1~S2.7, 저장 형식 v2 포함) → 2b(S2.8~S2.14). 2a 배포 전에 실제 브라우저에서 기존 데이터로 업그레이드하는 시험을 한다(7.3).

#### S2.1 꺼진 페달의 Mix 0% 바로잡기

| 항목 | 내용 |
|---|---|
| 해결 | R2-2 |
| 규모·선행 | S · S0.3 |
| 대상 파일 | `src/store/presetStore.ts`(팩토리 프리셋 40개 정의), `src/presets/normalize.ts`(신규, 불러올 때 정규화), 이펙트 기본 Mix(스키마 도입 전이면 `pedalStore.ts` 기본값, 뒤에 4.9의 `defaultMix`로 이동) |

**현재**: 팩토리 프리셋은 꺼 둔 페달의 Mix를 0%로 저장해, 프리셋을 불러온 뒤 그 페달을 켜도 원음만 100% 지나간다. 40개 프리셋 모두에 이런 페달이 하나 이상 있다(Crunch 37개, Fuzz 35개, Drive 23개, Delay 23개, Reverb 6개, Compressor 2개).

**변경**

1. 팩토리 데이터에서 꺼진 페달의 `mix: 0`을 이펙트 기본 Mix로 바꾼다. 꺼져 있으므로 불러온 직후 소리는 같다.
2. 불러오기 정규화: 사용자 프리셋도 '꺼짐 + Mix 0'이면 기본 Mix로 바꾼다(마이그레이션 M2와 같은 함수).
3. 데이터 검사 단위 테스트: 팩토리 프리셋에 '꺼짐 + Mix 0' 조합이 0개.

**수용 기준**

- [ ] P-18: 40개 프리셋에서 꺼진 페달을 하나씩 켜면 출력이 바뀐다(원음 대비 RMS 차 ≥ 0.5 dB 또는 스펙트럼 차 ≥ 1 dB ★)
- [ ] 프리셋을 불러온 직후의 소리는 바뀌지 않는다(널 테스트 ≤ −90 dB)

#### S2.2 조절기 이름·범위·기능 바로잡기 (파라미터 스키마 도입)

| 항목 | 내용 |
|---|---|
| 해결 | R2-3, D14, D15 |
| 규모·선행 | L(이름·범위·삭제 M + Fuzz 게이트·GR 실측 M) · S2.1 |
| 대상 파일 | `src/audio/params/`(신규: `types.ts`, `definitions/*.ts`), `components/effects/`의 EQ·Noise Gate·Compressor·Fuzz·Reverb·Delay 페달 UI(추정: `EQPedal.tsx` 등), `CompressorEffect.ts`(GR), `FuzzEffect.ts`(게이트), `ReverbEffect.ts`·`impulse.worker.ts`(Decay 범위), `DelayEffect.ts`(sync), `PresetPanel.tsx`(Output 막대·Store 탭) |

**작업 순서**(커밋 단위)

1. 파라미터 스키마 도입: 15개 이펙트의 ParamDef를 만든다. 지금 값을 그대로 옮기므로 소리 변화는 0이다.
2. 4.9 표의 이름 변경: EQ 7개, Noise Gate Mode → HYST, Compressor Tone → KNEE.
3. GR 실측: 네이티브 컴프의 `DynamicsCompressorNode.reduction`을 MonitorService 주기(30 Hz)로 읽어 표시한다. S3.6에서 직접 구현 컴프로 바꾸면 워클릿 메시지로 교체한다.
4. Reverb Decay 범위를 6초까지로 줄이고 저장값을 clamp한다(D14).
5. Delay: Sync가 켜지면 D.Time 노브를 비활성(`aria-disabled`, 흐리게)으로 바꾸고 동기된 값을 보여 준다.
6. Fuzz Gate를 실제 게이트로 만든다(D15): 퍼즈 셰이퍼 앞에 노이즈 게이트 워클릿 로직을 재사용, 0 = 끔, 1~100 → 문턱 −80 ~ −30 dBFS, 히스테리시스 6 dB 고정.
7. 프리셋 패널의 장식 막대와 Store 탭을 지운다.

**수용 기준**

- [ ] 단위 테스트: 화면에 그려지는 모든 조절기에 ParamDef가 있고, 라벨·단위가 화면과 같다
- [ ] P-21: 무음에서 GR 표시 0 dB(현재 −5.9 dB), −10 dBFS 지속음에서 표시값 = `reduction` ±0.5 dB
- [ ] P-20: Reverb decay 저장값 7.5 → 6.0, 해당 프리셋 2개(6.2초·7.5초)의 소리 변화 0(널 테스트)
- [ ] Fuzz Gate 0에서 소리 변화 0, 50에서 무연주 잡음 출력이 30 dB 이상 줄어듦 ★
- [ ] Delay Sync를 켜면 D.Time을 조작할 수 없고 동기된 값이 보인다
- [ ] 프리셋 패널에 고정 수치 막대와 Store 탭이 없다

**주의**: 저장 키(`key`)는 바꾸지 않는다. 이름만 바꾼다.

#### S2.3 오류 안내 한국어화와 기본 장치로 다시 연결

| 항목 | 내용 |
|---|---|
| 해결 | R2-7 |
| 규모·선행 | S · S1.7 |
| 대상 파일 | `src/i18n/ko.ts`(신규 — 이 Step에서 오류 문구부터 시작), `src/audio/engine/errors.ts`(신규: 오류 이름 → 문구 키), 연결 액션(`AudioSession.start`), `ConnectGuitarPanel.tsx` |

**현재**: 마이크 권한을 거부하면 'Permission denied', 장치가 없으면 'Requested device not found'가 그대로 나온다. 골라 둔 입력 장치가 사라진 상태에서 연결을 누르면 아무 안내 없이 버튼만 원래대로 돌아온다.

**변경**: 4.13 표대로 안내한다. 저장된 장치가 없으면(`OverconstrainedError` 또는 목록에 없음) 기본 장치로 다시 시도하고 알린다. 연결에 실패하면 항상 안내를 띄운다.

**수용 기준**(E-07)

- [ ] `getUserMedia`를 각 오류로 실패시키는 모의 7종 → 각각 4.13의 문구가 보이고 영어 원문 노출 0
- [ ] 저장된 장치 ID가 없는 상태에서 연결 → 기본 장치로 연결되고 안내가 뜬다

#### S2.4 On/Off·Bypass 통합과 저장 형식 v2

| 항목 | 내용 |
|---|---|
| 해결 | R2-4, D1, D10 |
| 규모·선행 | L · S1.7, S2.1, S2.2 |
| 대상 파일 | `src/audio/types.ts`(PedalState), `src/persistence/schema.ts`·`migrations/v1-to-v2.ts`(신규), `pedalStore.ts`(togglePedal·setPedalBypass), `presetStore.ts`, `BaseEffect.ts`(129행 활성 조건), `PedalCard.tsx`(150~160행·320~330행 스위치·LED), `GlobalKeyboardShortcuts.tsx`, MIDI 매핑(`midi.ts`, `audioStore.ts` 259~262행), A/B 슬롯(`PresetPanel.tsx` 237~265행), `vite.config.ts`(PWA 업데이트 방식) |

**현재**: 페달마다 On/Off와 Bypass 스위치가 따로 있는데 소리에는 똑같이 작용한다(둘 중 하나만 꺼져도 효과가 꺼진다). 프리셋은 끌 때 Bypass만 써서, LED는 켜져 있는데 효과는 꺼진 페달이 많다. 앱을 처음 열면 15개 LED가 켜져 있지만 실제로 켜진 이펙트는 5개다(10월 계획서).

**변경**

1. 4.7절 타입과 변환 규칙(M1~M7)을 구현한다. 백업 보존·멱등·여러 탭 감지 포함.
2. 화면에는 발스위치 하나만 둔다. LED = `active`. 'Bypass' 토글 UI는 지운다.
3. 단축키·MIDI·A/B·프리셋이 모두 같은 `setActive(id, on)`을 부른다.
4. BaseEffect의 크로스페이드는 `active` 하나로 움직인다. 내부 `bypassAll` 경로를 그대로 쓰므로 소리 처리 방식은 같다.
5. 서비스 워커 업데이트 배너: 새 버전이 활성화되면 '새 버전이 있습니다 — 연주를 마친 뒤 새로고침' 배너만 띄우고 자동 새로고침하지 않는다. 저장 형식이 바뀌는 첫 배포이므로 이 Step에 넣는다.

**수용 기준**

- [ ] E-08: 첫 화면에서 LED가 켜진 페달 수 = 실제 활성 이펙트 수(기본 5개)
- [ ] P-19: v1 픽스처 6종을 불러온 소리와 v2로 바꾼 뒤의 소리가 같다(널 테스트 ≤ −80 dB)
- [ ] 마이그레이션 단위 테스트 6종 통과, 두 번 실행해도 결과가 같다
- [ ] v1 키가 남아 있고, 구버전 탭이 v1 키를 쓰면 안내가 뜬다
- [ ] 연주 중 새 버전이 배포돼도 자동 새로고침이 일어나지 않는다

**주의**: 이 Step 밖에서는 저장 형식을 바꾸지 않는다. 변환에 실패하면 앱은 v1 데이터로 계속 동작해야 한다.

#### S2.5 입력 레벨 경고 바로잡기

| 항목 | 내용 |
|---|---|
| 해결 | R2-8 |
| 규모·선행 | S · S1.5 |
| 대상 파일 | `MonitorService.ts`(경고 판정), `Meter.tsx`·입력 패널(표시), `ko.ts` |

**현재**: 휴대폰 '입력' 탭에서는 입력이 정상이든 한계를 크게 넘든 '입력이 너무 작습니다. 게인을 올리세요'만 나온다. PC에서도 연주를 멈추거나 파일을 일시정지하면 같은 경고가 뜬다.

**변경**: 4.12 경고 표. 판정은 화면 탭과 상관없이 MonitorService가 한다. 파일 일시정지·세션 정지 상태에서는 판단하지 않는다.

**수용 기준**(E-09)

- [ ] 휴대폰 '입력' 탭을 포함한 모든 탭에서: 정상 입력(피크 −12 dBFS) → 경고 없음, 작은 입력(−40 dBFS) → '작습니다', 한계 초과(0 dBFS) → '너무 큽니다', 5초 무음 → '신호가 없습니다'
- [ ] PC에서 연주를 멈추거나 파일을 일시정지해도 '작습니다' 경고가 뜨지 않는다

#### S2.6 음원 파일 모드: 반복·탐색·Space

| 항목 | 내용 |
|---|---|
| 해결 | R2-5 |
| 규모·선행 | M · S1.2 |
| 대상 파일 | `AudioEngine.ts`(148~225행 파일 재생), `ConnectGuitarPanel.tsx`(파일 입력), `src/components/FilePlayer.tsx`(신규), `GlobalKeyboardShortcuts.tsx` |

**현재**: 파일 재생이 끝나면 파일이 사라져 다시 올려야 한다. 반복 재생과 탐색 막대가 없다. 재생 중 Space를 누르면 일시정지가 아니라 전체 정지가 되고, 한 번 더 누르면 마이크 입력이 켜진다.

**변경**: 4.11 파일 재생 표.

**수용 기준**(E-10)

- [ ] 재생이 끝나도 파일이 남고, 반복이 켜져 있으면 처음부터 다시 재생(이음매에서 큰 클릭 없음 — 청취 확인)
- [ ] 탐색 막대로 아무 위치로나 이동, ±10초 버튼 유지
- [ ] 파일 모드의 Space = 재생/일시정지, 마이크가 켜지는 일 없음
- [ ] 연결 해제 → 다시 연결해도 같은 파일로 재생 가능(새 `<audio>` 요소)
- [ ] 화면에 브라우저 기본 영문 파일 버튼이 보이지 않음

#### S2.7 Export·Import 정리

| 항목 | 내용 |
|---|---|
| 해결 | R2-6 |
| 규모·선행 | M · S2.4 |
| 대상 파일 | `PresetPanel.tsx`(Export·Import·텍스트 칸), `presetStore.ts`(직렬화·가져오기), `src/persistence/exportFormat.ts`(신규) |

**현재**: Export가 내 프리셋과 팩토리 프리셋 40개를 함께 내보내고(264 KB) 같은 내용을 화면의 텍스트 칸에도 채운다. 그 상태에서 Import를 누르면 파일 선택 창 없이 텍스트 칸의 내용이 바로 들어와, 내 프리셋이 0개에서 40개로, 전체가 40개에서 80개로 늘었다.

**변경**: 4.7 내보내기 형식 v2. Export는 내 프리셋만, 파일로만 내보낸다(텍스트 칸 자동 채우기 삭제). Import는 항상 파일 선택 창을 연다. '텍스트로 붙여넣기'는 별도 버튼 → 대화상자. 중복 처리는 4.7 규칙대로.

**수용 기준**(E-11)

- [ ] 내 프리셋이 0개일 때 Export → '내보낼 내 프리셋이 없습니다' 안내, 빈 파일을 만들지 않음
- [ ] Export 직후 Import → 파일 선택 창이 뜨고, 같은 파일을 가져오면 '0개 가져옴 · N개 건너뜀', 전체 개수 변화 0
- [ ] 예전 형식 내보내기 파일(팩토리 40개 포함) 가져오기 → 팩토리는 추가되지 않고 내 프리셋만 추가
- [ ] 내보낸 파일에 팩토리 프리셋이 없다

#### S2.8 삭제·초기화·덮어쓰기 안전장치

| 항목 | 내용 |
|---|---|
| 해결 | R2-14 |
| 규모·선행 | S · S1.7(토스트) |
| 대상 파일 | `PresetPanel.tsx`(x 버튼, 저장), `pedalStore.ts`('Default Chain' 초기화), `src/components/ConfirmDialog.tsx`(신규) |

**현재**: 내 프리셋 삭제(x 버튼)와 'Default Chain'(모든 노브를 처음 값으로)은 누르는 즉시 실행되고 되돌릴 수 없다. 같은 이름으로 저장하면 묻지 않고 덮어쓴다.

**변경**

1. 내 프리셋 삭제: 목록에서 바로 숨기고 토스트 '프리셋을 삭제했습니다 [실행 취소]'(8초)를 띄운다. 시간이 지나면 확정한다.
2. Default Chain: 직전 상태를 스냅숏으로 남기고 토스트 '모든 노브를 처음 값으로 되돌렸습니다 [실행 취소]'.
3. 같은 이름 저장: 대화상자 '같은 이름의 프리셋이 있습니다' — [덮어쓰기] [새 이름으로 저장] [취소].

**수용 기준**(E-12)

- [ ] 삭제 → 실행 취소 → 프리셋과 순서가 그대로 돌아온다
- [ ] Default Chain → 실행 취소 → 모든 노브 값이 돌아온다(널 테스트)
- [ ] 같은 이름 저장에서 묻지 않고 덮어쓰는 경로 0개
- [ ] 토스트의 '실행 취소' 버튼에 키보드로 갈 수 있다(`role="status"`, 포커스 가능)

#### S2.9 MIDI 자동 재연결·방향·토글

| 항목 | 내용 |
|---|---|
| 해결 | R2-9 |
| 규모·선행 | M · S2.4 |
| 대상 파일 | `src/audio/midi.ts`(115~150행 파싱·학습) → `src/audio/midi/MidiService.ts`, `audioStore.ts`(259~262행), MIDI 학습 UI(PedalCard) |

**현재**: 새로고침하면 '매핑됨'이라고 나오지만 MIDI 연결을 다시 맺지 않아 풋스위치가 반응하지 않는다. 아무 페달에서나 'MIDI 학습'을 다시 눌러야 살아난다. 스위치를 밟으면(값 127) 효과가 꺼지고 떼면 켜진다. 밟을 때마다 켜짐·꺼짐이 바뀌는 방식이 없다.

**변경**: 4.11 MIDI 표.

**수용 기준**(E-13, Web MIDI 모의)

- [ ] 매핑 저장 → 새로고침 → (권한 granted) 학습 없이 풋스위치가 반응하고 상태가 '매핑됨 · 연결됨'
- [ ] 권한 prompt 상태 → 배너 버튼으로 다시 연결, 로드할 때 권한 창이 저절로 뜨지 않음
- [ ] latch: 127 → 켜짐, 0 → 꺼짐 / toggle: 누를 때마다 전환, 뗌 무시
- [ ] 학습 중 누름 → 뗌이 1초 안에 이어지면 toggle로 자동 지정
- [ ] 장치를 뺐다 다시 꽂으면 리스너가 저절로 다시 붙음

실제 풋스위치 확인은 6.5 체크리스트에서 한다(보고서가 확인하지 못한 항목).

#### S2.10 지연·끊김 표시

| 항목 | 내용 |
|---|---|
| 해결 | R2-10, D11 |
| 규모·선행 | M · S1.5. Phase 3 뒤 처리 지연 값을 다시 갱신 |
| 대상 파일 | `AudioEngine.ts` `readLatency`(472~482행) → `src/audio/engine/latency.ts`, `BaseEffect.ts`(`latencySeconds`), `Meter.tsx`(262~287행 지연·글리치·안내 문구, 270행 ASIO), `noise-gate-processor.ts`(46~70행 글리치 집계), `NoiseGateEffect.ts`(73~75행), `README.md`(103행 '실제 오디오 글리치 카운터') |

**현재**: 화면의 지연시간은 출력 쪽 지연만 더한 값이라 입력 장치 지연(시험 환경 10 ms)과 페달 처리 지연(기본 구성 10 ms)이 빠져 있다. '글리치' 숫자는 실제 끊김을 세지 못한다 — 일부러 과부하를 걸어 브라우저가 끊김 106회를 기록하는 동안에도 0이었다. 지연이 클 때 나오는 'ASIO 드라이버 사용' 안내는 브라우저에서 할 수 없는 방법이다.

**변경**

1. 지연 = 입력 + 처리 + 출력(4.6 공식). 항목별로 보여 주고 값이 없는 항목은 '미포함'으로 쓴다.
2. 끊김: `playbackStats.underrunEvents`의 세션 시작 대비 증가분. 지원하지 않으면 '측정 불가'.
3. 노이즈 게이트 워클릿의 근거 없는 글리치 집계와 메시지를 지운다.
4. 'ASIO' 안내를 실제로 할 수 있는 방법으로 바꾼다(4.12).

**수용 기준**(E-14)

- [ ] Chrome: 지연 표시에 입력·처리·출력 세 항목이 보이고, 합계에 입력 지연과 처리 지연이 들어간다
- [ ] 과부하 시험(시험 전용 부하 워클릿) → 화면의 끊김 수 = `playbackStats.underrunEvents` 증가분
- [ ] `playbackStats`를 지운 모의 환경 → '측정 불가'
- [ ] 화면과 README에 'ASIO'가 한 번도 나오지 않는다

#### S2.11 키보드 단축키

| 항목 | 내용 |
|---|---|
| 해결 | R2-12, D13 |
| 규모·선행 | S · S1.2, S2.4 |
| 대상 파일 | `src/components/GlobalKeyboardShortcuts.tsx` → 로직은 `src/input/ShortcutService.ts`, 도움말 오버레이 |

**현재**: 한글 입력 상태에서는 T(탭 템포)·A·B가 동작하지 않는다(눌린 글자로 판단). Esc 한 번에 긴급 정지가 걸리고 녹음 중이던 내용이 버려진다. 숫자 1~9만 있어 10~15번째 페달(기본 순서로 Chorus부터 Reverb까지)은 단축키가 없다.

**변경**: 4.11 단축키 표.

**수용 기준**(E-15)

- [ ] 한글 입력 상태 모의(`key: 'ㅅ'`, `code: 'KeyT'`) → 탭 템포 동작. A·B도 같음
- [ ] 녹음 중 Esc → 정지 + 녹음 파일 남음(S1.2)
- [ ] Shift + 1~6 → 10~15번째 페달 전환, 도움말에 표시
- [ ] 입력 칸에 포커스가 있을 때 단축키가 동작하지 않음

#### S2.12 튜너: 줄 번호·옥타브·크로매틱

| 항목 | 내용 |
|---|---|
| 해결 | R2-13 |
| 규모·선행 | M · S1.3 |
| 대상 파일 | `src/audio/utils/tunings.ts`(80~120행 판독), `worklets/tuner-processor.ts`(4행 하한 70 Hz, 분석 버퍼 길이), 튜너 UI(`Meter.tsx`의 튜너 영역) |

**현재**: 튜너가 가장 가까운 음이름만 맞춰 본다. Standard에서 6번 줄이 한 음 낮은 D2(73.4 Hz)여도 'D3 · 정확함'으로 나오고, 개방현이 아닌 C3는 'B3 +100센트'로 나온다. 70 Hz 아래(7현 기타의 B1 등)는 읽지 못한다.

**변경**

1. 기타 모드: 옥타브를 접지 않고 로그 거리(센트)로 가장 가까운 줄을 고른다. 표시 예: '6번 줄(E2) · 200센트 낮음'.
2. 음이름은 같은데 옥타브만 다르면 '6번 줄보다 한 옥타브 높습니다'처럼 따로 알린다. 가장 가까운 줄과 600센트 넘게 떨어지면 '줄 번호를 확인하세요'.
3. 크로매틱 모드(음이름 + 옥타브, 예: C3)를 추가하고 모드 전환 버튼을 둔다.
4. 하한을 70 Hz에서 55 Hz로 내린다(7현 B1 61.7 Hz, 드롭 튜닝). 분석 창은 샘플레이트에 비례해 최저 주파수의 2.5주기 이상으로 잡는다.

**수용 기준**(E-16 + 튜너 단위 테스트)

- [ ] Standard에서 D2(73.4 Hz) → '6번 줄 · 200센트 낮음'(현재 'D3 · 정확함')
- [ ] C3(130.8 Hz) → 기타 모드 '4번 줄(D3) · 200센트 낮음', 크로매틱 모드 'C3'(현재 'B3 +100센트')
- [ ] B1(61.74 Hz) 감쇠 플럭 → ±2센트 안
- [ ] 6번 줄을 맞추는 중에 E3가 들어오면 '한 옥타브 높음' 안내
- [ ] P-22: 기존 튜너 회귀(4개 샘플레이트, 개방현 정확도) 유지

#### S2.13 입출력 장치 자동 관리

| 항목 | 내용 |
|---|---|
| 해결 | R2-15 |
| 규모·선행 | M · S1.2, S1.3 |
| 대상 파일 | `src/audio/devices/DeviceManager.ts`(신규), `DeviceSelector.tsx`, `AudioSession.ts`(장치 분리 → `device-lost`), 설정 저장 |

**현재**: 장치를 꽂거나 뽑아도 목록이 자동으로 바뀌지 않아 '새로고침'을 눌러야 한다. 연주 중 장치가 뽑혀도 화면은 연결된 상태로 남는다. 출력 장치를 고르는 메뉴가 없어 항상 시스템 기본 장치로 나가고, 고른 입력 장치는 다음 방문 때 기억되지 않는다.

**변경**: 4.4 DeviceManager.

**수용 기준**(E-17)

- [ ] 장치 추가·제거 모의(`devicechange`) → 1초 안에 목록 갱신, 새로고침 버튼이 필요 없다
- [ ] 연주 중 고른 장치 제거 → 세션 정지(`device-lost`) + 안내, 화면이 연결 상태로 남지 않는다
- [ ] Chrome·Edge: 출력 장치를 바꾸면 그 장치로 소리가 나가고(`setSinkId`) 다음 방문에 기억된다
- [ ] Firefox·Safari: 출력 메뉴를 숨기고 시스템 설정 안내를 보여 준다
- [ ] 고른 입력 장치를 다음 방문에 기억하고, 없으면 기본 장치 + 안내

#### S2.14 앱 아이콘과 파비콘

| 항목 | 내용 |
|---|---|
| 해결 | R2-11 |
| 규모·선행 | S(+ 아이콘 디자인 작업) · 없음 |
| 대상 파일 | `public/pwa-192x192.png`·`pwa-512x512.png`·`pwa-512x512-maskable.png`·`apple-touch-icon.png`(180 px)·`favicon.svg`·`favicon.ico`(32 px)(신규), `vite.config.ts`(18~42행 manifest: `lang: 'ko'`, `id`), `index.html`(파비콘·apple-touch-icon 링크), `scripts/pwa-regression.mjs`(30~35행) |

**현재**: 설치 정보 파일이 가리키는 아이콘 두 개(192 px, 512 px)가 공개 사이트에서 404다. Chrome 앱 설치 조건을 채우지 못하고, 파비콘과 아이폰 홈 화면 아이콘도 없다.

**변경**: 로고가 가로형(2048×1021)이라 정사각 아이콘용 심볼이 따로 필요하다. 로고에서 심볼만 잘라 쓰거나 페달 모양 아이콘을 새로 그린다(Figma에서 512 px 원본 제작 — 디자인 결정은 사람). maskable 아이콘은 가운데 80% 안전 영역 안에 그림을 둔다.

**수용 기준**(E-18)

- [ ] 배포 사이트에서 아이콘 6종이 모두 200으로 응답(현재 192·512가 404)
- [ ] CDP `Page.getInstallabilityErrors` 결과 0건(Chrome 설치 조건 충족)
- [ ] PWA 테스트가 경로 문자열이 아니라 `dist/`의 실제 파일 존재·PNG 크기를 검사

---

### 5.4 Phase 3 — 음질

**목표**: 3순위 7건과 처리 지연을 고친다. 보고서도 귀로 듣는 확인은 하지 못했으므로 **수치(프로브)와 귀(6.5 청취)를 둘 다** 통과해야 배포한다.
**공통 규칙**: Step마다 기준선을 갱신하고 이유를 적는다. 매 Step 끝에 P-05(프리셋 음량)를 다시 재서 변화를 기록하고, 다시 맞추는 일은 S3.8에서 한 번에 한다. 위험한 변경(S3.6, S3.7)은 기능 플래그(7.2)로 신·구를 비교할 수 있게 한다.

#### S3.1 Delay·Reverb Mix — 원음은 그대로, 효과음만 더하기

| 항목 | 내용 |
|---|---|
| 해결 | R3-7 |
| 규모·선행 | S · S0.3 |
| 대상 파일 | `DelayEffect.ts`, `ReverbEffect.ts`, `BaseEffect.ts`(53~62행 원음·효과음 합성) |

**현재**: 페달을 켜면 원음이 Mix만큼 작아진다. Delay 기본값 30%에서 원음이 3 dB 줄어든다.

**변경**: BaseEffect에 합성 방식 옵션 `mixLaw: 'crossfade' | 'additive'`를 둔다. Delay·Reverb는 `additive`(원음 1.0, 효과음 = Mix), 나머지 이펙트는 지금 방식 그대로.

**수용 기준**

- [ ] P-15: Delay Mix 30%에서 원음 레벨 변화 0 ± 0.1 dB(현재 −3 dB). Reverb도 같음
- [ ] 두 페달을 쓰는 프리셋의 음량 변화를 기록(S3.8에서 다시 맞춤)

#### S3.2 Cab 좌우 대칭과 무작위 성분 줄이기

| 항목 | 내용 |
|---|---|
| 해결 | R3-2, D7 |
| 규모·선행 | S · S1.4b |
| 대상 파일 | `src/audio/utils/cabinet.ts`(17~68행 IR 합성), `CabEffect.ts`(54~91행, 73~87행 IR 교체) |

**현재**: 좌우 IR에 서로 다른 무작위 성분이 들어 있어 음마다 좌우 음량이 다르다. 단일 음으로는 최대 14 dB, 실제 기타에 가까운 음으로는 2~3 dB.

**변경**

1. 좌우에 같은 IR을 쓴다(모노 IR 하나를 두 채널에).
2. 무작위 성분은 모델별 고정 시드의 결정적 난수로 바꾸고 크기를 줄여 주파수 응답의 들쭉날쭉함을 줄인다(1/3옥타브로 평활한 응답 대비 편차 ≤ 3 dB ★).
3. IR을 바꿀 때 20 ms 웻 페이드(리버브의 교체 방식 재사용)를 넣고, 마이크 위치·거리 노브는 120 ms 동안 조작이 멈춘 뒤에만 IR을 다시 만든다(10월 계획서가 지적한 노브 조작 중 클릭음).

**수용 기준**

- [ ] P-09: 80 Hz~5 kHz 단일 음에서 좌우 음량 차 ≤ 0.5 dB(현재 최대 14 dB)
- [ ] 마이크 위치 노브를 끄는 동안 클릭음이 없음(출력 1차 차분 피크 증가 ≤ +6 dB ★)
- [ ] P-04(Cab 음량 보정) 유지

#### S3.3 Delay Tape 모드 흔들림 줄이기

| 항목 | 내용 |
|---|---|
| 해결 | R3-3 |
| 규모·선행 | S · S0.3 |
| 대상 파일 | `DelayEffect.ts`(108~109행 플러터 6 ms·4.2 Hz) |

**현재**: 반복음의 음정이 초당 4번, 위아래로 2.5~3반음씩 흔들린다(1 kHz가 842~1,159 Hz로). Ambient Delay와 Tape Swell 프리셋이 이 모드를 쓴다.

**변경**: 흔들림 깊이를 지금의 약 1/30로 줄이고(보고서), 느린 와우(약 0.8 Hz)와 빠른 플러터(약 6.5 Hz) 두 LFO로 나눠 귀로 맞춘다. 지연 깊이(초) = 목표 주파수 편차 / (2π × LFO 주파수).

```ts
const WOW_HZ = 0.8;
const WOW_DEPTH_S = 0.003 / (2 * Math.PI * WOW_HZ);         // 음정 편차 약 ±0.3%
const FLUTTER_HZ = 6.5;
const FLUTTER_DEPTH_S = 0.001 / (2 * Math.PI * FLUTTER_HZ); // 음정 편차 약 ±0.1%
```

**수용 기준**

- [ ] P-10: 1 kHz 반복음의 순간 주파수 편차 ≤ ±0.6%(약 ±10센트, 현재 약 ±16%)
- [ ] Ambient Delay·Tape Swell 청취: 멀미 나는 음정 흔들림 없이 테이프 질감이 남는다
- [ ] (선택) 같은 파일의 핑퐁 타이밍(10월 계획서 M-7: 첫 반복이 T/2)도 확인 — sync 120 BPM 1/4에서 반복이 500·1,000·1,500 ms

#### S3.4 Flanger·Phaser를 AudioWorklet으로

| 항목 | 내용 |
|---|---|
| 해결 | R3-4, R4-2(Phaser가 꺼져 있어도 필터 30개가 돎 — 이 Step에서 함께 해결) |
| 규모·선행 | L · S0.3 |
| 대상 파일 | `FlangerEffect.ts`(전체, 72~91행 피드백 사이클), `PhaserEffect.ts`(전체, 14행·112~147행), `src/audio/worklets/flanger.worklet.ts`·`phaser.worklet.ts`(신규), `AudioEngine.ts` `loadWorklets`, `scripts/flanger-regression.mjs`(44~55행 정규식 단언)·`phaser-regression.mjs` |

**원인**: Web Audio는 피드백 사이클 안에 있는 DelayNode의 지연을 최소 1 렌더 퀀텀(128샘플, 48 kHz에서 약 2.67 ms)으로 늘린다. 그래서 되돌아오는 소리가 2.7 ms 늦게 들어온다. Flanger는 Manual 2 ms 설정에서 반복음이 4.7 ms 간격으로 생기고, Phaser는 25 dB 크기의 빗살 모양 울림이 생긴다.

**변경**

1. Flanger 워클릿: 원형 버퍼 + 분수 지연 선형 보간 + 샘플 단위 피드백 + 내부 사인 LFO(10월 계획서 Step 1.3 스케치). 파라미터 이름·범위(rate 0.05~5 Hz, manual 0.5~10 ms, depth 0~100%, feedback ±95%)는 그대로.
2. Phaser 워클릿: 고른 단수만큼만 1차 올패스를 계산 + 샘플 단위 피드백. 단수를 바꿀 때는 20 ms 크로스페이드.
3. 두 테스트의 정규식 단언(결함 구조를 요구하던 코드)을 수치 단언으로 바꾼다.

**수용 기준**

- [ ] P-11: Flanger 지연 2 ms 고정(LFO 깊이 0)에서 첫 노치 = 1/(2τ) = 250 Hz ±5%. 기본값에서 LFO 한 주기 동안 첫 노치가 약 177~425 Hz 사이를 움직임(44.1 kHz·48 kHz 모두)
- [ ] P-12: Phaser 피드백 최대에서 설계한 노치·공진 밖의 빗살 리플 ≤ 3 dB ★(현재 25 dB)
- [ ] P-17: Phaser가 꺼진 상태의 렌더 시간 기여 0(현재 코어의 약 10%), 켜진 상태는 고른 단수에 비례
- [ ] 두 이펙트를 쓰는 프리셋 청취: 움직이는 '제트' 소리가 난다

#### S3.5 Drive·Crunch 이득 곡선과 노브 범위

| 항목 | 내용 |
|---|---|
| 해결 | R3-5, R3-6, (같은 함수라 함께) 10월 계획서 M-2: Bias의 DC·데드존 |
| 규모·선행 | M · S1.1, S2.2(ParamDef의 taper) |
| 대상 파일 | `curves.ts` `createDriveCurve`(3~36행), `DriveEffect.ts`·`CrunchEffect.ts`, `DrivePedal.tsx`(78~86행 Bias), Drive·Crunch ParamDef |

**현재**: Drive의 Distortion 모드는 보통 세기 연주에서 노브 30%까지 왜곡이 0%로, 같은 위치의 Overdrive보다 깨끗하다. Crunch의 Gain 노브는 20~30%에서 이미 최대 왜곡에 도달해 그 위로는 변화가 없다. 10월 계획서는 Bias를 최대로 올리면 소리가 사라지는 현상(입력 −6.1 dBpk에 출력 −68.2 dBpk)도 확인했다.

**변경**

1. Distortion 모드: 보통 세기(REF-PC)에서 노브 30%부터 뚜렷한 왜곡이 나도록 증폭량을 다시 맞춘다. 목표: 같은 노브 위치에서 Distortion ≥ Overdrive.
2. Crunch Gain: 노브 0~100 전 구간에서 왜곡이 고르게 늘도록 노브 곡선(taper)을 다시 나눈다.
3. Bias: 이득을 곱한 뒤 바이어스를 더하고 0점 값을 빼는 공통 래퍼(10월 계획서 `withBias`), 범위 ±0.3로 축소, 저장값은 clamp.

측정 방법: 220 Hz 사인(−18 dBFS)과 REF-PC로 THD(총고조파왜곡)를 노브 0~100까지 10% 간격으로 잰다.

**수용 기준**

- [ ] P-13: Distortion 모드 THD가 노브를 따라 단조 증가하고, 30%에서 같은 위치 Overdrive의 THD 이상(현재 0%)
- [ ] P-14: Crunch THD가 10% 간격마다 증가(20~30% 뒤 평평한 구간 없음, 구간당 증가 ≥ 1%p ★)
- [ ] Bias 전 범위에서 무음 없음(출력 RMS ≥ −30 dBFS), 곡선의 0점 값 = 0(DC 없음)
- [ ] 해당 프리셋 청취. 프리셋 값은 바꾸지 않되, 소리가 크게 달라지면 프리셋 값 조정 여부를 사람에게 묻는다

#### S3.6 Compressor 직접 구현 (Mix 빗살 제거, 지연 0)

| 항목 | 내용 |
|---|---|
| 해결 | R3-1, D5, R2-3(GR 실측의 최종형) |
| 규모·선행 | L · S0.3, S2.2 |
| 대상 파일 | `src/audio/worklets/compressor.worklet.ts`(신규), `CompressorEffect.ts`(36줄, 전면 교체), `BaseEffect.ts`(원음 지연 임시안), Compressor ParamDef, 기능 플래그 `newCompressor` |

**현재**: 처리음이 원음보다 6 ms 늦어, 둘을 섞으면 특정 음이 깎인다. 기본값(Mix 75%)에서 2.2 dB, 'Headphone Safe Start'(45%)에서는 6번 줄과 2번 줄 개방음이 11 dB 줄었다. 40개 중 38개 프리셋이 해당한다. 원인은 브라우저 컴프레서의 룩어헤드(약 6 ms)이며, 이 컴프는 자동 메이크업 게인도 건다(10월 계획서).

**변경**

1. 워클릿 컴프레서: 피드포워드, 검출기 RMS(5 ms, 피크 선택 가능), 소프트 니(KNEE), attack·release·ratio·threshold, 수동 메이크업(자동 메이크업 없음), 룩어헤드 0. 감소량(GR)을 30 Hz로 포트에 보낸다.
2. 기존 파라미터 키·범위(Attack·Sustain·Ratio·Tone→KNEE·Mix 등 — S0.1에서 확인)는 유지하고, 네이티브와 값 대응표를 만들어 프리셋 음색을 가깝게 맞춘다.
3. 플래그 `newCompressor`로 신·구를 A/B 비교하고, 청취 승인 뒤 기본값을 새 것으로 바꾼다. 구 코드는 다음 릴리스에서 지운다.
4. 임시안(플래그가 꺼져 있을 때): BaseEffect에 원음 지연(`dryDelay`)을 두고 네이티브 룩어헤드만큼(프로브로 실측, 256프레임 예상) 넣어 빗살부터 먼저 없앤다.

**수용 기준**

- [ ] P-08: 0.1~1 kHz 리플 ≤ ±0.5 dB — Mix 75%·45% 모두(현재 2.2 dB, 11 dB)
- [ ] 'Headphone Safe Start'에서 6번·2번 줄 개방음 감소 ≤ 1 dB
- [ ] P-16: Compressor 처리 지연 0샘플(현재 약 6 ms)
- [ ] GR 표시 = 워클릿 실측값(P-21)
- [ ] 38개 프리셋의 음량 변화를 기록하고 청취 승인

#### S3.7 왜곡 페달 오버샘플링 4배 → 2배

| 항목 | 내용 |
|---|---|
| 해결 | D5(처리 지연) |
| 규모·선행 | M · S3.5 |
| 대상 파일 | `DriveEffect.ts`·`CrunchEffect.ts`·`FuzzEffect.ts`(WaveShaper `oversample`), `src/audio/params/latency.json`(P-16 실측값), 기능 플래그 `oversample2x` |

**현재**: Drive·Crunch·Fuzz가 4배 오버샘플링으로 각 약 4 ms를 더한다. Compressor 6 ms와 합쳐 기본 구성에서 10 ms가 늘어난다.

**변경**: `oversample = '2x'`. 페달별로 플래그를 두어 되돌릴 수 있게 하고, 각 페달의 `latencySeconds`를 실측값으로 바꾼다.

**수용 기준**

- [ ] P-16: 기본 구성 처리 지연 ≤ 2.7 ms(보고서 D5의 추정치 — 실측으로 확정), 리미터 포함 ≤ 3.7 ms
- [ ] 에일리어싱: 2~5 kHz 사인 스윕을 Drive 100·Fuzz 100에 넣었을 때 고조파가 아닌 성분의 증가 ≤ 6 dB(4배 대비) ★
- [ ] 청취: 높은 줄 하이 프렛에서 거슬리는 금속성 잡음이 없다. 거슬리면 그 페달만 4배 유지(Fuzz가 첫 후보)

#### S3.8 음량 다시 맞추기와 청취 승인

| 항목 | 내용 |
|---|---|
| 해결 | R1-5 마무리(Phase 3 변화 반영), D6 확정 |
| 규모·선행 | S + 사람 청취 · S3.1~S3.7 |
| 대상 파일 | `scripts/compute-preset-trims.mjs`(재실행), `src/presets/factoryTrims.json`, `docs/baseline/`, `docs/listening/` |

**작업**: trim 재계산 → factoryTrims 갱신 → 기준선 갱신(이유 기록) → 6.5 청취 체크리스트 전체 → D6 값 확정(바꾸면 상수 하나 변경 후 재계산).

**수용 기준**

- [ ] P-05: −20 ± 2 dBFS(또는 확정한 D6 값)
- [ ] 6.5 청취 기록 파일(`docs/listening/YYYY-MM-DD.md`) 작성 완료

---

### 5.5 Phase 4 — 성능·가독성·유지보수

**목표**: 당장 고장을 내지는 않지만 속도, 읽기 편함, 이후 수정의 안전성에 영향을 주는 9건을 고친다.

#### S4.1 로고 이미지 경량화

| 항목 | 내용 |
|---|---|
| 해결 | R4-1 |
| 규모·선행 | S · 없음 |
| 대상 파일 | `public/logo.png`(1,620 KB, 2048×1021), `index.html`(11행 preload), `PedalBoard.tsx`(83~90행), `vite.config.ts`(17행·47행 프리캐시) |

**현재**: 1.6 MB 원본을 화면에서는 폭 520 px 이하로 쓴다. 첫 화면 파일 크기의 75%이고, 오프라인 저장용으로 한 번 더 받아 첫 방문에 총 4.2 MB가 든다. 느린 4G에서 로고가 8.8초에 나타났다.

**변경**: 표시 최대 폭 520 px 기준 1배·2배 WebP(파일마다 50 KB 이하), `<img width height decoding="async" fetchpriority="high">` + `srcset`, preload 교체, 프리캐시 목록에서 PNG 제거.

**수용 기준**(E-19)

- [ ] 로고 파일 각 ≤ 50 KB
- [ ] 첫 방문 전송량(프리캐시 포함) 4.2 MB → 1 MB 이하 ★
- [ ] '느린 4G' 프로필에서 로고 표시 8.8초 → 2.5초 이하 ★
- [ ] 서비스 워커 프리캐시 목록에 `logo.png`가 없다

#### S4.2 꺼진 페달과 상시 동작 노드의 CPU

| 항목 | 내용 |
|---|---|
| 해결 | R4-2(Phaser 외 나머지 상시 부하) |
| 규모·선행 | M · S3.4 |
| 대상 파일 | `BaseEffect.ts`(유휴 처리), `ChorusEffect.ts`(134~146행 LFO 9개 상시), `noise-gate-processor.ts`(76~110행 매 샘플 `Math.pow`·`Math.exp`), 워클릿 공통 `idle` 메시지, 기능 플래그 `idleDisconnect` |

**현재**: Phaser는 꺼져 있어도 코어의 10%를 쓰고(S3.4에서 해결), 15개 페달을 모두 끈 상태도 22%를 쓴다.

**변경**

1. 페달이 꺼지고 크로스페이드가 끝난 뒤, 잔향이 있는 이펙트는 `tailSeconds`(딜레이 피드백·리버브 decay로 계산)가 지난 뒤 이펙트 내부 경로를 끊는다(`effectGate → 이펙트` disconnect). 켤 때는 다시 잇고 페이드인한다.
2. 워클릿 이펙트는 `{ type: 'idle', idle: true }`를 받으면 `process()`에서 바로 무음을 돌려준다.
3. Chorus LFO는 현재 보이스 수만큼만 만들고, 노이즈 게이트의 지수 계산은 파라미터가 바뀔 때만 한다.

**수용 기준**

- [ ] P-17: 15개를 모두 끈 상태의 렌더 시간이 현재(코어 22%)의 50% 이하 ★
- [ ] 페달을 켜고 끌 때 클릭 없음(P-23), 딜레이·리버브 잔향이 끝까지 이어진다

#### S4.3 노브 반응 속도

| 항목 | 내용 |
|---|---|
| 해결 | R4-3 |
| 규모·선행 | M · S1.7(저장 지연 기능) |
| 대상 파일 | `pedalStore.ts`(901~950행 액션 — 지금은 `clonePedal`로 15개를 모두 복제), `PedalCard.tsx`, `PedalBoard.tsx` |

**현재**: 노브를 한 칸 움직일 때마다 15개 페달을 모두 다시 그리고 설정을 저장한다. CPU가 4배 느린 조건에서 한 칸에 14 ms가 걸렸다.

**변경**: 바뀐 페달만 새 객체로 만들고 나머지는 참조를 유지한다. `PedalCard`를 `React.memo`로 감싸고 페달 ID별 셀렉터로 구독한다. 저장은 SafeStorage `setDebounced`(300 ms, 조작이 멈춘 뒤 1회).

**수용 기준**

- [ ] CPU 4배 느림 조건에서 노브 한 칸 처리 ≤ 4 ms ★(현재 14 ms)
- [ ] 노브를 끄는 동안 해당 카드만 다시 그려진다(개발 모드 렌더 카운터로 확인)
- [ ] 끌기 한 번에 저장 한 번

#### S4.4 노브 조작 방식

| 항목 | 내용 |
|---|---|
| 해결 | R4-4 |
| 규모·선행 | M · S2.2(ParamDef), S1.8 |
| 대상 파일 | `src/components/SliderControl.tsx`(48~57행) → `KnobControl.tsx`, `src/styles/controls.css`(102~110행 투명 range 덮개) |

**현재**: 노브는 실제로 폭 28~60 px의 숨은 가로 슬라이더다. 클릭 한 번에 값이 튀고(10월 계획서: Drive 42 → 100), Delay 시간은 1 px에 33 ms씩 바뀐다. 값이 숫자로 보이지 않는 조절기가 16개다(Noise Gate·Drive·Crunch·Fuzz·Delay의 주 노브).

**변경**

| 입력 | 동작 |
|---|---|
| 마우스·펜 | 세로 끌기(위로 = 증가), 200 px = 전체 범위, Shift = 10배 정밀. 누르기만 해서는 값이 바뀌지 않음 |
| 터치 | `touch-action: pan-y` — 세로로 쓸면 페이지 스크롤, 가로로 끌면 조절(오른쪽 = 증가). 길게 누르면(400 ms) 숫자 입력 팝오버 |
| 더블클릭·더블탭 | ParamDef 기본값으로 |
| 값 표시 클릭·Enter | 숫자 직접 입력(단위 포함, 범위 밖은 clamp) |
| 키보드 | 기존 range 유지(화살표·PageUp/Down·Home·End). 투명 range는 `pointer-events: none` |
| 표시 | 모든 조절기 아래에 값과 단위를 항상 표시(ParamDef `format`) |

노브 곡선은 ParamDef `taper`를 따른다(Delay 시간 등은 log).

**수용 기준**(E-20)

- [ ] 노브 위 아무 곳이나 클릭(끌지 않음) → 값 변화 0
- [ ] 위로 100 px 끌기 → 범위의 50% 증가, Shift를 누르면 5%
- [ ] Delay 시간: 일반 끌기에서 1 px당 ≤ 10 ms, Shift에서 ≤ 1 ms ★(현재 33 ms)
- [ ] 값이 보이지 않는 조절기 0개(현재 16개)
- [ ] 휴대폰에서 노브 위를 세로로 쓸어도 페이지가 스크롤된다

#### S4.5 글자 크기와 대비

| 항목 | 내용 |
|---|---|
| 해결 | R4-5, D12 |
| 규모·선행 | M · S1.8, S2.4(Bypass 라벨 제거 뒤) |
| 대상 파일 | `src/styles/*.css`(0.44~0.68rem 지정 약 47곳 — 10월 계획서), 색상 토큰, `PedalCard.tsx:162`(부적절한 role → `section` + `aria-label`), `ConnectGuitarPanel.tsx:89`(중첩 aside → `div role="note"`) |

**현재**: 화면 픽셀 기준 자동 추정으로 글자의 약 3분의 1이 대비 기준(4.5:1)에 못 미친다. 밝은 회색 카드 위 'Bypass'는 1.3:1이다. 11 px보다 작은 글자가 260개이고 가장 작은 것은 6.7 px이다.

**변경**: 4.10 토큰. 최소 11 px, 라벨 12 px, 값 13 px. 밝은 카드 위 글자 대비 ≥ 4.5:1. 상태 표시(LED)는 ≥ 3:1이고 색만으로 구분하지 않는다.

**수용 기준**(E-21)

- [ ] 계산된 글자 크기가 11 px 미만인 텍스트 0개(현재 260개)
- [ ] axe `color-contrast` 위반 0 + 픽셀 표본 검사로 4.5:1 미만 텍스트 0
- [ ] Lighthouse font-size 감사 통과, axe 확정 위반 0 유지

#### S4.6 언어와 문구 통일

| 항목 | 내용 |
|---|---|
| 해결 | R4-6 |
| 규모·선행 | S · S2.3(문구 카탈로그 시작) |
| 대상 파일 | `src/i18n/ko.ts`, 영어 시스템 문구가 있는 컴포넌트·스토어('Preset saved', 'Signal Chain Updated' 등), 페달 이름 표시(내부 이름 `noiseGate` 노출), `PedalBoard.tsx:96`(개발자용 문구) |

**변경**: 4.13 원칙.

**수용 기준**(E-22)

- [ ] 화면 텍스트에서 내부 ID 형태(카멜케이스 이펙트 키) 0건
- [ ] 영어 시스템 문구 목록(테스트에 고정) 0건, 모든 토스트·오류·안내가 `ko.ts` 키를 씀, 쓰이지 않는 키 0
- [ ] 첫 화면에 브라우저 기본 영문 버튼이 없다

#### S4.7 테스트 체계 전환

| 항목 | 내용 |
|---|---|
| 해결 | R4-7 |
| 규모·선행 | M · Phase 1~3이 바꾸지 않은 나머지 테스트 |
| 대상 파일 | `scripts/*-regression.mjs`(남은 정규식 단언), `scripts/pwa-regression.mjs`, 프로브·E2E |

**현재**: 14개 테스트가 모두 통과하지만 13개는 주로 소스 코드에 특정 글자가 있는지를 검사한다(337곳). 아이콘이 없는데도 PWA 테스트가 통과한다.

**변경**: 남은 `assert.match(소스, …)` 단언을 동작 단언(프로브·E2E·단위)으로 바꾸고, 결함을 일부러 넣어 테스트가 실제로 잡는지 확인한다.

**수용 기준**

- [ ] 소스 문자열 정규식 단언 0곳(현재 337곳)
- [ ] 결함 주입 6종(트레몰로 속도 ×2, EQ 밴드 주파수 변경, 오토와우 detune 부호 반전, 코러스 depth 0, 크런치 0점 계단 되살리기, 리미터 제거)에서 각각 해당 테스트가 실패
- [ ] PWA 아이콘 파일을 지우면 PWA 테스트가 실패

#### S4.8 상표명·저작물 정리

| 항목 | 내용 |
|---|---|
| 해결 | R4-8, D3, D4, D8 |
| 규모·선행 | S · 결정(D3·D4) |
| 대상 파일 | Drive·Crunch 페달 UI와 프리셋 표시('TS-9', 'Tube Screamer', 'Crunch Box'), `cabinet.ts`(223~229행 V30·Greenback — 10월 계획서 지적, D3 적용 여부 확인), `Source/`(이미지), `.gitignore`, `README.md`(118행) |

**변경**

1. 부록 C 대체표대로 표시 이름을 바꾼다(저장 키는 그대로, 표시만).
2. `Source/`의 png·jpg·avif는 사람이 백업을 확인한 뒤 `git rm`한다. AI 기획 문서는 `git mv`로 `docs/planning/`에 옮기고 `.gitignore`에 `Source/`를 넣는다.
3. 히스토리 정리는 하지 않는다(D8).

**수용 기준**

- [ ] `src/`·`public/`·`index.html`에서 'TS-9'·'Tube Screamer'·'Crunch Box' 0건
- [ ] `git ls-files Source`에서 이미지 확장자(png·jpg·jpeg·avif·webp) 0줄

**주의**: 이 문서는 법률 판단이 아니다. 표기를 유지할지는 전문가 확인 뒤 사람이 정한다(보고서).

#### S4.9 저장소 정리

| 항목 | 내용 |
|---|---|
| 해결 | R4-9 |
| 규모·선행 | S · S0.2 |
| 대상 파일 | `assets/`(옛 빌드 776 KB, `.gitignore:3`에 있으나 추적 중), `package.json`, `README.md`(실제와 다른 수치), `vite.config.ts`(73행 `sourcemap: true`), `src/store/__migration_check.ts`(1,077줄 DEV 전용) + `main.tsx`(10~14행), 기존 문자열 워클릿 3개 |

**변경**

1. `git rm -r --cached assets` 뒤 폴더 삭제.
2. `npm audit fix` — 개발 도구 경고 16건(배포되는 앱에는 들어가지 않음). 메이저 업데이트가 필요하면 멈추고 묻는다.
3. README 수치 갱신(이펙트 수·테스트 수·지연·지원 브라우저).
4. (선택) 소스맵 `'hidden'`, DEV 점검 코드를 `scripts/`로 옮겨 `npm test`에 포함, 기존 문자열 워클릿 3개를 파일 모듈로 전환(새 워클릿과 같은 방식).

**수용 기준**

- [ ] `git ls-files assets | wc -l` = 0
- [ ] `npm audit` high 이상 0(남는 항목은 README에 이유 기록)
- [ ] README의 수치가 코드와 같다(이펙트 수는 테스트로 자동 검사)

---

### 5.6 Phase 5 — 보완 기능(선택)

수정 항목과 별개로 기타 연습 도구로서 쓰임새를 넓히는 6가지다. Phase 1~2가 끝난 뒤 필요한 것부터 고른다.

#### S5.1 WAV 녹음

| 항목 | 내용 |
|---|---|
| 해결 | RX-1 |
| 규모·선행 | M · S1.4a(리미터 뒤에서 녹음) |
| 설계 | 리미터 뒤에 녹음용 워클릿(PCM을 0.5초 단위로 포트에 전송) → 워커에서 WAV 인코딩(16비트 기본, 24비트 선택). 기본 형식 WAV, '작은 파일'을 고르면 브라우저 압축 형식(Chrome WebM·Opus, Safari MP4·AAC)이고 확장자는 MIME에 맞춘다(`.webm`·`.m4a`). 최대 길이 설정(기본 5분)과 남은 시간 표시 |
| 수용 기준 | WAV를 음악 편집 프로그램·기본 플레이어에서 열면 길이가 정확히 보인다(현재 WebM은 길이 정보 없음). Safari 압축 녹음의 확장자가 `.m4a` |

#### S5.2 MIDI 확장

| 항목 | 내용 |
|---|---|
| 해결 | RX-2 |
| 규모·선행 | M · S2.9 |
| 설계 | Program Change n → 프리셋 슬롯 n(학습 UI에서 프리셋마다 지정). CC → 익스프레션 대상(Auto Wah에 수동 모드 추가 후 필터 위치, 볼륨). 값 스무딩 20 ms, 대상은 ParamDef로 고른다 |
| 수용 기준 | PC로 프리셋 전환 ≤ 50 ms, 익스프레션 CC 0~127이 대상 범위 전체를 움직이고 지퍼 잡음이 없다 |

#### S5.3 실행 취소·다시 실행

| 항목 | 내용 |
|---|---|
| 해결 | RX-3 |
| 규모·선행 | M · S2.4, S2.8 |
| 설계 | 페달·프리셋 상태 스냅숏 스택(최대 50단계), 노브 끌기 한 번 = 한 단계로 묶음, Ctrl/⌘ + Z와 Shift + Ctrl/⌘ + Z(`code` 기준). S2.8의 실행 취소 토스트와 같은 구조 |
| 수용 기준 | 노브 끌기 1회는 실행 취소 1번에 돌아온다, 프리셋 불러오기도 되돌릴 수 있다, 되돌릴 때 오디오 클릭이 없다 |

#### S5.4 캐비닛 IR 파일 불러오기

| 항목 | 내용 |
|---|---|
| 해결 | RX-4, D7 |
| 규모·선행 | M · S3.2 |
| 설계 | WAV 업로드 → `decodeAudioData` → 샘플레이트가 다르면 `OfflineAudioContext`로 리샘플 → 1초가 넘으면 잘라내고 안내 → 에너지 정규화(GS-3) → IndexedDB에 저장(설정 저장소와 분리) → Cab 모델 '내 IR'. 무료 사용 허용 여부를 확인하라는 안내 문구 |
| 수용 기준 | 올리자마자 적용, 새로고침 뒤에도 유지, 1.5초 IR은 1초로 자르고 안내, Cab 켬/끔 음량 차 ≤ 1.5 dB |

#### S5.5 튜너 기준음 조정

| 항목 | 내용 |
|---|---|
| 해결 | RX-5 |
| 규모·선행 | S · S2.12 |
| 설계 | A4 = 430~450 Hz(1 Hz 단위, 기본 440), 설정 저장, 기타 모드·크로매틱 모드 판독에 반영 |
| 수용 기준 | A4 = 442 Hz 설정에서 442 Hz 입력이 0센트 |

#### S5.6 화면 꺼짐 방지와 이탈 경고

| 항목 | 내용 |
|---|---|
| 해결 | RX-6 |
| 규모·선행 | S · S1.2 |
| 설계 | 세션이 돌고 있는 동안 `navigator.wakeLock.request('screen')`, 탭이 다시 보이면 다시 요청, 지원하지 않으면 생략. 녹음 중일 때만 `beforeunload` 경고 |
| 수용 기준 | 지원 기기에서 연주 중 화면이 꺼지지 않는다, 녹음 중 탭을 닫으면 브라우저 확인 창이 뜨고 녹음 중이 아니면 뜨지 않는다 |

---

## 6. 테스트 전략

### 6.1 테스트 계층

| 계층 | 도구 | 무엇을 | 언제 |
|---|---|---|---|
| 단위 | `node --test`(Node 22 이상, TS 직접 실행) | 곡선 함수, 마이그레이션, SafeStorage, 오류 매핑, 단축키 매핑, 지연 합산, 튜너 줄 판독, ParamDef 일관성 | 모든 PR |
| 오디오 렌더 프로브 | 헤드리스 Chromium + `probe.html` + OfflineAudioContext | 실제 이펙트 클래스·워클릿의 소리 수치(6.2) | 모든 PR |
| 브라우저 시나리오 | Playwright(Chromium) + 가짜 마이크 WAV | 배치, 조작, 세션, 저장, MIDI 모의(6.3) | 모든 PR(무거운 것은 main 병합 때) |
| 사람 청취·실기기 | 사람 | 실제 기타·인터페이스·헤드폰·휴대폰·MIDI 장치(6.5) | Phase 배포 전 |

### 6.2 오디오 렌더 프로브 목록

'현재'는 보고서 수치다(괄호 안은 10월 계획서). 신호는 부록 A.

| ID | 측정 | 입력 | 현재 | 목표 | Step |
|---|---|---|---|---|---|
| P-01 | Crunch 무연주 잡음 대 연주음 | REF-NOISE(−90 dBFS) / REF-PC | 잡음 출력 −23 dBFS, 연주음과 10 dB 차 | 차 ≥ 30 dB ★ | S1.1 |
| P-02 | Crunch 감쇠 추종 | REF-DECAY(55 dB 감쇠) | 출력 5 dB만 감소 | ≥ 25 dB 감소 ★ | S1.1 |
| P-03 | 최악 조합 출력 피크 | REF-PC, 전 페달·Level 200%·Graphic EQ +12 dB | 0 dBFS 초과 | ≤ −1.0 dBFS | S1.4a |
| P-04 | Cab 켬/끔 음량 차 | REF-PC | 약 15 dB(−23.8 → −8.5 dBFS) | ≤ 1.5 dB | S1.4b |
| P-05 | 프리셋 40개 출력 RMS | REF-PC | −51 ~ −24 dBFS(중앙값 −31) | −20 ± 2 dBFS | S1.4c, S3.8 |
| P-06 | 한쪽 채널 입력 | REF-PC를 왼쪽에만 | 오른쪽 무음, 왼쪽 −20 dB | 좌우 차 ≤ 1 dB, 손실 ≤ 0.5 dB | S1.3 |
| P-07 | 하울링 판정 매트릭스 | H-1~H-4, G-1~G-3 | 미터가 안 보이거나 기본 구성이면 미차단 | 부록 B 기대값 | S1.5 |
| P-08 | Compressor Mix 리플 | REF-NOISE 전달함수 | Mix 75%에서 2.2 dB, 45%에서 개방음 11 dB 감소 | ≤ ±0.5 dB | S3.6 |
| P-09 | Cab 좌우 차 | REF-SINES(80 Hz~5 kHz) | 최대 14 dB | ≤ 0.5 dB | S3.2 |
| P-10 | Tape 음정 흔들림 | REF-SINE 1 kHz | 842~1,159 Hz | ≤ ±0.6% | S3.3 |
| P-11 | Flanger 노치 | REF-NOISE | 반복 4.7 ms 간격 | 설정 지연 그대로, 스윕 동작 | S3.4 |
| P-12 | Phaser 리플 | REF-NOISE | 25 dB 빗살 | ≤ 3 dB ★ | S3.4 |
| P-13 | Drive Distortion THD-노브 곡선 | REF-SINE 220 Hz −18 dBFS | 노브 30%까지 0% | 단조 증가, 30%에서 Overdrive 이상 | S3.5 |
| P-14 | Crunch THD-노브 곡선 | 같음 | 20~30%에서 최대 | 전 구간 증가 | S3.5 |
| P-15 | Delay·Reverb 원음 레벨 | REF-PC, Mix 30% | −3 dB | 0 ± 0.1 dB | S3.1 |
| P-16 | 처리 지연 | REF-IMPULSE | 기본 구성 약 10 ms | ≤ 2.7 ms(+ 리미터 1.0 ms) | S3.6, S3.7 |
| P-17 | 렌더 시간(CPU 대용 지표) | REF-PC 10초 | 모두 꺼짐 22%, Phaser 꺼짐 10% | 50% 이하 ★, Phaser 꺼짐 기여 0 | S1.5, S3.4, S4.2 |
| P-18 | 꺼진 페달을 켰을 때의 변화 | REF-PC | 변화 없음(Mix 0%) | 변화 있음 | S2.1 |
| P-19 | v1 → v2 동일성 | REF-PC | — | 널 ≤ −80 dB | S2.4 |
| P-20 | Reverb Decay 변환 | REF-PC | 6~10초가 6초와 같음 | 7.5 → 6.0, 소리 변화 0 | S2.2 |
| P-21 | GR 표시 | 무음 / −10 dBFS 지속음 | 무음에서 −5.9 dB 표시 | 0 dB / `reduction` ±0.5 dB | S2.2, S3.6 |
| P-22 | 튜너 정확도(회귀) | 개방현 6개, B1·C2 | 개방현 0센트 | ±2센트, 기존 유지 | S2.12 |
| P-23 | 바이패스 클릭·노드 생성(회귀) | REF-PC + 켜고 끄기 | (클릭 없음, 새 노드 0) | 유지 | 모든 Phase |

### 6.3 브라우저 시나리오 목록

| ID | 시나리오 | 화면·조건 | 판정 | Step |
|---|---|---|---|---|
| E-01 | 정지 정리 | Panic·Esc·차단 모의 | 500 ms 안에 트랙 종료·컨텍스트 닫힘·녹음 남음 | S1.2 |
| E-02 | 입력 채널 | 왼쪽만 신호인 가짜 마이크 | 자동 판정, 좌우 균형, 메뉴 기억 | S1.3 |
| E-03 | 하울링 | 휴대폰 4개 탭·문서 숨김·파일 모드 | 부록 B 기대값 | S1.5 |
| E-04 | 휴대폰 도달성 | 390×844·360×640·412×915, 도크 접힘·펼침 | 모든 스위치 도달 | S1.6 |
| E-05 | 저장소·렌더 오류 | 차단·가득 참·예외 주입 | 흰 화면 0, 조작 가능, 안내 1회 | S1.7 |
| E-06 | 데스크톱 배치 | 768~1920 px, 패널 펼침·접힘 | 겹침 0, 스위치 100% | S1.8 |
| E-07 | 오류 안내 | `getUserMedia` 오류 모의 7종 | 한국어 안내, 영어 원문 0 | S2.3 |
| E-08 | 스위치 통합 | 첫 화면 | LED 수 = 활성 수 | S2.4 |
| E-09 | 레벨 경고 | 신호 4종 × 휴대폰 모든 탭 | 4.12 표대로 | S2.5 |
| E-10 | 파일 모드 | 반복·탐색·Space·재연결 | S2.6 수용 기준 | S2.6 |
| E-11 | 내보내기·가져오기 | 왕복, 예전 형식 파일 | 중복 0, 팩토리 추가 0 | S2.7 |
| E-12 | 실행 취소·덮어쓰기 | 삭제·초기화·같은 이름 | 복원, 묻지 않는 덮어쓰기 0 | S2.8 |
| E-13 | MIDI | Web MIDI 모의, 새로고침 | 자동 재연결·방향·토글 | S2.9 |
| E-14 | 지연·끊김 표시 | 과부하 워클릿, API 제거 모의 | 실측 일치, '측정 불가' | S2.10 |
| E-15 | 단축키 | 한글 입력 모의, 녹음 중 Esc | S2.11 수용 기준 | S2.11 |
| E-16 | 튜너 표시 | D2·C3·B1·E3 가짜 마이크 | S2.12 수용 기준 | S2.12 |
| E-17 | 장치 변경 | `devicechange` 모의 | 자동 갱신, 분리 시 정지 | S2.13 |
| E-18 | 설치 가능성 | 빌드 결과 | 아이콘 200, 설치 오류 0 | S2.14 |
| E-19 | 로딩 성능 | 느린 4G 프로필 | 전송량·로고 표시 시간 | S4.1 |
| E-20 | 노브 조작 | 마우스·터치·키보드 | S4.4 수용 기준 | S4.4 |
| E-21 | 글자·대비 | 화면 10종 | 11 px 미만 0, 대비 위반 0 | S4.5 |
| E-22 | 문구 | 모든 화면 | 내부 ID·영어 시스템 문구 0 | S4.6 |
| E-23 | 시작 회귀 | 로드 직후, 오프라인 새로고침 | AudioContext 0개·마이크 요청 0회, 오프라인으로 열리고 연결됨 | 모든 Phase |

### 6.4 CI 파이프라인

```yaml
# .github/workflows/verify.yml — PR과 main 공통(요지)
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:unit
      - run: npm run build -- --mode test        # probe.html 포함 빌드
      - run: npm run probe                       # 기준선 비교, 허용 오차를 넘으면 실패
      - run: npx playwright install --with-deps chromium
      - run: npm run e2e
      # 실패하면 프로브 차이 표와 스크린샷을 아티팩트로 올린다
# deploy.yml: needs: verify → npm run build(일반 모드) → GitHub Pages 배포
```

기준선 규칙:

- `docs/baseline/*.json`은 의도한 변화일 때만 갱신한다. 커밋 메시지는 `baseline: {Step ID} {이유}`.
- 허용 오차는 항목마다 `tolerances.json`에 둔다. 넓히려면 사람 승인이 필요하다.
- 브라우저 버전이 바뀌어 값이 흔들리면 Playwright 버전을 고정하고 별도 PR로 기준선을 갱신한다.

### 6.5 사람 청취·실기기 체크리스트

보고서가 확인하지 못한 항목(실제 기타·인터페이스·헤드폰, Safari·Firefox·실제 휴대폰, 실제 MIDI·하울링, 실기기 부하)을 여기서 메운다.

**장비**: 실제 기타 + 2입력 오디오 인터페이스(1번 입력) + 유선 헤드폰. 음량은 작게 시작한다.

| 프리셋·대상 | 확인할 것 | 관련 Step |
|---|---|---|
| 기본 구성 | 한쪽 쏠림 없음, 속이 빈 듯한 소리 없음 | S1.3, S3.6 |
| British Crunch · Plexi Lead · Thrash Rhythm | 연주를 멈췄을 때 잡음, 음 끝의 감쇠 | S1.1, S3.5 |
| Headphone Safe Start ↔ Texas Push 전환 | 음량 차 | S1.4c, S3.8 |
| Ambient Delay · Tape Swell | 음정 흔들림 정도 | S3.3 |
| Flanger·Phaser를 쓰는 프리셋 | 움직이는 '제트' 소리 | S3.4 |
| Cab 모델 전부 | 좌우 균형, 마이크 위치를 움직일 때 클릭 | S3.2 |
| 하이 프렛 리드(Drive·Fuzz 100) | 에일리어싱(거슬리는 금속성 잡음) | S3.7 |
| 꺼진 페달 켜기(아무 프리셋) | 켜면 소리가 바뀜 | S2.1 |

- **하울링 실제 시험**: 휴대폰 스피커 + 내장 마이크, 작은 음량부터. 차단 동작과, 일반 연주(퍼즈 서스테인 포함)의 오차단 여부. 인터페이스 앞에 외부 컴프·퍼즈를 둔 경우도 한 번.
- **브라우저·기기**: Chrome·Edge(Windows·macOS), Safari(macOS), Firefox, iPhone Safari(파일 모드·녹음 확장자), Android Chrome(장치 입력·도크).
- **MIDI**: 순간형(누름 127 / 뗌 0)과 래치형 풋스위치 각 1대.
- **부하**: 저사양 노트북·휴대폰에서 전 페달 켜고 5분, 끊김 수 기록.

**기록**: `docs/listening/YYYY-MM-DD.md`에 날짜·장비·브라우저·항목별 OK 또는 문제·조정한 수치를 적는다.

---

## 7. 배포·브랜치·롤백

### 7.1 브랜치와 PR

- 브랜치 이름: `refactor/s1-2-session-teardown`처럼 Step ID와 요지.
- PR 템플릿(`.github/pull_request_template.md`):

```markdown
## Step
S1.2 — 모든 정지를 하나의 정리 절차로

## 해결 항목
R1-3, R1-2(녹음 폐기), R2-12(Esc)

## 수용 기준 결과
| 기준 | 결과 | 근거(테스트·로그) |
|---|---|---|

## 프로브·스크린샷 변화

## 청취 메모(해당할 때)

## 남은 위험
```

### 7.2 기능 플래그

`src/config/flags.ts` — 주소에 `?ff=이름`을 붙이거나 개발자 메뉴로 켠다.

| 플래그 | Step | 기본값 | 정리 |
|---|---|---|---|
| `newCompressor` | S3.6 | 청취 승인 뒤 on | 다음 릴리스에서 구 경로 삭제 |
| `oversample2x` | S3.7 | 청취 승인 뒤 on(페달별) | 문제없으면 다음 릴리스에서 정리 |
| `idleDisconnect` | S4.2 | 검증 뒤 on | 다음 릴리스에서 정리 |

하울링 감지 v2(S1.5)에는 플래그를 두지 않는다. 구 방식은 보호가 되지 않으므로 되돌릴 대상이 아니다.

### 7.3 배포와 버전

| 배포 | 포함 | 배포 전 확인 |
|---|---|---|
| v2.1.0 | Phase 1 | CI + 청취(기본 구성·Crunch 계열·채널·작은 음량 하울링) |
| v2.2.0 | Phase 2a(S2.1~S2.7) | 마이그레이션 픽스처 + 실제 브라우저에서 기존 데이터로 업그레이드 시험, 업데이트 배너 동작 |
| v2.3.0 | Phase 2b(S2.8~S2.14) | 가능하면 실제 MIDI 장치 |
| v2.4.0 | Phase 3 | 6.5 청취 전체 |
| v2.5.0 | Phase 4 | Lighthouse·접근성 |

서비스 워커가 새 버전을 받아도 연주 중에 자동 새로고침하지 않는다(S2.4의 업데이트 배너). v1 저장 키 정리는 v2.2.0에서 2개 릴리스가 지난 뒤 별도 PR로 한다.

### 7.4 롤백

- **코드**: 해당 PR을 `git revert`하고 다시 배포한다.
- **데이터**: v2 배포를 되돌려도 v1 키가 남아 있어 구버전이 그대로 동작한다. v2 기간에 바꾼 설정은 잃는다는 점을 릴리스 노트에 적는다.
- **음질 변경**: 기능 플래그로 바로 구 경로로 돌아간다.

---

## 8. 위험과 대응

| 위험 | 가능성 | 영향 | 대응 | 관련 Step |
|---|---|---|---|---|
| 하울링 오차단(긴 서스테인, 외부 페달로 입력이 줄지 않음) | 중 | 중 | 입력 쪽 감쇠 판정, 시험 신호 매트릭스, 실기기 시험, 필요하면 2단계 대응(부록 B). 수치 변경은 사람 승인 | S1.5 |
| 하울링 미탐(왜곡된 하울링) | 낮음 | 높음 | 톤 성분 비율로 배음이 있는 신호도 포함, 리미터가 2차 보호 | S1.5 |
| 리미터가 톤을 바꿈(평소에도 누름) | 중 | 중 | 프리셋 음량 정렬로 평소 감소량 ≤ 1 dB(GS-7), 감소량 기록 | S1.4 |
| 프리셋 음량 정렬이 실제 기타에서 다르게 들림 | 중 | 낮음 | D6 값을 청취 뒤 확정, 상수 하나로 재계산 | S1.4c, S3.8 |
| 저장 형식 v2 변환 중 데이터 손실 | 낮음 | 높음 | v1 키 보존, 멱등 변환, 픽스처 6종, 두 키 성공 뒤에만 schema 갱신 | S2.4 |
| 구버전 탭과의 저장 충돌 | 낮음 | 중 | `storage` 이벤트 감지 안내, 업데이트 배너 | S2.4 |
| 워클릿이 늘어 CPU 부담 증가 | 중 | 중 | P-17로 매 Step 측정, 꺼진 페달 분리 | S1.5, S4.2 |
| 브라우저별 API 차이(`setSinkId`·`playbackStats`·`track.stats`는 Chromium 계열 전용, Safari에는 Web MIDI 없음) | 높음 | 낮음 | 기능 감지 후 숨김 또는 '측정 불가', Safari 실기기 확인 | S2.10, S2.13, S2.9 |
| 직접 구현한 컴프의 음색 차이 | 중 | 중 | 플래그 A/B, 값 대응표, 청취 승인 | S3.6 |
| 오버샘플 2배의 에일리어싱 | 중 | 중 | 측정 + 청취, 페달별 예외 | S3.7 |
| 기존 강점의 회귀(바이패스 클릭, 튜너 정확도, 오프라인) | 중 | 높음 | P-22·P-23·E-23을 모든 PR에서 실행 | 전체 |
| `createMediaElementSource`는 요소당 한 번만 가능 | 높음 | 중 | 세션마다 새 `<audio>` 요소 | S2.6 |
| 로드 직후 MIDI 권한 창이 뜸 | 중 | 낮음 | 권한이 granted일 때만 자동 연결, 아니면 배너 | S2.9 |
| AI 코딩 세션이 범위를 넘어 고침 | 중 | 중 | Step 범위·금지 목록·수용 기준, PR 단위 검토(부록 D) | 전체 |
| 새 워클릿 파일 방식이 빌드·프리캐시에서 실패 | 중 | 중 | S1.4a에서 먼저 검증, 실패하면 멈추고 묻기 | S1.4a |

---

## 9. 추적표 (보고서 항목 → Step)

| 보고서 항목 | 요약 | Step | 판정 |
|---|---|---|---|
| R1-1 | 휴대폰 하단 패널이 페달 아래쪽을 가림 | S1.6 | E-04 |
| R1-2 | 하울링 보호가 대부분의 상황에서 동작하지 않음, 차단 시 녹음 폐기 | S1.5, S1.2 | P-07, E-03, E-01 |
| R1-3 | Panic 뒤에도 마이크·엔진이 켜져 있음 | S1.2 | E-01 |
| R1-4 | 기타 소리가 왼쪽에서만 남 | S1.3 | P-06, E-02 |
| R1-5 | 프리셋 음량 최대 27 dB 차, Cab을 끄면 +15 dB·깨짐, 리미터 없음 | S1.4a·b·c, S3.8 | P-03, P-04, P-05 |
| R1-6 | Crunch 무연주 잡음 | S1.1 | P-01, P-02 |
| R1-7 | 노트북 화면에서 글자 겹침·Bypass 잘림 | S1.8 | E-06 |
| R2-1 | 저장소가 막히거나 차면 앱이 멈춤 | S1.7 | E-05 |
| R2-2 | 꺼진 페달은 켜도 소리가 안 바뀜(Mix 0%) | S2.1(+ M2) | P-18 |
| R2-3 | 이름과 기능이 다른 조절기 9곳 | S2.2, S3.6(GR 최종) | P-20, P-21, 단위 테스트 |
| R2-4 | On/Off와 Bypass가 같은 일 | S2.4 | E-08, P-19 |
| R2-5 | 음원 파일 모드가 한 번 재생하면 끝남, Space | S2.6, S2.11 | E-10 |
| R2-6 | Export 직후 Import 시 팩토리 40개 복제 | S2.7(+ M5) | E-11 |
| R2-7 | 오류 안내가 영어 원문이거나 없음 | S2.3 | E-07 |
| R2-8 | 입력 레벨 경고가 사실과 다름 | S1.5, S2.5 | E-09 |
| R2-9 | MIDI가 새로고침 뒤 무반응, 방향 반대, 토글 없음 | S2.9 | E-13 |
| R2-10 | 지연·글리치 숫자가 실제와 다름, ASIO 안내 | S2.10 | E-14 |
| R2-11 | 앱 설치 아이콘·파비콘 없음 | S2.14 | E-18 |
| R2-12 | 단축키 3가지 문제(한글 입력, Esc, 10~15번째) | S2.11, S1.2 | E-15, E-01 |
| R2-13 | 튜너가 옥타브를 구분 못 함 | S2.12 | E-16, P-22 |
| R2-14 | 삭제·초기화에 확인 절차 없음, 묻지 않는 덮어쓰기 | S2.8 | E-12 |
| R2-15 | 입출력 장치 관리가 수동 | S2.13 | E-17 |
| R3-1 | Compressor Mix의 빗살 현상 | S3.6 | P-08 |
| R3-2 | Cab 좌우 음량 차 | S3.2 | P-09 |
| R3-3 | Delay Tape 모드 음정 흔들림 | S3.3 | P-10 |
| R3-4 | Flanger·Phaser 피드백 2.7 ms 지연 | S3.4 | P-11, P-12 |
| R3-5 | Drive Distortion 모드가 30%까지 무왜곡 | S3.5 | P-13 |
| R3-6 | Crunch Gain이 20~30%에서 이미 최대 | S3.5 | P-14 |
| R3-7 | Delay·Reverb Mix가 원음을 줄임 | S3.1 | P-15 |
| (3순위 본문) | 처리 지연(기본 구성 +10 ms) | S3.6, S3.7 | P-16 |
| R4-1 | 로고 1.6 MB | S4.1 | E-19 |
| R4-2 | Phaser CPU(꺼져도 코어 10%) | S3.4, S4.2 | P-17 |
| R4-3 | 노브 한 칸마다 15개 다시 그리기·저장 | S4.3 | 성능 측정 |
| R4-4 | 노브 조작 방식(숨은 가로 슬라이더, 값 표시 없음) | S4.4 | E-20 |
| R4-5 | 글자 대비·크기 | S4.5 | E-21 |
| R4-6 | 한국어·영어 혼용, 내부 이름 노출 | S2.3, S4.6 | E-22 |
| R4-7 | 자동 테스트가 소스 문자열 검사, 배포 때 미실행 | S0.2, S0.3, S0.4, S4.7 | CI |
| R4-8 | 상표명·저작물 | S4.8 | 검색 검사 |
| R4-9 | 저장소 정리(옛 빌드, esbuild, README, 보안 경고) | S0.2, S4.9 | 명령 결과 |
| RX-1 | WAV 녹음 | S5.1 | S5.1 기준 |
| RX-2 | MIDI 확장(프리셋 전환, 익스프레션) | S5.2 | S5.2 기준 |
| RX-3 | 실행 취소·다시 실행 | S5.3 | S5.3 기준 |
| RX-4 | 캐비닛 IR 불러오기 | S5.4 | S5.4 기준 |
| RX-5 | 튜너 기준음 조정 | S5.5 | S5.5 기준 |
| RX-6 | 화면 꺼짐 방지, 녹음 중 이탈 경고 | S5.6 | S5.6 기준 |
| D1~D7 | 보고서의 결정 사항 | 2.1 표 | — |

---

## 10. 완료 정의

- [ ] 9장 추적표의 모든 항목이 판정을 통과
- [ ] CI(verify)가 녹색이고, 기준선을 갱신할 때마다 이유가 기록됨
- [ ] 6.5 청취·실기기 체크리스트 완료 기록
- [ ] README·CHANGELOG 갱신, 이 문서의 '현재값' 열을 결과값으로 바꾼 v1.x 발행
- [ ] v1 저장 키 정리 PR 일정 등록(v2.2.0에서 2개 릴리스 뒤)

---

## 부록

### A. 기준 신호

모두 `src/audio/testing/signals.ts`에서 고정 시드로 만든다. 같은 신호를 WAV로 저장해 브라우저 시나리오의 가짜 마이크로도 쓴다.

| ID | 신호 | 정의 |
|---|---|---|
| REF-PC | 합성 파워코드 | E2(82.41 Hz)·B2(123.47 Hz)·E3(164.81 Hz), 각 성분은 진폭 1/n인 배음 20개(톱니파 근사), 피크 −12 dBFS로 정규화, 지수 감쇠(시정수 1.2초), 2초마다 다시 침, 길이 8초. 보고서의 원 신호와 같지 않을 수 있다(그래서 S0.3에서 기준선을 새로 기록) |
| REF-NOISE | 백색잡음 | RMS −90 dBFS(P-01), 전달함수 측정용은 −20 dBFS |
| REF-DECAY | 감쇠 톱니파 | 110 Hz, 피크 −12 dBFS, 4초 동안 55 dB 감쇠 |
| REF-SINE | 사인 | 1 kHz(Tape), 220 Hz −18 dBFS(THD) |
| REF-SINES | 사인 묶음 | 80 Hz~5 kHz를 1/3옥타브 간격으로 각 0.5초 |
| REF-IMPULSE | 임펄스 | 단일 샘플 0.5 뒤 무음 |
| H-1 | 순음 하울링 | 1 kHz, −20 dBFS, 5초 지속 |
| H-2 | 커지는 하울링 | 2.5 kHz, −50 → −6 dBFS(약 +11 dB/s), 이후 유지 |
| H-3 | 왜곡된 하울링 | 800 Hz 사인을 tanh(4x)로 왜곡, −12 dBFS 지속 |
| H-4 | 기본 구성 고레벨 지속음 | 80 Hz~3.2 kHz 중 대표 5개 음, 입력 한계 +20 dB 상당(보고서 재현 조건) |
| G-1 | 서스테인 리드(오차단 시험) | 196 Hz 배음 10개, 입력 −4 dB/s 감쇠, 5 Hz ±15센트 비브라토, 4초씩 60초 반복 |
| G-2 | 스트러밍(오차단 시험) | REF-DECAY를 2초마다 60초 |
| G-3 | 잡음 바닥(오차단 시험) | 무음 + −70 dBFS 잡음 60초 |

### B. 하울링 판정 기본값 (D9)

| 항목 | 기본값 | 근거 |
|---|---|---|
| 분석 신호 | 입력 스테이지 출력(모노, 트림 뒤), 장치 모드만 | 원신호는 줄고 되먹임은 지속 |
| 분석 창·간격 | 2048 샘플 Hann · 1024 샘플(48 kHz에서 약 43 ms · 21 ms) | |
| 레벨 하한 | RMS ≥ −50 dBFS | 잡음 무시 |
| 톤 성분 비율 | 상위 8개 피크 에너지 ≥ 80% | 배음이 있는 왜곡 하울링도 포함 |
| 음높이 안정 | 기준 대비 ±20센트 | |
| 감쇠 판정 | 판정 구간 RMS 기울기 ≥ −1.0 dB/s | 보고서의 '줄지 않고' |
| 지속 시간 | 1.0초 | 보고서의 '1초 넘게' |
| 차단 동작 | 10 ms 램프 무음 → 정리 절차(S1.2), 녹음 보존 | R1-3, R1-2 |
| 파일 모드 | 판정 끔(리미터 유지) | 마이크가 없으면 되먹임도 없음 |
| 대안(오차단이 생길 때) | 1.0초에 −10 dB로 줄이고 경고, 2.0초에 차단 | 외부 페달 때문에 입력이 줄지 않는 경우 |

기대값(P-07, E-03): H-1·H-2·H-3·H-4는 1.5초 안에 차단, G-1·G-2·G-3은 60초 동안 오차단 0회, 파일 모드 H-1은 차단 없음.

### C. 표기 대체표 (D3)

| 지금 표기 | 위치 | 제안(일반 이름) | 비고 |
|---|---|---|---|
| TS-9 | Drive 모드·페달 면 | MID OD | 전체 이름: 미드 부스트 오버드라이브 |
| Tube Screamer | Drive 설명 | 미드 부스트 오버드라이브 | |
| Crunch Box | Crunch 페달 면 | CRUNCH | 전체 이름: 하이게인 크런치 |
| V30, Greenback | Cab 모델 이름(10월 계획서 지적) | 'Synth 4x12 모던', 'Synth 4x12 빈티지' | 합성 IR임을 이름에 밝힘. D3 적용 범위에 넣을지 확인 |

프리셋 이름 가운데 특정 제품을 떠올리게 하는 표현은 S0.1에서 목록으로 만들어 함께 검토한다. 이 표는 법률 판단이 아니다.

### D. Claude Code 작업 지시 템플릿 (Step 하나에 세션 하나)

```text
[역할]
너는 Web Audio·React/TypeScript 앱을 리팩토링하는 시니어 엔지니어다. 저장소 kimyounggaur/Guitar-Pedalboard.

[먼저 읽을 것]
- docs/refactoring-design.md 의 {Step ID} 전체, 4장 {관련 절}, 0.3절 규칙
- docs/refactoring/code-map.md 의 {Step ID} 행
- {Step의 대상 파일 목록}

[작업]
{Step ID}의 '변경'을 순서대로 구현한다. 하위 작업마다 커밋한다. 대상 파일 밖은 고치지 않는다.

[하지 말 것]
- 저장 필드 이름·저장 키 변경(S2.4 제외)
- 기준선·허용 오차를 근거 없이 완화
- git 히스토리 재작성, 저장소 공개 범위 변경
- 리미터·하울링 파라미터를 화면에 노출
- 한 PR에 파일 이동과 로직 변경을 섞기
- 꼭 필요하지 않은 의존성 추가
- {Step의 '주의'}

[검증]
$ npm run typecheck && npm run lint && npm test
$ npm run probe
$ npm run e2e -- --grep "{E-xx}"

[완료 기준]
{Step의 수용 기준 체크리스트를 그대로 붙여 넣기}

[멈추고 물어볼 조건]
- 수용 기준이나 판정 수치를 바꿔야 할 것 같을 때
- 저장 형식·저장 키를 바꿔야 할 때
- 기준선을 갱신해야 할 때(이유를 먼저 보고)
- 새 의존성이 필요할 때
- 되돌리기 어려운 git 작업이 필요할 때

[보고 형식]
1) 변경 파일 목록 2) 수용 기준 결과 표 3) 프로브·스크린샷 전후 비교 4) 계획서와 다른 점과 이유 5) 남은 위험
```

### E. 용어 풀이

| 용어 | 뜻 |
|---|---|
| dBFS | 디지털 최대치(0 dBFS)를 기준으로 한 음량. −20 dBFS는 최대치보다 20 dB 작다 |
| RMS / 피크 | 평균적인 음량 / 순간 최댓값 |
| AudioWorklet | 브라우저의 오디오 전용 스레드에서 소리를 샘플 단위로 처리하는 코드 |
| 렌더 퀀텀 | Web Audio가 한 번에 처리하는 128샘플 묶음 |
| 룩어헤드 | 미리 앞을 보고 대응하려고 소리를 일부러 조금 늦추는 것 |
| 리미터 | 정한 한계를 넘지 않게 소리를 눌러 주는 장치 |
| 빗살(콤) 필터 | 같은 소리를 조금 늦춰 섞을 때 특정 주파수들이 규칙적으로 깎이는 현상 |
| 오버샘플링 / 에일리어싱 | 왜곡 계산 때 샘플을 늘려 잡음을 줄이는 방법 / 그 잡음(원래 없던 주파수) |
| IR(임펄스 응답) | 공간·스피커의 울림을 담은 짧은 녹음 |
| THD | 원음 대비 새로 생긴 배음의 비율(왜곡 정도) |
| 널 테스트 | 두 출력을 빼서 남는 소리가 거의 없으면 같은 소리로 판정하는 방법 |
| 히스테리시스 | 켜지는 기준과 꺼지는 기준 사이에 간격을 둬 깜빡임을 막는 것 |
| 니(Knee) | 압축이 갑자기가 아니라 완만하게 시작되는 구간 |
| 테이퍼 | 노브 위치와 실제 값 사이의 곡선 |
| 멱등 | 같은 작업을 여러 번 해도 결과가 한 번 한 것과 같은 성질 |

### F. 참고 자료

- 「Guitar Pedalboard 웹앱 점검 보고서」(2026-11-12) — https://drive.google.com/file/d/1uyhRS61sHtVbTR8KUnO6pIv0Q0RH7nsj/view
- 「32_기타페달보드_개선계획서」(2026-10-23) — https://drive.google.com/file/d/15zgGkxz36fpWqJwAAk_OktByYYEqTjju/view
- MDN, AudioContext.playbackStats — https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/playbackStats
- MDN, AudioPlaybackStats(underrunEvents·underrunDuration, 1초마다 갱신) — https://developer.mozilla.org/en-US/docs/Web/API/AudioPlaybackStats
- Chrome for Developers, AudioContext.setSinkId(Chrome 110 이상, 기능 감지 방법) — https://developer.chrome.com/blog/audiocontext-setsinkid
- Can I use, AudioContext.setSinkId(Firefox·Safari 미지원) — https://caniuse.com/mdn-api_audiocontext_setsinkid
- MDN, MediaTrackSettings.latency(제한적 지원) — https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackSettings/latency
- W3C Media Capture Extensions, MediaStreamTrackAudioStats(`track.stats`) — https://w3c.github.io/mediacapture-extensions/#the-mediastreamtrackaudiostats-interface
- Can I use, MediaStreamTrackAudioStats.latency(Chromium 125 이상) — https://caniuse.com/mdn-api_mediastreamtrackaudiostats_latency
- WPT, 사이클 안 DelayNode 지연 클램프(10월 계획서 인용) — https://searchfox.org/firefox-main/source/testing/web-platform/tests/webaudio/the-audio-api/processing-model/delay-time-clamping.html
- Blink DynamicsCompressorKernel.h, 룩어헤드 프레임(10월 계획서 인용) — https://chromium.googlesource.com/chromium/blink/+/main/Source/platform/audio/DynamicsCompressorKernel.h
