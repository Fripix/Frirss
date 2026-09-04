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
 * Fetch the full article content from its original URL,
 * parse it with Mozilla Readability, and sanitize with DOMPurify.
 *
 * Returns { title, content, excerpt, byline, siteName, length } or throws.
 */
export async function extractFullContent(url: string): Promise<ExtractedContent> {
  const { backendToken } = useAuthStore.getState();

  // Le serveur fait autorité quand il répond : il extrait une fois pour toute
  // l'instance et partage le résultat entre appareils et entre comptes. Toute
  // réponse absente, en erreur ou illisible fait tomber sur l'extraction
  // locale ci-dessous, qui reste le filet — la route peut manquer (serveur
  // plus ancien), échouer sur une page que `linkedom` ne sait pas lire, ou
  // ne rien garder faute de Redis.
  //
  // Le HTML rendu par la route est BRUT, délibérément : `createDOMPurify` sur
  // `linkedom` ne filtre rien (pas de `NodeFilter`, donc DOMPurify bascule sans
  // bruit en mode « environnement non supporté » et rend l'entrée telle
  // quelle). C'est donc ICI qu'il est assaini, avant d'être rendu à l'appelant
  // et donc avant d'être archivé dans IndexedDB (`putExtract`) : sauter cette
  // étape publie une XSS stockée, atteignable depuis n'importe quel flux dont
  // la page d'origine porte un `onclick` ou un `onerror`.
  try {
    const served = await fetch(`/api/extract?url=${encodeURIComponent(url)}`, {
      headers: { ...(backendToken ? { Authorization: `Bearer ${backendToken}` } : {}) },
    });
    if (served.ok) {
      const data = (await served.json()) as ExtractedContent;
      if (data && typeof data.content === 'string' && data.content) {
        return { ...data, content: sanitizeExtracted(data.content) };
      }
    }
  } catch { /* repli */ }

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
