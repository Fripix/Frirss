import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import type { Article } from '../../types';
import type { AiProviderView } from '../../api/backend';
import type { AiLanguage } from '../../lib/aiLanguages';
import { displayedHtml, readingMinutes } from '../../lib/articleBody';
import { readingBodyKind } from '../../lib/readingBody';
import { articleTitle } from '../../lib/articleTitle';
import { sanitizeArticleBody } from '../../utils/sanitizeHtml';
import { formatArticleDate } from '../../utils/dates';
import AiSummary, { type AiSummaryProps } from './AiSummary';

/**
 * L'aperçu de l'article voisin pendant un balayage (« fantôme »), sur mobile
 * et tablette.
 *
 * Il montre EXACTEMENT ce que le rendu montrera : sans cela, quelque chose
 * change à l'instant où le geste se termine. Relevé sur iPhone (2026-11-24) :
 * un texte arabe qui ne se calait à droite qu'après le geste (pas de `dir`),
 * la boîte « Résumé IA » qui surgissait, et l'article qui sautait dans la
 * colonne de lecture limitée. D'où, ici, les mêmes `dir="auto"`, la même
 * colonne et les mêmes marges que `ReadingPane`, et la boîte rendue par le
 * vrai composant `AiSummary` plutôt que par une copie de son HTML.
 */

export interface GhostAi {
  providers: AiProviderView[];
  targetLang: AiLanguage;
  /** Un résumé automatique va partir : le rendu montrera la boîte en cours. */
  loading: boolean;
}

export interface GhostOptions {
  /** Contenu : la même décision que le rendu (`readingBodyKind`). */
  autoExtract: boolean;
  extractedHtml: string | null;
  /** Colonne de lecture limitée de cet appareil (`null` = pleine largeur). */
  columnWidth: number | null;
  /** La boîte « Résumé IA » telle que le rendu l'affichera, ou `null`. */
  ai: GhostAi | null;
  t: (key: string, opts?: Record<string, unknown>) => string;
  skeletonHtml: string;
}

const NO_TRANSLATION: AiSummaryProps['translation'] = { status: 'idle', text: null, lang: null, error: null };
const noop = () => {};
const roots = new WeakMap<Element, Root>();

function esc(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Le contenu du fantôme ; le conteneur (position, décalage) reste à l'appelant. */
export function fillSwipeGhost(preview: HTMLDivElement, adj: Article, o: GhostOptions): void {
  const adjDate = formatArticleDate(adj.published);
  const adjKind = readingBodyKind({ rssHtml: adj.content, extractedHtml: o.extractedHtml, autoExtract: o.autoExtract });
  const adjHtml = adjKind === 'skeleton' ? '' : displayedHtml(adj.content, o.extractedHtml);
  // Durée de lecture du contenu réellement montré, comme dans le rendu.
  const wc = adjHtml.replace(/<[^<>]*>/g, ' ').split(/\s+/).filter(Boolean).length;
  const rt = readingMinutes(wc);
  const tags = adj.tags || [];
  const tagsHtml = tags.length > 0
    ? '<div class="flex flex-wrap gap-1.5 mb-5">' +
        tags.map((tag) =>
          '<span class="inline-flex items-center px-2.5 py-1 rounded-full text-[11px] font-medium" style="background:var(--list-active);color:var(--reading-meta);border:1px solid var(--panel-border)">' + esc(tag) + '</span>',
        ).join('') +
      '</div>'
    : '';
  // Mêmes marges que l'<article> du rendu, et la même colonne.
  const column = o.columnWidth !== null;
  preview.innerHTML =
    '<div class="px-4 py-4 md:px-8 md:py-6 lg:px-12 lg:py-8' + (column ? ' reading-column-limited' : '') + '"' +
      (column ? ' style="--reading-column-width:' + o.columnWidth + 'px"' : '') + '>' +
      '<div class="flex items-stretch gap-3 mb-3">' +
        '<div class="flex-1 min-w-0">' +
          '<div class="text-xs font-semibold uppercase tracking-wide truncate" style="color:var(--list-source)">' +
            esc(adj.source) +
          '</div>' +
          '<div class="text-xs truncate mt-0.5" style="color:var(--reading-meta)">' +
            (adj.author ? esc(adj.author) + ' &middot; ' : '') + adjDate +
          '</div>' +
        '</div>' +
        (adjKind === 'skeleton' ? '' :
          '<span class="flex items-center gap-1 px-2.5 rounded-lg text-[11px] font-medium flex-shrink-0" style="color:var(--accent);background:var(--accent-glow)">' +
            '<svg class="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>' +
            // Le texte du rendu, unité comprise (« 3 Min. », « 3 分钟 »).
            esc(o.t('readingPane.readingTime', { count: rt })) +
          '</span>') +
      '</div>' +
      '<h1 dir="auto" class="font-bold leading-tight mb-4" style="color:var(--reading-title);font-size:var(--fs-reading-title)">' +
        esc(articleTitle(adj, (k) => o.t(k))) +
      '</h1>' +
      tagsHtml +
      (o.ai ? '<div data-ghost-ai></div>' : '') +
      (adjKind === 'skeleton'
        ? o.skeletonHtml
        // Même passe sur l'arbre que le rendu (format réservé, paragraphes
        // vides, `dir="auto"` par bloc), sans chargement différé.
        : '<div dir="auto" class="article-content leading-relaxed" style="color:var(--reading-text);font-size:var(--fs-reading-body)">' +
            sanitizeArticleBody(adjHtml, Infinity) +
          '</div>') +
    '</div>';

  const aiHost = o.ai ? preview.querySelector('[data-ghost-ai]') : null;
  if (aiHost && o.ai) {
    // Le vrai composant, rendu tout de suite (le geste est en cours) et
    // inerte : le fantôme est une image de l'article, pas un second volet.
    // `display: contents` : la boîte garde sa place, comme dans le rendu.
    (aiHost as HTMLElement).style.display = 'contents';
    const root = createRoot(aiHost);
    const ai = o.ai;
    flushSync(() => root.render(
      <AiSummary
        status={ai.loading ? 'loading' : 'idle'} result={null} error={null} providers={ai.providers}
        onSummarize={noop} translation={NO_TRANSLATION} onTranslate={noop} onShowSource={noop}
        targetLang={ai.targetLang}
      />,
    ));
    roots.set(preview, root);
  }
  preview.inert = true;
}

/** Retire un fantôme, et démonte la boîte « Résumé IA » qu'il portait. */
export function removeSwipeGhost(preview: Element | null | undefined): void {
  if (!preview) return;
  const root = roots.get(preview);
  if (root) {
    roots.delete(preview);
    root.unmount();
  }
  preview.remove();
}
