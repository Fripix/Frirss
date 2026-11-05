// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { isOrphanSeparator, markOrphanSeparators } from './orphanSeparators';

/*
 * L-11 : en tablette, l'en-tête de la liste se replie sur deux lignes (le
 * groupe d'actions passe sous le titre) et le trait vertical qui les séparait
 * restait seul au bout de la première ligne.
 */
const box = (top: number, height = 20) => ({ top, bottom: top + height });

describe('isOrphanSeparator', () => {
  it('entre deux éléments de la même ligne : pas orphelin', () => {
    // Le trait (16 px) est centré dans une ligne de 28 px : son haut n'est pas
    // celui de ses voisins, il recoupe quand même leur hauteur.
    expect(isOrphanSeparator(box(6, 16), box(0, 28), box(2, 24))).toBe(false);
  });

  it('en bout de ligne, le voisin suivant passé à la ligne : orphelin', () => {
    expect(isOrphanSeparator(box(6, 16), box(0, 28), box(34, 28))).toBe(true);
  });

  it('en tête de ligne, le voisin précédent resté au-dessus : orphelin', () => {
    expect(isOrphanSeparator(box(40, 16), box(0, 28), box(34, 28))).toBe(true);
  });

  it('sans voisin d’un côté : orphelin', () => {
    expect(isOrphanSeparator(box(6, 16), null, box(0, 28))).toBe(true);
    expect(isOrphanSeparator(box(6, 16), box(0, 28), null)).toBe(true);
  });
});

/** Donne à chaque élément `[data-y]` une boîte : `top` = data-y, hauteur data-h (20 par défaut). */
function layout(root: HTMLElement) {
  root.querySelectorAll<HTMLElement>('*').forEach((el) => {
    const top = el.dataset.y === undefined ? null : Number(el.dataset.y);
    const h = Number(el.dataset.h ?? 20);
    el.getBoundingClientRect = () => (top === null
      ? { top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) }
      : { top, bottom: top + h, left: 0, right: 10, width: 10, height: h, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
  });
}

describe('markOrphanSeparators', () => {
  it('marque le trait resté seul en bout de ligne, et lui seul', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div id="title" data-y="0" data-h="28"></div>
      <div id="lead" data-toolbar-sep data-y="6" data-h="16"></div>
      <div id="group" data-y="34" data-h="28">
        <button data-y="34"></button>
        <div id="inner" data-toolbar-sep data-y="40" data-h="16"></div>
        <button data-y="34"></button>
      </div>`;
    layout(root);
    markOrphanSeparators(root);
    expect(root.querySelector('#lead')!.hasAttribute('data-orphan')).toBe(true);
    expect(root.querySelector('#inner')!.hasAttribute('data-orphan')).toBe(false);
  });

  it('ignore un voisin non rendu et retire la marque quand la ligne ne se replie plus', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div id="title" data-y="0" data-h="28"></div>
      <div id="lead" data-toolbar-sep data-orphan data-y="6" data-h="16"></div>
      <span id="hidden"></span>
      <div id="group" data-y="2" data-h="24"></div>`;
    layout(root);
    markOrphanSeparators(root);
    expect(root.querySelector('#lead')!.hasAttribute('data-orphan')).toBe(false);
  });
});

describe('le CSS du trait orphelin', () => {
  // Invisible, pas retiré : `display: none` rendrait sa largeur à la ligne,
  // qui pourrait alors ne plus se replier — et la marque oscillerait.
  it('rend le trait marqué invisible sans retirer sa place', () => {
    const css = fs.readFileSync(path.resolve(__dirname, '../styles/index.css'), 'utf8');
    const rule = css.match(/\.list-actions \[data-toolbar-sep\]\[data-orphan\]\s*\{([^}]*)\}/)?.[1] ?? '';
    expect(rule).toMatch(/visibility:\s*hidden/);
    expect(rule).not.toMatch(/display:\s*none/);
  });
});
