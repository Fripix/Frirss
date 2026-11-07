/**
 * Les cas de la garde de non-perte « la page vérifie Readability » (REG-229 à
 * REG-233), écrits une fois pour la route serveur (`server/extract.ts`) et le
 * repli du navigateur (`src/utils/extractContent.ts`), dont la garde est une
 * copie : `defineContainerGuardCases` les déclare avec les fonctions de l'un
 * ou de l'autre. Un même cas, un même titre, dans les deux fichiers de tests.
 */
import { describe, it, expect } from 'vitest';
import { Readability } from '@mozilla/readability';
import {
  asideInFlowPageHtml, cardsBelowPageHtml, commentsAfterPageHtml, commentsInsidePageHtml, DESCRIBED_TITLE,
  descriptionIsTitlePageHtml, dossierPageHtml, listPageHtml, newsLedePageHtml, relatedCardsPageHtml,
} from './containerPageFixtures';
import { headerPageHtml, ledePageHtml } from './guardPageFixtures';
import { advisoryPageHtml } from './advisoryPageFixture';
import { embeddedTweetsPageHtml } from './embedConsentFixture';
import { blogPageHtml, newsPageHtml, pressPageHtml, shortPostPageHtml } from './boilerplatePageFixtures';
import { splitBodyAcrossEmbedPageHtml, splitBodyAcrossHeadingsPageHtml, splitBodyAcrossImagesPageHtml, splitBodyPageHtml, splitBodyWithBioPageHtml } from './splitBodyPageFixtures';
import { repeatLedePageHtml, repeatLightboxPageHtml } from './repeatPageFixtures';

interface Extracted { title: string; content: string }
export interface GuardApi {
  /** Préfixe des titres (« repli local — » pour le navigateur). */
  prefix: string;
  extractArticle: (url: string, html: string) => Extracted | null;
  extractWithoutGuard: (url: string, html: string) => Extracted | null;
  guardForTests: (input: { page: string; result: string; title?: string; base?: string }) => { content: string };
  /** Un document lu par l'analyseur de ce côté (linkedom, DOMParser). */
  parse: (html: string) => Document;
}

export function defineContainerGuardCases(api: GuardApi): void {
  const { prefix, extractArticle, extractWithoutGuard, guardForTests, parse } = api;
  const norm = (s: string | null | undefined) => (s || '').replace(/\s+/g, ' ').trim();
  const textOf = (html: string) => norm(parse(`<!doctype html><html><body>${html}</body></html>`).body.textContent);
  const all = (html: string, selector: string) => Array.from(parse(html).querySelectorAll(selector)) as Element[];
  const occurrences = (text: string, needle: string) => text.split(needle).length - 1;
  const url = 'https://example.com/page';

  /** Passes Readability faites pendant `run`. */
  const countPasses = (run: () => void) => {
    const proto = Readability.prototype as unknown as { parse: (...args: unknown[]) => unknown };
    const original = proto.parse;
    let passes = 0;
    proto.parse = function (this: unknown, ...args: unknown[]) { passes++; return original.apply(this, args); };
    try { run(); } finally { proto.parse = original; }
    return passes;
  };

  /** Les blocs de texte de `html` (paragraphes, entrées, intertitres) d'au moins `min` caractères. */
  const blocks = (html: string, selector: string, min = 40) => all(html, selector).map((el) => norm(el.textContent)).filter((t) => t.length >= min);

  /** `found` dans l'ordre : chaque texte après le précédent. */
  const inOrder = (text: string, found: string[]) => {
    let from = -1;
    for (const t of found) {
      const at = text.indexOf(t, from + 1);
      if (at <= from) return t;
      from = at;
    }
    return null;
  };

  describe(`${prefix}extractArticle — la page vérifie Readability : pages réelles (REG-229 à REG-233)`, () => {
    it('ramène l’article quand Readability a lu les cartes « articles liés », et garde les cartes (structure Docker, REG-229)', () => {
      const html = relatedCardsPageHtml();
      const strictHtml = extractWithoutGuard(url, html)!.content;
      const strict = textOf(strictHtml);
      // Le défaut : sans la garde, le corps de l'article est perdu ; Readability rend les cartes.
      const lost = blocks(html, 'article p', 60).filter((t) => !strict.includes(t));
      expect(lost.length).toBeGreaterThan(10);
      const text = textOf(extractArticle(url, html)!.content);
      for (const t of lost) expect(text, t).toContain(t);
      expect(inOrder(text, lost)).toBeNull();
      // Rien n'est retiré : ce que lisait Readability reste, après le corps retrouvé.
      const kept = blocks(strictHtml, 'p, h2, h3, li', 30);
      expect(kept.length).toBeGreaterThan(3);
      for (const t of kept) {
        expect(text, t).toContain(t);
        expect(text.lastIndexOf(t), t).toBeGreaterThan(text.indexOf(lost[0]));
      }
    });

    it('remet la suite d’un dossier coupé en blocs cousins, dans l’ordre (structure Clubic, REG-231)', () => {
      const html = dossierPageHtml();
      const body = blocks(html, 'div.slate-content p', 60);
      expect(body.length).toBeGreaterThan(8);
      const strict = textOf(extractWithoutGuard(url, html)!.content);
      expect(body.filter((t) => !strict.includes(t)).length).toBeGreaterThan(4);
      const text = textOf(extractArticle(url, html)!.content);
      for (const t of body) expect(text, t).toContain(t);
      expect(inOrder(text, body)).toBeNull();
      for (const t of body) expect(occurrences(text, t), t).toBe(1);
    });

    it('remet le chapeau et l’image d’en-tête, sans doubler le titre coupé ni ramasser les « publications » qui suivent (structure Les Numériques, REG-230)', () => {
      const html = newsLedePageHtml();
      const dek = norm(all(html, 'section.ed__p-artc__hdr p')[0]?.textContent);
      const hero = all(html, 'section.ed__p-artc__hdr img')[0]?.getAttribute('src');
      expect(dek.length).toBeGreaterThan(80);
      const strictOut = extractWithoutGuard(url, html)!;
      expect(textOf(strictOut.content)).not.toContain(dek);
      const out = extractArticle(url, html)!;
      const text = textOf(out.content);
      expect(occurrences(text, dek)).toBe(1);
      expect(out.content).toContain(`https://example.com${hero}`);
      // Le chapeau ouvre l'article, avant le corps.
      const body = blocks(html, 'div.ed__p-artc__ctnt > p, article p', 120).filter((t) => t !== dek);
      expect(text.indexOf(dek)).toBeLessThan(text.indexOf(body[0]));
      // Le titre, coupé dans `<title>`, n'est pas remis : le lecteur l'affiche à part.
      const h1 = norm(all(html, 'h1')[0]?.textContent);
      expect(occurrences(text, h1)).toBe(occurrences(textOf(strictOut.content), h1));
      // Ce qui suit le corps, dans un autre gabarit, ne revient pas.
      for (const after of blocks(html, '.ed__p-artc__rltd h3, .ed__p-artc__rltd p', 30)) expect(text).not.toContain(after);
    });

    it('lit un encadré dans le fil du texte, pas une colonne de côté (blog de GitHub, REG-232)', () => {
      const text = textOf(extractArticle(url, asideInFlowPageHtml())!.content);
      for (const n of ['Première', 'Deuxième', 'Troisième']) expect(text).toContain(`${n} définition de l’encadré`);
      expect(text.indexOf('Première définition')).toBeGreaterThan(text.indexOf('Avant l’encadré 3'));
      expect(text.indexOf('Troisième définition')).toBeLessThan(text.indexOf('Après l’encadré 1'));
      expect(text).not.toContain('Un billet populaire de la colonne');
      expect(text).not.toContain('Le slogan de la colonne de côté');
    });

    it('lit une vidéo paresseuse : sa `<source>` prend l’adresse de `data-src` (blog de DeepMind, REG-233)', () => {
      const out = extractArticle(url, cardsBelowPageHtml())!.content;
      const source = all(out, 'video source')[0];
      expect(source?.getAttribute('src')).toBe('https://example.com/media/demo.mp4');
    });
  });

  describe(`${prefix}garde de non-perte — formes qui pourraient casser (REG-229)`, () => {
    const s = (word: string) => `${word} : une phrase inventée assez longue pour être suivie par la garde de non-perte.`;
    const page = (inner: string, outside = '', head = '') => `<!doctype html><html><head><title>T</title>${head}</head><body>${outside}<main><article>${inner}</article></main></body></html>`;
    const result = (inner: string) => `<div id="readability-page-1" class="page">${inner}</div>`;
    const p = (word: string) => `<p>${s(word)}</p>`;
    const body = ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'].map((n) => p(`Corps ${n}`)).join('');
    const guarded = (inner: string, kept: string, outside = '', head = '') => textOf(guardForTests({ page: page(inner, outside, head), result: result(kept) }).content);

    it('une page de liste (des `<article>` qui font l’essentiel du `<main>`) n’a pas de conteneur : rien n’est remis', () => {
      const html = listPageHtml();
      const card = all(html, 'article')[2].outerHTML;
      expect(textOf(guardForTests({ page: html, result: result(card) }).content)).toBe(textOf(result(card)));
    });

    it('quelques cartes en `<article>` sous le corps (DeepMind) ne font pas une page de liste : le chapeau du `<main>` est remis', () => {
      const html = cardsBelowPageHtml();
      const sections = all(html, 'section.rich-text').map((el) => el.outerHTML).join('');
      const text = textOf(guardForTests({ page: html, result: result(sections) }).content);
      expect(text).toContain('Le chapeau du billet');
      expect(text.indexOf('Le chapeau du billet')).toBeLessThan(text.indexOf('Premier temps du corps 1'));
      // Les cartes, faites de liens et après le corps, ne reviennent pas.
      expect(text).not.toContain('Autre billet inventé');
    });

    it('un billet court ne ramasse pas la colonne voisine, hors du conteneur (Simon Willison, REG-172), mais garde sa propre fin', () => {
      const post = '<p>Un billet très court, inventé pour la mesure.</p>';
      const text = guarded(`${post}${p('Rubrique du billet')}`, post, `<div id="secondary">${p('Colonne voisine')}</div>`);
      expect(text).toContain(s('Rubrique du billet'));
      expect(text).not.toContain('Colonne voisine');
      // La vraie page : la colonne voisine reste dehors.
      expect(textOf(extractArticle(url, shortPostPageHtml())!.content)).toBe(textOf(extractWithoutGuard(url, shortPostPageHtml())!.content));
    });

    it('ce qui suit le corps dans un autre gabarit ne revient pas : notice de l’auteur, compteur de commentaires (Ars Technica)', () => {
      const text = guarded(`<header>${p('Chapeau')}</header><div class="corps">${body}</div><div class="notice">${p('Notice de l’auteur')}</div><a class="commentaires" href="/x">${s('22 commentaires')}</a>`, body);
      expect(text).toContain(s('Chapeau'));
      expect(text.indexOf(s('Chapeau'))).toBeLessThan(text.indexOf(s('Corps un')));
      expect(text).not.toContain('Notice de l’auteur');
      expect(text).not.toContain('22 commentaires');
      // La vraie page : ni notice ni compteur, le chapeau et la légende remis.
      const html = headerPageHtml();
      const real = textOf(extractArticle(url, html)!.content);
      expect(real).not.toContain(norm(all(html, '.author-mini-bio')[0]?.textContent).slice(-60));
      expect(real).not.toContain(norm(all(html, 'a.view-comments')[1]?.textContent));
    });

    it('les commentaires du conteneur ne reviennent jamais, même après un résultat court qui fait remettre toute la suite', () => {
      const html = commentsInsidePageHtml();
      const first = all(html, 'div.entry p').slice(0, 1).map((el) => el.outerHTML).join('');
      const text = textOf(guardForTests({ page: html, result: result(first) }).content);
      for (let n = 2; n <= 6; n++) expect(text).toContain(`Corps du billet commenté ${n}`);
      expect(text).not.toContain('Le commentaire du lecteur');
      expect(text).not.toContain('Douze commentaires');
      expect(text).not.toContain('Lecteur 1');
    });

    it('remonter au titre ne ramasse pas ce qui suit l’article dans l’ancêtre : vidéos, commentaires (structure Clubic)', () => {
      const text = textOf(extractArticle(url, commentsAfterPageHtml())!.content);
      expect(text).toContain('Le chapeau hors du corps');
      expect(text).not.toContain('La réponse du premier lecteur');
      expect(text).not.toContain('La suite de la réponse');
      expect(text).not.toContain('La vidéo du jour');
      expect(text).not.toContain('Commentaires (2)');
    });

    it('une `description` qui est le titre ne fait pas remettre le titre, ni un `<h1>` au titre coupé', () => {
      const html = descriptionIsTitlePageHtml();
      const out = extractArticle(url, html)!;
      expect(occurrences(textOf(out.content), DESCRIBED_TITLE)).toBe(occurrences(textOf(extractWithoutGuard(url, html)!.content), DESCRIBED_TITLE));
      expect(occurrences(textOf(out.content), DESCRIBED_TITLE)).toBeLessThanOrEqual(1);
    });

    it('un bloc que la page certifie (`og:description`, JSON-LD) revient où qu’il soit dans le conteneur ; sans preuve, ce qui suit le corps ailleurs ne revient pas', () => {
      const inner = `<div class="corps">${body}</div><div class="resume">${p('Résumé certifié')}</div>`;
      expect(guarded(inner, body)).not.toContain('Résumé certifié');
      expect(guarded(inner, body, '', `<meta property="og:description" content="${s('Résumé certifié')}">`)).toContain(s('Résumé certifié'));
      const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
      expect(guarded(inner, body, '', ld({ '@type': 'NewsArticle', articleBody: `${s('Corps un')}\n${s('Résumé certifié')}` }))).toContain(s('Résumé certifié'));
      // La liste d'autres billets d'une page n'est pas l'article.
      expect(guarded(inner, body, '', ld({ '@type': 'ItemList', itemListElement: [{ '@type': 'NewsArticle', description: s('Résumé certifié') }] }))).not.toContain('Résumé certifié');
    });

    it('un bloc fait de liens n’est remis que sur preuve : fil d’Ariane, vitrine, liste « liés »', () => {
      const links = `<ul><li><a href="/a">${s('Lien un')}</a></li><li><a href="/b">${s('Lien deux')}</a></li></ul>`;
      const inner = `<header>${p('Chapeau')}${links}</header><div>${body}</div>`;
      const text = guarded(inner, body);
      expect(text).toContain(s('Chapeau'));
      expect(text).not.toContain('Lien un');
      expect(guarded(inner, body, '', `<meta name="description" content="${s('Lien un')}">`)).toContain(s('Lien un'));
    });

    it('un panneau de réglages et ses libellés ne reviennent pas (réglage du texte d’Ars Technica)', () => {
      const panel = `<div class="text-settings"><div><span>Réglages du texte</span></div><div><label>Taille</label><select><option>Petite</option><option>Grande</option></select></div><div><span>* Abonnés seulement</span></div></div>`;
      const text = guarded(`<header>${p('Chapeau')}</header>${panel}<div>${body}</div>`, body);
      expect(text).toContain(s('Chapeau'));
      for (const label of ['Réglages du texte', 'Taille', 'Petite', 'Abonnés seulement']) expect(text).not.toContain(label);
    });

    // Readability retire parfois un appel de note au milieu d'une phrase : le
    // début et la fin s'en lisent encore. Une phrase dont la fin manque est,
    // elle, perdue : le paragraphe revient (un doublon plutôt qu'une perte).
    it('un paragraphe que Readability a retouché (une phrase touchée en son milieu) n’est pas remis en double ; une phrase perdue fait revenir le sien', () => {
      const third = 'Troisième phrase, dont le milieu porte un appel de note que Readability retire du paragraphe.';
      const own = `<p>${s('Première phrase')} ${s('Deuxième phrase')} ${third}</p>`;
      const inner = `<div>${p('Corps un')}${own}${p('Corps deux')}</div>`;
      const touched = `${p('Corps un')}<p>${s('Première phrase')} ${s('Deuxième phrase')} ${third.replace('un appel de note ', '')}</p>${p('Corps deux')}`;
      expect(occurrences(guarded(inner, touched), s('Première phrase'))).toBe(1);
      const cut = `${p('Corps un')}<p>${s('Première phrase')} ${s('Deuxième phrase')}</p>${p('Corps deux')}`;
      expect(guarded(inner, cut)).toContain(third);
    });

    it('deux `<span>` collés se lisent d’un seul tenant : le bloc n’est pas remis en double (Clubic)', () => {
      const faq = '<div><span>Foire aux questions</span><span>Contenu généré par l’IA</span></div>';
      const text = guarded(`<div>${p('Corps un')}${faq}${p('Corps deux')}</div>`, `${p('Corps un')}${faq}${p('Corps deux')}`);
      expect(occurrences(text, 'Foire aux questions')).toBe(1);
      expect(occurrences(text, 'Contenu généré')).toBe(1);
    });

    it('un cadre intégré qui n’est pas une vidéo n’est pas remis ; une vidéo l’est, sans son texte de repli', () => {
      const media = '<iframe src="https://codepen.io/x/embed/abc">CodePen Embed Fallback</iframe><iframe src="https://www.youtube.com/embed/abcdefghijk">Repli de la vidéo</iframe><audio><source src="https://example.com/son.mp3"><p>Votre navigateur ne lit pas le son.</p></audio>';
      const out = guardForTests({ page: page(`<div>${p('Corps un')}${media}${p('Corps deux')}</div>`), result: result(`${p('Corps un')}${p('Corps deux')}`) }).content;
      expect(out).toContain('https://www.youtube.com/embed/abcdefghijk');
      expect(out).not.toContain('codepen');
      expect(out).toContain('https://example.com/son.mp3');
      expect(textOf(out)).not.toContain('Repli de la vidéo');
      expect(textOf(out)).not.toContain('CodePen Embed Fallback');
      expect(textOf(out)).not.toContain('ne lit pas le son');
    });

    it('avant le corps, rien hors du conteneur : ni lien d’évitement, ni accroche du site', () => {
      const text = guarded(`<header>${p('Chapeau')}</header><div>${p('Corps un')}${p('Corps deux')}</div>`, `${p('Corps un')}${p('Corps deux')}`, `<p>${s('Accroche du site')}</p>`);
      expect(text).toContain(s('Chapeau'));
      expect(text).not.toContain('Accroche du site');
    });

    it('une icône ou un portrait d’auteur n’est pas remis ; l’image d’en-tête, si', () => {
      const out = guardForTests({
        page: page(`<header><img src="/portrait.jpg" width="48" height="48"><img src="/une.jpg" width="1200"></header><div>${p('Corps un')}${p('Corps deux')}</div>`),
        result: result(`${p('Corps un')}${p('Corps deux')}`),
      });
      expect(out.content).toContain('https://example.com/une.jpg');
      expect(out.content).not.toContain('portrait.jpg');
    });

    it('un chapeau repris en premier paragraphe n’est pas doublé', () => {
      const text = guarded(`<header>${p('Chapeau et ouverture')}<img src="/une.jpg" width="1200"></header><div class="corps">${p('Chapeau et ouverture')}${p('Corps deux')}${p('Corps trois')}</div>`, `${p('Chapeau et ouverture')}${p('Corps deux')}${p('Corps trois')}`);
      expect(occurrences(text, s('Chapeau et ouverture'))).toBe(1);
    });

    it('un chapeau écrit pour deux mises en page n’est remis qu’une fois', () => {
      const text = guarded(`<header><div class="mobile">${p('Chapeau double')}</div><div class="bureau">${p('Chapeau double')}</div></header><div>${body}</div>`, body);
      expect(occurrences(text, s('Chapeau double'))).toBe(1);
    });
  });

  describe(`${prefix}garde de non-perte — relecture (RG-01 à RG-04)`, () => {
    const s = (word: string) => `${word} : une phrase inventée assez longue pour être suivie par la garde de non-perte.`;
    const page = (inner: string) => `<!doctype html><html><head><title>T</title></head><body><main><article>${inner}</article></main></body></html>`;
    const result = (inner: string) => `<div id="readability-page-1" class="page">${inner}</div>`;
    const p = (word: string) => `<p>${s(word)}</p>`;
    const body = ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'].map((n) => p(`Corps ${n}`)).join('');

    it('RG-01 : remet les blocs courts de l’en-tête avec les autres, dans l’ordre', () => {
      const text = textOf(guardForTests({ page: page(`<header>${p('Chapeau')}<p>6 nov. 2026</p>${p('Sous-titre')}</header><div>${body}</div>`), result: result(body) }).content);
      expect(text).toContain('6 nov. 2026');
      expect(text.indexOf(s('Chapeau'))).toBeLessThan(text.indexOf('6 nov. 2026'));
      expect(text.indexOf('6 nov. 2026')).toBeLessThan(text.indexOf(s('Sous-titre')));
      expect(text.indexOf(s('Sous-titre'))).toBeLessThan(text.indexOf(s('Corps un')));
    });

    it('RG-04 : la signature de l’auteur ne revient pas', () => {
      const out = guardForTests({
        page: page(`<header>${p('Chapeau')}<div class="hero__author"><p>Camille Exemple</p>${p('Fonction de l’auteur')}</div><figure><img src="/une.jpg" width="1200"></figure></header><div>${body}</div>`),
        result: result(body),
      });
      const text = textOf(out.content);
      expect(text).toContain(s('Chapeau'));
      expect(out.content).toContain('https://example.com/une.jpg');
      expect(text).not.toContain('Camille Exemple');
      expect(text).not.toContain('Fonction de l’auteur');
    });

    it('RG-02 : un bloc remis ne double pas ce que le résultat lit déjà (légende d’une image perdue, entrée de liste)', () => {
      const caption = s('Légende de l’image');
      const out = guardForTests({
        page: page(`<header><figure><img src="/une.jpg" width="1200"><figcaption>${caption}</figcaption></figure><ul><li>${s('Point lu')}</li><li>${s('Point perdu')}</li></ul></header><div>${body}<p>${caption}</p><p>${s('Point lu')}</p></div>`),
        result: result(`${body}<p>${caption}</p><p>${s('Point lu')}</p>`),
      });
      const text = textOf(out.content);
      expect(out.content).toContain('https://example.com/une.jpg');
      expect(text).toContain(s('Point perdu'));
      expect(occurrences(text, caption)).toBe(1);
      expect(occurrences(text, s('Point lu'))).toBe(1);
    });

    it('RG-03 : un bloc remis prend sa place dans l’ordre de la page, après ce que le résultat gardait avant lui', () => {
      const out = guardForTests({
        page: page(`<figure><img src="/une.jpg" width="1200"></figure>${p('Chapeau')}<div>${body}</div>`),
        result: result(`<figure><img src="https://example.com/une.jpg" width="1200"></figure>${body}`),
      }).content;
      expect(out.indexOf('une.jpg')).toBeLessThan(out.indexOf(s('Chapeau')));
      expect(out.indexOf(s('Chapeau'))).toBeLessThan(out.indexOf(s('Corps un')));
    });

    it('un trou du corps est rempli à sa place, entre les blocs qui l’entourent', () => {
      const text = textOf(guardForTests({ page: page(`<div>${p('Corps un')}${p('Corps deux')}<div class="pub"><p>${s('Paragraphe coupé par la publicité')}</p></div>${p('Corps trois')}</div>`), result: result(`${p('Corps un')}${p('Corps deux')}${p('Corps trois')}`) }).content);
      expect(text.indexOf(s('Corps deux'))).toBeLessThan(text.indexOf('Paragraphe coupé'));
      expect(text.indexOf('Paragraphe coupé')).toBeLessThan(text.indexOf(s('Corps trois')));
    });
  });

  describe(`${prefix}garde de non-perte — rien d’invisible, rien de déjà là (REG-225)`, () => {
    const s = (word: string) => `${word} : une phrase inventée assez longue pour être suivie par la garde de non-perte.`;
    const page = (inner: string) => `<!doctype html><html><head><title>T</title></head><body><main><article>${inner}</article></main></body></html>`;
    const result = (inner: string) => `<div id="readability-page-1" class="page">${inner}</div>`;
    const p = (word: string) => `<p>${s(word)}</p>`;
    const body = ['un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept'].map((n) => p(`Corps ${n}`)).join('');
    const restored = (header: string) => textOf(guardForTests({ page: page(`<header>${header}</header><div>${body}</div>`), result: result(body) }).content).includes(s('Chapeau'));

    it('un chapeau masqué sur la page n’est jamais remis : en ligne, par attribut, par un ancêtre, par une classe de masquage', () => {
      expect(restored(`<p style="display:none">${s('Chapeau')}</p>`)).toBe(false);
      expect(restored(`<p style="visibility: hidden">${s('Chapeau')}</p>`)).toBe(false);
      expect(restored(`<p hidden>${s('Chapeau')}</p>`)).toBe(false);
      expect(restored(`<div aria-hidden="true"><p>${s('Chapeau')}</p></div>`)).toBe(false);
      expect(restored(`<div class="mobile hidden"><p>${s('Chapeau')}</p></div>`)).toBe(false);
      expect(restored(`<div class="d-none"><p>${s('Chapeau')}</p></div>`)).toBe(false);
    });

    it('un chapeau masqué seulement à certaines tailles d’écran est remis, sans la classe qui le masquerait dans le lecteur', () => {
      expect(restored(`<div class="hidden md:block"><p>${s('Chapeau')}</p></div>`)).toBe(true);
      expect(restored(`<div class="d-none d-lg-block"><p>${s('Chapeau')}</p></div>`)).toBe(true);
      expect(restored(`<p class="hidden-title">${s('Chapeau')}</p>`)).toBe(true);
      expect(restored(p('Chapeau'))).toBe(true);
      const out = guardForTests({ page: page(`<header><p class="hidden md:block">${s('Chapeau')}</p></header><div>${body}</div>`), result: result(body) }).content;
      expect(out).not.toContain('hidden');
    });

    it('une image d’en-tête que le résultat montre à une autre taille n’est pas remise', () => {
      const out = guardForTests({
        page: page(`<header><img src="/une.jpg?w=2400&amp;quality=90" width="1200"></header><div><figure><img src="/une-1200x675.jpg" width="1200"></figure>${body}</div>`),
        result: result(`<figure><img src="https://example.com/une-1200x675.jpg" width="1200"></figure>${body}`),
      });
      expect(out.content.match(/une[-.]/g)).toHaveLength(1);
    });

    it('une image d’en-tête qui est une autre photo que celles du résultat est remise', () => {
      const out = guardForTests({
        page: page(`<header><img src="/une.jpg" width="1200"></header><div><figure><img src="/corps.jpg" width="1200"></figure>${body}</div>`),
        result: result(`<figure><img src="https://example.com/corps.jpg" width="1200"></figure>${body}`),
      });
      expect(out.content).toContain('https://example.com/une.jpg');
    });
  });

  // Les pages des corrections précédentes : la garde n'y retire rien, et ce
  // qu'elle ajoute n'y est qu'une fois.
  describe(`${prefix}garde de non-perte — les pages déjà corrigées ne perdent rien`, () => {
    const pages: Array<[string, () => string]> = [
      ['avis du CERT-FR (REG-117, REG-122)', () => advisoryPageHtml()],
      ['gros avis du CERT-FR, liste de références (REG-199)', () => advisoryPageHtml(200)],
      ['Clubic, corps coupé par des images (REG-186)', splitBodyAcrossImagesPageHtml],
      ['Clubic, intertitres seuls (REG-198)', splitBodyAcrossHeadingsPageHtml],
      ['Clubic, message intégré (REG-198)', splitBodyAcrossEmbedPageHtml],
      ['Ars Technica, corps réparti (REG-175)', splitBodyPageHtml],
      ['Ars Technica, notice de l’auteur (REG-175)', splitBodyWithBioPageHtml],
      ['Numerama, messages intégrés et voile (REG-216)', embeddedTweetsPageHtml],
      ['Numerama, encart produit (N-1)', pressPageHtml],
      ['The Verge, lettre et « Related » (REG-140)', newsPageHtml],
      ['The Verge, chapeau de deux mises en page (REG-225)', repeatLedePageHtml],
      ['Ars Technica, légende de la visionneuse (REG-226)', repeatLightboxPageHtml],
      ['Schneier, billet court (REG-141)', blogPageHtml],
      ['Simon Willison, billet très court (REG-172)', shortPostPageHtml],
    ];
    for (const [label, html] of pages) {
      it(`${label} : tout ce que lisait Readability reste, une fois`, () => {
        const strict = extractWithoutGuard(url, html())!.content;
        const text = textOf(extractArticle(url, html())!.content);
        const before = textOf(strict);
        for (const block of blocks(strict, 'p, li, h2, h3, h4, figcaption, td, blockquote', 12)) {
          expect(occurrences(text, block), block).toBe(occurrences(before, block));
        }
      });
    }

    it('avis du CERT-FR, petits et gros, et messages intégrés de Numerama : rien n’est ajouté', () => {
      for (const html of [advisoryPageHtml(), advisoryPageHtml(200), embeddedTweetsPageHtml(), newsPageHtml(), blogPageHtml(), shortPostPageHtml()]) {
        expect(extractArticle(url, html)!.content).toBe(extractWithoutGuard(url, html)!.content);
      }
    });
  });

  describe(`${prefix}garde de non-perte — coût`, () => {
    it('aucune passe Readability de plus, quelle que soit la page', () => {
      for (const html of [relatedCardsPageHtml(), dossierPageHtml(), newsLedePageHtml(), ledePageHtml(), headerPageHtml(), advisoryPageHtml(200)]) {
        expect(countPasses(() => extractArticle(url, html))).toBe(countPasses(() => extractWithoutGuard(url, html)));
      }
    });

    /** Caractères comparés par les recherches de la garde pendant `run` (`startsWith`, `indexOf` d'un long texte). */
    const comparedDuring = (run: () => void) => {
      const proto = String.prototype as unknown as { indexOf: (...args: unknown[]) => number; startsWith: (...args: unknown[]) => boolean };
      const { indexOf, startsWith } = proto;
      let compared = 0;
      proto.indexOf = function (this: string, ...args: unknown[]) { if (typeof args[0] === 'string' && args[0].length > 20) compared += this.length; return indexOf.apply(this, args); };
      proto.startsWith = function (this: string, ...args: unknown[]) { if (typeof args[0] === 'string' && args[0].length > 20) compared += args[0].length; return startsWith.apply(this, args); };
      try { run(); } finally { proto.indexOf = indexOf; proto.startsWith = startsWith; }
      return compared;
    };

    // Des milliers de phrases absentes avant le corps, chacune cherchée dans
    // un long résultat : l'index ne relit que les occurrences d'une paire de
    // mots, jamais tout le texte.
    it('relit au plus un multiple borné du texte, même sur des milliers de phrases absentes', () => {
      const before = Array.from({ length: 3000 }, (_, i) => `<p>Phrase absente numéro ${i}, inventée pour coûter à la garde de non-perte.</p>`).join('');
      const body = Array.from({ length: 2000 }, (_, i) => `<p>Phrase du corps numéro ${i}, inventée elle aussi pour peser dans le résultat.</p>`).join('');
      const pageHtml = `<!doctype html><html><body><main><article><header>${before}</header><div>${body}</div></article></main></body></html>`;
      let out: { content: string } | undefined;
      const compared = comparedDuring(() => { out = guardForTests({ page: pageHtml, result: `<div class="page">${body}</div>` }); });
      expect(compared).toBeLessThan(64 * pageHtml.length + 20_000_000);
      // Elles sont remises : ce sont des phrases de l'en-tête.
      expect(textOf(out!.content)).toContain('Phrase absente numéro 2999');
    });

    // Une page faite pour coûter même à l'index : chaque phrase absente n'est
    // faite, entre son premier et son dernier mot, que de paires que le
    // résultat répète des milliers de fois. Le budget épuisé, la garde
    // s'abstient en entier.
    it('budget épuisé, la garde s’abstient en entier : rien n’est remis à moitié', () => {
      const before = Array.from({ length: 3000 }, (_, i) => `<p>Avant le chat noir le chat noir le chat noir absente${i}.</p>`).join('');
      const body = Array.from({ length: 8000 }, () => '<p>Le chat noir le chat noir le chat noir, encore.</p>').join('');
      const pageHtml = `<!doctype html><html><body><main><article><header>${before}</header><div>${body}</div></article></main></body></html>`;
      const strictResult = `<div class="page">${body}</div>`;
      let out: { content: string } | undefined;
      const compared = comparedDuring(() => { out = guardForTests({ page: pageHtml, result: strictResult }); });
      expect(compared).toBeLessThan(64 * pageHtml.length + 20_000_000);
      expect(textOf(out!.content)).toBe(textOf(strictResult));
    });
  });
}
