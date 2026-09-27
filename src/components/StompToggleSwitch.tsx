interface StompToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}

export function StompToggleSwitch({ label, checked, onChange }: StompToggleSwitchProps) {
  return (
    <button
      type="button"
      className={`stomp-toggle-switch${checked ? ' is-on' : ' is-off'}`}
      aria-pressed={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="stomp-toggle-led" aria-hidden="true" />
      <span className="stomp-toggle-button" aria-hidden="true">
        <span />
      </span>
      <span className="stomp-toggle-label">
        {label}
        <output>{checked ? 'ON' : 'OFF'}</output>
      </span>
    </button>
  );
}
