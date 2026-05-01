import { usePedalStore } from '../store/pedalStore';

export function ChainText() {
  const pedals = usePedalStore((state) => state.pedals);

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
            <strong>{pedal.name}</strong>
            {pedal.bypassed && <em>Bypass</em>}
          </li>
        ))}
      </ol>
    </section>
  );
}
