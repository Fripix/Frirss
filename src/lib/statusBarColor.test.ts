import { describe, it, expect } from 'vitest';
import { statusBarColor } from './statusBarColor';

// Discussion #19 : sur Android, la barre d'état d'une app installée prend la
// couleur de `theme-color`. Elle valait la barre des serveurs (sombre), masquée
// par défaut sur mobile — barre noire sur en-tête clair. Règle unique : la
// barre prend la couleur de la surface qui est juste dessous.
const colors = { 'topbar-bg': '#201f1b', 'panel-header-bg': '#fafafa', 'panel-bg': '#ffffff' };

describe('statusBarColor', () => {
  it("suit l'en-tête de liste quand la barre des serveurs est masquée", () => {
    expect(statusBarColor({ topbarVisible: false, reading: false }, colors)).toBe('#fafafa');
  });

  it('suit la barre des serveurs quand elle est affichée, liste ou article', () => {
    expect(statusBarColor({ topbarVisible: true, reading: false }, colors)).toBe('#201f1b');
    expect(statusBarColor({ topbarVisible: true, reading: true }, colors)).toBe('#201f1b');
  });

  it("suit le fond de l'article en lecture (option B : jamais l'accent)", () => {
    expect(statusBarColor({ topbarVisible: false, reading: true }, colors)).toBe('#ffffff');
  });

  it('retombe sur une couleur sûre si le thème ne fournit pas la clé', () => {
    expect(statusBarColor({ topbarVisible: false, reading: false }, {})).toBe('#fafafa');
  });
});
