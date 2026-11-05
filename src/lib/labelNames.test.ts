import { describe, it, expect } from 'vitest';
import { nameOf, takenBy, nameOwners, categoryNameIssue, userLabels } from './labelNames';

const L = (n: string) => `user/-/label/${n}`;

describe('labelNames — collisions entre étiquettes et catégories', () => {
  const owners = { labels: [L('Veille'), L('Tech/IA')], categories: [L('Tech'), L('Sans catégorie')] };

  it('nameOf lit le nom après /label/', () => {
    expect(nameOf(L('Tech/IA'))).toBe('Tech/IA');
  });

  it('un nom de catégorie est pris par la catégorie, sans casse ni espaces autour', () => {
    expect(takenBy('  tech ', owners)).toBe('category');
    expect(takenBy('sans CATÉGORIE', owners)).toBe('category');
  });

  it('un nom d’étiquette est pris par l’étiquette, imbrication comprise', () => {
    expect(takenBy('veille', owners)).toBe('label');
    expect(takenBy('tech/ia', owners)).toBe('label');
  });

  it('un nom libre ou vide n’est pris par personne', () => {
    expect(takenBy('Homelab', owners)).toBeNull();
    expect(takenBy('   ', owners)).toBeNull();
  });

  it('l’élément renommé ne se bloque pas lui-même (changer la casse reste permis)', () => {
    expect(takenBy('VEILLE', owners, L('Veille'))).toBeNull();
    expect(takenBy('TECH', owners, L('Tech'))).toBeNull();
    // …mais une autre étiquette au même nom bloque toujours.
    expect(takenBy('Veille', owners, L('Tech'))).toBe('label');
  });

  it('nameOwners réunit les catégories portées par les flux et les dossiers vides', () => {
    expect(nameOwners({
      labels: [{ id: L('Veille') }],
      categoryIds: [L('Tech')],
      folderIds: [L('Tech'), L('Sans catégorie')],
    })).toEqual({ labels: [L('Veille')], categories: [L('Tech'), L('Sans catégorie')] });
  });

  it('categoryNameIssue : la barre oblique d’abord, puis les collisions', () => {
    expect(categoryNameIssue('A/B', owners)).toBe('slash');
    expect(categoryNameIssue('Veille', owners)).toBe('label');
    expect(categoryNameIssue('tech', owners)).toBe('category');
    expect(categoryNameIssue('tech', owners, L('Tech'))).toBeNull();
    expect(categoryNameIssue('', owners)).toBeNull();
    expect(categoryNameIssue('Homelab', owners)).toBeNull();
  });
});

describe('userLabels — ce que la liste des étiquettes retient de tag/list', () => {
  it('écarte un dossier (catégorie) même vide, que les flux ne portent pas', () => {
    const tags = [
      { id: L('Sans catégorie'), type: 'folder' },
      { id: L('Sans catégorie'), type: 'tag' },
      { id: L('Veille'), type: 'tag' },
      { id: 'user/-/state/com.google/starred' },
    ];
    // Un nom porté à la fois par une catégorie et une étiquette désigne le
    // même flux pour l’API : il reste écarté, comme avant.
    expect(userLabels(tags, [], 'user/-/label/À lire plus tard').map((t) => t.id)).toEqual([L('Veille')]);
  });

  it('écarte les catégories portées par les flux et « À lire plus tard » (serveur sans type)', () => {
    const tags = [{ id: L('Tech') }, { id: L('À lire plus tard') }, { id: L('Veille') }];
    expect(userLabels(tags, [L('Tech')], L('À lire plus tard')).map((t) => t.id)).toEqual([L('Veille')]);
  });
});
