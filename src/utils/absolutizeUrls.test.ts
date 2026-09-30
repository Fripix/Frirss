// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { absolutizeUrls } from './absolutizeUrls';

/**
 * En production, le document analysé par `extractContent` naît d'un
 * `DOMParser` : il hérite de l'origine de FriRSS, et le `<base>` qu'on y
 * injectait est REFUSÉ par la CSP (`base-uri 'self'`, `nginx.conf`). Readability
 * résolvait alors les URLs relatives contre `https://frirss…/`, d'où des images
 * en 404 et des liens qui ramènent dans l'app.
 *
 * jsdom n'applique pas de CSP : le seul moyen de tester la production est donc
 * de reproduire sa situation — un document dont la base est une AUTRE origine
 * que l'article.
 */
const FRIRSS = 'https://frirss.example.com/';
const ARTICLE = 'https://www.cert.example.fr/avis/AVIS-2026-042/';

function parse(body: string): Document {
  const doc = new DOMParser().parseFromString(`<html><head></head><body>${body}</body></html>`, 'text/html');
  // jsdom donne à ce document l'URL de la page courante, comme le navigateur.
  Object.defineProperty(doc, 'baseURI', { value: FRIRSS, configurable: true });
  return doc;
}

describe('absolutizeUrls', () => {
  it('résout une image relative contre l’article, pas contre l’origine de l’app', () => {
    const doc = parse('<img src="/static/images/json_icon.svg">');
    absolutizeUrls(doc, ARTICLE);
    expect(doc.querySelector('img')!.getAttribute('src'))
      .toBe('https://www.cert.example.fr/static/images/json_icon.svg');
  });

  it('résout un chemin relatif au document', () => {
    const doc = parse('<img src="figure-1.png">');
    absolutizeUrls(doc, ARTICLE);
    expect(doc.querySelector('img')!.getAttribute('src'))
      .toBe('https://www.cert.example.fr/avis/AVIS-2026-042/figure-1.png');
  });

  it('résout les liens', () => {
    const doc = parse('<a href="/avis/AVIS-2026-041/">l’avis précédent</a>');
    absolutizeUrls(doc, ARTICLE);
    expect(doc.querySelector('a')!.getAttribute('href'))
      .toBe('https://www.cert.example.fr/avis/AVIS-2026-041/');
  });

  it('laisse intactes les URLs déjà absolues', () => {
    const doc = parse('<img src="https://cdn.example.net/a.jpg">');
    absolutizeUrls(doc, ARTICLE);
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('https://cdn.example.net/a.jpg');
  });

  it('ne touche ni aux ancres, ni aux mailto, ni aux données en ligne', () => {
    const doc = parse('<a href="#suite">suite</a><a href="mailto:x@example.com">écrire</a><img src="data:image/gif;base64,R0lGOD">');
    absolutizeUrls(doc, ARTICLE);
    const [ancre, mail] = [...doc.querySelectorAll('a')];
    expect(ancre.getAttribute('href')).toBe('#suite');
    expect(mail.getAttribute('href')).toBe('mailto:x@example.com');
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('data:image/gif;base64,R0lGOD');
  });

  it('honore le <base> que la page distante porte elle-même', () => {
    const doc = parse('<img src="a.png">');
    const base = doc.createElement('base');
    base.setAttribute('href', 'https://www.cert.example.fr/medias/');
    doc.head.append(base);
    absolutizeUrls(doc, ARTICLE);
    expect(doc.querySelector('img')!.getAttribute('src')).toBe('https://www.cert.example.fr/medias/a.png');
  });

  it('résout chaque candidat d’un srcset', () => {
    const doc = parse('<img srcset="/a-480.jpg 480w, /a-960.jpg 960w">');
    absolutizeUrls(doc, ARTICLE);
    expect(doc.querySelector('img')!.getAttribute('srcset'))
      .toBe('https://www.cert.example.fr/a-480.jpg 480w, https://www.cert.example.fr/a-960.jpg 960w');
  });

  /**
   * Une URL `data:` contient des virgules — et la virgule est justement ce qui
   * sépare deux candidats d'un `srcset`. Un découpage naïf coupait donc l'URL
   * en deux et résolvait sa queue contre la page : l'image disparaissait.
   * La spec HTML sépare l'URL de ses descripteurs par des ESPACES, pas par des
   * virgules — c'est cette règle-là qu'il faut suivre.
   */
  it('ne coupe pas une URL data en deux dans un srcset', () => {
    const doc = parse('<img srcset="data:image/svg+xml;base64,PHN2Zz48L3N2Zz4= 1x, /a-2x.png 2x">');
    absolutizeUrls(doc, ARTICLE);
    expect(doc.querySelector('img')!.getAttribute('srcset'))
      .toBe('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4= 1x, https://www.cert.example.fr/a-2x.png 2x');
  });

  it('accepte un candidat sans descripteur', () => {
    const doc = parse('<img srcset="/seul.png">');
    absolutizeUrls(doc, ARTICLE);
    expect(doc.querySelector('img')!.getAttribute('srcset')).toBe('https://www.cert.example.fr/seul.png');
  });

  it('résout les sources et l’affiche des vidéos', () => {
    const doc = parse('<video poster="/p.jpg"><source src="/v.mp4"></video>');
    absolutizeUrls(doc, ARTICLE);
    expect(doc.querySelector('video')!.getAttribute('poster')).toBe('https://www.cert.example.fr/p.jpg');
    expect(doc.querySelector('source')!.getAttribute('src')).toBe('https://www.cert.example.fr/v.mp4');
  });

  it('laisse passer une URL illisible sans casser le reste', () => {
    const doc = parse('<img src="http://[bancal"><img src="/ok.png">');
    absolutizeUrls(doc, ARTICLE);
    const imgs = [...doc.querySelectorAll('img')];
    expect(imgs[0].getAttribute('src')).toBe('http://[bancal');
    expect(imgs[1].getAttribute('src')).toBe('https://www.cert.example.fr/ok.png');
  });
});
