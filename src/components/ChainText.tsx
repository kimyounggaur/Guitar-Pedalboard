import { usePedalStore } from '../store/pedalStore';
import { useAudioStore } from '../store/audioStore';
import { PedalIcon } from './PedalIcon';

export function ChainText() {
  const pedals = usePedalStore((state) => state.pedals);
  const chainGainWarning = useAudioStore((state) => state.chainGainWarning);
  const estimatedChainGainDb = useAudioStore((state) => state.estimatedChainGainDb);

  return (
    <section className="side-panel chain-panel">
      <div className="panel-title">
        <p className="eyebrow">Signal Chain</p>
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
            {pedal.bypassed && <em>Bypass</em>}
          </li>
        ))}
      </ol>
      {chainGainWarning ? (
        <p className="warning-message" role="status">
          {chainGainWarning} (추정 +{estimatedChainGainDb.toFixed(1)} dB)
        </p>
      ) : null}
    </section>
  );
}
