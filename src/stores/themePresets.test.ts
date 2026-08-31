// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import {
  SHIPPED_THEMES,
  DEFAULT_THEME_NAME,
  NIGHT_THEME_NAME,
  ensureShippedThemes,
  pickAutoTheme,
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
    // 36 colours × 3 presets: one forgotten key would fall back to whatever the
    // previous theme left on :root, which is how a half-dark interface happens.
    const keys = Object.keys(base.colors);
    for (const theme of SHIPPED_THEMES) {
      expect(Object.keys(theme.colors).sort(), theme.name).toEqual(keys.slice().sort());
    }
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
