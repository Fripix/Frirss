import { describe, it, expect } from 'vitest';
import { ROW_SLICE, mountedRows, nextRowLimit } from './listWindow';

describe('mountedRows', () => {
  const base = { limit: ROW_SLICE, total: 400, selectedIndex: -1, searching: false };

  it('une longue liste ne monte que sa tranche', () => {
    expect(mountedRows(base)).toBe(50);
  });

  it('une liste plus courte que la tranche se monte entière', () => {
    expect(mountedRows({ ...base, total: 12 })).toBe(12);
  });

  it('l’article ouvert est toujours monté, même au-delà de la tranche', () => {
    expect(mountedRows({ ...base, selectedIndex: 120 })).toBe(121);
  });

  it('une ligne déjà montée le reste', () => {
    expect(mountedRows({ ...base, limit: 150, selectedIndex: 3 })).toBe(150);
  });

  // La recherche pagine déjà elle-même `articles` (`searchVisible`).
  it('pendant une recherche, tout est monté', () => {
    expect(mountedRows({ ...base, searching: true })).toBe(400);
  });
});

describe('nextRowLimit', () => {
  it('ajoute une tranche', () => {
    expect(nextRowLimit(50)).toBe(100);
  });
});
