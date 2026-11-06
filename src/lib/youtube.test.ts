import { describe, it, expect } from 'vitest';
import { extractYouTubeId, facadeMarkup, youtubeThumbnail, youtubeWatchUrl, injectVideoFacades, dropNonVideoIframes } from './youtube';

const L = { play: 'Lire', open: 'Ouvrir sur YouTube' };

describe('extractYouTubeId', () => {
  it('reads the watch form', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the short form', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the embed form', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the shorts form', () => {
    expect(extractYouTubeId('https://www.youtube.com/shorts/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('reads the nocookie form', () => {
    expect(extractYouTubeId('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('keeps other query parameters out of the id', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123')).toEqual({ id: 'dQw4w9WgXcQ' });
  });
  it('preserves a start time in seconds', () => {
    expect(extractYouTubeId('https://youtu.be/dQw4w9WgXcQ?t=90')).toEqual({ id: 'dQw4w9WgXcQ', start: 90 });
  });
  it('preserves a start time written as 1m30s', () => {
    expect(extractYouTubeId('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1m30s')).toEqual({ id: 'dQw4w9WgXcQ', start: 90 });
  });
  it('accepts the start parameter', () => {
    expect(extractYouTubeId('https://www.youtube.com/embed/dQw4w9WgXcQ?start=42')).toEqual({ id: 'dQw4w9WgXcQ', start: 42 });
  });
  it('rejects non-YouTube urls', () => {
    expect(extractYouTubeId('https://vimeo.com/12345')).toBeNull();
    expect(extractYouTubeId('https://example.com/watch?v=abc')).toBeNull();
  });
  it('rejects a YouTube url without a video', () => {
    expect(extractYouTubeId('https://www.youtube.com/@channel')).toBeNull();
  });
  it('handles empty input', () => {
    expect(extractYouTubeId('')).toBeNull();
  });
});

// La façade en tête du volet (`headFacadeHtml`, `ReadingPane.tsx`) est
// injectée SANS DOMPurify, depuis l'adresse de l'article — une donnée du
// flux. Elle n'est sûre que parce qu'`extractYouTubeId` n'en garde qu'un
// identifiant de 11 caractères [A-Za-z0-9_-] et un nombre de secondes :
// élargir l'un ou l'autre ouvrirait une injection (campagne 1.9.0,
// troisième round).
describe('extractYouTubeId — ce qui rend la façade de tête sûre sans assainissement', () => {
  const hostile = [
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ"><img src=x onerror=alert(1)>',
    "https://youtu.be/dQw4w9WgXcQ'onmouseover='alert(1)",
    'https://www.youtube.com/embed/<script>alert(1)</script>',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=1"><svg onload=alert(1)>',
    'https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=javascript:alert(1)',
    'https://youtu.be/AAAAAAAAA"<>onerror=x',
    'https://www.youtube.com/shorts/&quot;onerror&#61;x',
  ];
  const reference = facadeMarkup({ id: 'dQw4w9WgXcQ' }, youtubeThumbnail('dQw4w9WgXcQ'), L);

  it('ne rend qu’un identifiant de 11 caractères sûrs et un nombre de secondes', () => {
    expect(hostile.filter((url) => extractYouTubeId(url)).length).toBeGreaterThan(0);
    for (const url of hostile) {
      const ref = extractYouTubeId(url);
      if (!ref) continue;
      expect(ref.id).toMatch(/^[A-Za-z0-9_-]{11}$/);
      if (ref.start !== undefined) expect(Number.isInteger(ref.start) && ref.start >= 0).toBe(true);
    }
  });

  it('la façade construite depuis une adresse hostile ne porte ni balise ni attribut étrangers', () => {
    for (const url of hostile) {
      const ref = extractYouTubeId(url);
      if (!ref) continue;
      const html = facadeMarkup(ref, youtubeThumbnail(ref.id), L);
      expect(html).not.toMatch(/onerror|onload|onmouseover|<script|<svg|javascript:/i);
      expect(html.match(/</g)?.length).toBe(reference.match(/</g)?.length);
    }
  });
});

describe('youtubeThumbnail', () => {
  it('builds the standard thumbnail url', () => {
    expect(youtubeThumbnail('abc123')).toBe('https://i.ytimg.com/vi/abc123/hqdefault.jpg');
  });
});

describe('injectVideoFacades', () => {
  it('replaces a YouTube iframe with facade markup', () => {
    const { html, ids } = injectVideoFacades('<p>a</p><iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>', L);
    expect(ids).toEqual(['dQw4w9WgXcQ']);
    expect(html).toContain('data-yt-id="dQw4w9WgXcQ"');
    expect(html).not.toContain('<iframe');
    expect(html).toContain('<p>a</p>');
  });

  it('replaces a standalone YouTube link', () => {
    const { html, ids } = injectVideoFacades('<p><a href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a></p>', L);
    expect(ids).toEqual(['dQw4w9WgXcQ']);
    expect(html).toContain('data-yt-id="dQw4w9WgXcQ"');
  });

  it('carries the start time into the facade', () => {
    const { html } = injectVideoFacades('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=42"></iframe>', L);
    expect(html).toContain('data-yt-start="42"');
  });

  it('leaves non-YouTube iframes untouched', () => {
    const src = '<iframe src="https://player.vimeo.com/video/1"></iframe>';
    expect(injectVideoFacades(src, L).html).toBe(src);
  });

  it('leaves ordinary links untouched', () => {
    const src = '<p><a href="https://example.com/article">lire</a></p>';
    expect(injectVideoFacades(src, L).html).toBe(src);
  });

  it('reports each video once even when repeated', () => {
    const { ids } = injectVideoFacades(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe><a href="https://youtu.be/dQw4w9WgXcQ">x</a>',
      L,
    );
    expect(ids).toEqual(['dQw4w9WgXcQ']);
  });

  it('returns the html untouched when there is no video', () => {
    expect(injectVideoFacades('<p>rien</p>', L)).toEqual({ html: '<p>rien</p>', ids: [] });
  });

  it('handles empty input', () => {
    expect(injectVideoFacades('', L)).toEqual({ html: '', ids: [] });
  });

  it('always offers a way out to YouTube', () => {
    // Some owners disable embedding; the failure happens inside a cross-origin
    // frame we cannot inspect, so the link must always be there.
    const { html } = injectVideoFacades('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ?start=42"></iframe>', L);
    expect(html).toContain('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
    expect(html).toContain('Ouvrir sur YouTube');
  });

  // L-07 : la passe des liens retraitait le lien « Ouvrir sur YouTube » de la
  // façade tout juste posée par la passe des iframes — deux lecteurs imbriqués.
  it('turns one iframe into exactly one facade, its own link left alone', () => {
    const { html } = injectVideoFacades('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>', L);
    expect(html.match(/class="yt-facade"/g)).toHaveLength(1);
    expect(html.match(/class="yt-facade__link"/g)).toHaveLength(1);
  });

  it('still turns a link next to an iframe facade into its own facade', () => {
    const { html, ids } = injectVideoFacades(
      '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe><p><a href="https://youtu.be/abcdefghijk">https://youtu.be/abcdefghijk</a></p>',
      L,
    );
    expect(ids).toEqual(['dQw4w9WgXcQ', 'abcdefghijk']);
    expect(html.match(/class="yt-facade"/g)).toHaveLength(2);
  });

  describe('un lien dans le texte reste un lien (A4-06)', () => {
    it('un nom lié au milieu d’une phrase garde son texte (Simon Willison)', () => {
      const src = '<p>— <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">Nilay Patel</a>, The Vergecast</p>';
      expect(injectVideoFacades(src, L)).toEqual({ html: src, ids: [] });
    });

    it('un bout de phrase lié garde son texte (The Register)', () => {
      const src = '<p>when they <a href="https://www.youtube.com/watch?v=rgP_LBtaUEc">first built PyTorch</a> in 2016</p>';
      expect(injectVideoFacades(src, L)).toEqual({ html: src, ids: [] });
    });

    it('deux liens voisins vers la même vidéo ne donnent aucune façade', () => {
      const src = '<p><a href="https://youtu.be/dQw4w9WgXcQ">la conférence</a> et <a href="https://youtu.be/dQw4w9WgXcQ?t=90">ce passage</a>.</p>';
      expect(injectVideoFacades(src, L)).toEqual({ html: src, ids: [] });
    });

    it('un lien seul dans son paragraphe, mais avec des mots, les garde', () => {
      const src = '<p><a href="https://youtu.be/dQw4w9WgXcQ">Voir l’entretien complet</a></p>';
      expect(injectVideoFacades(src, L)).toEqual({ html: src, ids: [] });
    });

    it('un lien seul dont le texte est l’adresse, ou une image, devient une façade', () => {
      for (const inner of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', '', '<img src="https://example.com/v.jpg" alt="">']) {
        const { html, ids } = injectVideoFacades(`<p>avant</p><p> <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">${inner}</a> </p>`, L);
        expect(ids, inner).toEqual(['dQw4w9WgXcQ']);
        expect(html.match(/class="yt-facade"/g), inner).toHaveLength(1);
      }
    });

    it('une même vidéo ne donne qu’une façade, iframe ou lien seul', () => {
      const { html, ids } = injectVideoFacades(
        '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>'
          + '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>'
          + '<p><a href="https://youtu.be/dQw4w9WgXcQ">https://youtu.be/dQw4w9WgXcQ</a></p>',
        L,
      );
      expect(ids).toEqual(['dQw4w9WgXcQ']);
      expect(html.match(/class="yt-facade"/g)).toHaveLength(1);
      expect(html).not.toContain('<iframe');
    });

    it('un lien seul qui ne mène pas à YouTube (redirection) reste un lien', () => {
      const href = 'https://example.com/redirect?to=https://www.youtube.com/watch?v=dQw4w9WgXcQ';
      const src = `<p><a href="${href}">${href}</a></p>`;
      expect(injectVideoFacades(src, L)).toEqual({ html: src, ids: [] });
    });
  });

  it('uses the labels it is given, never a hard-coded language', () => {
    const { html } = injectVideoFacades('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>', L);
    expect(html).toContain('aria-label="Lire"');
    expect(html).not.toContain('>Play<');
  });
});

describe('youtubeWatchUrl', () => {
  it('builds a plain watch url', () => {
    expect(youtubeWatchUrl({ id: 'dQw4w9WgXcQ' })).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
  it('keeps the start time', () => {
    expect(youtubeWatchUrl({ id: 'dQw4w9WgXcQ', start: 42 })).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
  });
});

describe('dropNonVideoIframes', () => {
  // Le passage d'assainissement de l'extraction gardait <iframe> avec un src
  // libre. Rien ne l'affichait — ReadingPane repasse tout par sanitizeHtml,
  // qui supprime les iframes — mais le contenu ARCHIVÉ dans IndexedDB était
  // plus large que ce que la moindre vue rend. Ne garder que les iframes que
  // la façade sait transformer en lecteur aligne le stockage sur l'affichage.

  it('keeps an iframe the facade can turn into a player', () => {
    for (const src of ['https://www.youtube.com/embed/dQw4w9WgXcQ',
                       'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ']) {
      const html = `<p>a</p><iframe src="${src}" allowfullscreen></iframe><p>b</p>`;
      expect(dropNonVideoIframes(html), src).toBe(html);
    }
  });

  it('drops a foreign iframe', () => {
    expect(dropNonVideoIframes('<p>a</p><iframe src="https://attacker.tld/phish"></iframe><p>b</p>'))
      .toBe('<p>a</p><p>b</p>');
  });

  it('drops a self-closing foreign iframe', () => {
    expect(dropNonVideoIframes('<iframe src="https://attacker.tld/x" />')).toBe('');
  });

  it('drops an iframe with no src at all', () => {
    expect(dropNonVideoIframes('<p>a</p><iframe></iframe>')).toBe('<p>a</p>');
  });

  it('keeps the video and drops the intruder in the same document', () => {
    const html = '<iframe src="https://attacker.tld/x"></iframe>'
      + '<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>';
    expect(dropNonVideoIframes(html))
      .toBe('<iframe src="https://www.youtube.com/embed/dQw4w9WgXcQ"></iframe>');
  });

  it('leaves iframe-free content untouched', () => {
    const html = '<p>Rien à voir <a href="https://example.com">ici</a></p>';
    expect(dropNonVideoIframes(html)).toBe(html);
    expect(dropNonVideoIframes('')).toBe('');
  });
});
