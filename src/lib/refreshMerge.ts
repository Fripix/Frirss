/**
 * Relecture discrète (retour sur l'onglet) d'une liste dont plusieurs pages
 * sont déjà chargées.
 *
 * Le serveur ne renvoie que la PREMIÈRE page. La prendre telle quelle jetait
 * toutes les pages chargées au défilement : la liste raccourcissait sous les
 * yeux et la position retombait près du haut (issue #30). Ici, la première
 * page remplace le haut de la liste, et la queue déjà chargée est recousue
 * dessous, avec sa propre suite de pagination.
 *
 * La couture se fait au dernier article de la liste affichée que la page reçue
 * contient encore. Ce qui précède ce point et manque à la page a quitté la vue
 * (lu ailleurs, en non-lus) et part ; ce qui le suit est au-delà de la page,
 * donc gardé. Sans aucun article commun, rien ne garantit qu'il n'y a pas de
 * trou entre les deux : la page remplace tout, comme avant.
 */
export function mergeRefreshedPage<T extends { id: string }>(
  shown: readonly T[],
  shownContinuation: string | null,
  page: readonly T[],
  pageContinuation: string | null,
): { articles: T[]; continuation: string | null } {
  const replace = { articles: [...page], continuation: pageContinuation };
  // Le flux tient dans la page : elle est la vérité entière.
  if (!pageContinuation) return replace;
  const inPage = new Set(page.map((a) => a.id));
  let seam = -1;
  for (let i = shown.length - 1; i >= 0; i--) {
    if (inPage.has(shown[i].id)) { seam = i; break; }
  }
  if (seam < 0) return replace;
  const tail = shown.slice(seam + 1).filter((a) => !inPage.has(a.id));
  if (tail.length === 0) return replace;
  return { articles: [...page, ...tail], continuation: shownContinuation };
}
