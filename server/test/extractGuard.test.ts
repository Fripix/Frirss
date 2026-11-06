import { describe, it, expect } from 'vitest';
import {
  extractArticle, extractInWorker, EXTRACT_MAX_DEPTH, EXTRACT_MAX_ELEMENTS, ExtractTimeoutError, PageTooComplexError,
} from '../extract.js';

// ── M-01 (campagne 1.9.0, second round) ──────────────────────────────
// Une page de `<div>` imbriqués sur 1000 niveaux (23 Ko) immobilisait la boucle
// Node 17,8 s — `/api/health` muet, tous les comptes figés —, et 5000 niveaux
// plus de quatre minutes. Le coût de linkedom + Readability croît comme le
// cube de la profondeur : c'est la FORME qui coûte, pas la taille.

/** `depth` `<div>` imbriqués autour d'un texte court (sous le seuil de Readability). */
const nested = (depth: number) => `<html><body>${'<div>'.repeat(depth)}<p>court</p>${'</div>'.repeat(depth)}</body></html>`;

/**
 * Coûteuse mais SOUS les seuils : 40 chaînes de 200 niveaux côte à côte, soit
 * ~2 s d'analyse sur un poste de développement. Le refus rapide ne la voit
 * pas ; seul le worker et son délai la bornent.
 */
const wideAndDeep = () => {
  const chain = `${'<div>'.repeat(200)}<p>court</p>${'</div>'.repeat(200)}`;
  return `<html><body>${chain.repeat(40)}</body></html>`;
};

const article = `<!doctype html><html><head><title>Titre de la page</title></head>
<body><article><h1>Un vrai titre</h1>
<p>Un premier paragraphe suffisamment long pour que Readability le retienne comme corps de l'article, avec assez de mots pour dépasser son seuil.</p>
<p>Un second paragraphe, lui aussi assez fourni pour peser dans la balance du score de lisibilité calculé par Readability.</p>
</article></body></html>`;

describe('extractArticle — refus rapide d’une page trop complexe', () => {
  it('refuse vite une page imbriquée sur 1000 niveaux, avant toute passe Readability', () => {
    const started = performance.now();
    expect(() => extractArticle('https://example.com/piege', nested(1000))).toThrow(PageTooComplexError);
    expect(performance.now() - started).toBeLessThan(1000);
  });

  // Relecture 1.9.0 (R1-3) : le refus se mesurait APRÈS `parseHTML`, lui-même
  // quadratique en profondeur — 390 000 `<div>` jamais fermés (2 Mo) coûtaient
  // 42 s avant le refus, 50 000 niveaux 1,2 s.
  it('refuse sans même l’analyser une page de 390 000 `<div>` jamais fermés, et 50 000 niveaux', () => {
    const started = performance.now();
    const unclosed = `<html><body>${'<div>'.repeat(390_000)}</body></html>`;
    expect(() => extractArticle('https://example.com/piege', unclosed)).toThrow(PageTooComplexError);
    expect(() => extractArticle('https://example.com/piege', nested(50_000))).toThrow(PageTooComplexError);
    expect(performance.now() - started).toBeLessThan(300);
  });

  it('refuse une page qui dépasse le nombre d’éléments, même plate', () => {
    const flat = `<html><body>${'<b>x</b>'.repeat(EXTRACT_MAX_ELEMENTS + 10)}</body></html>`;
    expect(() => extractArticle('https://example.com/plate', flat)).toThrow(PageTooComplexError);
  });

  it('accepte une page exactement à la profondeur maximale', () => {
    // `<html>` et `<body>` comptent : le texte est au niveau EXTRACT_MAX_DEPTH.
    expect(() => extractArticle('https://example.com/limite', nested(EXTRACT_MAX_DEPTH - 3))).not.toThrow();
  });
});

describe('extractInWorker — l’analyse hors de la boucle principale', () => {
  it('rend l’article extrait par le worker', async () => {
    const out = await extractInWorker('https://example.com/a', article);
    expect(out?.content).toContain('premier paragraphe');
    expect(out?.title).toBe('Titre de la page');
  });

  it('rend « pas d’article » comme la fonction directe', async () => {
    await expect(extractInWorker('https://example.com/vide', '<html><body></body></html>')).resolves.toBeNull();
  });

  it('rend le refus rapide du worker sous sa forme typée', async () => {
    const err = await extractInWorker('https://example.com/piege', nested(1000)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PageTooComplexError);
    expect((err as PageTooComplexError).reason).toBe('depth');
  });

  it('pendant une analyse piégée, la boucle principale continue de tourner et le délai l’arrête', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 10);
    const started = performance.now();
    try {
      const err = await extractInWorker('https://example.com/large', wideAndDeep(), 1500).catch((e: unknown) => e);
      const elapsed = performance.now() - started;
      // Un délai n'est pas une page piégée (relecture 1.9.0) : un serveur
      // chargé peut le dépasser sur une page ordinaire.
      expect(err).toBeInstanceOf(ExtractTimeoutError);
      // Le délai tient, démarrage du worker compris : bien avant les ~2 s
      // d'analyse, et sans attendre qu'elle finisse.
      expect(elapsed).toBeLessThan(2500);
      // ~150 tours possibles en 1,5 s, dont plus d'une seconde d'analyse réelle
      // dans le worker. Une analyse sur la boucle principale n'en laisserait
      // passer aucun.
      expect(ticks).toBeGreaterThan(60);
    } finally {
      clearInterval(timer);
    }
  });
});
