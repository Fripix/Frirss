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
export interface TranslateOptions {
  /** Demande partie seule (traduction automatique du flux ou de la catégorie) :
   *  un `same` n'affiche rien ; une erreur, si (une bascule payante doit se voir). */
  automatic?: boolean;
}

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
  /** L'état affiché vient d'une demande automatique : un `same` ne se dit pas. */
  automatic: boolean;
  translate: (choice?: TranslateChoice, options?: TranslateOptions) => void;
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
  automatic: boolean;
  showing: 'source' | 'translation';
}

const idle = (key: string): Snapshot => ({
  key, state: 'idle', html: null, title: null, progress: null, partialOf: null, lang: null, error: null, automatic: false, showing: 'source',
});

const HAS_LETTER = /\p{L}/u;
const hasLetter = (html: string) => HAS_LETTER.test(html.replace(/<[^>]*>/g, ''));

const RAW_TEXT_TAGS = new Set(['script', 'style', 'noscript', 'template']);
const isAsciiLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isEntityChar = (c: number) => isAsciiLetter(c) || (c >= 48 && c <= 57) || c === 35; // lettre, chiffre, #
/** Plus longue entité nommée HTML (`&CounterClockwiseContourIntegral;`, 33). */
const MAX_ENTITY = 34;

/**
 * Estimation SANS analyse DOM : le corps porte-t-il du texte lisible ? Elle
 * tourne à chaque article ouvert, IA ou pas ; le vrai découpage n'a lieu qu'à
 * la demande (`translate`).
 *
 * Un seul passage, l'index ne recule jamais : aucune expression régulière sur
 * le corps entier. Celles d'avant étaient quadratiques sur du HTML malformé
 * (chaque `<` sans `>` relançait un balayage jusqu'à la fin : 100 Ko de `<`
 * prenaient 5 s) — et ce HTML vient des flux, donc de n'importe qui.
 *
 * - Une balise (`<` suivi d'une lettre, `/`, `!` ou `?`) est sautée jusqu'à
 *   son `>` ; sans `>`, tout le reste est dans la balise : pas de texte. Un
 *   `<` suivi d'autre chose est du texte, comme pour le navigateur.
 * - Le contenu de `script`, `style`, `noscript`, `template` est sauté jusqu'à
 *   sa balise fermante ; un commentaire jusqu'à `-->`.
 * - Une entité (`&nbsp;`, `&#233;`) ne compte pas comme lettre.
 * - Première lettre (`\p{L}`) dans le texte : vrai.
 *
 * Si le découpage ne trouve finalement rien (texte seulement dans un `<pre>`,
 * par exemple), `canTranslate` repasse à faux pour ce corps.
 */
export function hasReadableText(html: string): boolean {
  const n = html.length;
  // Balise fermante `</name` (casse indifférente) à partir de `from`, ou -1.
  // Pas de `toLowerCase()` du corps : certaines lettres changent de longueur
  // en minuscules (« İ »), et les index ne correspondraient plus.
  const closingTag = (name: string, from: number) => {
    let at = html.indexOf('</', from);
    while (at !== -1 && html.slice(at + 2, at + 2 + name.length).toLowerCase() !== name) at = html.indexOf('</', at + 2);
    return at;
  };
  let i = 0;
  while (i < n) {
    const c = html.charCodeAt(i);
    if (c === 60 /* < */) {
      const next = html.charCodeAt(i + 1);
      if (isAsciiLetter(next) || next === 47 /* / */ || next === 33 /* ! */ || next === 63 /* ? */) {
        if (html.startsWith('<!--', i)) {
          const close = html.indexOf('-->', i + 4);
          if (close === -1) return false;
          i = close + 3;
          continue;
        }
        const end = html.indexOf('>', i + 1);
        if (end === -1) return false;
        let nameEnd = i + 1;
        while (nameEnd < end && isAsciiLetter(html.charCodeAt(nameEnd))) nameEnd++;
        const name = html.slice(i + 1, nameEnd).toLowerCase();
        i = end + 1;
        if (RAW_TEXT_TAGS.has(name) && html.charCodeAt(end - 1) !== 47 /* / */) {
          const close = closingTag(name, i);
          if (close === -1) return false;
          const closeEnd = html.indexOf('>', close);
          if (closeEnd === -1) return false;
          i = closeEnd + 1;
        }
        continue;
      }
      i++;
      continue;
    }
    if (c === 38 /* & */) {
      let j = i + 1;
      const limit = Math.min(n, i + MAX_ENTITY);
      while (j < limit && isEntityChar(html.charCodeAt(j))) j++;
      if (j > i + 1 && html.charCodeAt(j) === 59 /* ; */) {
        i = j + 1;
        continue;
      }
      i++;
      continue;
    }
    if (c < 128) {
      if (isAsciiLetter(c)) return true;
      i++;
      continue;
    }
    const cp = html.codePointAt(i) ?? c;
    if (HAS_LETTER.test(String.fromCodePoint(cp))) return true;
    i += cp > 0xffff ? 2 : 1;
  }
  return false;
}

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
  segmented: Segmented;
  /** Ce qui part au fournisseur : le titre tel quel, chaque bloc passé au sanitiseur. */
  send: string[];
  /** Indices (dans `send`) groupés par lot. */
  batches: number[][];
  /** Segments écartés parce qu'aucune requête ne peut les porter (> 200 Ko à eux seuls). */
  skipped: number;
  /** Au moins un segment du corps part. */
  hasBody: boolean;
}

/** Coûteux (DOMParser, DOMPurify par bloc) : seulement dans `translate()`. */
function prepare(title: string, bodyHtml: string): Prepared {
  const segmented = segmentArticle(title, bodyHtml);
  const send = segmented.segments.map((s, i) => (i === 0 ? s : sanitizeHtml(s)));
  // Un segment vide ou sans lettre ne part pas (un titre vide, un bloc que le
  // sanitiseur a vidé) : le fournisseur pourrait l'omettre et invalider le lot.
  const candidates = send.map((_, i) => i).filter((i) => (i === 0 ? HAS_LETTER.test(send[0]) : hasLetter(send[i])));
  const batches = batchSegments(candidates.map((i) => send[i])).map((b) => b.map((j) => candidates[j]));
  const sent = batches.reduce((n, b) => n + b.length, 0);
  return {
    segmented, send, batches,
    skipped: candidates.length - sent,
    hasBody: batches.some((b) => b.some((i) => i > 0)),
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
 *   sont ignorés et la boucle s'arrête. Elle s'arrête aussi, sans rien écrire,
 *   quand le volet se démonte et quand le compte change (déconnexion).
 * - Chaque lot en vol est partagé (`sharedTranslationRequest`) : revenir sur
 *   l'article et relancer ne paie pas deux fois le lot déjà demandé.
 * - « Traduire avec X » (`providerId`) garde le réglage de repli ; si un lot
 *   bascule, `fellBackFrom` le dit et `providerName` nomme le dernier.
 * - Une demande automatique (`{ automatic: true }`) est marquée dans l'état
 *   (`automatic`) : le volet tait alors un `same`, mais montre une erreur.
 *   Sans rien à traduire, elle ne part pas, comme une demande à la main.
 */
export function useArticleTranslation(input: ArticleTranslationInput): ArticleTranslation {
  const { t, i18n } = useTranslation();
  const isAdmin = useAuthStore((s) => s.backendUser?.role === 'admin');
  const { articleId, title, bodyHtml } = input;
  // Seul le hash et l'estimation sont calculés au rendu : le découpage et le
  // sanitiseur par bloc coûtent plusieurs fois la chaîne d'affichage du corps,
  // et ce volet s'ouvre à chaque article, IA allumée ou non.
  const source = useMemo(
    () => ({ hash: hashOf(`${title}\u0000${bodyHtml}`), readable: hasReadableText(bodyHtml) }),
    [title, bodyHtml],
  );
  const key = `${articleId ?? ''}:${source.hash}`;
  const [snap, setSnap] = useState<Snapshot>(() => idle(key));
  const current = snap.key === key ? snap : idle(key);
  // Corps dont le découpage n'a rien trouvé à traduire.
  const [nothingFor, setNothingFor] = useState<string | null>(null);
  const canTranslate = source.readable && nothingFor !== key;
  // Découpage du corps courant, gardé tant qu'il ne change pas.
  const preparedFor = useRef<{ key: string; prepared: Prepared } | null>(null);

  // Désigne la boucle de lots dont les réponses comptent encore : un nouveau
  // corps, un autre article, une nouvelle demande ou le démontage du volet
  // l'incrémente. Le volet se démonte en même temps que l'article se vide sur
  // tablette et en deux colonnes : sans ce démontage compté, la boucle
  // continuerait d'envoyer des lots payants que personne ne verra.
  const seq = useRef(0);
  useEffect(() => {
    seq.current++;
    setSnap((s) => (s.key === key ? s : idle(key)));
  }, [key]);
  useEffect(() => () => { seq.current++; }, []);

  const latest = useRef({ input, hash: source.hash, key, current, canTranslate, t, language: i18n.language, isAdmin });
  useEffect(() => {
    latest.current = { input, hash: source.hash, key, current, canTranslate, t, language: i18n.language, isAdmin };
  });

  const translate = useCallback((choice?: TranslateChoice, options?: TranslateOptions) => {
    const automatic = options?.automatic === true;
    const { input: inp, hash, key: k, current: cur, canTranslate: can, t: tr, language, isAdmin: admin } = latest.current;
    const id = inp.articleId;
    if (!inp.enabled || !id || !can || cur.state === 'loading') return;
    const held = cur.state === 'done' && cur.html !== null ? cur : null;
    // « Traduire avec X » garde la langue de la traduction affichée, sinon la cible.
    const keptLang = choice?.providerId !== undefined ? held?.lang : null;
    const lang = choice?.lang ?? keptLang ?? inp.targetLang;
    // La traduction tenue répond déjà à la demande : la remontrer, sans appel.
    if (held && held.lang === lang && (choice?.providerId === undefined || choice.providerId === held.providerId)) {
      setSnap((s) => (s.key === k ? { ...s, showing: 'translation' } : s));
      return;
    }
    const failed = () => {
      const msg = aiErrorMessage(undefined, undefined, admin, language, { op: 'translate' });
      setSnap({ ...idle(k), state: 'error', error: tr(msg.key, msg.params) });
    };
    // Le découpage analyse du HTML venu du flux : une exception finit en
    // erreur affichée, jamais en exception non rattrapée dans le clic.
    if (preparedFor.current?.key !== k) {
      try {
        preparedFor.current = { key: k, prepared: prepare(inp.title, inp.bodyHtml) };
      } catch {
        failed();
        return;
      }
    }
    const prep = preparedFor.current.prepared;
    if (!prep.hasBody) {
      setNothingFor(k);
      return;
    }
    const mine = ++seq.current;
    const total = prep.batches.length;
    const routing = inp.routing();
    const startedAs = useAuthStore.getState();
    const user = startedAs.backendUser?.id ?? '';
    const token = startedAs.backendToken;
    // Une déconnexion ou un autre compte en cours de boucle : le lot suivant
    // partirait avec le jeton du compte suivant, à son plafond ou sur sa clé.
    const sameAccount = () => {
      const now = useAuthStore.getState();
      return now.backendToken === token && (now.backendUser?.id ?? '') === user;
    };
    const stillCurrent = () => seq.current === mine && sameAccount();
    setSnap((s) => ({ ...(s.key === k ? s : idle(k)), state: 'loading', progress: { done: 0, total }, error: null, automatic }));

    void (async () => {
      // Une chaîne vide laisse le segment d'origine en place (`apply`).
      const out: string[] = new Array<string>(prep.send.length).fill('');
      let providerId: number | undefined;
      let providerName: string | undefined;
      let fellBackFrom: string | undefined;
      try {
        for (let b = 0; b < total; b++) {
          if (!stillCurrent()) return;
          const indices = prep.batches[b];
          const r = await sharedTranslationRequest(
            `article:${user}:${id}:${lang}:${choice?.providerId ?? ''}:${hash}:${b}`,
            () => requestAiTranslation({
              articleId: id, scope: 'article', targetLang: lang, segments: indices.map((i) => prep.send[i]),
              provider: choice?.providerId, ...routing,
            }),
          );
          if (!stillCurrent()) return;
          if (r.same && b === 0) {
            setSnap({ ...idle(k), state: 'same', lang, automatic });
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
    canTranslate,
    automatic: current.automatic,
    translate,
    showSource,
    showTranslation,
    showing: current.html !== null ? current.showing : 'source',
  };
}
