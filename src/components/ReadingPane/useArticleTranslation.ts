import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { requestAiTranslation } from '../../api/backend';
import { useAuthStore } from '../../stores/authStore';
import { segmentArticle, batchSegments, type Segmented } from '../../lib/articleSegments';
import { aiErrorMessage } from '../../lib/aiErrorKey';
import type { AiRouting } from '../../lib/aiRouting';
import type { AiLanguage } from '../../lib/aiLanguages';
import { sanitizeHtml } from '../../utils/sanitizeHtml';
import { sharedTranslationRequest } from './aiPending';

export interface ArticleTranslationInput {
  articleId: string | null;
  /** Titre affiché (texte brut) : segment 0. */
  title: string;
  /** Corps affiché AVANT la chaîne d'affichage (`displayedHtml`) : le HTML
   *  traduit repasse par `buildArticleBody` comme l'original. */
  bodyHtml: string;
  targetLang: AiLanguage;
  /** Les étages de routage, lus au moment de la demande (`aiRouting(…, { op: 'translate' })`). */
  routing: () => AiRouting;
  /** IA utilisable et en ligne : sinon `translate` ne fait rien. */
  enabled: boolean;
}

export type ArticleTranslationState = 'idle' | 'loading' | 'done' | 'error' | 'same';
export interface TranslateChoice { lang?: AiLanguage; providerId?: number }

export interface ArticleTranslation {
  state: ArticleTranslationState;
  /** Corps traduit (à passer par `buildArticleBody`), `null` tant qu'il n'est pas entier. */
  html: string | null;
  /** Titre traduit, en texte brut. */
  title: string | null;
  /** Lots terminés sur le total, pendant l'attente seulement. */
  progress: { done: number; total: number } | null;
  /** Des segments trop lourds pour toute requête sont restés dans la source. */
  partial: boolean;
  /** Avec `partial` : lots traduits sur ceux qu'il aurait fallu (un par segment écarté). */
  partialOf: { translated: number; total: number } | null;
  /** Langue de la traduction affichée, ou celle déjà présente (`same`). */
  lang: AiLanguage | null;
  providerId?: number;
  providerName?: string;
  fellBackFrom?: string;
  error: string | null;
  /** Faux quand le corps n'a aucun segment à traduire (« Rien à traduire dans cet article. »). */
  canTranslate: boolean;
  translate: (choice?: TranslateChoice) => void;
  showSource: () => void;
  showTranslation: () => void;
  showing: 'source' | 'translation';
}

interface Snapshot {
  key: string;
  state: ArticleTranslationState;
  html: string | null;
  title: string | null;
  progress: { done: number; total: number } | null;
  partialOf: { translated: number; total: number } | null;
  lang: AiLanguage | null;
  providerId?: number;
  providerName?: string;
  fellBackFrom?: string;
  error: string | null;
  showing: 'source' | 'translation';
}

const idle = (key: string): Snapshot => ({
  key, state: 'idle', html: null, title: null, progress: null, partialOf: null, lang: null, error: null, showing: 'source',
});

const HAS_LETTER = /\p{L}/u;
const hasLetter = (html: string) => HAS_LETTER.test(html.replace(/<[^>]*>/g, ''));

/** FNV-1a 32 bits : lie une traduction au corps qu'elle a traduit. */
function hashOf(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Le modèle peut rendre du balisage ou des entités : le titre s'affiche en texte. */
function plainText(html: string): string {
  return new DOMParser().parseFromString(sanitizeHtml(html), 'text/html').body.textContent?.trim() ?? '';
}

interface Prepared {
  hash: string;
  segmented: Segmented;
  /** Ce qui part au fournisseur : le titre tel quel, chaque bloc passé au sanitiseur. */
  send: string[];
  /** Indices (dans `send`) groupés par lot. */
  batches: number[][];
  /** Segments écartés parce qu'aucune requête ne peut les porter (> 200 Ko à eux seuls). */
  skipped: number;
  canTranslate: boolean;
}

function prepare(title: string, bodyHtml: string): Prepared {
  const segmented = segmentArticle(title, bodyHtml);
  const send = segmented.segments.map((s, i) => (i === 0 ? s : sanitizeHtml(s)));
  // Un segment vide ou sans lettre ne part pas (un titre vide, un bloc que le
  // sanitiseur a vidé) : le fournisseur pourrait l'omettre et invalider le lot.
  const candidates = send.map((_, i) => i).filter((i) => (i === 0 ? HAS_LETTER.test(send[0]) : hasLetter(send[i])));
  const batches = batchSegments(candidates.map((i) => send[i])).map((b) => b.map((j) => candidates[j]));
  const sent = batches.reduce((n, b) => n + b.length, 0);
  return {
    hash: hashOf(`${title}\u0000${bodyHtml}`),
    segmented, send, batches,
    skipped: candidates.length - sent,
    canTranslate: candidates.some((i) => i > 0),
  };
}

/**
 * Traduction de l'article affiché (spec §17.1, §17.3).
 *
 * - Le corps est découpé en segments (`segmentArticle`, titre = segment 0),
 *   groupés en lots d'environ 1 200 mots (`batchSegments`) ; les lots partent
 *   **en série**, une requête par lot. `progress` sert la notice ; le numéro
 *   de lot ne part pas au serveur.
 * - Tant qu'un lot manque, rien n'est remplacé : une erreur à n'importe quel
 *   lot donne `error` sans corps traduit ; `same` au premier lot donne `same`
 *   (le texte est déjà dans la langue) sans autre requête.
 * - La traduction est liée au hash du titre et du corps : quand l'un change
 *   (extraction arrivée, « Article complet » basculé) ou que l'article change,
 *   l'état revient à `idle` et l'affichage à la source ; les lots encore en vol
 *   sont ignorés et la boucle s'arrête.
 * - Chaque lot en vol est partagé (`sharedTranslationRequest`) : revenir sur
 *   l'article et relancer ne paie pas deux fois le lot déjà demandé.
 * - « Traduire avec X » (`providerId`) garde le réglage de repli ; si un lot
 *   bascule, `fellBackFrom` le dit et `providerName` nomme le dernier.
 */
export function useArticleTranslation(input: ArticleTranslationInput): ArticleTranslation {
  const { t, i18n } = useTranslation();
  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  const { articleId, title, bodyHtml } = input;
  const prepared = useMemo(() => prepare(title, bodyHtml), [title, bodyHtml]);
  const key = `${articleId ?? ''}:${prepared.hash}`;
  const [snap, setSnap] = useState<Snapshot>(() => idle(key));
  const current = snap.key === key ? snap : idle(key);

  // Désigne la boucle de lots dont les réponses comptent encore : un nouveau
  // corps, un autre article ou une nouvelle demande l'incrémente.
  const seq = useRef(0);
  useEffect(() => {
    seq.current++;
    setSnap((s) => (s.key === key ? s : idle(key)));
  }, [key]);

  const latest = useRef({ input, prepared, key, current, t, language: i18n.language, isAdmin });
  useEffect(() => {
    latest.current = { input, prepared, key, current, t, language: i18n.language, isAdmin };
  });

  const translate = useCallback((choice?: TranslateChoice) => {
    const { input: inp, prepared: prep, key: k, current: cur, t: tr, language, isAdmin: admin } = latest.current;
    const id = inp.articleId;
    if (!inp.enabled || !id || !prep.canTranslate || cur.state === 'loading') return;
    const held = cur.state === 'done' && cur.html !== null ? cur : null;
    // « Traduire avec X » garde la langue de la traduction affichée, sinon la cible.
    const keptLang = choice?.providerId !== undefined ? held?.lang : null;
    const lang = choice?.lang ?? keptLang ?? inp.targetLang;
    // La traduction tenue répond déjà à la demande : la remontrer, sans appel.
    if (held && held.lang === lang && (choice?.providerId === undefined || choice.providerId === held.providerId)) {
      setSnap((s) => (s.key === k ? { ...s, showing: 'translation' } : s));
      return;
    }
    const mine = ++seq.current;
    const stillCurrent = () => seq.current === mine;
    const total = prep.batches.length;
    const routing = inp.routing();
    const user = useAuthStore.getState().backendUser?.id ?? '';
    setSnap((s) => ({ ...(s.key === k ? s : idle(k)), state: 'loading', progress: { done: 0, total }, error: null }));

    void (async () => {
      // Une chaîne vide laisse le segment d'origine en place (`apply`).
      const out: string[] = new Array<string>(prep.send.length).fill('');
      let providerId: number | undefined;
      let providerName: string | undefined;
      let fellBackFrom: string | undefined;
      try {
        for (let b = 0; b < total; b++) {
          const indices = prep.batches[b];
          const r = await sharedTranslationRequest(
            `article:${user}:${id}:${lang}:${choice?.providerId ?? ''}:${prep.hash}:${b}`,
            () => requestAiTranslation({
              articleId: id, scope: 'article', targetLang: lang, segments: indices.map((i) => prep.send[i]),
              provider: choice?.providerId, ...routing,
            }),
          );
          if (!stillCurrent()) return;
          if (r.same && b === 0) {
            setSnap({ ...idle(k), state: 'same', lang });
            return;
          }
          // Un lot plus loin déjà dans la langue (article mêlé) : ses segments restent.
          if (!r.same) indices.forEach((i, n) => { out[i] = r.segments[n]; });
          providerId = r.providerId;
          providerName = r.providerName;
          if (r.fellBackFrom) fellBackFrom = r.fellBackFrom;
          if (b + 1 < total) setSnap((s) => (s.key === k ? { ...s, progress: { done: b + 1, total } } : s));
        }
        const html = prep.segmented.apply(out, sanitizeHtml);
        const translatedTitle = out[0] ? plainText(out[0]) : '';
        setSnap({
          ...idle(k), state: 'done', html, title: translatedTitle || null, lang, providerId, providerName, fellBackFrom,
          partialOf: prep.skipped > 0 ? { translated: total, total: total + prep.skipped } : null,
          showing: 'translation',
        });
      } catch (err) {
        if (!stillCurrent()) return;
        const resp = axios.isAxiosError(err) ? err.response : undefined;
        const msg = aiErrorMessage(resp?.status, resp?.data as Parameters<typeof aiErrorMessage>[1], admin, language, { op: 'translate' });
        setSnap({ ...idle(k), state: 'error', error: tr(msg.key, msg.params) });
      }
    })();
  }, []);

  const showSource = useCallback(() => {
    setSnap((s) => ({ ...s, showing: 'source' }));
  }, []);
  const showTranslation = useCallback(() => {
    setSnap((s) => (s.html !== null ? { ...s, showing: 'translation' } : s));
  }, []);

  return {
    state: current.state,
    html: current.html,
    title: current.title,
    progress: current.progress,
    partial: current.partialOf !== null,
    partialOf: current.partialOf,
    lang: current.lang,
    providerId: current.providerId,
    providerName: current.providerName,
    fellBackFrom: current.fellBackFrom,
    error: current.error,
    canTranslate: prepared.canTranslate,
    translate,
    showSource,
    showTranslation,
    showing: current.html !== null ? current.showing : 'source',
  };
}
