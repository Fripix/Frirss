import { useTranslation } from 'react-i18next';

interface NewArticlesBannerProps {
  /** Réglage « Signaler les nouveaux articles » (Préférences → Général). */
  enabled: boolean;
  /** Articles arrivés dans la vue depuis son chargement (`feedStore.newInView`). */
  count: number;
  onClick: () => void;
  /** Ignore le bandeau (`feedStore.dismissNewArticles`) : remet le compte à
   *  zéro sans rien charger. Il réapparaîtra à la prochaine arrivée. */
  onDismiss: () => void;
}

/**
 * Bandeau « ↑ N nouveaux articles » (discussion #14).
 * Spec : docs/superpowers/specs/2026-09-17-new-articles-pill-design.md
 *
 * L'emplacement est `sticky` et de hauteur nulle : il colle en haut de la liste
 * sans rien décaler. La région `aria-live` reste montée même à zéro, sinon le
 * premier nombre ne serait pas annoncé. Le bouton de chargement reste le MÊME
 * élément quand le nombre change : l'animation d'entrée ne se rejoue pas.
 *
 * `enabled` (M6, revue finale) : le réglage éteint ne rend RIEN, pas même la
 * région `aria-live` — sinon un lecteur d'écran continuerait d'entendre un
 * décompte que l'utilisateur a désactivé.
 *
 * Devenu un bandeau (retouche visuelle, demande du propriétaire — la pastille
 * était jugée mieux qu'avant mais encore trop discrète) : pleine largeur de la
 * colonne de liste, posé sur la liste au même endroit que l'ancienne pastille
 * (l'emplacement reste `sticky` et de hauteur nulle). Le liseré et le voile de
 * la pastille ont disparu avec elle : ils découpaient un petit objet du texte
 * recouvert, un bandeau opaque pleine largeur n'en a plus besoin — une simple
 * ombre portée suffit.
 *
 * Deux boutons distincts, pas un bouton imbriqué dans un autre : la zone
 * gauche (flèche + libellé) charge les nouveaux articles, la croix à droite
 * ignore le bandeau (`onDismiss`, `feedStore.dismissNewArticles` — remet
 * `newInView` à zéro sans recharger ; le bandeau reviendra à la prochaine
 * arrivée).
 */
export default function NewArticlesBanner({ enabled, count, onClick, onDismiss }: NewArticlesBannerProps) {
  const { t } = useTranslation();
  if (!enabled) return null;
  return (
    <div className="new-articles-slot" aria-live="polite">
      {count > 0 && (
        <div className="new-articles-banner">
          <button type="button" className="new-articles-banner__load" onClick={onClick}>
            <span aria-hidden="true">↑</span>
            <span>{t('refresh.newArticles', { count })}</span>
          </button>
          <button
            type="button"
            className="new-articles-banner__dismiss"
            onClick={onDismiss}
            title={t('refresh.dismissNewArticles')}
            aria-label={t('refresh.dismissNewArticles')}
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
