import { describe, it, expect } from 'vitest';
import { COLOR_HIGHLIGHT_MAP, PREVIEW_ZONES, hasRealHighlight } from './colorHighlight';

/**
 * Pin de la « couverture honnête » promise par la spec de la refonte
 * (docs/superpowers/specs/2026-08-21-preferences-rework-design.md, section
 * « Couverture honnête ») : sur les 36 couleurs, 28 sont encadrables sur
 * l'interface réelle, 14 ont une zone dans l'aperçu, et 6 n'ont ni l'un ni
 * l'autre.
 *
 * Les assertions comparent des listes de clés, pas des longueurs : si une
 * couleur change de catégorie (ajout/retrait d'un sélecteur réel ou d'une
 * zone d'aperçu), le diff Vitest nomme la clé en cause au lieu de se
 * contenter d'un « expected 28, got 27 » qu'il faudrait re-déboguer à la main.
 */

const REAL_HIGHLIGHT_KEYS = [
  'code-bg',
  'list-active',
  'list-hover',
  'list-selected',
  'list-source',
  'list-summary',
  'list-time',
  'list-title',
  'list-title-read',
  'panel-bg',
  'panel-header-bg',
  'readlater-color',
  'reading-link',
  'reading-meta',
  'reading-text',
  'reading-title',
  'sidebar-bg',
  'sidebar-category-text',
  'sidebar-header-from',
  'sidebar-header-to',
  'sidebar-text',
  'sidebar-text-active',
  'star-color',
  'topbar-bg',
  'topbar-seg-active',
  'topbar-text',
  'topbar-text-active',
  'topbar-track',
].sort();

const PREVIEW_ZONE_KEYS = [
  'accent',
  'accent-dark',
  'list-selected',
  'list-source',
  'list-summary',
  'list-title',
  'panel-bg',
  'reading-text',
  'reading-title',
  'sidebar-bg',
  'sidebar-header-from',
  'sidebar-header-to',
  'sidebar-text',
  'sidebar-text-active',
].sort();

const NEITHER_KEYS = [
  'danger',
  'danger-light',
  'panel-border',
  'scrollbar',
  'scrollbar-hover',
  'sidebar-divider',
].sort();

describe('colour preview coverage', () => {
  const allKeys = Object.keys(COLOR_HIGHLIGHT_MAP);

  it('tracks exactly 36 colour keys', () => {
    expect(allKeys).toHaveLength(36);
  });

  it('has a real-element selector for exactly these 28 keys', () => {
    const actual = allKeys.filter((k) => hasRealHighlight(k)).sort();
    expect(actual).toEqual(REAL_HIGHLIGHT_KEYS);
  });

  it('has a preview zone for exactly these 14 keys', () => {
    const actual = allKeys.filter((k) => k in PREVIEW_ZONES).sort();
    expect(actual).toEqual(PREVIEW_ZONE_KEYS);
  });

  it('has neither a real-element selector nor a preview zone for exactly these 6 keys', () => {
    const actual = allKeys.filter((k) => !hasRealHighlight(k) && !(k in PREVIEW_ZONES)).sort();
    expect(actual).toEqual(NEITHER_KEYS);
  });

  it('every preview zone key is a real colour key (no stray entries)', () => {
    const strays = Object.keys(PREVIEW_ZONES).filter((k) => !(k in COLOR_HIGHLIGHT_MAP));
    expect(strays).toEqual([]);
  });
});
