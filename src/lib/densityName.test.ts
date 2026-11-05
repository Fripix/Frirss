import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const LOCALES = ['fr', 'en', 'de', 'es', 'it', 'nl', 'pl', 'pt', 'uk', 'zh'];

type Strings = {
  articleList: { displayMode: string };
  preferences: { sections: { layout: string }; toolbars: { items: { layout: string } } };
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
});
