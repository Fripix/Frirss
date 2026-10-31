import { describe, it, expect } from 'vitest';
import {
  drawIds, inDrawOrder, normalizeRandomAmount, normalizeRandomCount, normalizeRandomUnit,
  randomCutoffUsec, RANDOM_DEFAULT_COUNT, RANDOM_MAX_COUNT,
} from './randomDraw';

describe('paramètres du tirage', () => {
  it.each([undefined, null, 'x', 0, -3, 1.5, 501, NaN, Infinity, true, [5], ''])('nombre illisible %s → défaut', (v) => {
    expect(normalizeRandomCount(v)).toBe(RANDOM_DEFAULT_COUNT);
  });

  it('garde les bornes du nombre', () => {
    expect(normalizeRandomCount(1)).toBe(1);
    expect(normalizeRandomCount(RANDOM_MAX_COUNT)).toBe(RANDOM_MAX_COUNT);
    expect(normalizeRandomCount('35')).toBe(35);
  });

  it.each([undefined, 'x', -1, 2.5, NaN, Infinity, true, [5]])('ancienneté illisible %s → tous', (v) => {
    expect(normalizeRandomAmount(v)).toBe(0);
  });

  it('garde une ancienneté entière', () => {
    expect(normalizeRandomAmount(48)).toBe(48);
    expect(normalizeRandomAmount(0)).toBe(0);
  });

  it('une unité inconnue revient aux heures', () => {
    expect(normalizeRandomUnit('days')).toBe('days');
    expect(normalizeRandomUnit('weeks')).toBe('hours');
  });
});

describe('seuil d’ancienneté', () => {
  const now = Date.UTC(2026, 9, 31);

  it('rien sans ancienneté', () => {
    expect(randomCutoffUsec(0, 'hours', now)).toBeNull();
  });

  it('un jour vaut 24 heures, en microsecondes', () => {
    expect(randomCutoffUsec(1, 'days', now)).toBe(randomCutoffUsec(24, 'hours', now));
    expect(randomCutoffUsec(1, 'hours', now)).toBe(BigInt(now - 3600_000) * 1000n);
  });
});

describe('tirage', () => {
  const ids = Array.from({ length: 200 }, (_, i) => String(i));

  it('rend le nombre demandé, sans doublon, pris dans la vue', () => {
    const drawn = drawIds(ids, 20);
    expect(drawn).toHaveLength(20);
    expect(new Set(drawn).size).toBe(20);
    expect(drawn.every((id) => ids.includes(id))).toBe(true);
  });

  it('une vue plus petite que le nombre est rendue entière et mélangée', () => {
    const rng = () => 0;
    const drawn = drawIds(['a', 'b', 'c'], 20, rng);
    expect([...drawn].sort()).toEqual(['a', 'b', 'c']);
    expect(drawn).not.toEqual(['a', 'b', 'c']);
  });

  it('une vue vide rend une liste vide', () => {
    expect(drawIds([], 20)).toEqual([]);
  });

  it('suit le générateur, et ne touche pas à la liste reçue', () => {
    const copy = [...ids];
    const seq = () => { let n = 0.1; return () => { n = (n * 7.3) % 1; return n; }; };
    expect(drawIds(ids, 5, seq())).toEqual(drawIds(ids, 5, seq()));
    expect(ids).toEqual(copy);
  });
});

describe('remise dans l’ordre du tirage', () => {
  // Les identifiants du relevé sont décimaux, ceux des articles en `tag:…/hex`.
  const tag = (n: bigint) => `tag:google.com,2005:reader/item/${n.toString(16).padStart(16, '0')}`;

  it('suit le tirage malgré les deux formes d’identifiant', () => {
    const a = 1730000000000001n;
    const b = 1730000000000002n;
    const c = 1730000000000003n;
    const items = [{ id: tag(c) }, { id: tag(b) }, { id: tag(a) }];
    expect(inDrawOrder(items, [b, c, a].map(String)).map((i) => i.id)).toEqual([tag(b), tag(c), tag(a)]);
  });

  it('ignore un identifiant sans article', () => {
    const items = [{ id: tag(1730000000000001n) }];
    expect(inDrawOrder(items, ['1730000000000009', '1730000000000001'])).toEqual(items);
  });
});
