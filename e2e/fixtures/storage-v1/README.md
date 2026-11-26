# localStorage 픽스처 (storage-v1)

저장 형식을 바꾸기 **전**의 앱(`2a5ab81`, `SCHEMA_VERSION = 11`)이 쓰는 localStorage 상태를 파일로 고정한 것이다.
S0.4(E2E 하네스)가 시작 상태로 쓰고, S2.4(저장 형식 v2)가 변환의 입력으로 쓴다.

## 파일 모양

```json
{ "name": "…", "description": "…", "source": "…", "storage": { "<키>": "<저장된 원문 문자열>" } }
```

`storage`의 값은 객체가 아니라 **브라우저에 저장된 문자열 그대로**다. 03은 일부러 깨뜨린 문자열이라 JSON으로 파싱되지 않는다.

## 목록

| 파일 | 만든 방법 | 담은 것 | 앱에 넣으면(2026-11-23 실제 Chrome으로 확인) |
|---|---|---|---|
| `01-default.json` | 실제 앱에서 받음 | 처음 실행한 상태(`pedals` 키 하나, 페달 15개 모두 `enabled:true`) | 켜진 페달 Noise Gate·Compressor·Drive·EQ·Cab, 오류 0 |
| `02-user-presets-switch-combos.json` | 01을 변형 | `pedals` 키를 payload version 10으로 하고 Noise Gate·Compressor·Drive·EQ에 `enabled`/`bypassed` 네 가지 조합을 넣음, 사용자 프리셋 2개 | 10→11 변환 뒤 켜진 페달 Noise Gate·Cab (Compressor는 Bypass, Drive·EQ는 끔) |
| `03-corrupt-json.json` | 손으로 만듦(실제 값을 중간에서 자름) | `pedals`·`web-guitar-pedalboard-presets`·`io` 세 키가 모두 깨진 문자열 | 흰 화면 없이 기본값으로 뜸(켜진 페달 5개), 깨진 `io` 키는 앱이 다시 씀 |
| `04-disabled-pedal-mix0.json` | 01을 변형 | Delay·Reverb·Chorus가 꺼져 있고 Mix 0%(`pedals` 키와 사용자 프리셋) | 켜진 페달 기본 5개. Mix 0%는 S2.1이 불러올 때 바로잡기 전까지 그대로 남음 |
| `05-reverb-decay-7.5.json` | 01을 변형 | Reverb를 켠 채 `decay` 7.5초 | 켜진 페달 기본 5개 + Reverb. 슬라이더는 6초에서 멈추지만 저장값 7.5는 그대로(D14: 6초로 제한) |
| `06-midi-bypass-mapping.json` | 코드를 읽고 손으로 만듦(`src/audio/midi.ts` 형식) | `guitar-pedalboard:midi`에 Delay=CC 80 토글, Reverb=Note 60 누름 유지, Drive=CC 81 | 켜진 페달 기본 5개, `midi` 키 유지 |

"실제 앱에서 받음"은 개발 서버를 띄운 Chrome에서 스위치를 한 번 켰다 끈 뒤 `localStorage`를 그대로 덤프했다는 뜻이다. "변형"은 그 덤프를 프로그램으로 바꾼 것이다.
03·06은 `source`에 적은 대로 손으로 만들었다. 실제 사용자 데이터가 아니다.

## 불러오는 방법

앱 주소는 `vite` 개발 서버 기준 `http://127.0.0.1:<포트>/Guitar-Pedalboard/`다(`vite.config.ts`의 `base`).
페이지가 뜨기 **전에** 넣어야 한다. 새로고침할 때 덮어쓰지 않도록 `sessionStorage`로 한 번만 넣는다.

```js
import { readFileSync } from 'node:fs';

const fixture = JSON.parse(readFileSync('e2e/fixtures/storage-v1/02-user-presets-switch-combos.json', 'utf8'));
await page.addInitScript((storage) => {
  if (sessionStorage.getItem('__fixture-loaded')) return;
  sessionStorage.setItem('__fixture-loaded', '1');
  localStorage.clear();
  for (const [key, value] of Object.entries(storage)) localStorage.setItem(key, value);
}, fixture.storage);
await page.goto(appUrl);
```

CDP를 직접 쓸 때는 같은 스크립트를 `Page.addScriptToEvaluateOnNewDocument`에 넣는다.

## 쓰는 Step

| 픽스처 | Step |
|---|---|
| 01 | S0.4 기본 시나리오, S2.4 변환의 기준 |
| 02 | S2.4 (enabled/bypassed 네 가지 조합이 변환 뒤에도 같은 소리여야 함) |
| 03 | S1.7 (저장소 오류에도 앱이 뜸), S2.4 (깨진 값을 지우지 않고 백업) |
| 04 | S2.1 (꺼짐 + Mix 0% 바로잡기) |
| 05 | S2.2 (Reverb decay 범위) |
| 06 | S2.9 (MIDI가 `bypassed`→`active` 이름 변경 뒤에도 같은 동작) |

S2.4 는 여섯 픽스처 모두를 E-08(`e2e/tests/e08-active-led.spec.ts`)·P-19(오디오 프로브)·`npm run test:storage-v2` 의 입력으로 쓴다. 파일은 바뀌지 않았다.

## 바꿀 때 지킬 것

- 파일 안의 값은 **저장 형식 v1~v11이 만든 원본**이다. 앱 형식이 바뀌어도 이 파일을 새 형식으로 고치지 않는다(변환 시험의 입력이기 때문).
- 새 형식(`guitar-pedalboard:v2:*`)의 픽스처는 `storage-v2/`에 따로 만든다.
