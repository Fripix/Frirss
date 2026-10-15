// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import {
  SHIPPED_THEMES,
  DEFAULT_THEME_NAME,
  NIGHT_THEME_NAME,
  CONTRAST_THEME_NAME,
  ensureShippedThemes,
  pickAutoTheme,
  useThemeStore,
} from './themeStore';
import { readableTextOn, DARK_INK } from '../lib/readableText';
import type { Theme } from '../types';

const base = SHIPPED_THEMES[0];

describe('shipped themes', () => {
  it('ships the default first, then presets', () => {
    // Pas de compte figé : la galerie est faite pour s'étoffer. Ce qui compte
    // est que le thème par défaut ouvre la liste et que les noms soient uniques.
    expect(SHIPPED_THEMES.length).toBeGreaterThanOrEqual(4);
    expect(SHIPPED_THEMES[0].name).toBe(DEFAULT_THEME_NAME);
    expect(SHIPPED_THEMES.map((t) => t.name)).toContain(NIGHT_THEME_NAME);
    expect(new Set(SHIPPED_THEMES.map((t) => t.name)).size).toBe(SHIPPED_THEMES.length);
  });

  it('gives every preset every colour the default defines', () => {
    // 38 colours × every preset: one forgotten key would fall back to whatever the
    // previous theme left on :root, which is how a half-dark interface happens.
    const keys = Object.keys(base.colors);
    for (const theme of SHIPPED_THEMES) {
      expect(Object.keys(theme.colors).sort(), theme.name).toEqual(keys.slice().sort());
    }
  });

  it('defines the two AI summary colours', () => {
    expect(Object.keys(base.colors)).toHaveLength(38);
    expect(base.colors).toHaveProperty('ai-bg');
    expect(base.colors).toHaveProperty('ai-border');
  });

  it('tints the AI summary surface on the same side as the panel (light on light, dark on dark)', () => {
    for (const theme of SHIPPED_THEMES) {
      const panelIsLight = readableTextOn(theme.colors['panel-bg']) === DARK_INK;
      const aiIsLight = readableTextOn(theme.colors['ai-bg']) === DARK_INK;
      expect(aiIsLight, `${theme.name}: ai-bg`).toBe(panelIsLight);
      expect(theme.colors['ai-bg'], `${theme.name}: ai-bg is a tint, not the panel itself`).not.toBe(theme.colors['panel-bg']);
    }
  });

  const withoutAi = (colors: Record<string, string>) => {
    const c = { ...colors };
    delete c['ai-bg'];
    delete c['ai-border'];
    return c;
  };

  it('fills a shipped preset saved before the AI colours with that preset\'s own values, not a derived mix', () => {
    for (const name of [NIGHT_THEME_NAME, CONTRAST_THEME_NAME, DEFAULT_THEME_NAME]) {
      const preset = SHIPPED_THEMES.find((t) => t.name === name)!;
      useThemeStore.getState().applyServerPrefs({ theme: { name, colors: withoutAi(preset.colors), fontSizes: preset.fontSizes } });
      const st = useThemeStore.getState();
      expect(st.theme.colors['ai-bg'], name).toBe(preset.colors['ai-bg']);
      expect(st.theme.colors['ai-border'], name).toBe(preset.colors['ai-border']);
      expect(st.isColorModified('ai-bg'), name).toBe(false);
      expect(st.isColorModified('ai-border'), name).toBe(false);
    }
  });

  it('keeps an AI colour the user already customised on a shipped preset', () => {
    const contrast = SHIPPED_THEMES.find((t) => t.name === CONTRAST_THEME_NAME)!;
    useThemeStore.getState().applyServerPrefs({ theme: { name: CONTRAST_THEME_NAME, colors: { ...withoutAi(contrast.colors), 'ai-bg': '#fafafa' }, fontSizes: contrast.fontSizes } });
    expect(useThemeStore.getState().theme.colors['ai-bg']).toBe('#fafafa');
    expect(useThemeStore.getState().theme.colors['ai-border']).toBe(contrast.colors['ai-border']);
  });

  it('fills a stored shipped preset with its own AI colours on startup too', async () => {
    const contrast = SHIPPED_THEMES.find((t) => t.name === CONTRAST_THEME_NAME)!;
    localStorage.setItem('frirss_theme', JSON.stringify({ name: CONTRAST_THEME_NAME, colors: withoutAi(contrast.colors), fontSizes: contrast.fontSizes }));
    vi.resetModules();
    const fresh = await import('./themeStore');
    const st = fresh.useThemeStore.getState();
    expect(st.theme.colors['ai-border']).toBe(contrast.colors['ai-border']);
    expect(st.isColorModified('ai-bg')).toBe(false);
    expect(st.isColorModified('ai-border')).toBe(false);
    localStorage.removeItem('frirss_theme');
  });

  it('derives the AI colours of a theme saved before they existed from its own panel and accent', () => {
    const night = SHIPPED_THEMES.find((t) => t.name === NIGHT_THEME_NAME)!;
    const old = { ...night.colors };
    delete old['ai-bg'];
    delete old['ai-border'];
    useThemeStore.getState().applyServerPrefs({ theme: { name: 'Ma nuit', colors: old, fontSizes: night.fontSizes } });
    const got = useThemeStore.getState().theme.colors;
    // Un thème sombre ne doit pas hériter du fond clair du thème par défaut.
    expect(readableTextOn(got['ai-bg'])).not.toBe(DARK_INK);
    expect(got['ai-bg']).not.toBe(base.colors['ai-bg']);
    expect(got['ai-border']).toMatch(/^#[0-9a-f]{6}$/i);
    // Une valeur choisie n'est jamais recalculée.
    useThemeStore.getState().applyServerPrefs({ theme: { name: 'X', colors: { ...old, 'ai-bg': '#123456' }, fontSizes: night.fontSizes } });
    expect(useThemeStore.getState().theme.colors['ai-bg']).toBe('#123456');
  });

  it('gives every preset every font size the default defines', () => {
    const keys = Object.keys(base.fontSizes).sort();
    for (const theme of SHIPPED_THEMES) {
      expect(Object.keys(theme.fontSizes).sort(), theme.name).toEqual(keys);
    }
  });

  it('writes every colour as a hex value or an rgba() one', () => {
    for (const theme of SHIPPED_THEMES) {
      for (const [key, value] of Object.entries(theme.colors)) {
        expect(value, `${theme.name} / ${key}`).toMatch(/^(#[0-9a-f]{6}|rgba\([\d\s.,]+\))$/i);
      }
    }
  });

  it('never puts a light title on a light panel, or the reverse', () => {
    // Cheap sanity net rather than a full contrast audit — it catches a preset
    // that pastes a light palette's text colour onto a dark ground. A colour
    // that wants DARK ink written on it is itself a light colour.
    for (const theme of SHIPPED_THEMES) {
      const panelIsLight = readableTextOn(theme.colors['panel-bg']) === DARK_INK;
      const titleIsLight = readableTextOn(theme.colors['list-title']) === DARK_INK;
      expect(titleIsLight, `${theme.name}: title and panel are both ${panelIsLight ? 'light' : 'dark'}`)
        .toBe(!panelIsLight);
    }
  });

  it('keeps the sidebar darker than the panels in every preset', () => {
    // The hierarchy has to survive the flip: a sidebar lighter than the panel
    // next to it reads as floating rather than as a frame.
    for (const theme of SHIPPED_THEMES) {
      expect(theme.colors['sidebar-bg'], theme.name).not.toBe(theme.colors['panel-bg']);
    }
  });
});

describe('ensureShippedThemes', () => {
  it('adds every missing preset', () => {
    expect(ensureShippedThemes([]).map((t) => t.name)).toEqual(
      SHIPPED_THEMES.map((t) => t.name)
    );
  });

  it('keeps the user themes and leaves them after the shipped ones', () => {
    const mine: Theme = { name: 'Mine', colors: { ...base.colors }, fontSizes: { ...base.fontSizes } };
    const out = ensureShippedThemes([mine]);
    expect(out.map((t) => t.name)).toEqual([...SHIPPED_THEMES.map((t) => t.name), 'Mine']);
  });

  it('refreshes a shipped preset from its shipped definition, without duplicating it', () => {
    // Décision INVERSÉE. La copie enregistrée l'emportait, si bien qu'un
    // préréglage corrigé ou refondu n'atteignait jamais quelqu'un qui l'avait
    // déjà en liste : les quatre thèmes repassés en clair sont restés sombres
    // chez l'utilisateur, et rien dans l'interface ne permettait de s'en
    // sortir. Un préréglage suit donc désormais le code.
    //
    // Sans risque pour les personnalisations : régler une couleur modifie le
    // thème ACTIF (`frirss_theme`), pas l'entrée enregistrée — celle-ci ne
    // change que si on appuie explicitement sur « Enregistrer » sous ce nom.
    const stale: Theme = {
      name: NIGHT_THEME_NAME,
      colors: { ...base.colors, accent: '#123456' },
      fontSizes: { ...base.fontSizes },
    };
    const out = ensureShippedThemes([stale]);
    const shipped = SHIPPED_THEMES.find((t) => t.name === NIGHT_THEME_NAME)!;
    expect(out.filter((t) => t.name === NIGHT_THEME_NAME)).toHaveLength(1);
    expect(out.find((t) => t.name === NIGHT_THEME_NAME)?.colors.accent)
      .toBe(shipped.colors.accent);
  });

  it('leaves a theme of the user\'s own untouched', () => {
    const mine: Theme = {
      name: 'Mine',
      colors: { ...base.colors, accent: '#123456' },
      fontSizes: { ...base.fontSizes },
    };
    expect(ensureShippedThemes([mine]).find((t) => t.name === 'Mine')?.colors.accent)
      .toBe('#123456');
  });

  it('migrates a colour away from ANY of its former defaults', () => {
    // `list-active` a eu trois valeurs successives : le gris froid d'origine,
    // le beige de la parenthèse tiède, puis le gris neutre. Les deux premières
    // doivent mener à la troisième, sinon la moitié des installations reste
    // sur une teinte abandonnée selon la version d'où elles viennent.
    const from = (value: string) => ensureShippedThemes([{
      name: 'Le mien',
      colors: { ...base.colors, 'list-active': value },
      fontSizes: { ...base.fontSizes },
    }]).find((t) => t.name === 'Le mien')!.colors['list-active'];
    expect(from('#f0f0f5')).toBe(base.colors['list-active']);
    expect(from('#eeebe2')).toBe(base.colors['list-active']);
    // Une valeur choisie par l'utilisateur n'est jamais touchée.
    expect(from('#123456')).toBe('#123456');
  });

  it('migrates a stored theme of the user that still carries the old defaults', () => {
    // Le bug : au démarrage, le thème actif passe par `migrateColors` et
    // reçoit les panneaux tièdes ; la liste des thèmes enregistrés, non. En
    // rechargeant « FriRSS Default » depuis la liste, on retombait donc sur le
    // blanc froid — l'interface changeait d'aspect selon le chemin emprunté.
    // Sur un thème PERSONNEL : les préréglages livrés, eux, viennent
    // désormais du code et n'ont plus rien à migrer.
    const stale: Theme = {
      name: 'Le mien',
      colors: { ...base.colors, 'panel-bg': '#ffffff', 'panel-header-bg': '#fafafa' },
      fontSizes: { ...base.fontSizes },
    };
    const out = ensureShippedThemes([stale]);
    const restored = out.find((t) => t.name === 'Le mien')!;
    expect(restored.colors['panel-bg']).toBe(base.colors['panel-bg']);
    expect(restored.colors['panel-header-bg']).toBe(base.colors['panel-header-bg']);
  });

  it('leaves a colour the user deliberately chose alone', () => {
    const mine: Theme = {
      name: 'Mine',
      colors: { ...base.colors, 'panel-bg': '#123456' },
      fontSizes: { ...base.fontSizes },
    };
    expect(ensureShippedThemes([mine]).find((t) => t.name === 'Mine')!.colors['panel-bg'])
      .toBe('#123456');
  });

  it('removes presets that were shipped and then withdrawn', () => {
    // Midnight / Ember / Nordic ont été livrés puis retirés. Ils n'ont jamais
    // été choisis par personne : `ensureShippedThemes` les ajoutait tout seul.
    // Les laisser traîner encombrerait la galerie de thèmes que l'utilisateur
    // n'a pas demandés et ne peut pas distinguer des siens.
    const stale: Theme = {
      name: 'FriRSS Midnight',
      colors: { ...base.colors },
      fontSizes: { ...base.fontSizes },
    };
    const mine: Theme = { name: 'Mine', colors: { ...base.colors }, fontSizes: { ...base.fontSizes } };
    const out = ensureShippedThemes([stale, mine]);
    expect(out.map((t) => t.name)).not.toContain('FriRSS Midnight');
    expect(out.map((t) => t.name)).toContain('Mine');
  });

  it('drops entries that are not themes rather than passing them on', () => {
    const out = ensureShippedThemes([null, { name: 'x' }] as unknown as Theme[]);
    expect(out.map((t) => t.name)).toEqual(SHIPPED_THEMES.map((t) => t.name));
  });
});

describe('pickAutoTheme', () => {
  const saved = SHIPPED_THEMES;

  it('returns nothing when the setting is off', () => {
    expect(pickAutoTheme(false, true, DEFAULT_THEME_NAME, NIGHT_THEME_NAME, saved)).toBeNull();
  });

  it('picks the dark theme when the system is dark', () => {
    expect(pickAutoTheme(true, true, DEFAULT_THEME_NAME, NIGHT_THEME_NAME, saved)?.name)
      .toBe(NIGHT_THEME_NAME);
  });

  it('picks the light theme when it is not', () => {
    expect(pickAutoTheme(true, false, DEFAULT_THEME_NAME, NIGHT_THEME_NAME, saved)?.name)
      .toBe(DEFAULT_THEME_NAME);
  });

  it('returns nothing when the chosen theme no longer exists', () => {
    // Deleted from the list: better to leave the current theme alone than to
    // fall back to something the user never picked.
    expect(pickAutoTheme(true, true, DEFAULT_THEME_NAME, 'Gone', saved)).toBeNull();
  });
});
