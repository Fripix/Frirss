import { create } from 'zustand';
import { useUiStore } from './uiStore';
import { readableTextOn } from '../lib/readableText';
import type { Theme, LabelColor } from '../types';

export const DEFAULT_THEME_NAME = 'FriRSS Default';
export const NIGHT_THEME_NAME = 'FriRSS Night';
export const PAPER_THEME_NAME = 'FriRSS Paper';
export const CONTRAST_THEME_NAME = 'FriRSS High Contrast';
export const DESK_THEME_NAME = 'FriRSS Desk';

const defaultTheme: Theme = {
  name: DEFAULT_THEME_NAME,
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
    'list-active': '#f0f0f0',
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
/**
 * Anciennes valeurs par défaut d'une couleur → sa valeur actuelle.
 *
 * Le premier terme est une LISTE : une couleur peut avoir eu plusieurs
 * défauts successifs, et toutes doivent mener à la valeur du jour, sinon la
 * moitié des installations reste sur une teinte abandonnée selon la version
 * d'où elle vient. Une valeur que l'utilisateur a réellement choisie ne
 * correspond à aucune et n'est jamais touchée.
 */
const COLOR_DEFAULT_MIGRATIONS: Record<string, [string[], string]> = {
  'list-hover': [['#f5f5f8'], '#e9f8f2'],
  'readlater-color': [['#a78bfa'], '#8b5cf6'],
  // Parenthèse des panneaux tièdes, ouverte puis refermée : le blanc cassé
  // avait été choisi pour s'accorder au noir chaud de la barre latérale, mais
  // à l'usage il se lit comme un voile de couleur sur les articles. La surface
  // de lecture redevient blanche ; la chaleur reste où elle a un sens, dans
  // « Paper ».
  'panel-bg': [['#faf9f6'], '#ffffff'],
  'panel-header-bg': [['#f2f0e9'], '#fafafa'],
  'panel-border': [['#e6e3da'], '#e8e8ec'],
  // `--list-active` peint les pistes qui groupent les icônes de l'en-tête.
  // #f0f0f5 tirait au lilas, #eeebe2 au beige : les deux se voyaient. Gris
  // franc, qui ne penche d'aucun côté.
  'list-active': [['#f0f0f5', '#eeebe2'], '#f0f0f0'],
};

function migrateColors(colors: Record<string, string>): Record<string, string> {
  const out = { ...colors };
  for (const key in COLOR_DEFAULT_MIGRATIONS) {
    const [oldValues, newVal] = COLOR_DEFAULT_MIGRATIONS[key];
    if (oldValues.includes(out[key])) out[key] = newVal;
  }
  return out;
}

/* ── Thèmes livrés ──────────────────────────────────────────────────────
 * Le moteur de thèmes était complet — 36 couleurs, enregistrement, export CSS,
 * import, partage par lien — mais ne livrait qu'un seul thème. Quelqu'un qui
 * voulait lire au lit devait régler 36 valeurs à la main.
 *
 * Les préréglages sont de simples thèmes enregistrés : `ensureShippedThemes()`
 * garantit leur présence dans la liste, exactement comme le thème par défaut
 * l'était déjà, et « Charger » les applique sans machinerie nouvelle.
 *
 * Chacun définit les 36 couleurs. Un test (`themePresets.test.ts`) échoue si
 * l'un en oublie une : une clé manquante laisserait sur `:root` la valeur du
 * thème précédent, ce qui donne une interface à moitié sombre.
 */
function preset(name: string, colors: Record<string, string>): Theme {
  return { name, colors, fontSizes: { ...defaultTheme.fontSizes } };
}

const nightTheme = preset(NIGHT_THEME_NAME, {
  // La barre latérale descend SOUS les panneaux. En thème clair la hiérarchie
  // va du sombre vers le clair ; en thème sombre elle doit rester du sombre
  // vers le moins sombre, sinon la barre latérale a l'air de flotter.
  'sidebar-bg': '#151410',
  'sidebar-header-from': '#38b888',
  'sidebar-header-to': '#2a8f6c',
  'sidebar-text': '#8a887e',
  'sidebar-text-active': '#ecebe4',
  'sidebar-category-text': '#6d6b61',
  'sidebar-divider': 'rgba(255, 255, 255, 0.07)',
  'topbar-bg': '#151410',
  'topbar-text': '#8a887e',
  'topbar-text-active': '#4cd4a1',
  'topbar-track': '#23221d',
  'topbar-seg-active': '#2e2d26',
  'accent': '#4cd4a1',
  'accent-dark': '#38b888',
  'panel-bg': '#201f1b',
  'panel-border': '#34322b',
  'panel-header-bg': '#26251f',
  'list-hover': '#26332d',
  'list-active': '#2b2a24',
  'list-selected': '#1e3830',
  'list-source': '#4cd4a1',
  'list-title': '#e8e6df',
  'list-title-read': '#86847b',
  'list-summary': '#9a988e',
  'list-time': '#74726a',
  'reading-title': '#f0eee7',
  'reading-text': '#cbc8bd',
  'reading-meta': '#97948a',
  'reading-link': '#4cd4a1',
  'star-color': '#f5c542',
  'readlater-color': '#a78bfa',
  'danger': '#f87171',
  'danger-light': '#3a1f1f',
  'code-bg': '#1a1915',
  'scrollbar': '#3d3b33',
  'scrollbar-hover': '#555248',
});

const paperTheme = preset(PAPER_THEME_NAME, {
  // Papier tiède pour la lecture longue. L'accent garde sa teinte mais fonce :
  // le menthe clair sur crème ne tient pas le contraste.
  'sidebar-bg': '#33302a',
  'sidebar-header-from': '#4cd4a1',
  'sidebar-header-to': '#38b888',
  'sidebar-text': '#8b8779',
  'sidebar-text-active': '#eee9dc',
  'sidebar-category-text': '#6b675c',
  'sidebar-divider': 'rgba(255, 255, 255, 0.08)',
  'topbar-bg': '#33302a',
  'topbar-text': '#8b8779',
  'topbar-text-active': '#4cd4a1',
  'topbar-track': '#403c34',
  'topbar-seg-active': '#4b473d',
  'accent': '#2f9e77',
  'accent-dark': '#23795b',
  'panel-bg': '#f6f1e4',
  'panel-border': '#e0d7c0',
  'panel-header-bg': '#efe8d6',
  'list-hover': '#e3eee4',
  'list-active': '#eae2ce',
  'list-selected': '#dbe9dd',
  'list-source': '#2f9e77',
  'list-title': '#2e2a20',
  'list-title-read': '#8d8674',
  'list-summary': '#7d7663',
  'list-time': '#a39b86',
  'reading-title': '#2e2a20',
  'reading-text': '#4a4437',
  'reading-meta': '#857d69',
  'reading-link': '#23795b',
  'star-color': '#b8860b',
  'readlater-color': '#7c5cd6',
  'danger': '#b3382c',
  'danger-light': '#f7e6e3',
  'code-bg': '#ece5d3',
  'scrollbar': '#cfc6ae',
  'scrollbar-hover': '#b3a98e',
});

const contrastTheme = preset(CONTRAST_THEME_NAME, {
  // Noir et blanc francs, accent assombri jusqu'à porter du texte blanc.
  'sidebar-bg': '#000000',
  'sidebar-header-from': '#067a52',
  'sidebar-header-to': '#04593c',
  'sidebar-text': '#c9c9c9',
  'sidebar-text-active': '#ffffff',
  'sidebar-category-text': '#a8a8a8',
  'sidebar-divider': 'rgba(255, 255, 255, 0.25)',
  'topbar-bg': '#000000',
  'topbar-text': '#c9c9c9',
  'topbar-text-active': '#4cd4a1',
  'topbar-track': '#1a1a1a',
  'topbar-seg-active': '#2e2e2e',
  'accent': '#067a52',
  'accent-dark': '#04593c',
  'panel-bg': '#ffffff',
  'panel-border': '#767676',
  'panel-header-bg': '#f0f0f0',
  'list-hover': '#dff0e8',
  'list-active': '#e6e6e6',
  'list-selected': '#c9e8da',
  'list-source': '#067a52',
  'list-title': '#000000',
  'list-title-read': '#3d3d3d',
  'list-summary': '#333333',
  'list-time': '#4a4a4a',
  'reading-title': '#000000',
  'reading-text': '#1a1a1a',
  'reading-meta': '#3d3d3d',
  'reading-link': '#045c3d',
  'star-color': '#8a6100',
  'readlater-color': '#5b21b6',
  'danger': '#b91c1c',
  'danger-light': '#fee2e2',
  'code-bg': '#f0f0f0',
  'scrollbar': '#767676',
  'scrollbar-hover': '#4a4a4a',
});

/* ── Thème commandé ─────────────────────────────────────────────────────
 * Parti d'une image de référence donnée par l'utilisateur, pas d'une idée.
 *
 * Recette, pour la prochaine fois : la première couleur devient l'accent et
 * ouvre le dégradé d'en-tête, la seconde ferme ce dégradé **et** prend les
 * liens, pour qu'elle ait un rôle et pas seulement une présence. Demander
 * aussi la variante voulue, claire ou sombre.
 *
 * Ce qui a été essayé et écarté (Lagoon, Neon, Circuit, en sombre puis en
 * clair) : une palette bâtie autour de deux couleurs vives donne un écran qui
 * fatigue vite, et sur fond clair la couleur doit être tellement assombrie
 * pour rester lisible qu'il n'en reste plus grand-chose. Ce qui marche ici est
 * un fond franc — blanc ou noir — et une seule couleur qui ponctue.
 */

const deskTheme = preset(DESK_THEME_NAME, {
  // D'après la photo de bureau : noir profond, halo vert lime au sol, et la
  // lampe qui pose une chaleur ambrée. C'est cette chaleur qui distingue ce
  // thème du suivant — elle va aux favoris, le seul endroit où une seconde
  // couleur chaude a un sens.
  'sidebar-bg': '#0a0d08',
  'sidebar-header-from': '#a6e22e',
  'sidebar-header-to': '#6b9e18',
  'sidebar-text': '#7c8472',
  'sidebar-text-active': '#e7ecdf',
  'sidebar-category-text': '#616858',
  'sidebar-divider': 'rgba(255, 255, 255, 0.07)',
  'topbar-bg': '#0a0d08',
  'topbar-text': '#7c8472',
  'topbar-text-active': '#a6e22e',
  'topbar-track': '#141810',
  'topbar-seg-active': '#1d2317',
  'accent': '#a6e22e',
  'accent-dark': '#7fb418',
  'panel-bg': '#11150d',
  'panel-border': '#232a1c',
  'panel-header-bg': '#161b11',
  'list-hover': '#1c2513',
  'list-active': '#1e2418',
  'list-selected': '#253312',
  'list-source': '#a6e22e',
  'list-title': '#e4e9dc',
  'list-title-read': '#7c8472',
  'list-summary': '#929a86',
  'list-time': '#6a7261',
  'reading-title': '#eff3e8',
  'reading-text': '#c6ccb9',
  'reading-meta': '#8d9581',
  'reading-link': '#a6e22e',
  'star-color': '#e8a33d',
  'readlater-color': '#b08cf0',
  'danger': '#ef6b5e',
  'danger-light': '#331a17',
  'code-bg': '#0d1109',
  'scrollbar': '#2c3423',
  'scrollbar-hover': '#414c33',
});


export const SHIPPED_THEMES: Theme[] = [
  defaultTheme, nightTheme, deskTheme, paperTheme, contrastTheme,
];

/**
 * Préréglages livrés puis retirés.
 *
 * `ensureShippedThemes()` les ajoutait tout seul : personne ne les a choisis,
 * et les laisser dans la liste encombrerait la galerie de thèmes que
 * l'utilisateur n'a pas demandés et ne peut pas distinguer des siens. Ils sont
 * donc retirés au chargement, pas seulement absents des nouvelles listes.
 */
const RETIRED_THEME_NAMES = [
  // Inventés sans être demandés.
  'FriRSS Midnight', 'FriRSS Ember', 'FriRSS Nordic',
  // Commandés, essayés en sombre puis en clair, et écartés à l'usage. Les deux
  // variantes partent : ce qui ne convainc pas encombre la galerie.
  'FriRSS Lagoon', 'FriRSS Lagoon Light',
  'FriRSS Neon', 'FriRSS Neon Light',
  'FriRSS Circuit', 'FriRSS Circuit Light',
];

/**
 * Garantit la présence des thèmes livrés, en tête, sans doublon et **à jour**.
 *
 * Un préréglage suit le CODE, il n'est pas figé à la première version reçue.
 * L'inverse était le comportement d'origine et s'est retourné contre nous :
 * les quatre thèmes commandés ont été repassés en clair, et personne ne l'a
 * jamais vu — la copie enregistrée l'emportait, sans aucun moyen de s'en
 * sortir depuis l'interface. Un correctif de préréglage doit atteindre tout le
 * monde.
 *
 * Sans risque pour les personnalisations : régler une couleur modifie le thème
 * **actif** (`frirss_theme`), pas l'entrée enregistrée — celle-ci ne change que
 * si on appuie explicitement sur « Enregistrer » sous ce nom. Une variante
 * personnelle se garde donc sous son propre nom, ce que l'interface propose
 * déjà.
 *
 * Un préréglage supprimé revient au chargement suivant — c'était déjà le
 * comportement du thème par défaut, et une liste amputée casserait le choix
 * « suivre le système ».
 */
export function ensureShippedThemes(list: Theme[] | null | undefined): Theme[] {
  const existing = Array.isArray(list)
    ? list
        .filter((t): t is Theme => !!t && typeof t.name === 'string' && !!t.colors)
        // Les thèmes ENREGISTRÉS passent par les mêmes migrations de défauts
        // que le thème actif. Sans cela, démarrer donnait les panneaux tièdes
        // (le thème actif est migré au chargement) alors que recharger
        // « FriRSS Default » depuis la liste ramenait le blanc froid : la même
        // interface changeait d'aspect selon le chemin emprunté. Une valeur
        // que l'utilisateur a réellement choisie n'est jamais touchée — les
        // migrations ne remplacent qu'un ancien défaut exact.
        .filter((t) => !RETIRED_THEME_NAMES.includes(t.name))
        .map((t) => ({ ...t, colors: migrateColors(t.colors) }))
    : [];
  const shipped = SHIPPED_THEMES.map(
    (s) => ({ ...s, colors: { ...s.colors }, fontSizes: { ...s.fontSizes } })
  );
  const rest = existing.filter((t) => !SHIPPED_THEMES.some((s) => s.name === t.name));
  return [...shipped, ...rest];
}

/**
 * Quel thème le système réclame-t-il ? `null` = ne rien changer.
 *
 * Renvoie `null` aussi quand le thème visé n'existe plus dans la liste :
 * mieux vaut laisser le thème courant en place que de basculer vers quelque
 * chose que l'utilisateur n'a pas choisi.
 */
export function pickAutoTheme(
  followSystem: boolean,
  prefersDark: boolean,
  lightThemeName: string,
  darkThemeName: string,
  savedThemes: Theme[]
): Theme | null {
  if (!followSystem) return null;
  const wanted = prefersDark ? darkThemeName : lightThemeName;
  return savedThemes.find((t) => t.name === wanted) ?? null;
}

function resolveSchemeName(stored: string | null, fallback: string): string {
  if (!stored || RETIRED_THEME_NAMES.includes(stored)) return fallback;
  return stored;
}

function systemPrefersDark(): boolean {
  try {
    if (typeof matchMedia !== 'function') return false;
    return matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
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
    return ensureShippedThemes(saved ? JSON.parse(saved) : []);
  } catch {
    return ensureShippedThemes([]);
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

  // Ink that stays readable on the two colours the interface fills buttons and
  // pills with. Both are user-settable, so `#fff` written in a className was a
  // guess: white on the default mint accent is about 1.9:1, and any pale
  // accent or danger colour made its own button label vanish. Derived, not a
  // theme key — there is nothing here for the user to decide.
  root.style.setProperty('--on-accent', readableTextOn(theme.colors['accent']));
  root.style.setProperty('--on-danger', readableTextOn(theme.colors['danger']));

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
  // Intention ponctuelle portée par l'ouverture : la section seule ne dit pas
  // ce qu'on vient y faire. Consommée puis vidée au montage, sinon rouvrir le
  // panneau relancerait l'action.
  preferencesIntent: string | null;
  preferencesOpenId: number;

  openPreferences: (tab?: string | null, intent?: string | null) => void;
  clearPreferencesIntent: () => void;
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

  /** Suivre le thème clair/sombre du système. */
  followSystem: boolean;
  lightThemeName: string;
  darkThemeName: string;
  setFollowSystem: (on: boolean) => void;
  setSchemeTheme: (scheme: 'light' | 'dark', name: string) => void;
  /** Applique le thème réclamé par le système, si le réglage est actif. */
  syncSystemTheme: () => void;
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
    preferencesTab: null, // null = default ('general'), or force a specific tab on open
    preferencesIntent: null, // null = just open the section
    preferencesOpenId: 0,  // increments each open — forces useEffect to re-fire

    followSystem: localStorage.getItem('frirss_followSystem') === 'true',
    // Un thème visé qui a été RETIRÉ laisserait « suivre le système » sans
    // effet et sans rien dire (`pickAutoTheme` renvoie null quand la cible
    // n'existe plus). Comme c'est notre retrait qui l'aurait cassé, on
    // ramène le choix sur le préréglage correspondant.
    lightThemeName: resolveSchemeName(localStorage.getItem('frirss_lightThemeName'), DEFAULT_THEME_NAME),
    darkThemeName: resolveSchemeName(localStorage.getItem('frirss_darkThemeName'), NIGHT_THEME_NAME),

    openPreferences: (tab = null, intent = null) => set((s) => ({ preferencesOpen: true, preferencesTab: tab, preferencesIntent: intent, preferencesOpenId: s.preferencesOpenId + 1 })),
    clearPreferencesIntent: () => set({ preferencesIntent: null }),
    closePreferences: () => set({ preferencesOpen: false, preferencesTab: null, preferencesIntent: null }),

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

    setFollowSystem: (on) => {
      localStorage.setItem('frirss_followSystem', String(on));
      set({ followSystem: on });
      get().syncSystemTheme();
    },

    setSchemeTheme: (scheme, name) => {
      const key = scheme === 'dark' ? 'darkThemeName' : 'lightThemeName';
      localStorage.setItem(`frirss_${key}`, name);
      set({ [key]: name } as Partial<ThemeState>);
      get().syncSystemTheme();
    },

    syncSystemTheme: () => {
      const { followSystem, lightThemeName, darkThemeName, savedThemes, theme } = get();
      const target = pickAutoTheme(followSystem, systemPrefersDark(), lightThemeName, darkThemeName, savedThemes);
      if (!target || target.name === theme.name) return;
      // Les tailles de police courantes sont conservées : une bascule
      // automatique au coucher du soleil qui remettrait aussi la taille du
      // corps de texte à sa valeur d'usine serait une mauvaise surprise.
      // « Charger » à la main garde, lui, son remplacement complet.
      const next: Theme = {
        ...target,
        colors: { ...target.colors },
        fontSizes: { ...theme.fontSizes },
      };
      localStorage.setItem('frirss_theme', JSON.stringify(next));
      applyThemeToDOM(next);
      set({ theme: next, baseTheme: resolveBaseTheme(next, savedThemes) });
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
        const list = ensureShippedThemes(prefs.savedThemes as Theme[]);
        localStorage.setItem('frirss_savedThemes', JSON.stringify(list));
        patch.savedThemes = list;
      }

      if (prefs.labelColors && typeof prefs.labelColors === 'object') {
        localStorage.setItem('frirss_labelColors', JSON.stringify(prefs.labelColors));
        patch.labelColors = prefs.labelColors;
      }

      if (typeof prefs.followSystem === 'boolean') {
        localStorage.setItem('frirss_followSystem', String(prefs.followSystem));
        patch.followSystem = prefs.followSystem;
      }
      for (const key of ['lightThemeName', 'darkThemeName'] as const) {
        if (typeof prefs[key] === 'string') {
          localStorage.setItem(`frirss_${key}`, prefs[key] as string);
          patch[key] = prefs[key];
        }
      }

      // Recompute the reset target from the freshly applied theme/savedThemes
      if (patch.theme || patch.savedThemes) {
        const theme = (patch.theme as Theme) || get().theme;
        const savedThemes = (patch.savedThemes as Theme[]) || get().savedThemes;
        patch.baseTheme = resolveBaseTheme(theme, savedThemes);
      }

      if (Object.keys(patch).length) set(patch as Partial<ThemeState>);
      // Les préférences arrivent après le démarrage : le réglage « suivre le
      // système » peut n'être connu qu'ici, donc on rejoue la décision.
      get().syncSystemTheme();
    },
  };
});

// Theme-related keys synced to the server (logical prefs).
export const THEME_SYNC_KEYS = [
  'theme', 'savedThemes', 'labelColors',
  'followSystem', 'lightThemeName', 'darkThemeName',
];

/* Le système change d'avis (coucher du soleil, bascule manuelle de macOS) :
 * on rejoue la décision. Un seul écouteur pour toute l'application, posé au
 * chargement du module — `matchMedia` peut ne pas exister (jsdom), auquel cas
 * le réglage reste simplement sans effet. */
if (typeof matchMedia === 'function') {
  try {
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const sync = () => useThemeStore.getState().syncSystemTheme();
    mq.addEventListener?.('change', sync);
    // Deuxième filet : le système peut basculer pendant que l'onglet est
    // masqué — c'est même le cas courant, une PWA laissée ouverte au coucher
    // du soleil. Le retour au premier plan rejoue la décision.
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') sync();
      });
    }
    setTimeout(sync, 0);
  } catch { /* pas de matchMedia utilisable : réglage inopérant, jamais fatal */ }
}
