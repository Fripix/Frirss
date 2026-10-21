// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import {
  normalizeImageUrl,
  aspectDecl,
  reserveImgAspect,
  rememberImageSize,
  measuredImageSize,
  forgetMeasuredSizes,
  MEASURED_LIMIT,
} from './imageAspect';

beforeEach(() => forgetMeasuredSizes());

/** Un élément tel que l'arbre assaini le présente à la passe. */
const el = (html: string): Element => {
  const t = document.createElement('template');
  t.innerHTML = html;
  return t.content.firstElementChild!;
};

describe('normalizeImageUrl', () => {
  it('décode l’esperluette échappée d’un attribut HTML', () => {
    expect(normalizeImageUrl('https://ex.com/a.jpg?w=1&amp;h=2'))
      .toBe('https://ex.com/a.jpg?w=1&h=2');
  });

  it('décode aussi les formes numériques', () => {
    expect(normalizeImageUrl('https://ex.com/a.jpg?w=1&#38;h=2&#x26;q=3'))
      .toBe('https://ex.com/a.jpg?w=1&h=2&q=3');
  });

  it('laisse une URL déjà propre telle quelle', () => {
    expect(normalizeImageUrl('https://ex.com/a.jpg')).toBe('https://ex.com/a.jpg');
  });
});

describe('aspectDecl', () => {
  it('préfère les attributs de la balise', () => {
    expect(aspectDecl(el('<img width="800" height="450">'), { width: 10, height: 10 }))
      .toBe('aspect-ratio:800/450');
  });

  it('lit les chiffres de tête, comme avant (`800px`)', () => {
    expect(aspectDecl(el('<img width="800px" height=450>'), null)).toBe('aspect-ratio:800/450');
  });

  it('ne prend pas un data-width pour un width', () => {
    expect(aspectDecl(el('<img data-width="800" data-height="450">'), null)).toBeNull();
  });

  it('retombe sur la mesure quand les attributs manquent', () => {
    expect(aspectDecl(el('<img src="a.jpg">'), { width: 1200, height: 800 }))
      .toBe('aspect-ratio:1200/800');
  });

  it('retombe sur la mesure quand les attributs sont dégénérés', () => {
    expect(aspectDecl(el('<img width="0" height="10">'), { width: 4, height: 3 }))
      .toBe('aspect-ratio:4/3');
  });

  it('ne devine jamais : sans mesure utilisable, rien', () => {
    expect(aspectDecl(el('<img src="a.jpg">'), null)).toBeNull();
    expect(aspectDecl(el('<img src="a.jpg">'), { width: 0, height: 600 })).toBeNull();
    expect(aspectDecl(el('<img src="a.jpg">'), { width: 600, height: 0 })).toBeNull();
  });
});

describe('reserveImgAspect', () => {
  it('ajoute un style quand l’image n’en a pas', () => {
    const img = el('<img src="a.jpg" width="4" height="3">');
    reserveImgAspect(img);
    expect(img.outerHTML).toBe('<img src="a.jpg" width="4" height="3" style="aspect-ratio:4/3">');
  });

  it('complète un style existant au lieu de l’écraser, à sa place', () => {
    const img = el('<img style="border:0" src="a.jpg" width="4" height="3">');
    reserveImgAspect(img);
    expect(img.outerHTML).toBe('<img style="border:0;aspect-ratio:4/3" src="a.jpg" width="4" height="3">');
  });

  it('retrouve la mesure par le src de l’élément, déjà décodé', () => {
    rememberImageSize('https://ex.com/a.jpg?a=1&amp;b=2', 1200, 800);
    const img = el('<img src="https://ex.com/a.jpg?a=1&amp;b=2">');
    reserveImgAspect(img);
    expect(img.getAttribute('style')).toBe('aspect-ratio:1200/800');
  });

  it('laisse l’image intacte sans dimensions ni mesure', () => {
    const img = el('<img alt="rien" src="a.jpg">');
    reserveImgAspect(img);
    expect(img.outerHTML).toBe('<img alt="rien" src="a.jpg">');
  });

  it('ne touche pas la vignette d’une façade vidéo', () => {
    rememberImageSize('https://i.ytimg.com/vi/x/hqdefault.jpg', 480, 360);
    const img = el('<img class="yt-facade__thumb" src="https://i.ytimg.com/vi/x/hqdefault.jpg">');
    reserveImgAspect(img);
    expect(img.hasAttribute('style')).toBe(false);
  });
});

describe('mémoire des mesures', () => {
  it('rend ce qu’elle a retenu, sous une clé normalisée', () => {
    rememberImageSize('https://ex.com/a.jpg?x=1&amp;y=2', 1200, 800);
    expect(measuredImageSize('https://ex.com/a.jpg?x=1&y=2')).toEqual({ width: 1200, height: 800 });
  });

  it('ignore les mesures dégénérées', () => {
    rememberImageSize('https://ex.com/z.jpg', 0, 400);
    rememberImageSize('https://ex.com/y.jpg', 400, 0);
    expect(measuredImageSize('https://ex.com/z.jpg')).toBeNull();
    expect(measuredImageSize('https://ex.com/y.jpg')).toBeNull();
  });

  it('renvoie null pour ce qu’elle n’a jamais vu', () => {
    expect(measuredImageSize('https://ex.com/inconnue.jpg')).toBeNull();
  });

  // Une session de lecture dure des heures : la carte ne doit pas grandir
  // indéfiniment. La plus ancienne entrée sort quand la limite est atteinte.
  it('reste bornée et évince la plus ancienne', () => {
    for (let i = 0; i < MEASURED_LIMIT + 5; i++) {
      rememberImageSize(`https://ex.com/${i}.jpg`, 100 + i, 50);
    }
    expect(measuredImageSize('https://ex.com/0.jpg')).toBeNull();
    expect(measuredImageSize('https://ex.com/4.jpg')).toBeNull();
    expect(measuredImageSize(`https://ex.com/${MEASURED_LIMIT + 4}.jpg`)).not.toBeNull();
  });

  it('remesurer une URL connue la rafraîchit sans la dupliquer', () => {
    rememberImageSize('https://ex.com/a.jpg', 100, 50);
    rememberImageSize('https://ex.com/a.jpg', 200, 100);
    expect(measuredImageSize('https://ex.com/a.jpg')).toEqual({ width: 200, height: 100 });
  });
});
