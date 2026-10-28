import type { ReactNode } from 'react';
import { safeHref } from '../../lib/safeHref';
import { titleClickIsNative } from '../../lib/titleLink';

interface TitleLinkProps {
  /** URL de l'article, brute : seule une URL `http(s)` devient un `href` (`safeHref`). */
  url: string | undefined;
  /** Ouverture native (clic molette, ⌘/Ctrl/Maj-clic) : l'appelant marque lu, sans sélectionner. */
  onOpenedInBackground?: () => void;
  children: ReactNode;
}

/**
 * Le titre d'une ligne ou d'une carte, en VRAI lien vers l'article.
 *
 * Le clic molette sur la ligne passe par `window.open`, qui ouvre au premier
 * plan : un navigateur n'ouvre en arrière-plan qu'un lien réel cliqué par
 * l'utilisateur. Le titre — et lui seul — devient donc un `<a href>`, comme
 * l'icône « ouvrir à la source » ; le reste de la ligne garde ses gestes
 * (choix du 2026-10-28 : toute la surface en lien aurait affiché l'URL au
 * survol de chaque ligne, glissé un lien, et fait annoncer chaque ligne comme
 * un lien).
 *
 * - **Clic gauche simple** : `preventDefault()`, et le clic remonte à la ligne
 *   qui sélectionne l'article, exactement comme avant.
 * - **Clic molette, ⌘/Ctrl-clic, Maj-clic** (`titleClickIsNative`) : laissés au
 *   navigateur (onglet en arrière-plan, ou fenêtre). Le clic ne remonte pas —
 *   la ligne le sélectionnerait — et `onOpenedInBackground` marque l'article
 *   lu. Le clic molette n'atteint pas non plus l'ouverture à la source de la
 *   ligne : `useArticleMenuGestures` laisse le clic molette parti d'un lien à
 *   ce lien.
 * - **Appui long tactile** : reste celui de la ligne (`data-row-link`, lu par
 *   `useArticleMenuGestures`). La bulle iOS d'un lien est coupée en CSS
 *   (`.article-title-link`) ; le menu natif de lien de Chrome Android l'est
 *   par le `preventDefault` du `contextmenu` de la ligne ; le clic d'écho est
 *   avalé — navigation comprise — par son `onClickCapture`.
 * - **Drag** : `draggable={false}` — le navigateur remonte alors à l'ancêtre
 *   déplaçable, la ligne, qui emporte l'article vers la barre latérale comme
 *   avant, au lieu de glisser l'URL du lien.
 * - **Clavier** : `tabIndex={-1}`. La ligne est déjà un arrêt de tabulation ;
 *   un second par ligne doublerait la traversée de la liste. Le focus qu'un
 *   clic lui donne est rendu à la ligne ; s'il le garde malgré tout (focus
 *   par script), Entrée ne suit pas le lien (`preventDefault`) et remonte à
 *   la ligne, qui sélectionne.
 *
 * Sans URL `http(s)`, pas de lien du tout : le titre redevient du texte et la
 * ligne garde tous ses gestes, clic molette compris.
 *
 * L'apparence ne bouge pas : le lien hérite couleur et décoration (préflight
 * Tailwind : `a { color: inherit; text-decoration: inherit }`) et reste en
 * ligne dans l'élément du titre, qui garde ellipse, coupure à deux lignes,
 * graisse lu / non lu et les `<mark>` de la recherche.
 */
export default function TitleLink({ url, onOpenedInBackground, children }: TitleLinkProps) {
  const href = safeHref(url);
  if (!href) return <>{children}</>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      tabIndex={-1}
      draggable={false}
      data-row-link=""
      className="article-title-link"
      onClick={(e) => {
        if (titleClickIsNative(e)) {
          e.stopPropagation();
          onOpenedInBackground?.();
        } else {
          e.preventDefault();
        }
      }}
      onAuxClick={(e) => {
        if (e.button !== 1) return;
        if (!titleClickIsNative(e)) { e.preventDefault(); return; }
        e.stopPropagation();
        onOpenedInBackground?.();
      }}
      // Un clic sur un lien lui donne le focus (Chrome, Firefox) : il revient
      // à la ligne, qui l'avait avant. Sinon la touche suivante allumait
      // l'anneau `a:focus-visible` autour du seul titre.
      onFocus={(e) => e.currentTarget.closest<HTMLElement>('[data-article-id]')?.focus({ preventScroll: true })}
      onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }}
    >
      {children}
    </a>
  );
}
