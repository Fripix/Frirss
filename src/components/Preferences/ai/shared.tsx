import { useTranslation } from 'react-i18next';
import type { AiProviderView } from '../../../api/backend';

export function BlockTitle({ children }: { children: string }) {
  return (
    <h3 className="flex items-center gap-2.5 text-sm font-bold" style={{ color: 'var(--list-title)' }}>
      <span aria-hidden="true" className="inline-block w-1 h-4 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} />
      {children}
    </h3>
  );
}

/**
 * Les `<option>` d'une liste de fournisseurs : l'option vide (`defaultLabel`),
 * un fournisseur par option — grisé et marqué « clé requise » s'il n'est pas
 * utilisable par cet utilisateur — et, si `value` désigne un fournisseur qui
 * n'existe plus, une option « Fournisseur supprimé » qui garde le choix visible
 * au lieu de retomber en silence sur le défaut.
 */
export function ProviderOptions({ providers, value, defaultLabel }: { providers: AiProviderView[]; value: number | null; defaultLabel: string }) {
  const { t } = useTranslation();
  const removed = value !== null && !providers.some((p) => p.id === value);
  return (
    <>
      <option value="">{defaultLabel}</option>
      {providers.map((p) => (
        <option key={p.id} value={p.id} disabled={!p.available}>
          {p.available ? p.name : t('ai.user.keyRequired', { name: p.name })}
        </option>
      ))}
      {removed && <option value={value}>{t('ai.user.removedProvider')}</option>}
    </>
  );
}
