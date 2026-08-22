import { useState } from 'react';
import { useTranslation } from 'react-i18next';

export function TabResetButton({ label, onReset }: { label: string; onReset: () => void }) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="pt-3 flex justify-end" style={{ borderTop: '1px solid var(--panel-border)' }}>
      <button
        onClick={() => {
          if (!confirm) { setConfirm(true); setTimeout(() => setConfirm(false), 3000); return; }
          onReset();
          setConfirm(false);
        }}
        className="text-[11px] px-3 py-1.5 rounded-md transition-colors"
        style={{
          color: confirm ? '#fff' : 'var(--danger)',
          background: confirm ? 'var(--danger)' : 'var(--danger-light)',
        }}
      >
        {confirm ? t('preferences.confirm') : label}
      </button>
    </div>
  );
}
