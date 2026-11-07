// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeHtml, sanitizeArticleBody } from './sanitizeHtml';

describe('sanitizeHtml', () => {
  it('removes <script> tags', () => {
    expect(sanitizeHtml('<p>ok</p><script>alert(1)</script>')).not.toContain('<script');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeHtml('<img src="x" onerror="alert(1)">');
    expect(out).not.toMatch(/onerror/i);
  });

  it('drops javascript: URLs', () => {
    const out = sanitizeHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toMatch(/javascript:/i);
  });

  it('keeps safe markup and links', () => {
    const out = sanitizeHtml('<a href="https://example.com">link</a><strong>b</strong>');
    expect(out).toContain('href="https://example.com"');
    expect(out).toContain('<strong>');
  });

  it('hardens target=_blank links with rel', () => {
    const out = sanitizeHtml('<a href="https://example.com" target="_blank">x</a>');
    expect(out).toMatch(/rel="noopener noreferrer"/);
  });

  it('returns empty string for falsy input', () => {
    expect(sanitizeHtml('')).toBe('');
    expect(sanitizeHtml(null)).toBe('');
  });
});

// La passe « corps d'article » ne fait qu'AJOUTER `dir` / `loading` : elle ne
// retire ni ne repose jamais un attribut existant. DOMPurify garde des noms
// `data-*` que le parseur HTML accepte mais que la vérification de nom XML
// refuse (`data-a;b`) ; les reposer levait `InvalidCharacterError` sur les
// moteurs à l'ancienne règle, et l'exception remontait jusqu'à la seule
// frontière d'erreur de l'application : un article de flux la faisait tomber.
// `data-floating-surface` est le marqueur des surfaces flottantes de l'app :
// tant qu'un élément le porte, les raccourcis clavier sont coupés. Venu du
// corps d'un article, il les couperait tant que l'article reste ouvert.
describe('marqueur de surface flottante', () => {
  const html = '<div data-floating-surface data-keep="1">pub</div>';
  it('sanitizeHtml le retire et garde les autres data-*', () => {
    const out = sanitizeHtml(html);
    expect(out).not.toContain('data-floating-surface');
    expect(out).toContain('data-keep="1"');
  });
  it('sanitizeArticleBody le retire aussi', () => {
    const out = sanitizeArticleBody(html, Infinity);
    expect(out).not.toContain('data-floating-surface');
    expect(out).toContain('data-keep="1"');
  });
});

describe('sanitizeArticleBody', () => {
  // `data-a×b` : DOMPurify le garde (sa règle `data-*` admet U+00D7), le
  // parseur HTML aussi, mais `×` n'est pas un caractère de nom XML.
  // `data-a;b` : DOMPurify 3.4.13 l'écarte lui-même ; il ne doit pas lever.
  it.each(['data-a×b', 'data-a;b'])('never throws on an attribute named %s', (name) => {
    expect(() => sanitizeArticleBody(`<p ${name}="1">x</p>`, 2)).not.toThrow();
    expect(() => sanitizeArticleBody(`<img src="1.jpg"><img src="2.jpg"><img ${name}="1" src="3.jpg">`, 2)).not.toThrow();
  });

  it('keeps an attribute with an XML-invalid name on a block, and adds dir', () => {
    const out = sanitizeArticleBody('<p data-a×b="1">x</p>', 2);
    const p = new DOMParser().parseFromString(out, 'text/html').querySelector('p')!;
    expect(p.getAttribute('data-a×b')).toBe('1');
    expect(p.getAttribute('dir')).toBe('auto');
  });

  it('keeps an attribute with an XML-invalid name on a lazy image', () => {
    const out = sanitizeArticleBody('<img src="1.jpg"><img src="2.jpg"><img data-a×b="1" src="3.jpg">', 2);
    const img = new DOMParser().parseFromString(out, 'text/html').querySelectorAll('img')[2];
    expect(img.getAttribute('data-a×b')).toBe('1');
    expect(img.getAttribute('loading')).toBe('lazy');
  });

  it('appends the attribute after the existing ones', () => {
    expect(sanitizeArticleBody('<p class="c">x</p>', 2)).toBe('<p class="c" dir="auto">x</p>');
    expect(sanitizeArticleBody('<img src="1.jpg"><img src="2.jpg"><img src="3.jpg" alt="">', 2))
      .toBe('<img src="1.jpg"><img src="2.jpg"><img src="3.jpg" alt="" loading="lazy">');
  });

  it('overrides loading="eager" to lazy past the eager images, in place', () => {
    expect(sanitizeArticleBody('<img src="1.jpg"><img src="2.jpg"><img loading="eager" src="3.jpg">', 2))
      .toBe('<img src="1.jpg"><img src="2.jpg"><img loading="lazy" src="3.jpg">');
  });
});

// Le fantôme de balayage (`ReadingPane`) passe par la même passe sur l'arbre :
// format réservé et paragraphes vides retirés, mais sans chargement différé
// ni `dir` — ce qu'il faisait déjà quand c'étaient des motifs.
describe('sanitizeArticleBody — fantôme de balayage', () => {
  const ghost = (html: string) => sanitizeArticleBody(html, Infinity, { blockDir: false });

  it('reserves the aspect, drops empty paragraphs, and adds nothing else', () => {
    expect(ghost('<p> </p><img src="1.jpg" width="4" height="3"><img src="2.jpg"><img src="3.jpg"><p>x</p>'))
      .toBe('<img src="1.jpg" width="4" height="3" style="aspect-ratio:4/3"><img src="2.jpg"><img src="3.jpg"><p>x</p>');
  });

  it('never touches the inside of an attribute value', () => {
    const out = ghost('<p><a title="<img width=1 height=1 onmouseover=alert(1) x" href="https://example.com/">t</a></p><p><img alt="<p" src="https://example.com/a.jpg">  </p><p>keep me</p>');
    const doc = new DOMParser().parseFromString(out, 'text/html');
    expect([...doc.querySelector('a')!.attributes].map((x) => x.name).sort()).toEqual(['href', 'rel', 'target', 'title']);
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('https://example.com/a.jpg');
    expect([...doc.querySelectorAll('p')].map((p) => p.textContent)).toContain('keep me');
  });
});

describe('sanitizeArticleBody — liens (issue #24)', () => {
  it('ouvre chaque lien du corps dans un nouvel onglet, durci contre le reverse-tabnabbing', () => {
    const out = sanitizeArticleBody('<p><a href="https://example.com/x">lien</a></p>', 0);
    expect(out).toContain('target="_blank"');
    expect(out).toContain('rel="noopener noreferrer"');
  });
  it('laisse une ancre interne naviguer dans la page', () => {
    const out = sanitizeArticleBody('<p><a href="#notes">notes</a></p>', 0);
    expect(out).not.toContain('target=');
  });
  it('ne touche pas aux liens hors corps d\'article', () => {
    const out = sanitizeHtml('<a href="https://example.com">x</a>');
    expect(out).not.toContain('target=');
  });
});

// M-11 (second round) : un tableau large était coupé à droite, sans défilement
// (`table { width: 100% }`, sans enveloppe). Le corps l'enveloppe d'un bloc qui
// défile de côté.
describe('sanitizeArticleBody — tableaux larges (M-11)', () => {
  const wrap = (html: string) => {
    const div = document.createElement('div');
    div.innerHTML = sanitizeArticleBody(html, 2);
    return div;
  };

  it('enveloppe chaque tableau d’un bloc qui défile de côté', () => {
    const div = wrap('<p>a</p><table><tr><td>1</td></tr></table><table><tr><td>2</td></tr></table>');
    const tables = div.querySelectorAll('table');
    expect(tables).toHaveLength(2);
    for (const t of tables) expect(t.parentElement?.className).toBe('article-scroll-x');
  });

  it('un tableau dans un tableau n’est pas enveloppé une seconde fois', () => {
    const div = wrap('<table><tr><td><table><tr><td>x</td></tr></table></td></tr></table>');
    expect(div.querySelectorAll('.article-scroll-x')).toHaveLength(1);
    expect(div.querySelector('td table')?.parentElement?.tagName).toBe('TD');
  });

  it('hors corps d’article, rien n’est enveloppé', () => {
    expect(sanitizeHtml('<table><tr><td>1</td></tr></table>')).not.toContain('article-scroll-x');
  });
});

// REG-248 : le blog de GitHub (WordPress) écrit `sizes="auto, (max-width: 1000px)
// 100vw, 1000px"`. Avec `loading="lazy"`, `auto` fait choisir la variante du
// `srcset` d'après la largeur de l'image AVANT son chargement — 300 px par
// défaut, puisque le volet la laisse en `width: auto` — et l'image restait
// affichée à 300 px (`?w=300`) au lieu de la largeur du volet.
describe('sanitizeArticleBody — `sizes="auto"` (REG-248)', () => {
  const imgs = (html: string, eager = 0) => {
    const div = document.createElement('div');
    div.innerHTML = sanitizeArticleBody(html, eager);
    return Array.from(div.querySelectorAll('img, source'));
  };
  const srcset = 'https://example.com/c.png?w=300 300w, https://example.com/c.png?w=1024 1024w, https://example.com/c.png?w=1600 1600w';

  it('retire `auto` en tête de `sizes`, le reste de la liste demeure (blog de GitHub, Frandroid)', () => {
    const [img] = imgs(`<img src="https://example.com/c.png?resize=1024%2C483" width="1024" height="483" loading="lazy" srcset="${srcset}" sizes="auto, (max-width: 1000px) 100vw, 1000px">`);
    expect(img.getAttribute('sizes')).toBe('(max-width: 1000px) 100vw, 1000px');
    expect(img.getAttribute('srcset')).toBe(srcset);
    expect(img.getAttribute('loading')).toBe('lazy');
    const [frandroid] = imgs(`<img src="https://example.com/f.jpg" srcset="${srcset}" sizes="AUTO ,(max-width: 1200px) 100vw, 1200px">`);
    expect(frandroid.getAttribute('sizes')).toBe('(max-width: 1200px) 100vw, 1200px');
  });

  it('`sizes="auto"` seul devient la largeur de l’écran ; une `<source>` de `<picture>` aussi', () => {
    const [alone] = imgs(`<img src="https://example.com/c.png" srcset="${srcset}" sizes="auto">`);
    expect(alone.getAttribute('sizes')).toBe('100vw');
    const [source, img] = imgs(`<picture><source type="image/webp" srcset="${srcset}" sizes="auto, 100vw"><img src="https://example.com/c.png" srcset="${srcset}" sizes=" auto "></picture>`);
    expect(source.tagName).toBe('SOURCE');
    expect(source.getAttribute('sizes')).toBe('100vw');
    expect(img.getAttribute('sizes')).toBe('100vw');
  });

  it('une petite image garde son `sizes` (avatar à 34 px, vignette à 100 px) ; une liste sans `auto` est intacte', () => {
    const cases = ['34px', '100px', '(max-width: 768px) 100vw, 700px', '(min-width: 1728px) 1728px, 100vw', '100vw, (min-width: 640px) calc(100vw - 2rem)'];
    for (const sizes of cases) {
      const [img] = imgs(`<img src="https://example.com/a.jpg" srcset="${srcset}" sizes="${sizes}" width="34" height="34">`);
      expect(img.getAttribute('sizes'), sizes).toBe(sizes);
    }
  });

  it('`auto` ailleurs qu’en tête n’est pas touché ; une image sans `sizes` n’en reçoit pas', () => {
    const [late] = imgs(`<img src="https://example.com/a.jpg" srcset="${srcset}" sizes="(max-width: 600px) 100vw, auto">`);
    expect(late.getAttribute('sizes')).toBe('(max-width: 600px) 100vw, auto');
    const [none] = imgs(`<img src="https://example.com/a.jpg" srcset="${srcset}">`);
    expect(none.hasAttribute('sizes')).toBe(false);
  });

  it('hors corps d’article, `sizes` reste tel quel', () => {
    expect(sanitizeHtml(`<img src="https://example.com/a.jpg" srcset="${srcset}" sizes="auto, 100vw">`)).toContain('sizes="auto, 100vw"');
  });
});
