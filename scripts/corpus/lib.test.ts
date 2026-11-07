import { describe, expect, it } from 'vitest';
import {
  capturedUrls,
  compareExtracts,
  compileAccepted,
  comparablePages,
  decodeEntities,
  imageSources,
  isTracked,
  normalizeText,
  pageFileName,
  parseAccepted,
  parseArgs,
  parseFeedItems,
  parseFeedList,
  parseIndex,
  pickRecent,
  splitSentences,
  visibleText,
} from './lib.ts';

const LONG_A = 'La première phrase de cet article parle du sujet principal.';
const LONG_B = 'Une deuxième phrase apporte le détail que le lecteur attendait.';
const LONG_C = 'Et une troisième phrase conclut le paragraphe sans rien perdre.';

const article = (body: string, title = 'Titre') => ({ title, content: `<div>${body}</div>` });

describe('splitSentences', () => {
  it('coupe le français sur la ponctuation forte et garde les décimales', () => {
    expect(splitSentences('<p>Le prix passe à 3,5 €. Vraiment ? Oui ! La version 2.5 sort… demain.</p>')).toEqual([
      'Le prix passe à 3,5 €.',
      'Vraiment ?',
      'Oui !',
      'La version 2.5 sort…',
      'demain.',
    ]);
  });

  it('coupe l’anglais et garde les guillemets fermants avec la phrase', () => {
    expect(splitSentences('<p>He said "stop." Then he left. Why?</p>')).toEqual([
      'He said "stop."',
      'Then he left.',
      'Why?',
    ]);
  });

  it('coupe le chinois sur la ponctuation pleine chasse, sans blanc', () => {
    expect(splitSentences('<p>今天天气很好。我们去公园吧！你来吗？</p>')).toEqual(['今天天气很好。', '我们去公园吧！', '你来吗？']);
  });

  it('coupe l’arabe sur le point d’interrogation arabe et le point', () => {
    expect(splitSentences('<p>هل قرأت المقال؟ إنه مقال طويل جدا. شكرا</p>')).toEqual([
      'هل قرأت المقال؟',
      'إنه مقال طويل جدا.',
      'شكرا',
    ]);
  });

  it('traite les fins de bloc comme des fins de phrase', () => {
    const html =
      '<h2>Un intertitre</h2><p>Un paragraphe sans point</p><ul><li>premier point</li><li>second point</li></ul>' +
      '<table><tr><td>cellule un</td><td>cellule deux</td></tr></table><blockquote>une citation</blockquote>' +
      '<figure><img src="a.jpg"><figcaption>une légende</figcaption></figure>';
    expect(splitSentences(html)).toEqual([
      'Un intertitre',
      'Un paragraphe sans point',
      'premier point',
      'second point',
      'cellule un',
      'cellule deux',
      'une citation',
      'une légende',
    ]);
  });

  it('ne coupe pas sur une balise en ligne et décode les entités', () => {
    expect(splitSentences('<p>L&rsquo;<em>exemple</em> &amp; son&nbsp;double&#x2009;: <a href="#">lien</a>.</p>')).toEqual([
      'L’exemple & son double : lien.',
    ]);
  });

  it('ignore scripts, styles et commentaires', () => {
    expect(visibleText('<p>visible<script>var x = "caché.";</script><style>p{}</style><!-- note --></p>')).toBe('visible');
  });
});

describe('normalizeText', () => {
  it('passe en minuscules et réduit ponctuation et blancs', () => {
    expect(normalizeText('  L’Exemple,   «\u00a0vrai\u00a0» — ici ! ')).toBe('l exemple vrai ici');
  });

  it('rend comparables deux apostrophes et deux espaces différentes', () => {
    expect(normalizeText("l'article d’hier")).toBe(normalizeText('l’article  d\'hier'));
  });

  it('applique NFKC (pleine chasse → ASCII)', () => {
    expect(normalizeText('ＡＢＣ１２３')).toBe('abc123');
  });
});

describe('isTracked', () => {
  it('surveille les phrases de 25 caractères et plus', () => {
    expect(isTracked('Trop court pour compter.')).toBe(false);
    expect(isTracked('Cette phrase est assez longue.')).toBe(true);
  });

  it('abaisse le seuil à 8 caractères pour les écritures sans espaces', () => {
    expect(isTracked('今天天气很好我们去')).toBe(true);
    expect(isTracked('你来吗？')).toBe(false);
  });
});

describe('compareExtracts', () => {
  it('ne signale rien quand le texte est identique au balisage près', () => {
    const base = article(`<p>${LONG_A} ${LONG_B}</p>`);
    const head = article(`<section><p>${LONG_A}</p><p>${LONG_B}</p></section>`);
    const diff = compareExtracts(base, head, 'example.com');
    expect(diff.lost).toEqual([]);
    expect(diff.gained).toEqual([]);
    expect(diff.failing).toBe(false);
    expect(diff.changed).toBe(false);
  });

  it('signale une phrase perdue', () => {
    const diff = compareExtracts(article(`<p>${LONG_A}</p><p>${LONG_B}</p>`), article(`<p>${LONG_A}</p>`), 'example.com');
    expect(diff.lost).toEqual([LONG_B]);
    expect(diff.failing).toBe(true);
    expect(diff.lengthDrop).toBe(true);
  });

  it('ne compte pas une phrase trop courte, ni un fragment de mot', () => {
    const diff = compareExtracts(
      article('<p>Partager.</p><p>Le chat dort sur le canapé du salon.</p>'),
      article('<p>Le chat dort sur le canapé du salonnier.</p>'),
      'example.com',
    );
    expect(diff.lost).toEqual(['Le chat dort sur le canapé du salon.']);
  });

  // Les paliers d'une page de dons (« 2 GB », « Every little bit helps »…)
  // sont tous sous 25 caractères : sans ce compte, une garde qui les perdait
  // passait le corpus (relecture de la garde de non-perte, RG-01).
  it('signale une suite de fragments courts perdus, au-delà de 60 caractères', () => {
    const tiers = '<li>2 GB</li><li>Every little bit helps</li><li>Supports a good cause</li><li>4 GB</li><li>Our most popular option</li><li>Enough to save one LLM</li>';
    const diff = compareExtracts(article(`<p>${LONG_A}</p><ul>${tiers}</ul>`), article(`<p>${LONG_A}</p>`), 'example.com');
    expect(diff.lost).toEqual([]);
    expect(diff.lostFragments).toEqual(['Every little bit helps', 'Supports a good cause', 'Our most popular option', 'Enough to save one LLM']);
    expect(diff.failing).toBe(true);
  });

  it('laisse passer quelques mots courts perdus, et les fragments acceptés', () => {
    const few = compareExtracts(article(`<p>${LONG_A}</p><p>Partager.</p><p>Lire aussi</p>`), article(`<p>${LONG_A}</p>`), 'example.com');
    expect(few.lostFragments).toEqual([]);
    expect(few.failing).toBe(false);
    const menu = '<li>Every little bit helps</li><li>Supports a good cause</li><li>Our most popular option</li>';
    const accepted = compileAccepted([{ pattern: '/^(Every little|Supports a|Our most)/', reason: 'menu' }]);
    const diff = compareExtracts(article(`<p>${LONG_A}</p><ul>${menu}</ul>`), article(`<p>${LONG_A}</p>`), 'example.com', accepted);
    expect(diff.lostFragments).toEqual([]);
    expect(diff.failing).toBe(false);
  });

  it('classe une perte qui correspond à un retrait accepté', () => {
    const accepted = compileAccepted([{ pattern: 'deuxième phrase', reason: 'bandeau' }]);
    const diff = compareExtracts(article(`<p>${LONG_A}</p><p>${LONG_B}</p>`), article(`<p>${LONG_A}</p>`), 'example.com', accepted);
    expect(diff.lost).toEqual([]);
    expect(diff.accepted).toEqual([{ text: LONG_B, reason: 'bandeau' }]);
    expect(diff.failing).toBe(false);
    expect(diff.changed).toBe(true);
  });

  it('limite un retrait accepté à son hôte', () => {
    const accepted = compileAccepted([{ pattern: '/^une deuxième/i', reason: 'bandeau', scope: 'example.com' }]);
    const base = article(`<p>${LONG_A}</p><p>${LONG_B}</p>`);
    const head = article(`<p>${LONG_A}</p>`);
    expect(compareExtracts(base, head, 'www.example.com', accepted).lost).toEqual([]);
    expect(compareExtracts(base, head, 'example.org', accepted).lost).toEqual([LONG_B]);
    expect(compareExtracts(base, head, 'notexample.com', accepted).lost).toEqual([LONG_B]);
  });

  // Un doublon visible est un Majeur (`docs/TESTING.md`) : il fait échouer la
  // page (REG-228). Avant, il n'était qu'un relevé, et seulement pour une
  // phrase que la base lisait déjà.
  it('détecte un doublon apparu en tête, et fait échouer la page', () => {
    const diff = compareExtracts(
      article(`<p>${LONG_A}</p><p>${LONG_B}</p>`),
      article(`<p>${LONG_A}</p><p>${LONG_B}</p><p>${LONG_A}</p>`),
      'example.com',
    );
    expect(diff.duplicated).toEqual([LONG_A]);
    expect(diff.newDuplicates).toEqual([LONG_A]);
    expect(diff.lost).toEqual([]);
    expect(diff.failing).toBe(true);
    expect(diff.changed).toBe(true);
  });

  // L'angle mort qui a laissé passer le chapeau doublé de The Verge : la
  // phrase était absente de la base, donc « gagnée », jamais « doublée ».
  it('détecte un doublon d’une phrase que la base n’avait pas du tout (REG-228)', () => {
    const diff = compareExtracts(article(`<p>${LONG_B}</p>`), article(`<p>${LONG_A}</p><p>${LONG_A}</p><p>${LONG_B}</p>`), 'example.com');
    expect(diff.newDuplicates).toEqual([LONG_A]);
    expect(diff.failing).toBe(true);
  });

  it('ne prend pas pour un doublon une phrase déjà répétée en base', () => {
    const body = `<p>${LONG_A}</p><p>${LONG_A}</p>`;
    const diff = compareExtracts(article(body), article(body), 'example.com');
    expect(diff.duplicated).toEqual([]);
    expect(diff.newDuplicates).toEqual([]);
    expect(diff.failing).toBe(false);
  });

  it('ne prend pas pour un doublon une phrase que la page montre deux fois, à deux endroits (CERT-FR : liste et tableau)', () => {
    const line = 'Bulletin de sécurité Exemple 123 du 02 novembre 2026';
    const page = `<html><body><table><tr><td>${line}</td></tr></table><h2>Documentation</h2><ul><li><p>${line}</p></li></ul></body></html>`;
    const diff = compareExtracts(article(`<p>${LONG_A}</p><p>${line}</p>`), article(`<p>${LONG_A}</p><p>${line}</p><p>${line}</p>`), 'example.com', undefined, page);
    expect(diff.newDuplicates).toEqual([]);
    expect(diff.failing).toBe(false);
  });

  it('compte pour un seul exemplaire de la page celui qu’elle masque, ou ne rend jamais', () => {
    const head = article(`<p>${LONG_A}</p><p>${LONG_A}</p>`);
    const base = article(`<p>${LONG_A}</p>`);
    for (const hidden of [
      `<p style="display: none">${LONG_A}</p>`,
      `<p style="visibility:hidden">${LONG_A}</p>`,
      `<div hidden><p>${LONG_A}</p></div>`,
      `<div aria-hidden="true"><p>${LONG_A}</p></div>`,
      `<div class="sr-only">${LONG_A}</div>`,
      `<noscript><p>${LONG_A}</p></noscript>`,
      `<template><p>${LONG_A}</p></template>`,
      `<script>var x = "${LONG_A}";</script>`,
    ]) {
      const page = `<html><body><p>${LONG_A}</p><h2>Autre chose ici</h2>${hidden}</body></html>`;
      expect(compareExtracts(base, head, 'example.com', undefined, page).failing, hidden).toBe(true);
    }
    // Masqué seulement à certaines tailles d'écran : la page le montre.
    const responsive = `<html><body><p>${LONG_A}</p><h2>Autre chose ici</h2><div class="hidden md:block"><p>${LONG_A}</p></div></body></html>`;
    expect(compareExtracts(base, head, 'example.com', undefined, responsive).failing).toBe(false);
  });

  // The Verge : le chapeau une fois par mise en page, l'un après l'autre ;
  // Ars Technica : la légende et son crédit dans la visionneuse puis dans le
  // `<figcaption>`. La feuille de style n'en montre qu'un : deux exemplaires
  // qui se suivent comptent pour un.
  it('compte pour un seul deux exemplaires de la page qui se suivent', () => {
    const credit = 'Crédit : Exemple, 2026';
    const caption = `<div class="cap">${LONG_A}<div>${credit}</div></div><figcaption>${LONG_A} <span>${credit}</span></figcaption>`;
    const dek = `<div><p>${LONG_A}</p></div><div><div><p>${LONG_A}</p></div></div>`;
    for (const twins of [dek, caption]) {
      const page = `<html><body><h1>Un titre</h1>${twins}<p>${LONG_B}</p></body></html>`;
      const diff = compareExtracts(article(`<p>${LONG_B}</p>`), article(`<p>${LONG_A}</p><p>${LONG_A}</p><p>${LONG_B}</p>`), 'example.com', undefined, page);
      expect(diff.newDuplicates, twins).toEqual([LONG_A]);
    }
  });

  // CERT-FR : « (cf. section Documentation). » puis l'intertitre
  // « Documentation » — deux textes, même collés dans le texte de la page.
  it('ne confond pas la fin d’une phrase et l’intertitre qui la suit', () => {
    const page = `<html><body><p>Se référer au bulletin (cf. section Documentation).</p><h2>Documentation</h2><ul><li>Un lien</li></ul></body></html>`;
    const diff = compareExtracts(
      article(`<p>Un lien vers la suite</p>`),
      article(`<p>Se référer au bulletin (cf. section Documentation).</p><h2>Documentation</h2><p>Un lien vers la suite</p>`),
      'example.com', undefined, page,
    );
    expect(diff.newDuplicates).toEqual([]);
  });

  // CERT-FR : « … 12 SP5 » puis « … 12 SP5 LTSS » dans la liste des systèmes
  // affectés — le second commence comme le premier, sans le répéter.
  it('ne prend pas pour deux exemplaires voisins une ligne et la suivante qui la prolonge', () => {
    const page = `<html><body><ul><li>Serveur Exemple 12 SP5</li><li>Serveur Exemple 12 SP5 LTSS</li></ul></body></html>`;
    const diff = compareExtracts(
      article(`<p>${LONG_A}</p>`),
      article(`<p>${LONG_A}</p><ul><li>Serveur Exemple 12 SP5</li><li>Serveur Exemple 12 SP5 LTSS</li></ul>`),
      'example.com', undefined, page,
    );
    expect(diff.newDuplicates).toEqual([]);
  });

  it('suit aussi les fragments courts doublés, pas un mot isolé', () => {
    const diff = compareExtracts(
      article(`<p>${LONG_A}</p><p>Crédit : Exemple</p><p>Partager</p>`),
      article(`<p>${LONG_A}</p><p>Crédit : Exemple</p><p>Crédit : Exemple</p><p>Partager</p><p>Partager</p>`),
      'example.com',
    );
    expect(diff.newDuplicates).toEqual(['Crédit : Exemple']);
  });

  it('détecte une image doublée, la même photo à la taille près (REG-228)', () => {
    const base = article(`<p>${LONG_A}</p><img src="https://example.com/une.jpg?w=1080">`);
    const head = article(`<img src="https://example.com/une.jpg?w=1080&amp;crop=a"><img src="https://example.com/une.jpg?w=2400&amp;crop=b"><p>${LONG_A}</p>`);
    const page = `<html><body><div><img src="/une.jpg?w=1080"></div><div><img src="/une.jpg?w=2400"></div><p>${LONG_A}</p></body></html>`;
    const diff = compareExtracts(base, head, 'example.com', undefined, page, 'https://example.com/a');
    expect(diff.duplicatedImages).toEqual(['https://example.com/une.jpg?w=1080&crop=a']);
    expect(diff.failing).toBe(true);
  });

  it('ne prend pas pour une image doublée la photo qu’une galerie de la page montre deux fois', () => {
    const base = article(`<p>${LONG_A}</p><img src="https://example.com/a.jpg">`);
    const head = article(`<img src="https://example.com/a.jpg"><p>${LONG_A}</p><img src="https://example.com/a.jpg">`);
    const page = `<html><body><img src="/a.jpg"><p>${LONG_A}</p><img src="/a.jpg"></body></html>`;
    const diff = compareExtracts(base, head, 'example.com', undefined, page, 'https://example.com/a');
    expect(diff.duplicatedImages).toEqual([]);
    expect(diff.failing).toBe(false);
  });

  it('une image gardée à une autre taille n’est pas perdue', () => {
    const base = article(`<p>${LONG_A}</p><img src="https://example.com/une.jpg?w=2400">`);
    const head = article(`<p>${LONG_A}</p><img src="https://example.com/une-1200x675.jpg">`);
    expect(compareExtracts(base, head, 'example.com').lostImages).toEqual([]);
  });

  it('relève les phrases gagnées', () => {
    const diff = compareExtracts(article(`<p>${LONG_A}</p>`), article(`<p>${LONG_A}</p><p>${LONG_C}</p>`), 'example.com');
    expect(diff.gained).toEqual([LONG_C]);
    expect(diff.failing).toBe(false);
  });

  it('signale un null nouveau, pas un null qui disparaît', () => {
    const page = article(`<p>${LONG_A}</p>`);
    expect(compareExtracts(page, null, 'example.com')).toMatchObject({ newNull: true, failing: true, changed: true });
    expect(compareExtracts(null, page, 'example.com')).toMatchObject({ newNull: false, failing: false, changed: true });
    expect(compareExtracts(null, null, 'example.com')).toMatchObject({ failing: false, changed: false });
  });

  it('signale une image perdue, sauf espace réservé data:', () => {
    const base = article(`<p>${LONG_A}</p><img src="https://example.com/a.jpg"><img src="data:image/gif;base64,R0lGOD">`);
    const head = article(`<p>${LONG_A}</p><img src="https://example.com/b.jpg">`);
    const diff = compareExtracts(base, head, 'example.com');
    expect(diff.lostImages).toEqual(['https://example.com/a.jpg']);
    expect(diff.failing).toBe(true);
  });

  it('accepte une image perdue qui correspond à une règle', () => {
    const base = article(`<p>${LONG_A}</p><img src="https://ads.example.com/pixel.gif">`);
    const head = article(`<p>${LONG_A}</p>`);
    const accepted = compileAccepted([{ pattern: 'ads.example.com', reason: 'pixel' }]);
    const diff = compareExtracts(base, head, 'example.com', accepted);
    expect(diff.lostImages).toEqual([]);
    expect(diff.acceptedImages).toHaveLength(1);
    expect(diff.failing).toBe(false);
  });

  it('relève un titre changé', () => {
    const diff = compareExtracts(article(`<p>${LONG_A}</p>`, 'Avant'), article(`<p>${LONG_A}</p>`, 'Après'), 'example.com');
    expect(diff.titleChanged).toEqual({ base: 'Avant', head: 'Après' });
    expect(diff.failing).toBe(false);
  });

  it('suit une perte en chinois', () => {
    const diff = compareExtracts(article('<p>今天天气很好我们去公园。明天下雨我们待在家里。</p>'), article('<p>今天天气很好我们去公园。</p>'), 'example.com');
    expect(diff.lost).toEqual(['明天下雨我们待在家里。']);
  });
});

describe('parseAccepted', () => {
  it('lit un tableau de règles', () => {
    expect(parseAccepted('[{"pattern":"x","reason":"pub","scope":"example.com"}]')).toEqual([
      { pattern: 'x', reason: 'pub', scope: 'example.com' },
    ]);
  });

  it('refuse une règle sans raison ou sans motif', () => {
    expect(() => parseAccepted('[{"pattern":"x"}]')).toThrow(/reason/);
    expect(() => parseAccepted('[{"reason":"x"}]')).toThrow(/pattern/);
    expect(() => parseAccepted('{"pattern":"x"}')).toThrow(/tableau/);
  });

  it('accepte une sous-chaîne insensible à la casse et à la ponctuation', () => {
    const m = compileAccepted([{ pattern: 'Abonnez-vous à la newsletter', reason: 'appel' }]);
    expect(m.match('ABONNEZ VOUS À LA NEWSLETTER, c’est gratuit.', 'example.com')?.reason).toBe('appel');
    expect(m.match('Rien à voir avec la choucroute.', 'example.com')).toBeNull();
  });
});

describe('parseFeedList', () => {
  it('lit une URL par ligne, ignore commentaires, blancs et doublons', () => {
    const text = '# mes flux\nhttps://example.com/feed\n\n  https://example.org/rss.xml  \n#https://example.net/off\nhttps://example.com/feed\n';
    expect(parseFeedList(text)).toEqual(['https://example.com/feed', 'https://example.org/rss.xml']);
  });
});

describe('index', () => {
  const text = [
    JSON.stringify({ file: 'a.html', url: 'https://example.com/a', capturedAt: '2026-11-01T00:00:00Z', status: 200, bytes: 10 }),
    '',
    JSON.stringify({ url: 'https://example.com/b', capturedAt: '2026-11-01T00:00:00Z', status: 403 }),
    'pas du json',
    JSON.stringify({ file: 'a.html', url: 'https://example.com/a', finalUrl: 'https://example.com/a2', capturedAt: '2026-11-02T00:00:00Z', status: 200 }),
    JSON.stringify({ capturedAt: 'x', status: 200 }),
  ].join('\n');

  it('lit les entrées et signale les lignes illisibles', () => {
    const { entries, errors } = parseIndex(text);
    expect(entries).toHaveLength(3);
    expect(errors.map((e) => e.line)).toEqual([4, 6]);
  });

  it('ne retient comme capturées que les pages avec fichier', () => {
    const { entries } = parseIndex(text);
    expect([...capturedUrls(entries)]).toEqual(['https://example.com/a']);
  });

  it('ne compare chaque fichier qu’une fois, la dernière ligne gagne', () => {
    const { entries } = parseIndex(text);
    const pages = comparablePages(entries);
    expect(pages).toHaveLength(1);
    expect(pages[0].finalUrl).toBe('https://example.com/a2');
  });

  it('nomme le fichier d’une page par le SHA-1 de son URL', () => {
    expect(pageFileName('https://example.com/a')).toMatch(/^[0-9a-f]{16}\.html$/);
    expect(pageFileName('https://example.com/a')).toBe(pageFileName('https://example.com/a'));
    expect(pageFileName('https://example.com/a')).not.toBe(pageFileName('https://example.com/b'));
  });
});

describe('flux', () => {
  const NOW = Date.parse('2026-11-07T12:00:00Z');
  const rss = `<?xml version="1.0"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom"><channel>
<title>Exemple</title><link>https://example.com/</link>
<atom:link href="https://example.com/feed" rel="self" type="application/rss+xml"/>
<item><title>Ancien</title><link>https://example.com/ancien</link><pubDate>Mon, 02 Nov 2026 10:00:00 +0000</pubDate></item>
<item><title>Récent</title><link><![CDATA[https://example.com/recent?a=1&b=2]]></link><pubDate>Fri, 06 Nov 2026 10:00:00 +0000</pubDate></item>
<item><title>Milieu</title><link>https://example.com/milieu?a=1&amp;b=2</link><pubDate>Wed, 04 Nov 2026 10:00:00 +0000</pubDate></item>
<item><title>Très vieux</title><link>https://example.com/vieux</link><pubDate>Thu, 01 Jan 2026 10:00:00 +0000</pubDate></item>
<item><title>Sans lien</title><guid isPermaLink="false">tag:example.com,2026:1</guid></item>
<item><title>Par guid</title><guid>https://example.com/guid</guid><pubDate>Tue, 03 Nov 2026 10:00:00 +0000</pubDate></item>
</channel></rss>`;

  const atom = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom"><title>Exemple</title>
<link href="https://example.com/" rel="alternate"/>
<entry><title>Un</title><link rel="self" href="https://example.com/api/1"/><link href="/billet/un" rel="alternate" type="text/html"/><updated>2026-11-01T08:00:00Z</updated></entry>
<entry><title>Deux</title><link href="https://example.com/billet/deux"/><published>2026-11-05T08:00:00Z</published></entry>
<entry><title>Trois</title><link rel="enclosure" href="https://example.com/son.mp3"/><link rel="alternate" href="https://example.com/billet/trois"/><updated>2026-11-03T08:00:00+01:00</updated></entry>
</feed>`;

  it('lit les liens d’un flux RSS, CDATA, entités et guid permalien compris', () => {
    expect(parseFeedItems(rss, 'https://example.com/feed').map((i) => i.link)).toEqual([
      'https://example.com/ancien',
      'https://example.com/recent?a=1&b=2',
      'https://example.com/milieu?a=1&b=2',
      'https://example.com/vieux',
      'https://example.com/guid',
    ]);
  });

  it('lit les liens alternate d’un flux Atom, relatifs résolus', () => {
    expect(parseFeedItems(atom, 'https://example.com/atom.xml').map((i) => i.link)).toEqual([
      'https://example.com/billet/un',
      'https://example.com/billet/deux',
      'https://example.com/billet/trois',
    ]);
  });

  it('prend les plus récents d’un flux RSS, dans la limite d’âge, hors déjà capturés', () => {
    const items = parseFeedItems(rss, 'https://example.com/feed');
    expect(pickRecent(items, { perFeed: 2, maxAgeDays: 30, now: NOW, exclude: new Set() })).toEqual([
      'https://example.com/recent?a=1&b=2',
      'https://example.com/milieu?a=1&b=2',
    ]);
    expect(
      pickRecent(items, { perFeed: 8, maxAgeDays: 30, now: NOW, exclude: new Set(['https://example.com/recent?a=1&b=2']) }),
    ).toEqual(['https://example.com/milieu?a=1&b=2', 'https://example.com/guid', 'https://example.com/ancien']);
  });

  it('prend les plus récents d’un flux Atom', () => {
    const items = parseFeedItems(atom, 'https://example.com/atom.xml');
    expect(pickRecent(items, { perFeed: 2, maxAgeDays: 30, now: NOW, exclude: new Set() })).toEqual([
      'https://example.com/billet/deux',
      'https://example.com/billet/trois',
    ]);
  });

  it('garde l’ordre du flux quand un article n’est pas daté', () => {
    const items = [
      { link: 'https://example.com/1', date: null },
      { link: 'https://example.com/2', date: Date.parse('2026-11-06T00:00:00Z') },
    ];
    expect(pickRecent(items, { perFeed: 5, maxAgeDays: 30, now: NOW, exclude: new Set() })).toEqual([
      'https://example.com/1',
      'https://example.com/2',
    ]);
  });
});

describe('divers', () => {
  it('décode les entités numériques et nommées, laisse les inconnues', () => {
    expect(decodeEntities('&#233;t&#xE9; &eacute; &inconnue; &amp;amp;')).toBe('été é &inconnue; &amp;');
  });

  it('liste les images d’un extrait', () => {
    expect(imageSources('<img alt="x" src="https://example.com/a.jpg?w=1&amp;h=2"><img src=\'b.png\'><img>')).toEqual([
      'https://example.com/a.jpg?w=1&h=2',
      'b.png',
    ]);
  });

  it('lit les arguments --clé valeur et --clé=valeur', () => {
    expect(parseArgs(['--corpus', 'c', '--base=v1', '--head', 'HEAD'])).toEqual({ corpus: 'c', base: 'v1', head: 'HEAD' });
    expect(() => parseArgs(['--corpus'])).toThrow(/manquante/);
    expect(() => parseArgs(['seul'])).toThrow(/inattendu/);
  });
});
