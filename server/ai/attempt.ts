import { TIMEOUT_MS } from './providers.js';
import { AiError } from './errors.js';
import { resolveProvider, fallbackOrder, type Availability, type ResolutionInput } from './resolve.js';
import { aiCacheGet, aiCacheSet, bumpUsage, refundUsage, dailyCap, type AiCacheValue } from './store.js';

/**
 * Échéance de TOUTE la demande, repli compris. Les candidats s'essaient l'un
 * après l'autre : avec 60 s chacun, un premier fournisseur lent atteignait les
 * 60 s de nginx (504 au client) et le serveur appelait ensuite le suivant —
 * peut-être payant, compté, mis en cache — sans que personne attende. 50 s
 * tiennent sous un reverse proxy réglé par défaut ; le nginx du conteneur en
 * accorde 120 à `/api/`, pour ne jamais couper une demande que le serveur tient
 * encore. C'est celle du résumé ; la traduction a la sienne, proportionnelle
 * au lot (`translateDeadlineMs`, `translate.ts`) : sa sortie est aussi longue
 * que son entrée.
 */
export const SUMMARY_DEADLINE_MS = 50_000;
/** Sous ce reste, un appel n'a aucune chance d'aboutir : on n'en lance plus. */
export const MIN_CALL_MS = 2_000;

export interface Attempt<T> {
  userId: number;
  resolution: ResolutionInput;
  available: Availability[];
  fallback: boolean;
  /** Instant (selon `now`) au-delà duquel plus aucun appel ne part. */
  deadline: number;
  /**
   * Plafond d'UN appel, avant l'échéance : chaque candidat reçoit
   * `min(maxCallMs, reste)`. Défaut `TIMEOUT_MS` (60 s) ; la traduction passe
   * son échéance entière, qui peut dépasser 60 s pour un gros lot.
   */
  maxCallMs?: number;
  now: () => number;
  /** Clé de cache propre au candidat : le fournisseur et le modèle en font partie. */
  cacheKeyFor: (cand: Availability) => string;
  /** L'appel au fournisseur ; `timeoutMs` est déjà borné par l'échéance. */
  call: (cand: Availability, timeoutMs: number) => Promise<T>;
  /**
   * « Régénérer » : ne pas LIRE le cache. L'appel part, compte une unité comme
   * un autre, et son résultat est écrit sous la même clé : il remplace l'ancien.
   */
  skipCacheRead?: boolean;
  /** Ce qu'il faut mettre en cache pour ce résultat ; `null` = rien. */
  onSuccess?: (cand: Availability, result: T) => Promise<AiCacheValue | null>;
}

/**
 * Spec §6 et §9 : la boucle commune au résumé et à la traduction. Ordre :
 * résolution, puis pour chaque candidat cache, échéance, plafond (clé admin
 * seulement, réservé avant l'appel et rendu s'il échoue), appel, repli (jamais
 * sur `refused` ni sur une erreur `noFallback`, un seul tour), cache.
 *
 * - Un candidat plafonné est sauté, pas échoué : le repli passe au suivant
 *   (clé de l'utilisateur, fournisseur gratuit) et `fellBackFrom` reste vide.
 * - Un résultat tiré du cache est rendu tel quel (`AiCacheValue`), avec
 *   `fromCache: true` : c'est à l'appelant de le relire.
 */
export async function runWithFallback<T>(a: Attempt<T>): Promise<{ result: T | AiCacheValue; cand: Availability; fromCache: boolean; fellBackFrom?: string }> {
  const first = resolveProvider(a.resolution, a.available);
  if (!first) throw new AiError('technical', 'no_provider');
  const candidates = a.fallback ? fallbackOrder(first, a.available) : [first];

  let fellBackFrom: string | undefined;
  let lastError: AiError | null = null;
  let capped = false;
  for (const cand of candidates) {
    const key = a.cacheKeyFor(cand);
    let cached = null;
    if (!a.skipCacheRead) {
      try { cached = await aiCacheGet(key); } catch { /* cache illisible = absence */ }
    }
    if (cached) return { result: cached, cand, fromCache: true, fellBackFrom };

    const remaining = a.deadline - a.now();
    if (remaining < MIN_CALL_MS) {
      if (lastError) throw lastError;
      throw new AiError('technical', 'deadline');
    }

    // Réservation AVANT l'appel : lire le compteur puis l'incrémenter après
    // laissait N requêtes simultanées passer toutes la vérification. SQLite
    // incrémente et rend le compte d'un seul geste ; au-delà du plafond, on
    // rend la place et le candidat est plafonné.
    if (cand.paidByAdmin) {
      const cap = dailyCap();
      if (bumpUsage(a.userId) > cap && cap > 0) {
        refundUsage(a.userId);
        if (!a.fallback) throw new AiError('quota', 'ai_daily_cap');
        capped = true;
        console.warn('AI fallback:', cand.provider.name, 'quota', 'daily cap reached');
        continue;
      }
    }

    let result: T;
    try {
      result = await a.call(cand, Math.min(a.maxCallMs ?? TIMEOUT_MS, remaining));
    } catch (err) {
      // Un appel raté n'est pas payé : la place réservée est rendue.
      if (cand.paidByAdmin) refundUsage(a.userId);
      // Que des chaînes : jamais l'objet d'erreur brut, qui peut porter la requête et ses en-têtes (donc la clé).
      if (!(err instanceof AiError)) console.error('AI provider error:', cand.provider.name, (err as Error)?.name, (err as Error)?.message);
      const e = err instanceof AiError ? err : new AiError('technical', 'provider_error');
      e.ownKey = cand.own;
      if (e.kind === 'refused' || e.noFallback || !a.fallback) throw e;
      // Sans cette ligne, une bascule rattrapée ne laisse aucune trace : une coupure
      // réseau vers Ollama a ainsi basculé vers Claude (payant) sans rien dire.
      // Chaînes seulement ; le message est déjà masqué (clé) et coupé par l'adaptateur.
      console.warn('AI fallback:', cand.provider.name, e.kind, e.message);
      lastError = e;
      fellBackFrom = fellBackFrom ?? cand.provider.name;
      continue;
    }
    // Le résultat est payé (et déjà compté par la réservation) : le cache ne doit pas le faire passer pour un échec du fournisseur.
    try {
      const value = a.onSuccess ? await a.onSuccess(cand, result) : null;
      if (value) await aiCacheSet(key, value);
    } catch { /* le résultat est servi, il ne sera juste pas mis en cache */ }
    return { result, cand, fromCache: false, fellBackFrom };
  }
  if (lastError) throw lastError;
  throw new AiError(capped ? 'quota' : 'technical', capped ? 'ai_daily_cap' : 'no_provider');
}
