import { useTranslation } from 'react-i18next';

interface NewArticlesPillProps {
  /** Réglage « Signaler les nouveaux articles » (Préférences → Général). */
  enabled: boolean;
  /** Articles arrivés dans la vue depuis son chargement (`feedStore.newInView`). */
  count: number;
  onClick: () => void;
}

/**
 * Pastille « ↑ N nouveaux articles » (discussion #14).
 * Spec : docs/superpowers/specs/2026-09-17-new-articles-pill-design.md
 *
 * L'emplacement est `sticky` et de hauteur nulle : il colle en haut de la liste
 * sans rien décaler. La région `aria-live` reste montée même à zéro, sinon le
 * premier nombre ne serait pas annoncé. Le bouton reste le MÊME élément quand
 * le nombre change : l'animation d'entrée ne se rejoue pas.
 *
 * `enabled` (M6, revue finale) : le réglage éteint ne rend RIEN, pas même la
 * région `aria-live` — sinon un lecteur d'écran continuerait d'entendre un
 * décompte que l'utilisateur a désactivé.
 */
export default function NewArticlesPill({ enabled, count, onClick }: NewArticlesPillProps) {
  const { t } = useTranslation();
  if (!enabled) return null;
  return (
    <div className="new-articles-slot" aria-live="polite">
      {count > 0 && (
        <button type="button" className="new-articles-pill" onClick={onClick}>
          <span aria-hidden="true">↑</span>
          <span>{t('refresh.newArticles', { count })}</span>
        </button>
      )}
    </div>
  );
}
