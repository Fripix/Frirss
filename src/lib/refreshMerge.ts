import { entryIdUsec } from './entryId';
import type { ArticleOrder } from './effectiveOrder';

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
 *
 * ⚠️ « Ce qui suit la couture est au-delà de la page » n'est prouvé que si la
 * page S'ARRÊTE sur un article de la liste. Quand le bas de la liste a quitté
 * la vue (non-lus lus ailleurs, favoris retirés), la page s'étend au-delà du
 * dernier article chargé : recoudre la queue périmée dessous, avec l'ancienne
 * suite, donnait `001…029, 101…121, 030…100`, puis la page suivante rajoutait
 * 101 et suivants en double, et ↓ tournait en rond (L-01, 1.9.0). Le dernier
 * article de la page borne alors la queue par l'ordre de FreshRSS (l'id
 * d'entrée, celui qui trie le flux) : ne reste que ce qui le suit. Sans id
 * lisible, la page remplace tout, plutôt que de risquer un doublon.
 */
export function mergeRefreshedPage<T extends { id: string }>(
  shown: readonly T[],
  shownContinuation: string | null,
  page: readonly T[],
  pageContinuation: string | null,
  order: ArticleOrder,
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
  let tail = shown.slice(seam + 1).filter((a) => !inPage.has(a.id));
  const last = page[page.length - 1];
  // La page finit sur un article qui n'est pas la couture : elle a pu
  // dépasser une partie de la queue, voire toute.
  if (last.id !== shown[seam].id) {
    const bound = entryIdUsec(last.id);
    if (bound === null) return replace;
    const beyond: T[] = [];
    for (const a of tail) {
      const usec = entryIdUsec(a.id);
      if (usec === null) return replace;
      const after = order === 'oldest' ? BigInt(usec) > BigInt(bound) : BigInt(usec) < BigInt(bound);
      if (after) beyond.push(a);
    }
    tail = beyond;
  }
  if (tail.length === 0) return replace;
  // Une liste finie, du plus ancien au plus récent : ce qui est arrivé depuis
  // vient APRÈS la queue, et l'ancienne suite (aucune) le rendait
  // inatteignable — la liste se disait terminée (D-01, 1.9.0). La suite de la
  // page repasse par la queue (`appendPage` n'en redouble rien) puis atteint
  // les nouveaux. À la première page sans neuf, `loadMore` demande si la vue a
  // quoi que ce soit au-delà du dernier article (`nothingBeyondTail`) : rien,
  // la liste se redit finie sans relire la queue ; sinon il traverse les pages
  // de doublons, borné par `duplicatePageLimit` (RO-03). Du plus récent au plus
  // ancien, les nouveaux sont dans la page : la liste reste finie.
  const continuation = shownContinuation ?? (order === 'oldest' ? pageContinuation : null);
  return { articles: [...page, ...tail], continuation };
}

/**
 * Une liste « plus anciens d'abord » n'a-t-elle RIEN au-delà de son dernier
 * article ? `newestId` est l'identifiant le plus récent de la vue côté serveur
 * (`newestItemId`), `null` si elle est vide. Ce qui suit la queue dans cet
 * ordre est plus récent que tout ce qui est chargé : si le plus récent de la
 * vue n'est pas plus récent que la liste, la suite ne rapporterait que des
 * doublons (RO-03). Dans le doute (identifiant illisible, liste vide), `false` :
 * la suite est parcourue plutôt que des articles perdus.
 */
export function nothingBeyondTail(rows: readonly { id: string }[], newestId: string | null): boolean {
  if (rows.length === 0) return false;
  let max: bigint | null = null;
  for (const a of rows) {
    const usec = entryIdUsec(a.id);
    if (usec === null) return false;
    const n = BigInt(usec);
    if (max === null || n > max) max = n;
  }
  if (newestId === null) return true;
  const newest = entryIdUsec(newestId);
  return newest !== null && max !== null && BigInt(newest) <= max;
}

/**
 * Combien de pages de doublons `loadMore` traverse d'affilée au plus. La suite
 * d'une relecture repasse par une queue déjà chargée : elle ne peut pas compter
 * plus de pages que la liste n'en contient (plus une, pour une page à cheval).
 * Au-delà, la suite ne mène nulle part : la liste se redit finie (RO-03).
 */
export function duplicatePageLimit(loaded: number, pageSize: number): number {
  return Math.ceil(loaded / pageSize) + 1;
}

/**
 * Ajoute une page sous la liste sans redoubler un article déjà présent : deux
 * enfants React sous la même clé, et ↓ qui revient en arrière (L-01). La
 * relecture peut avoir rendu, en tête, des articles que la page suivante
 * apporte aussi.
 */
export function appendPage<T extends { id: string }>(rows: readonly T[], page: readonly T[]): T[] {
  const have = new Set(rows.map((a) => a.id));
  return [...rows, ...page.filter((a) => !have.has(a.id))];
}

/**
 * Remet l'article ouvert dans une liste relue qui ne le contient plus (lu, en
 * non-lus). Sa place se déduit de ses VOISINS, pas de son ancien rang : les
 * lignes lues au-dessus de lui ont pu partir avec la relecture, et l'ancien
 * index le posait 39 lignes trop bas, où ↓ sautait tous les non-lus qui le
 * suivaient (L-02). Il se place avant le premier article qui le suivait et qui
 * est encore là ; à défaut, après le dernier qui le précédait ; à défaut, en
 * tête.
 */
export function keepOpenRow<T extends { id: string }>(previous: readonly T[], rows: readonly T[], open: T): T[] {
  const at = new Map(rows.map((a, i) => [a.id, i]));
  const was = previous.findIndex((a) => a.id === open.id);
  let index = 0;
  if (was >= 0) {
    let found = false;
    for (let j = was + 1; j < previous.length && !found; j++) {
      const i = at.get(previous[j].id);
      if (i !== undefined) { index = i; found = true; }
    }
    for (let j = was - 1; j >= 0 && !found; j--) {
      const i = at.get(previous[j].id);
      if (i !== undefined) { index = i + 1; found = true; }
    }
  }
  const out = [...rows];
  out.splice(index, 0, open);
  return out;
}
