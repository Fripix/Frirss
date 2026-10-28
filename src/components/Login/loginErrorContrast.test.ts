import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { contrastRatio } from '../../lib/readableText';

/*
 * La carte de connexion est sombre et fixe (rgba(20,20,24,.72) sur la
 * vignette noire), quel que soit le thème. Son message d'erreur avait pris
 * `--danger`, un rouge foncé pensé pour les fonds clairs dans Papier, Riso et
 * Contraste : 2,7 à 2,9:1, la ligne la moins lisible de l'écran. Il garde
 * une couleur fixe, choisie pour ce fond.
 */
const ROOT = path.resolve(__dirname, '../..');

describe('écran de connexion — message d’erreur lisible', () => {
  it('utilise une couleur propre à la carte sombre, au moins 4,5:1', () => {
    const css = fs.readFileSync(path.join(ROOT, 'styles/index.css'), 'utf8');
    const rule = css.match(/\.login-error\s*\{([^}]*)\}/)?.[1] ?? '';
    const color = rule.match(/(?:^|;)\s*color:\s*(#[0-9a-fA-F]{6})/)?.[1];
    expect(color, '.login-error doit fixer une couleur hexadécimale').toBeTruthy();
    expect(contrastRatio(color!, '#141417')).toBeGreaterThanOrEqual(4.5);
  });

  it('la connexion n’emploie plus la couleur de danger du thème', () => {
    const tsx = fs.readFileSync(path.join(ROOT, 'components/Login/Login.tsx'), 'utf8');
    expect(tsx).not.toMatch(/danger-note/);
    expect(tsx.match(/login-error/g)?.length).toBe(2);
  });
});
