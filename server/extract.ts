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
 * Extrait le corps lisible d'une page. **Le HTML rendu est BRUT — il n'est PAS
 * assaini.** `onclick`, `onerror` et le reste survivent tels quels.
 *
 * L'assainissement se fait chez le client, à la réception (`sanitizeExtracted()`),
 * comme pour sa propre extraction. Afficher ce contenu sans passer par là est
 * une faille XSS, pas un raccourci.
 *
 * Décision du 2026-09-04, à ne pas « corriger » de bonne foi : assainir ici a
 * été tenté et abandonné parce que `createDOMPurify` sur la fenêtre de
 * `linkedom` ne filtre **rien** — il lui manque `NodeFilter`, DOMPurify bascule
 * silencieusement en mode « environnement non supporté » et rend son entrée
 * telle quelle, sans lever d'erreur. Le filet existait, y croire suffisait à
 * supprimer le vrai. Quiconque veut réintroduire un assainissement serveur doit
 * d'abord **prouver qu'il filtre** (un test qui injecte un `onerror` et le voit
 * disparaître), avant de toucher au client.
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
