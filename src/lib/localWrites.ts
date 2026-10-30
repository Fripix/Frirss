import { withLabel } from './searchCorpus';
import type { Article } from '../types';

/**
 * Le registre des écritures locales récentes (lu, favori, étiquette).
 *
 * Une lecture partie AVANT un geste rapporte l'état d'avant ce geste. Rangée
 * telle quelle, elle remettait en gras l'article qu'on venait d'ouvrir, dans la
 * liste, le volet, le cache mémoire et la liste hors ligne, et le rouvrir le
 * décomptait une seconde fois. Sur un FreshRSS lent, la fenêtre fait plusieurs
 * secondes.
 *
 * Chaque lecture note `mark()` à son départ. Une écriture reçoit un numéro à
 * son enregistrement (`record`), et reste EN VOL jusqu'à sa confirmation (`touch`)
 * ou son rollback (`rollback`). `overlay` réapplique sur la réponse, champ par
 * champ, ce qui est en vol et ce qui est plus récent que son départ : un favori
 * posé pendant le vol n'emporte pas le `read` du serveur.
 *
 * En vol, parce qu'une lecture partie APRÈS le geste peut quand même passer au
 * serveur avant lui, et répondre avant sa confirmation (FreshRSS lent à écrire,
 * cache Redis rapide à lire). Un numéro ne suffit pas à le voir : lecture et
 * geste sont dans le bon ordre, c'est le serveur qui n'a pas encore reçu l'écriture.
 * La confirmation avance aussi le numéro, pour la lecture partie pendant le vol
 * qui répond après elle.
 *
 * Un rollback compte comme une écriture : c'est lui la dernière valeur, et elle
 * redit ce que le serveur a gardé.
 */

/**
 * Durée de vie d'une entrée. Au-delà de tout délai d'attente d'une requête
 * (`TIMEOUT_DEFAULT_MS`, 75 s) : plus aucune réponse en vol ne peut être partie
 * avant cette écriture.
 */
export const LOCAL_WRITE_TTL_MS = 5 * 60 * 1000;
const PRUNE_EVERY_MS = 60 * 1000;

/** `read`, `starred` ou `label:<id>`. */
export type WriteField = 'read' | 'starred' | `label:${string}`;

/** `inFlight` compte les gestes pas encore réglés : ils se croisent sur une ligne. */
interface Written { seq: number; value: boolean; inFlight: number }
interface Entry { at: number; fields: Map<WriteField, Written> }

const LABEL_PREFIX = 'label:';

export function applyField(row: Article, field: WriteField, value: boolean): Article {
  if (field === 'read') return row.read === value ? row : { ...row, read: value };
  if (field === 'starred') return row.starred === value ? row : { ...row, starred: value };
  const labelId = field.slice(LABEL_PREFIX.length);
  if ((row.labels ?? []).includes(labelId) === value) return row;
  return { ...row, labels: withLabel(row.labels, labelId, value) };
}

export function createLocalWrites(now: () => number = Date.now) {
  const entries = new Map<string, Entry>();
  let seq = 0;
  let prunedAt = now();
  const keyOf = (scope: string, id: string) => `${scope}|${id}`;

  // Au plus une fois par minute : un « Tout lu » enregistre toutes les lignes
  // affichées d'un coup, et parcourir le registre à chacune serait quadratique.
  function prune(): void {
    if (now() - prunedAt < PRUNE_EVERY_MS) return;
    prunedAt = now();
    const limit = now() - LOCAL_WRITE_TTL_MS;
    for (const [key, entry] of entries) {
      if (entry.at < limit) entries.delete(key);
    }
  }

  return {
    /** À noter AVANT d'envoyer une lecture. */
    mark: () => seq,

    record(scope: string, articleId: string, field: WriteField, value: boolean): void {
      prune();
      const key = keyOf(scope, articleId);
      const entry = entries.get(key) ?? { at: now(), fields: new Map<WriteField, Written>() };
      entry.at = now();
      entry.fields.set(field, { seq: ++seq, value, inFlight: (entry.fields.get(field)?.inFlight ?? 0) + 1 });
      entries.set(key, entry);
    },

    /**
     * Le geste est réglé, par le serveur ou par la file d'attente qui le prend
     * en charge : la valeur ne change pas, son numéro avance. Sans effet si
     * l'entrée a expiré. La valeur gardée est celle du dernier geste : la
     * confirmation d'un geste plus ancien ne la rétablit pas.
     */
    touch(scope: string, articleId: string, field: WriteField): void {
      const entry = entries.get(keyOf(scope, articleId));
      const written = entry?.fields.get(field);
      if (!entry || !written) return;
      entry.at = now();
      written.seq = ++seq;
      written.inFlight = Math.max(0, written.inFlight - 1);
    },

    /** Le serveur a refusé : `value` est ce qu'il a gardé, et le geste est réglé. */
    rollback(scope: string, articleId: string, field: WriteField, value: boolean): void {
      const entry = entries.get(keyOf(scope, articleId));
      const written = entry?.fields.get(field);
      if (!entry || !written) return;
      entry.at = now();
      written.seq = ++seq;
      written.value = value;
      written.inFlight = Math.max(0, written.inFlight - 1);
    },

    /**
     * Les lignes d'une réponse, recalées sur les écritures en vol et sur celles
     * plus récentes que `since`. Rend le MÊME tableau quand rien ne change. `keep` n'est appelé que
     * sur les lignes recalées, et les écarte s'il répond faux : une ligne que le
     * geste a sortie de la vue n'a pas à y revenir.
     */
    overlay(scope: string, rows: Article[], since: number, keep?: (row: Article) => boolean): Article[] {
      if (!entries.size) return rows;
      let changed = false;
      const out: Article[] = [];
      for (const row of rows) {
        let next = row;
        const entry = entries.get(keyOf(scope, row.id));
        if (entry) {
          for (const [field, written] of entry.fields) {
            if (written.inFlight > 0 || written.seq > since) next = applyField(next, field, written.value);
          }
        }
        if (next === row) { out.push(row); continue; }
        changed = true;
        if (!keep || keep(next)) out.push(next);
      }
      return changed ? out : rows;
    },

    /** Pour les tests. */
    size: () => entries.size,
  };
}
