import type { MouseEventHandler } from 'react';
import { useParamNames } from './ParamScope';

interface ToggleSwitchProps {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  onContextMenu?: MouseEventHandler<HTMLLabelElement>;
}

export function ToggleSwitch({ label, checked, onChange, onContextMenu }: ToggleSwitchProps) {
  const { name, tip } = useParamNames(label);
  return (
    <label className="toggle-switch" onContextMenu={onContextMenu}>
      <span title={tip}>{label}</span>
      <input
        type="checkbox"
        aria-label={name}
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span className="switch-track" aria-hidden="true">
        <span className="switch-thumb" />
      </span>
    </label>
  );
}
