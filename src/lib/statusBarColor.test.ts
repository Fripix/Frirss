import { describe, it, expect } from 'vitest';
import { statusBarColor, clampForChromeWebapp } from './statusBarColor';

// Discussion #19 : sur Android, la barre d'état d'une app installée prend la
// couleur de `theme-color`. Elle valait la barre des serveurs (sombre), masquée
// par défaut sur mobile — barre noire sur en-tête clair. Règle unique : la
// barre prend la couleur de la surface qui est juste dessous.
const colors = { 'topbar-bg': '#201f1b', 'panel-header-bg': '#fafafa', 'panel-bg': '#ffffff' };

describe('statusBarColor', () => {
  it("suit l'en-tête de liste quand la barre des serveurs est masquée — au plafond de Chrome près", () => {
    expect(statusBarColor({ topbarVisible: false, reading: false }, colors)).toBe('#efefef');
  });

  it('suit la barre des serveurs quand elle est affichée, liste ou article', () => {
    expect(statusBarColor({ topbarVisible: true, reading: false }, colors)).toBe('#201f1b');
    expect(statusBarColor({ topbarVisible: true, reading: true }, colors)).toBe('#201f1b');
  });

  it("suit le fond de l'article en lecture (option B : jamais l'accent), plafonné", () => {
    expect(statusBarColor({ topbarVisible: false, reading: true }, colors)).toBe('#efefef');
  });

  it('retombe sur une couleur sûre si le thème ne fournit pas la clé', () => {
    expect(statusBarColor({ topbarVisible: false, reading: false }, {})).toBe('#efefef');
  });
});

// Mesuré sur Chrome Android 17 en app installée (2026-10-13) : une couleur de
// luminosité HSL > 0,94 est ignorée et Chrome retombe sur la couleur
// d'installation. #e8e8e8 passe, #f0f0f0 non.
describe('clampForChromeWebapp', () => {
  it('ramène un blanc ou presque au plus clair que Chrome accepte', () => {
    expect(clampForChromeWebapp('#ffffff')).toBe('#efefef');
    expect(clampForChromeWebapp('#fafafa')).toBe('#efefef');
    expect(clampForChromeWebapp('#f0f0f0')).toBe('#efefef');
  });

  it('laisse intacte une couleur déjà sous le plafond', () => {
    expect(clampForChromeWebapp('#e8e8e8')).toBe('#e8e8e8');
    expect(clampForChromeWebapp('#f2f0e9')).toBe('#f2f0e9'); // en-tête du thème Paper, L = 0,93
    expect(clampForChromeWebapp('#26251f')).toBe('#26251f');
    expect(clampForChromeWebapp('#4cd4a1')).toBe('#4cd4a1');
  });

  it("garde la teinte d'une couleur claire colorée", () => {
    // un bleu très pâle reste bleuté, juste un peu moins clair
    const out = clampForChromeWebapp('#f4f8ff');
    expect(out).not.toBe('#f4f8ff');
    expect(out.slice(5, 7) >= out.slice(1, 3)).toBe(true);
  });

  it('rend tel quel ce qui n’est pas un hex à 6 chiffres', () => {
    expect(clampForChromeWebapp('rgb(1,2,3)')).toBe('rgb(1,2,3)');
  });
});
