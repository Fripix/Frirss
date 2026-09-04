import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { ROW_ACTION_ORDER } from '../../lib/rowActions';
import ToggleSwitch from '../ToggleSwitch';

/**
 * Préférences → Mise en page.
 *
 * Ces interrupteurs ne concernent que la barre d'actions d'une LIGNE. Le volet
 * de lecture garde ses propres boutons : masquer le ✓ de la liste ne doit pas
 * retirer le moyen de marquer lu l'article qu'on est en train de lire.
 *
 * Ce n'est pas non plus la piste d'options en tête de liste (source, favicons,
 * séparateurs de dates), qui règle ce que la ligne montre du CONTENU, là où
 * ceci règle quels OUTILS l'interface propose.
 */
export default function LayoutTab() {
  const { t } = useTranslation();
  const rowActions = useUiStore((s) => s.rowActions);
  const setRowAction = useUiStore((s) => s.setRowAction);

  return (
    <div className="max-w-xl">
      <h3 className="text-[11px] font-bold uppercase tracking-widest mb-2" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.layout.title')}
      </h3>
      <p className="text-[11px] opacity-70 mb-3" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.layout.hint')}
      </p>

      {ROW_ACTION_ORDER.map((kind) => (
        <div key={kind} className="flex items-start justify-between gap-4 select-none mt-4">
          <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
            {t(`preferences.layout.${kind}`)}
          </span>
          <span className="mt-0.5">
            <ToggleSwitch
              checked={rowActions[kind]}
              onChange={(v: boolean) => setRowAction(kind, v)}
              ariaLabel={t(`preferences.layout.${kind}`)}
            />
          </span>
        </div>
      ))}
    </div>
  );
}
