import { useEffect, useState } from 'react';
import { STORAGE_FAILURE_EVENT } from '../store/storageNotice';

export function StorageNotice() {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const show = () => setVisible(true);
    window.addEventListener(STORAGE_FAILURE_EVENT, show);
    return () => window.removeEventListener(STORAGE_FAILURE_EVENT, show);
  }, []);
  if (!visible) return null;
  return <div role="alert" style={{ position: 'fixed', zIndex: 9999, top: 8, left: 8, right: 8, padding: 12, background: '#642c21', color: 'white', textAlign: 'center' }}>
    설정이 저장되지 않았습니다. 현재 화면에서는 계속 사용할 수 있지만 새로고침하면 변경 사항이 사라질 수 있습니다. 브라우저 저장 공간과 사이트 설정을 확인해 주세요.{' '}
    <button type="button" onClick={() => setVisible(false)}>닫기</button>
  </div>;
}
