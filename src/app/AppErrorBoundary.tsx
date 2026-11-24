import { Component, createRef, type ErrorInfo, type ReactNode } from 'react';
import { safeStorage } from '../persistence';
import { stopSessionForError } from '../store/audioStore';
import { buildErrorReport, copyText, describeError } from './errorReport';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
  confirmingReset: boolean;
  copyStatus: 'idle' | 'copied' | 'failed';
}

const initialState: State = { error: null, confirmingReset: false, copyStatus: 'idle' };

/**
 * 앱 전체를 감싸는 오류 경계(S1.7, 설계서 4.8절).
 * 렌더링 중 예외가 나면 먼저 오디오 세션을 'error' 이유로 멈춰 소리와 마이크를 끄고, 한국어 안내 화면을 보여 준다.
 * 이 경계가 잡는 것은 렌더링·생명주기 중의 예외뿐이다. 이벤트 핸들러·비동기 코드의 오류는 `installGlobalErrorHandlers` 가 토스트로 알린다.
 */
export class AppErrorBoundary extends Component<Props, State> {
  state: State = initialState;
  private readonly screenRef = createRef<HTMLElement>();

  static getDerivedStateFromError(error: unknown): State {
    const normalized = error instanceof Error ? error : new Error(describeError(error).message);
    return { error: normalized, confirmingReset: false, copyStatus: 'idle' };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    // 소리부터 끈다. 정리 절차가 실패해도 던지지 않으므로 아래 화면 표시에는 영향이 없다.
    void stopSessionForError();
    console.error('화면을 표시하는 중 오류가 발생했습니다.', error, info.componentStack);
  }

  componentDidUpdate(_previousProps: Props, previousState: State): void {
    // 오류 화면이 막 나타났을 때 스크린 리더와 키보드 사용자가 그 화면에서 시작하도록 포커스를 옮긴다.
    if (!previousState.error && this.state.error) this.screenRef.current?.focus();
  }

  private readonly retry = (): void => {
    this.setState(initialState);
  };

  private readonly askReset = (): void => {
    this.setState({ confirmingReset: true });
  };

  private readonly cancelReset = (): void => {
    this.setState({ confirmingReset: false });
  };

  private readonly confirmReset = (): void => {
    // 이 앱의 설정 키(`guitar-pedalboard:`)만 지운다. 같은 주소의 다른 앱 데이터와 직접 저장한 프리셋은 건드리지 않는다.
    safeStorage.clearAppSettings();
    window.location.reload();
  };

  private readonly copyReport = async (): Promise<void> => {
    const copied = await copyText(buildErrorReport(this.state.error));
    this.setState({ copyStatus: copied ? 'copied' : 'failed' });
  };

  render(): ReactNode {
    const { error, confirmingReset, copyStatus } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="app-error-screen" role="alert" tabIndex={-1} ref={this.screenRef} data-app-error="true">
        <h1>문제가 생겨 화면을 표시하지 못했습니다</h1>
        <p>예기치 못한 오류가 발생했습니다. 소리와 마이크 입력은 안전을 위해 멈췄습니다.</p>
        <p className="app-error-detail">직접 저장한 프리셋은 그대로 남아 있습니다.</p>

        <div className="app-error-actions">
          <button type="button" className="app-error-primary" onClick={this.retry}>
            다시 시도
          </button>
          <button type="button" onClick={this.askReset} aria-expanded={confirmingReset}>
            설정을 초기화하고 다시 시작
          </button>
          <button type="button" onClick={() => void this.copyReport()}>
            오류 정보 복사
          </button>
        </div>

        {copyStatus === 'copied' ? <p role="status">오류 정보를 복사했습니다.</p> : null}
        {copyStatus === 'failed' ? (
          <div role="status">
            <p>복사하지 못했습니다. 아래 내용을 직접 선택해 복사해 주세요.</p>
            <textarea readOnly rows={6} value={buildErrorReport(error)} aria-label="오류 정보" onFocus={(event) => event.currentTarget.select()} />
          </div>
        ) : null}

        {confirmingReset ? (
          <section className="app-error-confirm" aria-labelledby="app-error-confirm-title">
            <h2 id="app-error-confirm-title">설정을 초기화할까요?</h2>
            <p>페달 상태, 입출력·MIDI 설정, 프리셋 즐겨찾기와 최근 목록이 지워지고 처음 상태로 시작합니다. 직접 저장한 프리셋은 지워지지 않습니다.</p>
            <div className="app-error-actions">
              <button type="button" className="app-error-danger" onClick={this.confirmReset}>
                초기화하고 다시 시작
              </button>
              <button type="button" onClick={this.cancelReset}>
                취소
              </button>
            </div>
          </section>
        ) : null}
      </main>
    );
  }
}
