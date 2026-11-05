import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'pt', 'uk', 'zh'];

type Strings = {
  articleList: { displayMode: string };
  sidebar: { feedLayoutThisFeed: string };
  preferences: { sections: { layout: string }; toolbars: { items: { layout: string; density: string } } };
};

const load = (locale: string): Strings =>
  JSON.parse(readFileSync(resolve(__dirname, `../locales/${locale}.json`), 'utf8')) as Strings;

/**
 * La densité (Aperçu / Standard / Compact) porte son nom dans la palette
 * (« Affichage : Compact ») et dans la feuille d'options du téléphone. En
 * anglais elle s'appelait « Layout » — le nom de la disposition (Liste / Côte
 * à côte / Grille) et de la section « Mise en page » des Préférences : deux
 * réglages différents sous un seul mot (campagne 1.9.0, L-37). L'espagnol, le
 * néerlandais, le polonais et le chinois avaient la même collision.
 */
describe('nom de la densité', () => {
  it.each(LOCALES)('%s : ne reprend ni le nom de la disposition ni celui de la section Mise en page', (locale) => {
    const s = load(locale);
    const density = s.articleList.displayMode.trim().toLowerCase();
    const layoutItem = s.preferences.toolbars.items.layout.split(' (')[0].trim().toLowerCase();
    expect(density).not.toBe(layoutItem);
    expect(density).not.toBe(s.preferences.sections.layout.trim().toLowerCase());
  });

  // Relecture 1.9.0 : l'ukrainien appelait encore la densité « Макет », le mot
  // de « Макет цієї стрічки » (la disposition propre à un flux).
  it.each(LOCALES)('%s : ne reprend pas le mot de la disposition par flux', (locale) => {
    const s = load(locale);
    const density = s.articleList.displayMode.trim().toLowerCase();
    expect(s.sidebar.feedLayoutThisFeed.toLowerCase()).not.toContain(density);
  });

  // Et la palette dit le mot des Préférences (« Densité (Aperçu / Standard /
  // Compact) ») : en français, italien et portugais, elle disait « Affichage ».
  it.each(LOCALES)('%s : le même mot que dans les Préférences', (locale) => {
    const s = load(locale);
    expect(s.articleList.displayMode.trim()).toBe(s.preferences.toolbars.items.density.split(' (')[0].trim());
  });
});
