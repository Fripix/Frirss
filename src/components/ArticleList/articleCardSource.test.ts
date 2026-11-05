import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/*
 * L-12 : un nom de flux long (« Le blog de l'équipe sécurité de … ») prenait
 * jusqu'à quatre lignes en tête d'une carte de la grille, et poussait le
 * titre et le résumé hors de la carte. Le nom tient sur UNE ligne, coupé par
 * une ellipse ; l'heure garde sa place à droite.
 */
const css = fs.readFileSync(path.resolve(__dirname, '../../styles/index.css'), 'utf8');
const rule = (sel: string) => css.match(new RegExp(`\\n${sel.replace(/\./g, '\\.')}\\s*\\{([^}]*)\\}`))?.[1] ?? '';

describe('carte de la grille — nom du flux sur une ligne (L-12)', () => {
  it('le nom du flux ne passe pas à la ligne et se coupe par une ellipse', () => {
    const r = rule('.article-card__source');
    expect(r).toMatch(/white-space:\s*nowrap/);
    expect(r).toMatch(/overflow:\s*hidden/);
    expect(r).toMatch(/text-overflow:\s*ellipsis/);
    // Élément flexible : sans `min-width: 0`, il ne rétrécit pas sous la
    // largeur de son texte, et l'ellipse n'apparaît jamais.
    expect(r).toMatch(/min-width:\s*0/);
  });

  it("l'heure ne cède pas sa place au nom", () => {
    expect(rule('.article-card__time')).toMatch(/flex-shrink:\s*0/);
  });
});
