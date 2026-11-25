# Phase 3 청취 체크리스트 (빈 양식)

> **아직 아무도 듣지 않았다.** 모든 '결과' 칸은 비어 있다. 들은 뒤 이 파일을 `YYYY-MM-DD.md` 로 복사해 채운다
> (날짜·장비·브라우저를 맨 위에 적는다). 설계서 6.5·S3.8. 사용법과 플래그는 `README.md`.

- 날짜:
- 장비(기타·인터페이스·헤드폰):
- 브라우저·기기:

## 1. 설계서 6.5 표(프리셋·대상별)

| # | 프리셋·대상 | 확인할 것 | 관련 Step | 결과(OK / 문제 / 조정한 수치) |
|---|---|---|---|---|
| 1 | 기본 구성 | 한쪽 쏠림 없음, 속이 빈 듯한 소리 없음 | S1.3, S3.6 | |
| 2 | British Crunch · Plexi Lead · Thrash Rhythm | 연주를 멈췄을 때 잡음, 음 끝의 감쇠 | S1.1, S3.5 | |
| 3 | Headphone Safe Start ↔ Texas Push 전환 | 음량 차(측정 5.85 dB — Headphone Safe Start 만 −26 dBFS 예외) | S1.4c, S3.8 | |
| 4 | Ambient Delay · Tape Swell | 음정 흔들림 정도(와우·플러터 깊이 ±0.4%, 여유 ±0.6% 까지) | S3.3 | |
| 5 | Flanger·Phaser 를 쓰는 프리셋 | 움직이는 '제트' 소리(Phaser 노치가 절반이 되어 결이 달라졌다) | S3.4 | |
| 6 | Cab 모델 전부 | 좌우 균형, 마이크 위치를 움직일 때 클릭, 노브가 바뀌는 데 약 0.14 초 걸리는 것 | S3.2 | |
| 7 | 하이 프렛 리드(Drive·Fuzz 100) | 에일리어싱(거슬리는 금속성 잡음). 거슬리면 `?ff=-oversample2xFuzz` 부터 4배와 비교 | S3.7 | |
| 8 | 꺼진 페달 켜기(아무 프리셋) | 켜면 소리가 바뀜 | S2.1 | |

## 2. Phase 3 에서 소리가 달라진 것

| # | 대상 | 들을 것 | 어떻게 | 결과 |
|---|---|---|---|---|
| 9 | Drive 를 쓰는 프리셋(blues-lead·texas-push·soulful-neck·solo-boost) | 더 대칭인 소리로 달라졌다. 프리셋의 Bias 를 올려 옛 소리에 맞출지 | 기본 | |
| 10 | Distortion 모드의 낮은 노브(0~30%) | 옛보다 훨씬 많이 깨진다(노브 0 의 이득이 6.5 배). 의도에 맞는지 | 기본 | |
| 11 | Crunch Gain | 정말 20~30% 에서 최대로 들리는지(R3-6, 수치로는 재현되지 않았다) | 기본 | |
| 12 | Compressor 를 쓰는 프리셋 38개(특히 bright-pop-clean −8.0·studio-clean −7.5·country-twang −7.2·funk-comp −6.5·acoustic-room −6.7 dB) | 새 컴프레서(자동 메이크업 없음)가 옛 소리보다 거슬리는지, 조용해지는 정도가 받아들일 만한지 | 기본 ↔ `?ff=newCompressor` | |
| 13 | 컴프레서 수동 메이크업 | 새 경로에서 압축을 세게 걸었을 때 다른 곳에서 올려야 하는 것이 불편한지 | `?ff=newCompressor` | |
| 14 | Fuzz | 4배(옛)와 2배(지금)가 6~7 dB 차이로 4배도 이미 거칠다. 4배를 쓸 이유가 있는지 | 기본 ↔ `?ff=-oversample2xFuzz` | |
| 15 | Drive·Crunch | 3 kHz 이상의 높은 음에서만 2배의 에일리어싱이 −28~−46 dBc 까지 올라간다. 연주에서 들리는지 | 기본 ↔ `?ff=-oversample2xDrive,-oversample2xCrunch` | |

## 3. 음량 정렬(S1.4c·S3.8)

| # | 대상 | 들을 것 | 결과 |
|---|---|---|---|
| 16 | **D6 목표(−20 dBFS)** | 실제 기타로 프리셋을 오가며 음량이 비슷하게 들리는지. 바꾸려면 `PRESET_TARGET_RMS_DBFS` 한 개를 고치고 `npm run trims` | |
| 17 | 피크 제한을 받은 프리셋 7개(Acoustic Room −22.7·Tape Swell −21.2·Fuzz Experiment −21.3 등) | 귀로 너무 작지 않은지. 작다면 평균을 우선하는 쪽으로 바꿀지 | |
| 18 | 클린 ↔ 드라이브 전환(가장 큰 쌍 Acoustic Room ↔ Post Rock Wash 3.2 dB) | 음량이 튀지 않는지, Cab 켬/끔 때도 거슬리지 않는지 | |

## 4. 앞 Phase 에서 미룬 실기기 확인(발췌)

설계서 6.5 의 나머지: 하울링 실제 시험(휴대폰 스피커 + 내장 마이크, 작은 음량부터, 차단 동작과 일반 연주·퍼즈 서스테인의 오차단), 브라우저·기기(Chrome·Edge, Safari, Firefox, iPhone Safari 파일 모드·녹음 확장자, Android Chrome), MIDI(순간형·래치형 풋스위치 각 1대), 부하(저사양 노트북·휴대폰에서 전 페달 켜고 5분, 끊김 수).
각 Step 별 세부 항목은 `docs/refactoring/step-reports.md` 의 '사람 확인 필요'.

| # | 항목 | 결과 |
|---|---|---|
| 19 | 하울링 실제 시험 | |
| 20 | 브라우저·기기 | |
| 21 | MIDI | |
| 22 | 부하 | |
