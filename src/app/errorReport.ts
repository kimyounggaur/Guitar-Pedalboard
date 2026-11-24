// 오류 화면의 '오류 정보 복사'와 토스트의 '오류 정보 복사'가 함께 쓰는 보고 문자열(S1.7, 설계서 4.8절).
// 오류 이름·메시지·앱 버전·브라우저만 담는다. 저장된 설정 값이나 연주 내용은 담지 않는다.
import { version as APP_VERSION } from '../../package.json';

export const appVersion: string = APP_VERSION;

export interface ErrorDescription {
  name: string;
  message: string;
}

/** 던져진 것이 Error 가 아닐 수 있다(문자열, 객체, undefined). 어떤 값이든 이름과 메시지로 바꾼다. */
export function describeError(error: unknown): ErrorDescription {
  if (error instanceof Error) return { name: error.name || 'Error', message: error.message || '(메시지 없음)' };
  if (typeof error === 'object' && error !== null) {
    const record = error as Record<string, unknown>;
    const name = typeof record.name === 'string' && record.name ? record.name : 'Error';
    const message = typeof record.message === 'string' && record.message ? record.message : '(메시지 없음)';
    return { name, message };
  }
  if (typeof error === 'string' && error) return { name: 'Error', message: error };
  return { name: 'Error', message: '(메시지 없음)' };
}

export function buildErrorReport(error: unknown, now: Date = new Date()): string {
  const { name, message } = describeError(error);
  const browser = typeof navigator !== 'undefined' && navigator.userAgent ? navigator.userAgent : '알 수 없음';
  return [
    `오류 이름: ${name}`,
    `메시지: ${message}`,
    `앱 버전: ${appVersion}`,
    `브라우저: ${browser}`,
    `시각: ${now.toISOString()}`,
  ].join('\n');
}

/** 클립보드에 쓴다. 비동기 클립보드 API 를 먼저 쓰고, 안 되면 임시 입력칸으로 복사한다. 던지지 않고 성공 여부만 돌려준다. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 권한이 없거나 문서에 포커스가 없으면 아래 방법으로 넘어간다.
  }

  try {
    if (typeof document === 'undefined') return false;
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.top = '0';
    field.style.left = '-9999px';
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand('copy');
    document.body.removeChild(field);
    return copied;
  } catch {
    return false;
  }
}
