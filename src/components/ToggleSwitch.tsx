interface ToggleSwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name (used when the visible label is separate). */
  ariaLabel?: string;
  disabled?: boolean;
}

/**
 * Small sliding on/off switch, matching the toggle used in the Admin settings
 * (registrations / SSO). Self-contained button — place it next to its label.
 */
export default function ToggleSwitch({ checked, onChange, ariaLabel, disabled }: ToggleSwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="w-8 h-4 rounded-full relative transition-colors flex-shrink-0 disabled:opacity-50 cursor-pointer"
      style={{ background: checked ? 'var(--accent)' : 'var(--panel-border)' }}
    >
      <span
        className="w-3.5 h-3.5 rounded-full bg-white absolute top-0.5 transition-all"
        style={{ left: checked ? '17px' : '1px' }}
      />
    </button>
  );
}
