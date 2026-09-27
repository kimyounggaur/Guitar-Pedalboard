import type { MouseEventHandler } from 'react';

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onContextMenu?: MouseEventHandler<HTMLLabelElement>;
}

export function ToggleSwitch({ label, checked, onChange, onContextMenu }: ToggleSwitchProps) {
  return (
    <label className="toggle-switch" onContextMenu={onContextMenu}>
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </label>
  );
}
