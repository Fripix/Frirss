import { Readability } from '@mozilla/readability';
import DOMPurify from 'dompurify';
import { useAuthStore } from '../stores/authStore';
import { dropNonVideoIframes } from '../lib/youtube';

export interface ExtractedContent {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  siteName: string;
  length: number;
}

/**
 * Assainit le HTML d'un article extrait.
 *
 * Plus permissif que `sanitizeHtml()` sur un seul point, et ce point est
 * obligatoire : les <iframe> doivent survivre, sans quoi une vidéo intégrée à
 * un article extrait disparaîtrait avant qu'`injectVideoFacades` (appelé au
 * rendu, dans `ReadingPane`) puisse la transformer en façade.
 *
 * Cette permission est refermée aussitôt sur les seules vidéos que la façade
 * sait lire. Ce qu'elle laissait passer avant n'atteignait pas l'écran —
 * `ReadingPane` repasse tout par `sanitizeHtml`, qui supprime les iframes —
 * mais le résultat est ARCHIVÉ tel quel dans IndexedDB (`putExtract`), donc
 * l'innocuité ne tenait qu'au fait que chaque consommateur pense à réassainir.
 * Un stockage qui correspond au contrat d'affichage ne dépend de personne.
 */
export function sanitizeExtracted(html: string): string {
  return dropNonVideoIframes(DOMPurify.sanitize(html, {
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allow', 'allowfullscreen'],
    ALLOW_DATA_ATTR: false,
  }));
}

/**
 * Délai au-delà duquel la route serveur est abandonnée au profit du repli.
 *
 * Sans minuteur, un serveur qui accepte la connexion et ne répond jamais tient
 * l'extraction indéfiniment. Les deux appelants sont strictement séquentiels —
 * le préchargement des dix articles suivants (`ReadingPane`) et
 * `prepareOffline` sur trente jours d'articles (`feedStore`) — donc un seul
 * article bloqué bloque toute la file, et « Article complet » reste sur
 * « Extraction… » sans erreur ni sortie.
 *
 * 25 s se pose juste AU-DESSUS du plafond de corps du serveur (20 s,
 * `BODY_TIMEOUT_MS` dans `server/routes/extract.ts`) : une page qu'il est en
 * train de lire n'est jamais abandonnée en cours de route — l'abandonner
 * enverrait le repli chercher le MÊME site lent, deux fois le trafic à
 * l'origine pour un résultat plus tardif. Au-delà, ce n'est plus une
 * extraction lente mais une route qui ne répondra pas.
 *
 * `AbortController` explicite plutôt qu'`AbortSignal.timeout()` : c'est ce qui
 * rend le délai pilotable par les faux minuteurs, donc testable sans faire
 * attendre la suite de tests vingt-cinq secondes.
 */
export const SERVER_EXTRACT_TIMEOUT_MS = 25_000;

/**
 * Fetch the full article content from its original URL,
 * parse it with Mozilla Readability, and sanitize with DOMPurify.
 *
 * Returns { title, content, excerpt, byline, siteName, length } or throws.
 */
export async function extractFullContent(url: string): Promise<ExtractedContent> {
  const { backendToken } = useAuthStore.getState();

  // Le serveur fait autorité quand il répond : il extrait une fois pour toute
  // l'instance et, quand Redis est là, partage le résultat entre appareils et
  // entre comptes. Toute réponse absente, en erreur, trop lente ou illisible
  // fait tomber sur l'extraction locale ci-dessous, qui reste le filet — la
  // route peut manquer (serveur plus ancien), refuser la page (415, 422) ou
  // échouer à la joindre (502, 504).
  //
  // Ce repli ne couvre PAS l'absence de Redis : sans cache, la route extrait
  // quand même et répond 200 — elle ne garde simplement rien, et le prochain
  // appareil repaiera l'extraction.
  //
  // Le HTML rendu par la route est BRUT, délibérément : `createDOMPurify` sur
  // `linkedom` ne filtre rien (pas de `NodeFilter`, donc DOMPurify bascule sans
  // bruit en mode « environnement non supporté » et rend l'entrée telle
  // quelle). C'est donc ICI qu'il est assaini, avant d'être rendu à l'appelant
  // et donc avant d'être archivé dans IndexedDB (`putExtract`) : sauter cette
  // étape publie une XSS stockée, atteignable depuis n'importe quel flux dont
  // la page d'origine porte un `onclick` ou un `onerror`.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SERVER_EXTRACT_TIMEOUT_MS);
  try {
    const served = await fetch(`/api/extract?url=${encodeURIComponent(url)}`, {
      headers: { ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}) },
      signal: controller.signal,
    });
    if (served.ok) {
      const data = (await served.json()) as Partial<ExtractedContent>;
      // Champ par champ, exactement comme le chemin local plus bas. Un
      // `{ ...data }` recopierait dans IndexedDB (`putExtract`) toute clé que
      // la route viendrait à ajouter, et laisserait passer un `title` absent —
      // `ExtractRecord extends ExtractedContent` ne vaudrait alors que ce que
      // vaut le JSON reçu.
      if (data && typeof data.content === 'string' && data.content) {
        return {
          title: data.title || '',
          content: sanitizeExtracted(data.content),
          excerpt: data.excerpt || '',
          byline: data.byline || '',
          siteName: data.siteName || '',
          length: data.length || 0,
        };
      }
    }
  } catch { /* repli */ } finally {
    clearTimeout(timer);
  }

  // Fetch through the same-origin backend proxy (avoids CORS; the target is
  // passed in a header, auth via the FriRSS JWT).
  const response = await fetch('/api/proxy', {
    headers: {
      'X-Proxy-Target': url,
      'X-Proxy-Accept': 'text/html',
      ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const html = await response.text();

  // Parse into a DOM document that Readability can work with
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, 'text/html');

  // Resolve relative URLs in the parsed document
  const base = doc.createElement('base');
  base.href = url;
  doc.head.prepend(base);

  // Extract readable content
  const reader = new Readability(doc, {
    charThreshold: 50,
  });
  const result = reader.parse();

  if (!result || !result.content) {
    throw new Error('NO_CONTENT');
  }

  const cleanContent = sanitizeExtracted(result.content);

  return {
    title: result.title || '',
    content: cleanContent,
    excerpt: result.excerpt || '',
    byline: result.byline || '',
    siteName: result.siteName || '',
    length: result.length || 0,
  };
}
