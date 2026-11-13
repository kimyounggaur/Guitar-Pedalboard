import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { failed: boolean }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State { return { failed: true }; }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('화면을 표시하는 중 오류가 발생했습니다.', error, info);
  }

  render() {
    if (this.state.failed) {
      return (
        <main role="alert" style={{ padding: '2rem', color: '#f8fafc', background: '#101622', minHeight: '100vh' }}>
          <h1>화면을 표시하지 못했습니다</h1>
          <p>예기치 못한 오류가 발생했습니다. 저장하지 않은 변경 사항은 사라질 수 있습니다.</p>
          <button type="button" onClick={() => window.location.reload()}>페이지 다시 불러오기</button>
        </main>
      );
    }
    return this.props.children;
  }
}
