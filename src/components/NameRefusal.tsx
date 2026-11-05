import { useTranslation } from 'react-i18next';
import type { NameOwner } from '../lib/labelNames';

export type NameIssue = NameOwner | 'slash' | null;

/**
 * Pourquoi un nom d'étiquette ou de catégorie est refusé, dit sous le champ.
 *
 * Toujours montée (vide quand le nom passe) : une région `aria-live` qui
 * apparaît en même temps que son texte n'est pas toujours annoncée. Le champ
 * pointe sur elle par `aria-describedby`. Sans ce message, le bouton se
 * grisait (barre oblique) ou le geste ne faisait rien (nom pris), en silence.
 */
export default function NameRefusal({ id, issue, name, className, spacing = 'mt-1' }: {
  id: string;
  issue: NameIssue;
  name: string;
  /** Taille du texte (11 px par défaut). */
  className?: string;
  /** Marges, posées seulement quand il y a un motif : vide, la région ne prend aucune place. */
  spacing?: string;
}) {
  const { t } = useTranslation();
  const shown = name.trim();
  const message =
    issue === 'category' ? t('preferences.labels.nameIsCategory', { name: shown })
      : issue === 'label' ? t('preferences.labels.nameIsLabel', { name: shown })
        : issue === 'slash' ? t('preferences.categories.noSlash')
          : '';
  return (
    <p
      id={id}
      aria-live="polite"
      className={`${className || 'text-[11px]'} leading-snug ${message ? spacing : ''}`}
      style={{ color: 'var(--danger)' }}
    >
      {message}
    </p>
  );
}
