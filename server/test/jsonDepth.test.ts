import { describe, it, expect } from 'vitest';
import { jsonTooDeep, MAX_JSON_DEPTH } from '../jsonDepth.js';

// Node 26 sérialise une imbrication que Node 24 refusait aussitôt : une réponse
// de 8 Mo imbriquée sur 4 millions de niveaux bloquait le serveur 4,1 s à la
// réécriture (`JSON.stringify`), contre 4 ms sous Node 24 (mesuré le
// 2026-11-24). La profondeur se mesure sur le texte, avant toute analyse.
describe('jsonTooDeep', () => {
  const nest = (n: number) => '['.repeat(n) + ']'.repeat(n);

  it('accepte une vraie réponse et refuse au-delà de la limite', () => {
    expect(jsonTooDeep('{"items":[{"a":{"b":[1,2,{"c":3}]}}]}')).toBe(false);
    expect(jsonTooDeep(nest(MAX_JSON_DEPTH))).toBe(false);
    expect(jsonTooDeep(nest(MAX_JSON_DEPTH + 1))).toBe(true);
  });

  it('ignore les crochets et accolades dans les chaînes, échappements compris', () => {
    const text = JSON.stringify({ t: '['.repeat(500) + '{'.repeat(500), q: 'a\\"[[[[\\\\', e: '\\' });
    expect(jsonTooDeep(text, 3)).toBe(false);
    expect(jsonTooDeep('{"a":"\\"","b":[[[[1]]]]}', 3)).toBe(true);
  });

  it('lit aussi un Buffer (corps reçu), multi-octets compris', () => {
    expect(jsonTooDeep(Buffer.from('{"é":"[[[[[","x":[1]}', 'utf8'), 2)).toBe(false);
    expect(jsonTooDeep(Buffer.from(nest(70), 'utf8'))).toBe(true);
  });

  it('répond vite sur 8 Mo, et s’arrête dès la limite franchie', () => {
    const flat = '[' + Array(1_600_000).fill('"abc"').join(',') + ']';
    let t = performance.now();
    expect(jsonTooDeep(flat)).toBe(false);
    expect(performance.now() - t).toBeLessThan(500);
    t = performance.now();
    expect(jsonTooDeep(nest(4_000_000))).toBe(true);
    expect(performance.now() - t).toBeLessThan(50);
  });
});
