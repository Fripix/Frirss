import { useTranslation } from 'react-i18next';
import type { AiProviderView } from '../../../api/backend';
import { providerChoices } from '../../../lib/aiProviderChoices';
import ConfirmDialog from '../../ConfirmDialog';

export function BlockTitle({ children }: { children: string }) {
  return (
    <h3 className="flex items-center gap-2.5 text-sm font-bold" style={{ color: 'var(--list-title)' }}>
      <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
      {children}
    </h3>
  );
}

/** Les `<option>` d'une liste de fournisseurs, selon `providerChoices`. */
export function ProviderOptions({ providers, value, defaultLabel }: { providers: AiProviderView[]; value: number | null; defaultLabel: string }) {
  const { t } = useTranslation();
  return (
    <>
      {providerChoices(providers, value, defaultLabel, t).map((c) => (
        <option key={c.value ?? ''} value={c.value ?? ''} disabled={c.disabled}>{c.label}</option>
      ))}
    </>
  );
}

/**
 * L'avertissement de coût du résumé automatique, une seule rédaction pour ses
 * deux portes d'entrée : l'interrupteur global de « Résumés » et un
 * interrupteur « Résumer » de « Par flux et catégorie ». Confirmer ici, d'où
 * qu'on vienne, vaut pour le compte (`aiAutoSummaryConfirmed`) : c'est à
 * l'appelant de le noter.
 */
export function AutoSummaryConfirm({ open, onConfirm, onCancel }: { open: boolean; onConfirm: () => void; onCancel: () => void }) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={open}
      title={t('ai.user.autoConfirmTitle')}
      message={t('ai.user.autoConfirmMessage')}
      confirmLabel={t('ai.user.autoConfirm')}
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}
