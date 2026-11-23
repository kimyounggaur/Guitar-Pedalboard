// 별도 TS 파일로 만든 워클릿의 주소(설계서 4.1절 규칙 6). Vite 가 빌드 때 해시 이름의 파일로 내보내고,
// 서비스 워커 프리캐시(`**/*.js`)에 들어가 오프라인에서도 불러와진다. 이 파일은 앱·오프라인 렌더 양쪽이 쓴다.
import levelMeterWorkletUrl from './level-meter.worklet.ts?worker&url';
import limiterWorkletUrl from './limiter.worklet.ts?worker&url';
import outputGuardWorkletUrl from './output-guard.worklet.ts?worker&url';

export { levelMeterWorkletUrl, limiterWorkletUrl, outputGuardWorkletUrl };
