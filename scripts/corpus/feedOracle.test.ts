import { describe, expect, it } from 'vitest';
import { compileAccepted } from './lib.ts';
import {
  buildFeedOracle,
  feedContentFor,
  indexFeedEntries,
  isFeedTrailer,
  judgeOracle,
  oracleMisses,
  parseFeedEntries,
  setFeedFiles,
  takeFlag,
  urlKey,
} from './feedOracle.ts';

const A = 'La première phrase de cet article parle du sujet principal.';
const B = 'Une deuxième phrase apporte le détail que le lecteur attendait.';
const C = 'Et une troisième phrase conclut le paragraphe sans rien perdre.';

const page = (body: string) => `<html><head><title>t</title></head><body>${body}</body></html>`;
const extract = (body: string) => ({ title: 'Titre', content: `<div>${body}</div>` });
const none = compileAccepted([]);

describe('parseFeedEntries', () => {
  it('prend content:encoded (CDATA) plutôt que la description', () => {
    const xml = `<rss><channel><item><link>https://example.com/a</link>
      <description>Court résumé.</description>
      <content:encoded><![CDATA[<p>${A}</p><p>${B}</p>]]></content:encoded></item></channel></rss>`;
    const [e] = parseFeedEntries(xml);
    expect(e.link).toBe('https://example.com/a');
    expect(e.content).toBe(`<p>${A}</p><p>${B}</p>`);
  });

  it('décode le HTML échappé d’une description et d’un contenu Atom', () => {
    const xml = `<rss><item><link>https://example.com/a</link><description>&lt;p&gt;${A} &amp;amp; fin&lt;/p&gt;</description></item></rss>
      <feed><entry><link rel="alternate" href="https://example.com/b"/><content type="html">&lt;p&gt;${B}&lt;/p&gt;</content></entry></feed>`;
    const [a, b] = parseFeedEntries(xml);
    expect(a.content).toBe(`<p>${A} &amp; fin</p>`);
    expect(b.content).toBe(`<p>${B}</p>`);
  });

  it('garde le XHTML Atom tel quel et ignore un <content src> vide', () => {
    const xml = `<feed><entry><link href="https://example.com/x"/><content type="xhtml"><div xmlns="http://www.w3.org/1999/xhtml"><p>${A}</p></div></content></entry>
      <entry><link href="https://example.com/y"/><content src="https://example.com/y.html"/><summary>${B}</summary></entry></feed>`;
    const [x, y] = parseFeedEntries(xml);
    expect(x.content).toContain(`<p>${A}</p>`);
    expect(y.content).toBe(B);
  });

  it('change un résumé en texte brut en HTML (retours à la ligne, < échappé)', () => {
    const xml = `<rss><item><link>https://example.com/a</link><description>${A}\n\nSi a &lt; b alors ${B}</description></item></rss>`;
    const [e] = parseFeedEntries(xml);
    expect(e.content).toBe(`${A}<br><br>Si a &lt; b alors ${B}`);
  });

  it('retient le lien d’origine FeedBurner, les liens et le guid comme clés', () => {
    const xml = `<rss><item><link>https://feeds.example.com/~r/x/123</link><feedburner:origLink>https://example.com/vrai/</feedburner:origLink>
      <guid>https://example.com/?p=42</guid><description>${A}</description></item></rss>`;
    const [e] = parseFeedEntries(xml);
    expect(e.link).toBe('https://example.com/vrai/');
    expect(e.keys).toEqual(expect.arrayContaining([urlKey('https://example.com/vrai/'), urlKey('https://example.com/?p=42')]));
  });
});

describe('appariement page ↔ item', () => {
  it('urlKey ignore www, la barre finale et les utm_, garde le reste de la requête', () => {
    expect(urlKey('https://www.Example.com/a/b/?utm_source=rss&p=1')).toBe(urlKey('https://example.com/a/b?p=1'));
    expect(urlKey('https://example.com/?p=1')).not.toBe(urlKey('https://example.com/?p=2'));
  });

  it('trouve le contenu par url, puis par finalUrl ; le premier item gagne', () => {
    const map = indexFeedEntries([
      { link: 'https://example.com/a', keys: [urlKey('https://example.com/a')], content: '<p>premier</p>' },
      { link: 'https://example.com/a', keys: [urlKey('https://example.com/a')], content: '<p>second</p>' },
      { link: 'https://example.com/b/', keys: [urlKey('https://example.com/b/')], content: '<p>b</p>' },
    ]);
    expect(feedContentFor(map, { url: 'https://www.example.com/a/' })).toBe('<p>premier</p>');
    expect(feedContentFor(map, { url: 'https://example.com/redir', finalUrl: 'https://example.com/b' })).toBe('<p>b</p>');
    expect(feedContentFor(map, { url: 'https://example.com/z' })).toBeNull();
  });

  it('un item au contenu vide ne compte pas', () => {
    const map = indexFeedEntries([{ link: 'https://example.com/a', keys: [urlKey('https://example.com/a')], content: '  <p> </p> ' }]);
    expect(feedContentFor(map, { url: 'https://example.com/a' })).toBeNull();
  });
});

describe('setFeedFiles', () => {
  it('ajoute feedFile en dernier champ, sans toucher aux autres lignes ni à leur ordre', () => {
    const lines = [
      '{"url":"https://example.com/a","feed":"f","capturedAt":"t","status":200,"file":"aaa.html","bytes":1}',
      '{"url":"https://example.com/b","capturedAt":"t","status":404}',
      'ligne cassée',
      '{"url":"https://example.com/c","capturedAt":"t","status":200,"file":"ccc.html"}',
      '{"url":"https://example.com/d","capturedAt":"t","status":200,"file":"ddd.html","feedFile":"ddd.html"}',
    ];
    const { text, updated } = setFeedFiles(
      lines.join('\n') + '\n',
      new Map([
        ['aaa.html', 'aaa.html'],
        ['ddd.html', 'autre.html'],
      ]),
    );
    const out = text.split('\n');
    expect(out).toHaveLength(6);
    expect(out[0]).toBe(
      '{"url":"https://example.com/a","feed":"f","capturedAt":"t","status":200,"file":"aaa.html","bytes":1,"feedFile":"aaa.html"}',
    );
    expect(out.slice(1, 5)).toEqual(lines.slice(1));
    expect(out[5]).toBe('');
    expect(updated).toBe(1);
  });

  it('garde le style d’une ligne écrite avec des espaces', () => {
    const line = '{"file": "aaa.html", "url": "https://example.com/a", "status": 200}';
    expect(setFeedFiles(line, new Map([['aaa.html', 'aaa.html']])).text).toBe(
      '{"file": "aaa.html", "url": "https://example.com/a", "status": 200, "feedFile": "aaa.html"}',
    );
  });
});

describe('isFeedTrailer', () => {
  it('reconnaît les fins de flux qui ne sont pas l’article', () => {
    expect(isFeedTrailer('The post Docker Desktop 5.0 is here appeared first on Docker.')).toBe(true);
    expect(isFeedTrailer('L’article Un titre. Avec un point est apparu en premier sur Le Site.')).toBe(true);
    expect(isFeedTrailer('Read more')).toBe(true);
    expect(isFeedTrailer('Continue reading “Un long titre d’article” →')).toBe(true);
    expect(isFeedTrailer('Lire la suite de l’article sur le site')).toBe(true);
    expect(isFeedTrailer('Next article: A new Go API for JSON')).toBe(true);
    expect(isFeedTrailer("Previous article: Help set Go's priorities for next year")).toBe(true);
  });

  it('laisse le texte d’article', () => {
    expect(isFeedTrailer(A)).toBe(false);
    expect(isFeedTrailer('The post office opened in 1902 and appeared in many local stories since then.')).toBe(false);
    expect(isFeedTrailer('Read more about the incident in the following paragraphs, which explain the timeline.' + ' x'.repeat(80))).toBe(false);
  });
});

describe('buildFeedOracle', () => {
  it('ne garde que les phrases suivies, sans les fins de flux, ni les acceptées, ni ce que la page n’affiche pas', () => {
    const feed = `<p>${A}</p><p>${B}</p><p>Abonnez-vous à notre newsletter pour ne rien manquer.</p><p>${C}</p>
      <p>The post Mon article appeared first on Mon Site.</p><p><a href="/x">Continue reading</a></p>`;
    const accepted = compileAccepted([{ pattern: 'Abonnez-vous à notre newsletter', reason: 'formulaire', scope: 'example.com' }]);
    const html = page(`<article><p>${A}</p><p>${B}</p><p>Abonnez-vous à notre newsletter pour ne rien manquer.</p></article>`);
    const o = buildFeedOracle(feed, 'www.example.com', accepted, html);
    expect(o.sentences).toEqual([A, B]);
    expect(o.offPage).toEqual([C]);
    expect(o.accepted.map((a) => a.reason)).toEqual(['formulaire']);
    expect(o.trailers).toEqual(['The post Mon article appeared first on Mon Site.', 'Continue reading']);
  });

  it('une règle acceptée d’un autre hôte ne s’applique pas', () => {
    const accepted = compileAccepted([{ pattern: 'première phrase', reason: 'r', scope: 'autre.example' }]);
    expect(buildFeedOracle(`<p>${A}</p>`, 'example.com', accepted).sentences).toEqual([A]);
  });

  it('flux vide : aucun oracle', () => {
    const o = buildFeedOracle('', 'example.com', none, page(`<p>${A}</p>`));
    expect(o.sentences).toEqual([]);
    expect(o.fragments).toEqual([]);
    const miss = oracleMisses(o, extract(''));
    expect(miss.missing).toEqual([]);
  });

  it('suit aussi les fragments (intertitres, lignes de liste)', () => {
    const o = buildFeedOracle(`<h2>Les nouveautés</h2><ul><li>Partager</li></ul><p>${A}</p>`, 'example.com', none);
    expect(o.fragments).toEqual(['Les nouveautés']);
    expect(o.sentences).toEqual([A]);
  });

  it('CJK : une phrase de 8 caractères est suivie', () => {
    const feed = '<p>今天我们发布了新的版本。这个版本修复了很多问题。好。</p>';
    const o = buildFeedOracle(feed, 'example.cn', none);
    expect(o.sentences).toEqual(['今天我们发布了新的版本。', '这个版本修复了很多问题。']);
    const miss = oracleMisses(o, extract('<p>今天我们发布了新的版本。</p>'));
    expect(miss.missing).toEqual(['这个版本修复了很多问题。']);
  });
});

describe('oracleMisses', () => {
  it('flux résumé : seul ce qu’il contient est mesuré', () => {
    const o = buildFeedOracle(`<p>${A}</p>`, 'example.com', none);
    expect(oracleMisses(o, extract(`<p>${A}</p><p>${B}</p><p>${C}</p>`)).missing).toEqual([]);
    expect(oracleMisses(o, extract(`<p>${B}</p>`)).missing).toEqual([A]);
  });

  it('un résumé tronqué par « […] » se compare comme un début de phrase', () => {
    const o = buildFeedOracle(`<p>${A} Une deuxième phrase apporte le dét […]</p>`, 'example.com', none);
    expect(o.sentences).toHaveLength(2);
    expect(oracleMisses(o, extract(`<p>${A}</p><p>${B}</p>`)).missing).toEqual([]);
    expect(oracleMisses(o, extract(`<p>${A}</p>`)).missing).toHaveLength(1);
  });

  it('le titre que le flux répète est rendu par le titre de l’extrait', () => {
    const o = buildFeedOracle(`<h1>Better HTTP/1 connection reuse in the standard library</h1><p>${A}</p>`, 'go.dev', none);
    const miss = oracleMisses(o, { title: 'Better HTTP/1 connection reuse in the standard library', content: `<p>${A}</p>` });
    expect(miss.missing).toEqual([]);
  });

  it('une entité nommée rare du flux (&rarr;) se compare au caractère de l’extrait', () => {
    const feed = '<p>The loop is change &rarr; execute checks &rarr; read findings &amp; fix.</p>';
    const o = buildFeedOracle(feed, 'github.blog', none, page(feed));
    expect(o.offPage).toEqual([]);
    expect(o.sentences).toEqual(['The loop is change → execute checks → read findings & fix.']);
    expect(oracleMisses(o, extract('<p>The loop is change → execute checks → read findings &amp; fix.</p>')).missing).toEqual([]);
  });

  it('un extrait null manque tout', () => {
    const o = buildFeedOracle(`<p>${A}</p><h3>Les nouveautés</h3>`, 'example.com', none);
    expect(oracleMisses(o, null)).toEqual({ missing: [A], missingFragments: ['Les nouveautés'] });
  });
});

describe('judgeOracle', () => {
  const o = buildFeedOracle(`<p>${A}</p><p>${B}</p><p>${C}</p>`, 'example.com', none);

  it('régression : la tête manque une phrase que la base avait', () => {
    const v = judgeOracle(o, extract(`<p>${A}</p><p>${B}</p>`), extract(`<p>${A}</p>`));
    expect(v.base?.missing).toEqual([C]);
    expect(v.head?.missing).toEqual([B, C]);
    expect(v.regressions).toEqual([B]);
    expect(v.failing).toBe(true);
    expect(v.strictFailing).toBe(true);
  });

  it('une phrase que la base manquait déjà n’est pas une régression, mais échoue en mode strict', () => {
    const v = judgeOracle(o, extract(`<p>${A}</p><p>${B}</p>`), extract(`<p>${A}</p><p>${B}</p>`));
    expect(v.regressions).toEqual([]);
    expect(v.failing).toBe(false);
    expect(v.strictFailing).toBe(true);
  });

  it('base inconnue (délai, exception) : pas de régression mesurable', () => {
    const v = judgeOracle(o, undefined, extract(`<p>${A}</p>`));
    expect(v.base).toBeNull();
    expect(v.regressions).toEqual([]);
    expect(v.strictFailing).toBe(true);
  });

  it('tête complète : rien à signaler', () => {
    const v = judgeOracle(o, null, extract(`<p>${A}</p><p>${B}</p><p>${C}</p>`));
    expect(v.base?.missing).toEqual([A, B, C]);
    expect(v.failing).toBe(false);
    expect(v.strictFailing).toBe(false);
  });
});

describe('takeFlag', () => {
  it('retire un drapeau sans valeur de la ligne de commande', () => {
    expect(takeFlag(['--corpus', 'x', '--oracle-strict', '--jobs', '2'], 'oracle-strict')).toEqual({
      argv: ['--corpus', 'x', '--jobs', '2'],
      present: true,
    });
    expect(takeFlag(['--corpus', 'x'], 'backfill')).toEqual({ argv: ['--corpus', 'x'], present: false });
  });
});
