import { useChainItems } from '../store/pedalSelectors';
import { useRenderCount } from '../testing/renderCount';
import { useAudioStore } from '../store/audioStore';
import { PedalIcon } from './PedalIcon';

export function ChainText() {
  useRenderCount('ChainText');
  // 이름·종류·색·켜짐만 구독한다. 노브 값이 바뀔 때는 다시 그려지지 않는다(S4.3).
  const pedals = useChainItems(true);
  // 경고가 있을 때만 쓰는 문구라 한 문자열로 구독한다. 경고가 없으면 추정 게인이 바뀌어도(Drive 노브를 돌려도) 다시 그려지지 않는다.
  const chainGainNotice = useAudioStore((state) =>
    state.chainGainWarning ? `${state.chainGainWarning} (추정 +${state.estimatedChainGainDb.toFixed(1)} dB)` : null,
  );

  return (
    <section className="side-panel chain-panel">
      <div className="panel-title">
        <p className="eyebrow">신호 흐름</p>
        <h2>체인 순서</h2>
      </div>
      <ol className="chain-list">
        {pedals.map((pedal, index) => (
          <li key={pedal.id}>
            <span>{index + 1}</span>
            <strong>
              <PedalIcon type={pedal.type} color={pedal.color} />
              {pedal.name}
            </strong>
            {!pedal.active && <em>꺼짐</em>}
          </li>
        ))}
      </ol>
      {chainGainNotice ? (
        <p className="warning-message" role="status">
          {chainGainNotice}
        </p>
      ) : null}
    </section>
  );
}
