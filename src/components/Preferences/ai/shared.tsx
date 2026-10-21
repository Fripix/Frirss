import { useTranslation } from 'react-i18next';
import type { AiProviderView } from '../../../api/backend';
import ConfirmDialog from '../../ConfirmDialog';
import ToggleSwitch from '../../ToggleSwitch';

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

/**
 * Une pastille de « Par flux et catégorie » : le mot (« Résumer », « Traduire »,
 * « Panneau ») et son interrupteur dans un même `<label>` à contour fin, de
 * sorte qu'un toucher sur le mot ou sur le bord bascule l'interrupteur, une
 * seule fois (le clic remonte au bouton, rien d'autre ne le reçoit). Allumée,
 * le contour et le mot prennent l'accent : l'état se lit sans regarder le
 * curseur. 32 px de haut à la souris, 44 px au doigt (`prefs-tap-btn`).
 * Le mot ne suffit pas à nommer l'interrupteur — il ne dit pas la ligne —, d'où
 * le `ariaLabel` complet ; `describedBy` pointe la légende du bloc.
 */
export function Pill({ word, checked, ariaLabel, describedBy, onChange }: {
  word: string; checked: boolean; ariaLabel: string; describedBy?: string; onChange: (on: boolean) => void;
}) {
  return (
    <label
      className="prefs-tap-btn inline-flex items-center gap-1.5 min-h-[32px] max-w-full pl-2.5 pr-1.5 border rounded-full text-xs whitespace-nowrap cursor-pointer"
      style={{ borderColor: checked ? 'var(--accent)' : 'var(--panel-border)', color: checked ? 'var(--accent)' : 'var(--list-summary)' }}
    >
      {word}
      <ToggleSwitch checked={checked} onChange={onChange} ariaLabel={ariaLabel} describedBy={describedBy} />
    </label>
  );
}
