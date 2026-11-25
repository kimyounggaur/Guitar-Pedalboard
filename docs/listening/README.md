# 사람 청취·실기기 기록

설계서 6.5 의 체크리스트를 사람이 채워 넣는 곳이다. 자동 시험·프로브·e2e 는 소리를 **숫자**로만 재므로(귀로 듣는 확인은 하지 못했다),
배포 전에 아래를 사람이 한 번 해야 한다.

- **현재 상태(2026-11-26): 청취 기록 없음.** 이 폴더의 `phase3-checklist.md` 는 Phase 3 가 끝난 시점에 사람이 들어야 하는 것을
  한곳에 모아 둔 **빈 체크리스트**다. 아직 아무도 듣지 않았다.
- 들은 뒤에는 `phase3-checklist.md` 를 복사해 `YYYY-MM-DD.md`(들은 날짜)로 저장하고 날짜·장비·브라우저·항목별 결과(OK 또는 문제)·조정한 수치를 적는다.
  설계서 S3.8 의 수용 기준 "6.5 청취 기록 파일 작성 완료" 가 이 파일이다.
- 앞 Phase 에서 미룬 사람 확인은 `docs/refactoring/step-reports.md` 각 Step 절의 '사람 확인 필요' 에 있다(S1.2~S3.7).
  Phase 3 에서 소리가 달라질 수 있는 것만 체크리스트에 옮겼다.

## 장비

실제 기타 + 2입력 오디오 인터페이스(1번 입력) + 유선 헤드폰. **음량은 작게 시작한다.**

## 플래그로 옛 소리·새 소리를 번갈아 듣기

주소 뒤에 붙이고 새로 고친다(이미 만들어진 이펙트는 바뀌지 않는다). 쉼표로 여럿, 이름 앞의 `-` 는 끔.

| 주소 | 뜻 | 기본값 |
|---|---|---|
| `?ff=newCompressor` | 새 컴프레서(5 ms RMS·자동 메이크업 없음, S3.6). 켜면 Compressor 를 쓰는 프리셋 38개가 0.02~8 dB 조용해진다 | 꺼짐 |
| `?ff=-oversample2x` | 왜곡 페달 셋을 모두 옛 4배 오버샘플링으로(S3.7). 켤 때 지연이 페달당 약 1.4 ms 늘어난다 | 켜짐(2배) |
| `?ff=-oversample2xDrive` · `-oversample2xCrunch` · `-oversample2xFuzz` | 그 페달만 4배로 | 켜짐(2배) |

예: `https://…/Guitar-Pedalboard/?ff=newCompressor,-oversample2xFuzz`

## 결정이 필요한 것(청취 뒤)

| 결정 | 어떻게 바꾸나 | 뒤따르는 일 |
|---|---|---|
| 새 컴프레서를 기본으로 | `src/config/flags.ts` 의 `newCompressor` 를 `true` | `npm run trims` 로 프리셋 음량 다시 맞추기, `npm run probe -- --update`, 다음 릴리스에서 옛 경로 삭제 |
| 컴프레서 수동 메이크업이 필요한가 | `makeup` ParamDef 추가 또는 Level 상한 200% | 파라미터 스키마·화면·저장 형식·e2e 가 함께 바뀐다(별도 Step) |
| 왜곡 페달을 4배로 되돌리나 | `flags.ts` 의 `oversample2xFuzz`(등)를 `false` | 켤 때 지연 +1.4 ms(P-29 4배 표 4.39 / 4.04 ms), 프리셋 음량이 달라지면 `npm run trims` |
| 목표 음량 D6(−20 dBFS) | `src/audio/offline/loudnessSpec.ts` 의 `PRESET_TARGET_RMS_DBFS` | `npm run trims` 후 `npm run probe -- --update` |
| Drive 프리셋의 Bias 값 | 프리셋 정의의 `bias` | `npm run trims` |
