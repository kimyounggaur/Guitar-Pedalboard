// 연결 오류의 분류와 안내 문구 고르기(설계서 4.13, 보고서 R2-7).
//
// 오류의 `name` 만 본다. 브라우저가 주는 영어 `message`('Permission denied' 등)는 화면에 내지 않는다.
// 이 파일은 브라우저·Web Audio 에 의존하지 않아 Node 에서 그대로 시험한다(`npm run test:connect-errors`).
import { ko } from '../../i18n/ko';

export type ConnectErrorKind =
  | 'notAllowed'
  | 'notFound'
  | 'notReadable'
  | 'overconstrained'
  | 'security'
  | 'abort'
  | 'workletLoad'
  | 'other';

/**
 * 오디오 워클릿 모듈을 불러오지 못했다(`audioWorklet.addModule` 이 거부됨).
 * 브라우저는 이 실패를 AbortError 로 올려서 '장치 시작 실패'와 이름이 같다. 엔진이 이 오류로 감싸서 둘을 가른다.
 */
export class WorkletLoadError extends Error {
  constructor(options?: { cause?: unknown }) {
    super(ko.engine.workletLoad, options);
    this.name = 'WorkletLoadError';
  }
}

function errorName(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' && name !== '' ? name : null;
}

function errorText(error: unknown): string {
  if (typeof error === 'string') return error;
  if (typeof error !== 'object' || error === null) return '';
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' ? message : '';
}

function hasHangul(text: string): boolean {
  return /[가-힣]/.test(text);
}

/** 오류 이름으로 4.13 표의 행을 고른다. 옛 브라우저가 쓰던 이름도 같은 행이다. instanceof 는 쓰지 않는다(다른 창에서 온 오류도 이름은 같다). */
export function classifyConnectError(error: unknown): ConnectErrorKind {
  switch (errorName(error)) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return 'notAllowed';
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'notFound';
    case 'NotReadableError':
    case 'TrackStartError':
      return 'notReadable';
    case 'OverconstrainedError':
    case 'ConstraintNotSatisfiedError':
      return 'overconstrained';
    case 'SecurityError':
      return 'security';
    case 'AbortError':
      return 'abort';
    case 'WorkletLoadError':
      return 'workletLoad';
    default:
      return 'other';
  }
}

/**
 * 입력 장치로 연결하다 실패했을 때 화면에 낼 한국어 안내(4.13 표). 영어 원문은 어떤 경우에도 나오지 않는다.
 * 표에 없는 오류는 '그 밖' 행이다. 엔진이 직접 만든 한국어 오류('이 브라우저는 오디오 입력을 지원하지 않습니다.' 등)는 그대로 보여 준다.
 */
export function connectErrorMessage(error: unknown): string {
  switch (classifyConnectError(error)) {
    case 'notAllowed':
      return ko.connect.notAllowed;
    case 'notFound':
      return ko.connect.notFound;
    case 'notReadable':
      return ko.connect.notReadable;
    case 'overconstrained':
      // 여기까지 왔다면 기본 장치로 다시 시도해도 조건에 맞는 입력이 없었다는 뜻이다. 표에는 이 경우의 문구가 없어 '입력 장치 없음'과 같게 안내한다.
      return ko.connect.notFound;
    case 'security':
      return ko.connect.security;
    case 'abort':
      return ko.connect.abort;
    case 'workletLoad':
      return ko.connect.workletLoad;
    case 'other': {
      const text = errorText(error);
      if (hasHangul(text)) return text;
      return ko.connect.other(errorName(error) ?? '알 수 없음');
    }
  }
}

/**
 * 연결이 아닌 오디오 작업(음원 파일 시작·재생, 녹음 시작, 장치 목록 읽기)이 실패했을 때의 안내.
 * 마이크 권한 같은 연결 오류 문구는 쓰지 않는다(음원 파일의 재생 거부도 NotAllowedError 인데, 마이크와는 관계가 없다).
 */
export function audioErrorMessage(error: unknown): string {
  if (classifyConnectError(error) === 'workletLoad') return ko.connect.workletLoad;
  const text = errorText(error);
  return hasHangul(text) ? text : ko.audio.startFailed;
}

/**
 * 골라 둔 입력 장치가 없어서 연결이 실패했는가. 그렇다면 기본 장치로 한 번 다시 연결한다(4.13: OverconstrainedError).
 * 브라우저에 따라 '없는 장치 ID' 를 NotFoundError 로 알리기도 하므로 같이 본다. 장치를 고르지 않았다면(기본 장치) 다시 시도할 것이 없다.
 */
export function shouldRetryWithDefaultInput(error: unknown, requestedDeviceId: string | undefined): boolean {
  if (!requestedDeviceId) return false;
  const kind = classifyConnectError(error);
  return kind === 'overconstrained' || kind === 'notFound';
}
