import { create } from 'zustand';
import { useUiStore } from './uiStore';
import type { Theme, LabelColor } from '../types';

const defaultTheme: Theme = {
  name: 'FriRSS Default',
  colors: {
    'sidebar-bg': '#201f1b',
    'sidebar-header-from': '#4cd4a1',
    'sidebar-header-to': '#38b888',
    'sidebar-text': '#6d6f6c',
    'sidebar-text-active': '#e0e0dc',
    'sidebar-category-text': '#555753',
    'sidebar-divider': 'rgba(255, 255, 255, 0.06)',
    'topbar-bg': '#201f1b',
    'topbar-text': '#6d6f6c',
    'topbar-text-active': '#4cd4a1',
    'topbar-track': '#2d2c29',
    'topbar-seg-active': '#363532',
    'accent': '#4cd4a1',
    'accent-dark': '#38b888',
    'panel-bg': '#ffffff',
    'panel-border': '#e8e8ec',
    'panel-header-bg': '#fafafa',
    'list-hover': '#e9f8f2',
    'list-active': '#f0f0f5',
    'list-selected': '#def7ee',
    'list-source': '#4cd4a1',
    'list-title': '#2c2d35',
    'list-title-read': '#8b8d9a',
    'list-summary': '#8b8d9a',
    'list-time': '#b0b2c0',
    'reading-title': '#2c2d35',
    'reading-text': '#4a4b58',
    'reading-meta': '#8b8d9a',
    'reading-link': '#4cd4a1',
    'star-color': '#f5c542',
    'readlater-color': '#8b5cf6',
    'danger': '#ef4444',
    'danger-light': '#fef2f2',
    'code-bg': '#f5f5f8',
    'scrollbar': '#d0d1da',
    'scrollbar-hover': '#b0b2c0',
  },
  fontSizes: {
    'sidebar-feed': '14',
    'sidebar-category': '11',
    'list-title': '14',
    'list-summary': '12',
    'list-source': '10',
    'reading-title': '24',
    'reading-body': '14',
  },
};

// Colors whose shipped default changed: a value still equal to the old
// default is bumped to the new one. Idempotent and applied on every load
// (localStorage + backend hydration), so a persisted theme picks up the
// new default while genuine user customizations (any other value) are kept.
const COLOR_DEFAULT_MIGRATIONS: Record<string, [string, string]> = {
  'list-hover': ['#f5f5f8', '#e9f8f2'],
  'readlater-color': ['#a78bfa', '#8b5cf6'],
};

function migrateColors(colors: Record<string, string>): Record<string, string> {
  const out = { ...colors };
  for (const key in COLOR_DEFAULT_MIGRATIONS) {
    const [oldVal, newVal] = COLOR_DEFAULT_MIGRATIONS[key];
    if (out[key] === oldVal) out[key] = newVal;
  }
  return out;
}

function loadTheme(): Theme {
  try {
    const saved = localStorage.getItem('frirss_theme');
    if (saved) {
      const parsed = JSON.parse(saved) as Partial<Theme>;
      return {
        ...defaultTheme,
        ...parsed,
        colors: migrateColors({ ...defaultTheme.colors, ...parsed.colors }),
        fontSizes: { ...defaultTheme.fontSizes, ...parsed.fontSizes },
      };
    }
  } catch { /* ignore */ }
  return { ...defaultTheme };
}

function loadSavedThemes(): Theme[] {
  try {
    const saved = localStorage.getItem('frirss_savedThemes');
    const list: Theme[] = saved ? JSON.parse(saved) : [];
    // Ensure the default theme is always present (first, non-deletable)
    if (!list.find((t) => t.name === defaultTheme.name)) {
      list.unshift({ ...defaultTheme });
    }
    return list;
  } catch {
    return [{ ...defaultTheme }];
  }
}

/**
 * Resolve the "base" theme — the saved snapshot that the current theme derives from.
 * Used as the reference for reset operations (reset = revert to base, not to hardcoded default).
 */
function resolveBaseTheme(theme: Theme, savedThemes: Theme[]): Theme {
  const match = savedThemes.find((t) => t.name === theme.name);
  if (match) return JSON.parse(JSON.stringify(match)); // deep clone
  return JSON.parse(JSON.stringify(defaultTheme));
}

/**
 * Label colors — stored separately from the theme (label-specific, not theme-specific).
 * Structure: { [labelId]: { color: '#hex', inherit: true } }
 * `inherit` means children of this label inherit the parent color unless overridden.
 */
function loadLabelColors(): Record<string, LabelColor> {
  try {
    const saved = localStorage.getItem('frirss_labelColors');
    return saved ? JSON.parse(saved) : {};
  } catch {
    return {};
  }
}

function saveLabelColors(labelColors: Record<string, LabelColor>): void {
  localStorage.setItem('frirss_labelColors', JSON.stringify(labelColors));
}

function applyThemeToDOM(theme: Theme): void {
  const root = document.documentElement;

  // Apply colors
  const semiTransparentKeys: Record<string, number> = { 'badge-dot': 0.5, 'badge-count': 0.5 };
  Object.entries(theme.colors).forEach(([key, value]) => {
    if (key === 'sidebar-header-from' || key === 'sidebar-header-to') return;
    if (semiTransparentKeys[key] && value.startsWith('#')) {
      root.style.setProperty(`--${key}`, hexToRgba(value, semiTransparentKeys[key]));
    } else {
      root.style.setProperty(`--${key}`, value);
    }
  });

  // Special: header gradient
  root.style.setProperty(
    '--sidebar-header-bg',
    `linear-gradient(135deg, ${theme.colors['sidebar-header-from']} 0%, ${theme.colors['sidebar-header-to']} 100%)`
  );

  // Derived values
  root.style.setProperty('--accent-glow', hexToGlow(theme.colors['accent']));
  root.style.setProperty('--sidebar-hover', 'rgba(255, 255, 255, 0.05)');
  root.style.setProperty('--sidebar-active', 'rgba(255, 255, 255, 0.08)');
  root.style.setProperty('--list-unread-bar', theme.colors['accent']);
  root.style.setProperty('--badge-bg', hexToGlow(theme.colors['accent']));
  root.style.setProperty('--badge-text', theme.colors['accent']);
  root.style.setProperty('--star-inactive', '#d0d1da');
  root.style.setProperty('--resize-handle-hover', theme.colors['accent']);

  // Apply font sizes as CSS custom properties
  Object.entries(theme.fontSizes).forEach(([key, value]) => {
    root.style.setProperty(`--fs-${key}`, `${value}px`);
  });
}

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function hexToGlow(hex: string): string {
  return hexToRgba(hex, 0.12);
}

type BilingualComment = [string, string];

/* ── CSS color comments / Commentaires des couleurs CSS ─────────────── */
const COLOR_COMMENTS: Record<string, BilingualComment> = {
  'sidebar-bg':           ['Sidebar background',              'Fond de la barre latérale'],
  'sidebar-header-from':  ['Header gradient start',           'Début du dégradé du header'],
  'sidebar-header-to':    ['Header gradient end',             'Fin du dégradé du header'],
  'sidebar-text':         ['Sidebar text',                    'Texte de la barre latérale'],
  'sidebar-text-active':  ['Sidebar active text',             'Texte actif de la barre latérale'],
  'sidebar-category-text':['Category headers',                'En-têtes de catégories'],
  'sidebar-divider':      ['Sidebar dividers',                'Séparateurs de la barre latérale'],
  'topbar-bg':            ['Server topbar background',        'Fond de la barre serveurs'],
  'topbar-text':          ['Server name (inactive)',          'Nom de serveur (inactif)'],
  'topbar-text-active':   ['Server name (active)',            'Nom de serveur (actif)'],
  'topbar-track':         ['Server switcher track',           'Fond du sélecteur de serveurs'],
  'topbar-seg-active':    ['Active server background',        'Fond du serveur actif'],
  'accent':               ['Primary accent color',            'Couleur d\'accentuation principale'],
  'accent-dark':          ['Dark accent',                     'Accentuation foncée'],
  'panel-bg':             ['Panel background',                'Fond des panneaux'],
  'panel-border':         ['Panel borders',                   'Bordures des panneaux'],
  'panel-header-bg':      ['Panel header background',         'Fond de l\'en-tête des panneaux'],
  'list-hover':           ['Article list hover',              'Survol dans la liste d\'articles'],
  'list-active':          ['Chip / switcher background',       'Fond des pastilles / sélecteurs'],
  'list-selected':        ['Selected article overlay',         'Surbrillance de l\'article sélectionné'],
  'list-source':          ['Feed source name',                'Nom de la source du flux'],
  'list-title':           ['Article title (unread)',          'Titre d\'article (non lu)'],
  'list-title-read':      ['Article title (read)',            'Titre d\'article (lu)'],
  'list-summary':         ['Article summary text',            'Résumé de l\'article'],
  'list-time':            ['Article timestamp',               'Date de l\'article'],
  'reading-title':        ['Reading pane title',              'Titre du panneau de lecture'],
  'reading-text':         ['Reading pane body text',          'Texte du panneau de lecture'],
  'reading-meta':         ['Reading pane metadata',           'Métadonnées du panneau de lecture'],
  'reading-link':         ['Links in articles',               'Liens dans les articles'],
  'star-color':           ['Favorite star color',             'Couleur de l\'étoile favori'],
  'readlater-color':      ['Read-later highlight color',       'Couleur À lire plus tard'],
  'danger':               ['Danger/destructive actions',      'Actions dangereuses/destructives'],
  'danger-light':         ['Danger background',               'Fond des alertes de danger'],
  'code-bg':              ['Code block background',           'Fond des blocs de code'],
  'scrollbar':            ['Scrollbar track',                 'Barre de défilement'],
  'scrollbar-hover':      ['Scrollbar hover',                 'Barre de défilement (survol)'],
};

const FONT_COMMENTS: Record<string, BilingualComment> = {
  'sidebar-feed':    ['Sidebar feed name',       'Nom du flux dans la barre latérale'],
  'sidebar-category':['Sidebar category header', 'En-tête de catégorie'],
  'list-title':      ['Article list title',       'Titre dans la liste d\'articles'],
  'list-summary':    ['Article list summary',     'Résumé dans la liste d\'articles'],
  'list-source':     ['Article list source',      'Source dans la liste d\'articles'],
  'reading-title':   ['Reading pane title',       'Titre du panneau de lecture'],
  'reading-body':    ['Reading pane body',        'Corps du panneau de lecture'],
};

/* ── CSS section grouping / Regroupement par section CSS ────────────── */
interface ColorSection {
  comment: BilingualComment;
  keys: string[];
}
const COLOR_SECTIONS_CSS: ColorSection[] = [
  { comment: ['Sidebar', 'Barre latérale'],
    keys: ['sidebar-bg', 'sidebar-header-from', 'sidebar-header-to', 'sidebar-text', 'sidebar-text-active', 'sidebar-category-text', 'sidebar-divider'] },
  { comment: ['Server topbar (multi-server)', 'Barre serveurs (multi-serveur)'],
    keys: ['topbar-bg', 'topbar-text', 'topbar-text-active', 'topbar-track', 'topbar-seg-active'] },
  { comment: ['Accent', 'Accentuation'],
    keys: ['accent', 'accent-dark'] },
  { comment: ['Article list', 'Liste d\'articles'],
    keys: ['panel-bg', 'panel-border', 'panel-header-bg', 'list-hover', 'list-active', 'list-selected', 'list-source', 'list-title', 'list-title-read', 'list-summary', 'list-time'] },
  { comment: ['Reading pane', 'Panneau de lecture'],
    keys: ['reading-title', 'reading-text', 'reading-meta', 'reading-link'] },
  { comment: ['Misc', 'Divers'],
    keys: ['star-color', 'readlater-color', 'danger', 'danger-light', 'code-bg', 'scrollbar', 'scrollbar-hover'] },
];

/**
 * Convert a theme object to a CSS string with bilingual comments.
 */
function themeToCss(theme: Theme, logo?: string | null): string {
  const lines: string[] = [];
  lines.push(`/*`);
  lines.push(` * FriRSS Theme / Thème FriRSS`);
  lines.push(` * Name / Nom : ${theme.name}`);
  lines.push(` * Exported / Exporté : ${new Date().toISOString().split('T')[0]}`);
  lines.push(` *`);
  lines.push(` * Import this file into FriRSS Preferences > Themes > Import`);
  lines.push(` * Importez ce fichier dans Préférences FriRSS > Thèmes > Importer`);
  lines.push(` */`);
  lines.push('');
  lines.push(`:root {`);
  lines.push(`  /* Theme name / Nom du thème */`);
  lines.push(`  --frirss-theme-name: "${theme.name}";`);
  if (logo) {
    lines.push('');
    lines.push(`  /* App logo (URL or data URI) / Logo de l'app (URL ou data URI) */`);
    lines.push(`  --frirss-logo: url("${logo}");`);
  }
  lines.push('');

  // Colors grouped by section
  lines.push(`  /* ── Colors / Couleurs ──────────────────────────────── */`);
  lines.push('');

  for (const section of COLOR_SECTIONS_CSS) {
    lines.push(`  /* ${section.comment[0]} / ${section.comment[1]} */`);
    for (const key of section.keys) {
      const value: string | undefined = theme.colors[key];
      if (value === undefined) continue;
      const c = COLOR_COMMENTS[key];
      if (c) {
        lines.push(`  --${key}: ${value}; /* ${c[0]} / ${c[1]} */`);
      } else {
        lines.push(`  --${key}: ${value};`);
      }
    }
    lines.push('');
  }

  // Font sizes
  lines.push(`  /* ── Font sizes (px) / Tailles de police (px) ──────── */`);
  lines.push('');
  for (const [key, value] of Object.entries(theme.fontSizes)) {
    const c = FONT_COMMENTS[key];
    if (c) {
      lines.push(`  --fs-${key}: ${value}px; /* ${c[0]} / ${c[1]} */`);
    } else {
      lines.push(`  --fs-${key}: ${value}px;`);
    }
  }

  lines.push(`}`);
  lines.push('');
  return lines.join('\n');
}

interface ImportedTheme {
  name: string;
  colors: Record<string, string>;
  fontSizes: Record<string, string>;
  logo?: string;
}

/**
 * Parse a CSS theme file back into a theme object.
 * Extracts --key: value pairs and the theme name.
 */
function cssToTheme(cssString: string): ImportedTheme | null {
  if (!cssString || typeof cssString !== 'string') return null;

  const theme: ImportedTheme = { name: 'Imported Theme', colors: {}, fontSizes: {} };

  // Extract theme name: --frirss-theme-name: "My Theme";
  const nameMatch = cssString.match(/--frirss-theme-name:\s*"([^"]+)"/);
  if (nameMatch) theme.name = nameMatch[1];

  // Extract logo: --frirss-logo: url("..."); (handled separately — data URIs contain ';')
  const logoMatch = cssString.match(/--frirss-logo:\s*url\(\s*["']?([^)]*?)["']?\s*\)/i);
  if (logoMatch && logoMatch[1].trim()) {
    theme.logo = logoMatch[1].trim();
  }

  // Extract all custom properties: --key: value;
  const propRegex = /--([a-z][a-z0-9-]*)\s*:\s*([^;]+);/gi;
  let match: RegExpExecArray | null;
  while ((match = propRegex.exec(cssString)) !== null) {
    const key = match[1].trim();
    const value = match[2].trim().replace(/\/\*.*?\*\//g, '').trim(); // strip inline comments

    // Skip internal properties
    if (key === 'frirss-theme-name') continue;

    // Font sizes: --fs-xxx: 14px → fontSizes['xxx'] = '14'
    if (key.startsWith('fs-')) {
      const fsKey = key.slice(3); // remove 'fs-' prefix
      const numVal = value.replace(/px$/, '').trim();
      if (fsKey in defaultTheme.fontSizes) {
        theme.fontSizes[fsKey] = numVal;
      }
      continue;
    }

    // Colors: only accept keys that exist in defaultTheme.colors
    if (key in defaultTheme.colors) {
      theme.colors[key] = value;
    }
  }

  // Must have found at least some valid properties (or a logo)
  if (Object.keys(theme.colors).length === 0 && Object.keys(theme.fontSizes).length === 0 && !theme.logo) {
    return null;
  }

  return theme;
}

export interface ThemeState {
  theme: Theme;
  baseTheme: Theme;
  savedThemes: Theme[];
  labelColors: Record<string, LabelColor>;
  preferencesOpen: boolean;
  preferencesTab: string | null;
  preferencesOpenId: number;

  openPreferences: (tab?: string | null) => void;
  closePreferences: () => void;
  setColor: (key: string, value: string) => void;
  setFontSize: (key: string, value: string) => void;
  setThemeName: (name: string) => void;
  saveCurrentTheme: () => void;
  loadSavedTheme: (name: string) => void;
  deleteSavedTheme: (name: string) => void;
  exportTheme: () => void;
  importTheme: (fileContent: string) => boolean;
  setLabelColor: (labelId: string, color: string) => void;
  toggleLabelInherit: (labelId: string) => void;
  removeLabelColor: (labelId: string) => void;
  renameLabelColor: (oldLabelId: string, newLabelId: string) => void;
  getLabelColor: (labelId: string) => string | null;
  resetToDefault: () => void;
  resetColors: () => void;
  resetColor: (key: string) => void;
  isColorModified: (key: string) => boolean;
  resetFontSizes: () => void;
  resetLabelColors: () => void;
  applyServerPrefs: (prefs: Record<string, unknown> | null | undefined) => void;
}

export const useThemeStore = create<ThemeState>()((set, get) => {
  const initialSaved = loadSavedThemes();
  const initial = loadTheme();
  const initialBase = resolveBaseTheme(initial, initialSaved);
  // Apply on load
  setTimeout(() => applyThemeToDOM(initial), 0);

  return {
    theme: initial,
    baseTheme: initialBase, // snapshot of the current theme as saved — reset target
    savedThemes: initialSaved,
    labelColors: loadLabelColors(),
    preferencesOpen: false,
    preferencesTab: null, // null = default ('branding'), or force a specific tab on open
    preferencesOpenId: 0,  // increments each open — forces useEffect to re-fire

    openPreferences: (tab = null) => set((s) => ({ preferencesOpen: true, preferencesTab: tab, preferencesOpenId: s.preferencesOpenId + 1 })),
    closePreferences: () => set({ preferencesOpen: false, preferencesTab: null }),

    setColor: (key, value) => {
      set((state) => {
        const next: Theme = {
          ...state.theme,
          colors: { ...state.theme.colors, [key]: value },
        };
        localStorage.setItem('frirss_theme', JSON.stringify(next));
        applyThemeToDOM(next);
        return { theme: next };
      });
    },

    setFontSize: (key, value) => {
      set((state) => {
        const next: Theme = {
          ...state.theme,
          fontSizes: { ...state.theme.fontSizes, [key]: value },
        };
        localStorage.setItem('frirss_theme', JSON.stringify(next));
        applyThemeToDOM(next);
        return { theme: next };
      });
    },

    setThemeName: (name) => {
      set((state) => {
        const next: Theme = { ...state.theme, name };
        localStorage.setItem('frirss_theme', JSON.stringify(next));
        return { theme: next };
      });
    },

    saveCurrentTheme: () => {
      const { theme, savedThemes } = get();
      const snapshot: Theme = JSON.parse(JSON.stringify(theme));
      const exists = savedThemes.findIndex((t) => t.name === theme.name);
      let next: Theme[];
      if (exists >= 0) {
        next = [...savedThemes];
        next[exists] = snapshot;
      } else {
        next = [...savedThemes, snapshot];
      }
      localStorage.setItem('frirss_savedThemes', JSON.stringify(next));
      // After saving, the base theme becomes the saved snapshot
      set({ savedThemes: next, baseTheme: JSON.parse(JSON.stringify(snapshot)) });
    },

    loadSavedTheme: (name) => {
      const { savedThemes } = get();
      const found = savedThemes.find((t) => t.name === name);
      if (found) {
        const loaded: Theme = JSON.parse(JSON.stringify(found)); // deep clone
        localStorage.setItem('frirss_theme', JSON.stringify(loaded));
        applyThemeToDOM(loaded);
        set({ theme: loaded, baseTheme: JSON.parse(JSON.stringify(found)) });
      }
    },

    deleteSavedTheme: (name) => {
      // Cannot delete the built-in default theme
      if (name === defaultTheme.name) return;
      set((state) => {
        const next = state.savedThemes.filter((t) => t.name !== name);
        localStorage.setItem('frirss_savedThemes', JSON.stringify(next));
        return { savedThemes: next };
      });
    },

    exportTheme: () => {
      const { theme } = get();
      const logo = useUiStore.getState().appLogo;
      const css = themeToCss(theme, logo);
      const blob = new Blob([css], { type: 'text/css' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${theme.name.replace(/\s+/g, '-').toLowerCase()}.frirss-theme.css`;
      a.click();
      URL.revokeObjectURL(url);
    },

    importTheme: (fileContent) => {
      try {
        const imported = cssToTheme(fileContent);
        if (!imported) return false;
        const merged: Theme & { logo?: string } = {
          ...defaultTheme,
          ...imported,
          colors: { ...defaultTheme.colors, ...imported.colors },
          fontSizes: { ...defaultTheme.fontSizes, ...imported.fontSizes },
        };
        // Logo travels with the theme but lives in uiStore — not part of the theme object
        delete merged.logo;
        localStorage.setItem('frirss_theme', JSON.stringify(merged));
        applyThemeToDOM(merged);
        set({ theme: merged, baseTheme: JSON.parse(JSON.stringify(merged)) });
        if (imported.logo) {
          useUiStore.getState().setAppLogo(imported.logo);
        }
        return true;
      } catch {
        return false;
      }
    },

    // ── Label colors ──────────────────────────────────────────
    setLabelColor: (labelId, color) => {
      set((state) => {
        const next = {
          ...state.labelColors,
          [labelId]: { ...state.labelColors[labelId], color },
        };
        // Default inherit to true if not set
        if (next[labelId].inherit === undefined) next[labelId].inherit = true;
        saveLabelColors(next);
        return { labelColors: next };
      });
    },

    toggleLabelInherit: (labelId) => {
      set((state) => {
        const entry = state.labelColors[labelId];
        if (!entry) return state;
        const next = {
          ...state.labelColors,
          [labelId]: { ...entry, inherit: !entry.inherit },
        };
        saveLabelColors(next);
        return { labelColors: next };
      });
    },

    removeLabelColor: (labelId) => {
      set((state) => {
        const next = { ...state.labelColors };
        delete next[labelId];
        saveLabelColors(next);
        return { labelColors: next };
      });
    },

    // Migrate color entry when a label is renamed/moved
    renameLabelColor: (oldLabelId, newLabelId) => {
      set((state) => {
        if (!state.labelColors[oldLabelId]) return state;
        const next = { ...state.labelColors };
        next[newLabelId] = next[oldLabelId];
        delete next[oldLabelId];
        saveLabelColors(next);
        return { labelColors: next };
      });
    },

    /**
     * Resolve the effective color for a label.
     * Priority: own color > inherited parent color > null (= use accent)
     */
    getLabelColor: (labelId) => {
      const { labelColors } = get();
      // Own color?
      const own = labelColors[labelId]?.color;
      if (own) return own;
      // Check parent: extract "user/-/label/Parent" from "user/-/label/Parent/Child"
      const labelName = labelId.split('/label/').pop();
      if (!labelName) return null;
      const slashIdx = labelName.indexOf('/');
      if (slashIdx > 0) {
        const parentName = labelName.substring(0, slashIdx);
        // Find parent label ID
        const parentId = labelId.split('/label/')[0] + '/label/' + parentName;
        const parentEntry = labelColors[parentId];
        if (parentEntry?.color && parentEntry.inherit !== false) {
          return parentEntry.color;
        }
      }
      return null; // use accent as default
    },

    // Reset everything to the base theme (the saved snapshot of the current theme)
    resetToDefault: () => {
      const { baseTheme } = get();
      const reset: Theme = JSON.parse(JSON.stringify(baseTheme));
      localStorage.setItem('frirss_theme', JSON.stringify(reset));
      applyThemeToDOM(reset);
      set({ theme: reset });
    },

    // Reset only colors to the base theme's colors (keep fontSizes, name, etc.)
    resetColors: () => {
      const { baseTheme } = get();
      set((state) => {
        const next: Theme = { ...state.theme, colors: { ...baseTheme.colors } };
        localStorage.setItem('frirss_theme', JSON.stringify(next));
        applyThemeToDOM(next);
        return { theme: next };
      });
    },

    // Reset a single color to the base theme's value
    resetColor: (key) => {
      const { baseTheme } = get();
      if (!baseTheme.colors[key]) return;
      set((state) => {
        const next: Theme = {
          ...state.theme,
          colors: { ...state.theme.colors, [key]: baseTheme.colors[key] },
        };
        localStorage.setItem('frirss_theme', JSON.stringify(next));
        applyThemeToDOM(next);
        return { theme: next };
      });
    },

    // Check if a color differs from the base theme
    isColorModified: (key) => {
      const { theme, baseTheme } = get();
      return theme.colors[key] !== baseTheme.colors[key];
    },

    // Reset only font sizes to the base theme's values (keep colors, name, etc.)
    resetFontSizes: () => {
      const { baseTheme } = get();
      set((state) => {
        const next: Theme = { ...state.theme, fontSizes: { ...baseTheme.fontSizes } };
        localStorage.setItem('frirss_theme', JSON.stringify(next));
        applyThemeToDOM(next);
        return { theme: next };
      });
    },

    // Reset all label colors
    resetLabelColors: () => {
      localStorage.removeItem('frirss_labelColors');
      set({ labelColors: {} });
    },

    // ── Server-side sync ──────────────────────────────────────────
    // Apply theme-related preferences hydrated from the backend.
    // Recognised keys: theme, savedThemes, labelColors.
    applyServerPrefs: (prefs) => {
      if (!prefs || typeof prefs !== 'object') return;
      const patch: Record<string, unknown> = {};

      if (prefs.theme && typeof prefs.theme === 'object') {
        const pt = prefs.theme as Partial<Theme>;
        const merged: Theme = {
          ...defaultTheme,
          ...pt,
          colors: migrateColors({ ...defaultTheme.colors, ...pt.colors }),
          fontSizes: { ...defaultTheme.fontSizes, ...pt.fontSizes },
        };
        localStorage.setItem('frirss_theme', JSON.stringify(merged));
        applyThemeToDOM(merged);
        patch.theme = merged;
      }

      if (Array.isArray(prefs.savedThemes)) {
        const list: Theme[] = (prefs.savedThemes as Theme[]).slice();
        if (!list.find((t) => t && t.name === defaultTheme.name)) {
          list.unshift({ ...defaultTheme });
        }
        localStorage.setItem('frirss_savedThemes', JSON.stringify(list));
        patch.savedThemes = list;
      }

      if (prefs.labelColors && typeof prefs.labelColors === 'object') {
        localStorage.setItem('frirss_labelColors', JSON.stringify(prefs.labelColors));
        patch.labelColors = prefs.labelColors;
      }

      // Recompute the reset target from the freshly applied theme/savedThemes
      if (patch.theme || patch.savedThemes) {
        const theme = (patch.theme as Theme) || get().theme;
        const savedThemes = (patch.savedThemes as Theme[]) || get().savedThemes;
        patch.baseTheme = resolveBaseTheme(theme, savedThemes);
      }

      if (Object.keys(patch).length) set(patch as Partial<ThemeState>);
    },
  };
});

// Theme-related keys synced to the server (logical prefs).
export const THEME_SYNC_KEYS = ['theme', 'savedThemes', 'labelColors'];
