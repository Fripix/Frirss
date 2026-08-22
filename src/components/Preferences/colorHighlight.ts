// Mapping: color key → CSS selectors to highlight in the UI
// Uses data-theme attributes on specific elements for precise targeting
/** Sélecteur CSS de l'élément réel à encadrer, ou null quand il y en a trop. */
export const COLOR_HIGHLIGHT_MAP: Record<string, string | null> = {
  'sidebar-bg':           '.sidebar',
  'sidebar-header-from':  '.sidebar-header',
  'sidebar-header-to':    '.sidebar-header',
  'sidebar-text':         '[data-theme="sidebar-text"]',
  'sidebar-text-active':  '[data-theme="sidebar-text-active"]',
  'sidebar-category-text':'[data-theme="sidebar-category-text"]',
  'sidebar-divider':      null,
  'topbar-bg':            '.server-track',
  'topbar-text':          '.server-seg:not(.server-seg-active)',
  'topbar-text-active':   '.server-seg-active',
  'topbar-track':         '.server-track',
  'topbar-seg-active':    '.server-seg-active',
  'accent':               null, // too many elements, skip
  'accent-dark':          null,
  'panel-bg':             '.article-list, .reading-pane',
  'panel-border':         null,
  'panel-header-bg':      '.article-list-header',
  'list-hover':           '.article-row:not(.article-row-active)',
  'list-active':          '[data-theme="list-active"]',
  'list-selected':        '.article-row-active',
  'list-source':          '[data-theme="list-source"]',
  'list-title':           '[data-theme="list-title"]',
  'list-title-read':      '[data-theme="list-title-read"]',
  'list-summary':         '[data-theme="list-summary"]',
  'list-time':            '[data-theme="list-time"]',
  'reading-title':        '[data-theme="reading-title"]',
  'reading-text':         '[data-theme="reading-text"]',
  'reading-meta':         '[data-theme="reading-meta"]',
  'reading-link':         '.article-content a',
  'star-color':           '[data-theme="star-color"]',
  'readlater-color':      '[data-theme="readlater-color"]',
  'danger':               null,
  'danger-light':         null,
  'code-bg':              '.article-content pre, .article-content code',
  'scrollbar':            null,
  'scrollbar-hover':      null,
};

/** Vrai si cette couleur peut être encadrée sur l'interface réelle. */
export function hasRealHighlight(key: string): boolean {
  return COLOR_HIGHLIGHT_MAP[key] != null;
}
