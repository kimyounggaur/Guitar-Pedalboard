import { ko } from '../i18n/ko';
import { useMonitorStore } from '../store/monitorStore';

// 입력 레벨 경고 한 줄(설계서 4.12, S2.5). 입력 패널과 미터 패널이 같은 컴포넌트로 같은 문구를 보인다.
// 판정은 MonitorService 가 오디오 시계로 하고, 여기서는 monitorStore.inputWarning 을 읽어 보여 주기만 한다 —
// 어느 탭이 열려 있는지, 미터가 그려지는지와 상관없이 두 패널은 같은 값을 본다. 값은 바뀔 때만 갱신되므로 30 Hz 로 다시 그리지 않는다.
const NOTICES = {
  // 신호가 없다: 눈에 띄되 급하지 않다. 케이블·채널 확인.
  silent: { tone: 'is-warning', role: 'status', text: ko.level.silent },
  // 작다: 연주는 가능하다. 가장 약한 표시.
  low: { tone: 'is-muted', role: 'status', text: ko.level.low },
  // 너무 크다: 인터페이스에서 이미 깨졌다. 바로 알린다.
  high: { tone: 'is-danger', role: 'alert', text: ko.level.high },
} as const;

export function InputLevelNotice() {
  const warning = useMonitorStore((state) => state.inputWarning);
  if (!warning) return null;
  const notice = NOTICES[warning];
  return (
    <p className={`level-warning ${notice.tone}`} role={notice.role} data-level-warning={warning}>
      {notice.text}
    </p>
  );
}
