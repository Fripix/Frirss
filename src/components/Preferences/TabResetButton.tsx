import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import ConfirmDialog from '../ConfirmDialog';

/**
 * Le bouton « Réinitialiser… » en bas d'un onglet des Préférences.
 *
 * Il confirme par `ConfirmDialog`, comme toute action qui défait un réglage :
 * il devenait « Confirmer ? » à la même place pendant 3 s, et le second clic
 * d'un double-clic validait (le piège de l'issue #17).
 */
export function TabResetButton({ label, title, message, onReset }: {
  label: string;
  /** La question posée par la boîte. */
  title: string;
  /** Ce que la réinitialisation touche. */
  message: string;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="pt-3 flex justify-end" style={{ borderTop: '1px solid var(--panel-border)' }}>
      <button
        onClick={() => setConfirm(true)}
        className="text-[11px] px-3 py-1.5 rounded-md transition-colors"
        style={{ color: 'var(--danger)', background: 'var(--danger-light)' }}
      >
        {label}
      </button>
      <ConfirmDialog
        open={confirm}
        title={title}
        message={message}
        confirmLabel={t('preferences.resetThemeConfirm')}
        danger
        onConfirm={() => { onReset(); setConfirm(false); }}
        onCancel={() => setConfirm(false)}
      />
    </div>
  );
}
