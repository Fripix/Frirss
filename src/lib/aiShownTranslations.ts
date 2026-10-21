import type { AiLanguage } from './aiLanguages';

/**
 * Mémoire PAR APPAREIL des traductions d'article affichées : quand on revient
 * sur un article dont la traduction était montrée, le volet la rejoue depuis le
 * cache serveur (`cacheOnly`) au lieu de retomber sur la source.
 *
 * On ne garde que de quoi redemander la même entrée de cache : langue,
 * fournisseur de la traduction affichée, hash du titre et du corps traduits
 * (un corps changé n'est pas rejoué), date pour l'éviction. Jamais le texte.
 * Une table par compte (`frirss_aiShown:<userId>`), 200 articles au plus, les
 * plus anciens évincés. Tout accès au stockage est sous `try/catch` : un
 * stockage absent, plein ou refusé ne casse rien, il fait seulement oublier.
 */
export interface ShownTranslation { lang: AiLanguage; providerId?: number; hash: string; at: number }

const MAX_ENTRIES = 200;
const storageKey = (userId: string) => `frirss_aiShown:${userId}`;

type Table = Record<string, ShownTranslation>;

function isEntry(v: unknown): v is ShownTranslation {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return typeof e.lang === 'string' && typeof e.hash === 'string' && typeof e.at === 'number'
    && (e.providerId === undefined || typeof e.providerId === 'number');
}

function load(userId: string): Table {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const table: Table = {};
    for (const [id, v] of Object.entries(parsed)) if (isEntry(v)) table[id] = v;
    return table;
  } catch {
    return {};
  }
}

function save(userId: string, table: Table): void {
  try {
    if (Object.keys(table).length === 0) localStorage.removeItem(storageKey(userId));
    else localStorage.setItem(storageKey(userId), JSON.stringify(table));
  } catch {
    /* stockage plein ou refusé : on oublie */
  }
}

export function rememberShown(userId: string, articleId: string, v: Omit<ShownTranslation, 'at'>, now: () => number = Date.now): void {
  const table = load(userId);
  delete table[articleId];
  table[articleId] = { lang: v.lang, ...(v.providerId !== undefined ? { providerId: v.providerId } : {}), hash: v.hash, at: now() };
  const ids = Object.keys(table);
  if (ids.length > MAX_ENTRIES) {
    // Les plus anciennes d'abord (à égalité, la plus anciennement insérée).
    ids.sort((a, b) => table[a].at - table[b].at);
    for (const id of ids.slice(0, ids.length - MAX_ENTRIES)) delete table[id];
  }
  save(userId, table);
}

export function forgetShown(userId: string, articleId: string): void {
  const table = load(userId);
  if (!(articleId in table)) return;
  delete table[articleId];
  save(userId, table);
}

/** L'entrée de l'article, ou `null` si absente ou liée à un autre corps (`hash`). */
export function recallShown(userId: string, articleId: string, hash: string): ShownTranslation | null {
  const e = load(userId)[articleId];
  return e && e.hash === hash ? e : null;
}
