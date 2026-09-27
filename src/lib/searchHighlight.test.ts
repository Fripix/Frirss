import { describe, it, expect } from 'vitest';
import { highlight, snippet, resultSummary } from './searchHighlight';

describe('highlight', () => {
  it('rend le texte en un seul segment quand il n’y a pas de terme', () => {
    expect(highlight('Docker en 2026', [])).toEqual([{ text: 'Docker en 2026', hit: false }]);
  });

  it('marque le terme sans tenir compte de la casse', () => {
    expect(highlight('Docker en 2026', ['docker'])).toEqual([
      { text: 'Docker', hit: true },
      { text: ' en 2026', hit: false },
    ]);
  });

  it('trouve un mot accentué cherché sans accent, et rend le texte d’origine', () => {
    // La recherche compare sur du texte déplié (`normalizeForSearch`) : le
    // surlignage doit revenir aux positions du texte ORIGINAL, sinon « é »
    // décalerait tout ce qui suit.
    const segments = highlight('Une élection anticipée', ['election']);
    expect(segments).toEqual([
      { text: 'Une ', hit: false },
      { text: 'élection', hit: true },
      { text: ' anticipée', hit: false },
    ]);
  });

  it('marque chaque occurrence de chaque terme, sans jamais perdre de texte', () => {
    const texte = 'Docker et Podman, puis docker encore';
    const segments = highlight(texte, ['docker', 'podman']);
    expect(segments.map((s) => s.text).join('')).toBe(texte);
    expect(segments.filter((s) => s.hit).map((s) => s.text)).toEqual(['Docker', 'Podman', 'docker']);
  });

  it('fond deux termes qui se chevauchent en une seule marque', () => {
    const segments = highlight('autohébergement', ['auto', 'autoheberge']);
    expect(segments).toEqual([
      { text: 'autohéberge', hit: true },
      { text: 'ment', hit: false },
    ]);
  });
});

describe('snippet', () => {
  it('découpe autour de la première correspondance, entre ellipses', () => {
    const texte = `${'a'.repeat(200)} kubernetes ${'b'.repeat(200)}`;
    const extrait = snippet(texte, ['kubernetes']);
    expect(extrait).toMatch(/^…a* kubernetes b+…$/);
    expect(extrait!.length).toBeLessThan(texte.length);
  });

  /**
   * La ligne d'article coupe le résumé à DEUX lignes (`line-clamp-2`), soit
   * ~90 caractères dans un panneau de liste ordinaire. Un extrait qui centre
   * la correspondance la pousse au-delà : mesuré sur l'instance de dev le
   * 2026-09-27, 29 extraits sur 34 avaient leur terme surligné hors du cadre
   * visible — la ligne restait donc inexpliquée, ce que l'extrait devait
   * justement corriger. Le terme doit tomber dans la PREMIÈRE ligne.
   */
  it('place la correspondance dans les premiers caractères, pas au milieu', () => {
    const texte = `${'a'.repeat(400)} kubernetes ${'b'.repeat(400)}`;
    const extrait = snippet(texte, ['kubernetes'])!;
    expect(extrait.indexOf('kubernetes')).toBeLessThanOrEqual(25);
  });

  it('garde du contexte APRÈS la correspondance', () => {
    const texte = `${'a'.repeat(400)} kubernetes ${'b'.repeat(400)}`;
    const extrait = snippet(texte, ['kubernetes'])!;
    const après = extrait.slice(extrait.indexOf('kubernetes') + 'kubernetes'.length).replace(/…$/, '');
    expect(après.trim().length).toBeGreaterThan(100);
  });

  it('ne met pas d’ellipse de tête quand la correspondance ouvre le texte', () => {
    expect(snippet('kubernetes partout', ['kubernetes'])).toBe('kubernetes partout');
  });

  it('rend null quand aucun terme n’est présent', () => {
    expect(snippet('rien à voir ici', ['kubernetes'])).toBeNull();
  });
});

describe('resultSummary', () => {
  const terms = ['docker'];

  it('garde le résumé quand il porte déjà le terme', () => {
    const article = { summary: 'Un guide Docker pas à pas', content: '<p>peu importe</p>' };
    expect(resultSummary(article, terms)).toBe('Un guide Docker pas à pas');
  });

  it('montre un extrait du corps quand le résumé ne dit pas pourquoi la ligne est là', () => {
    const article = {
      summary: 'Retour d’expérience sur mon serveur maison',
      content: `<p>${'x'.repeat(120)} tout tourne sous docker compose ${'y'.repeat(120)}</p>`,
    };
    const rendu = resultSummary(article, terms);
    expect(rendu).toContain('docker compose');
    expect(rendu).not.toContain('<p>');
    expect(rendu).not.toBe(article.summary);
  });

  it('retombe sur le résumé quand rien ne correspond nulle part', () => {
    const article = { summary: 'Retour d’expérience', content: '<p>rien de pertinent</p>' };
    expect(resultSummary(article, terms)).toBe('Retour d’expérience');
  });

  it('rend le résumé tel quel hors recherche', () => {
    const article = { summary: 'Retour d’expérience', content: '<p>docker</p>' };
    expect(resultSummary(article, [])).toBe('Retour d’expérience');
  });
});
