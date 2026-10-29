import DOMPurify, { type Config } from 'dompurify';

/*
 * Chrome garde en mémoire tout document analysé (DOMParser, DOMPurify) qui
 * contient une `<video>` ou une `<picture><source media>` : leurs « activités
 * en attente » (lecture à distance, requête média) le retiennent, même quand
 * plus rien ne s'y réfère. Mesuré sur Android : 20 documents sur 20 retenus,
 * 0 une fois le document vidé — et 434 documents (365 000 nœuds) au bout d'une
 * préparation hors ligne de 6 600 articles. Chaque affichage d'un article à
 * vidéo en laissait un de plus.
 *
 * Remède : vider le document dès qu'on n'en a plus besoin. Retirer ses nœuds
 * déclenche leur retrait (la requête média perd son écouteur, la vidéo sort du
 * document), et plus rien ne le retient.
 */

/** Vide un document analysé. Jamais celui de l'application. */
export function releaseDocument(doc: Document | null | undefined): void {
  if (!doc || (typeof document !== 'undefined' && doc === document)) return;
  doc.documentElement?.remove();
}

/**
 * `DOMPurify.sanitize(html, cfg)` en chaîne, sans laisser son document interne
 * en mémoire. Même sortie que DOMPurify pour nos configurations (ni
 * `WHOLE_DOCUMENT`, ni `SAFE_FOR_TEMPLATES`, ni Trusted Types) : il sérialise
 * lui aussi `body.innerHTML`. `RETURN_DOM` rend ce `body`, qui appartient à son
 * document — sauf avec des attributs `shadowroot`, où il est importé dans le
 * document de l'application : `releaseDocument` l'ignore alors, d'où sa garde.
 */
export function purifyToString(html: string, cfg: Config): string {
  if (!html) return '';
  const body = DOMPurify.sanitize(html, { ...cfg, RETURN_DOM: true }) as HTMLElement;
  try {
    return body.innerHTML;
  } finally {
    releaseDocument(body.ownerDocument);
  }
}
