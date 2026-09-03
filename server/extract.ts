import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

export interface ExtractedArticle {
  title: string;
  content: string;
  excerpt: string;
  byline: string;
  siteName: string;
  length: number;
}

/**
 * Extrait le corps lisible d'une page, assaini, prêt à afficher.
 *
 * `null` quand Readability ne trouve pas d'article : l'appelant doit alors
 * laisser la main au navigateur plutôt que de renvoyer un corps vide.
 */
export function extractArticle(url: string, html: string): ExtractedArticle | null {
  const { document } = parseHTML(html);

  // Une URL relative dans la page ne veut rien dire pour le navigateur, qui
  // reçoit le HTML sans savoir d'où il vient. `<base>` les résout ici.
  const base = document.createElement('base');
  base.setAttribute('href', url);
  document.head?.prepend(base);

  const parsed = new Readability(document as never, { charThreshold: 50 }).parse();
  if (!parsed?.content) return null;

  return {
    title: parsed.title || '',
    content: parsed.content,
    excerpt: parsed.excerpt || '',
    byline: parsed.byline || '',
    siteName: parsed.siteName || '',
    length: parsed.length || 0,
  };
}
