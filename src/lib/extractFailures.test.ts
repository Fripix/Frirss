import { describe, it, expect } from 'vitest';
import { isExtractableUrl, isPageRefusal } from './extractFailures';

// Un refus n'est retenu pour la session que s'il tient à la PAGE : un refus
// passager du site, ou un refus de FriRSS lui-même, ne doit pas priver
// l'extraction automatique de cette page jusqu'au rechargement.
describe('isPageRefusal', () => {
  it('retient les 4xx propres à la page, que le site a renvoyés', () => {
    for (const status of [400, 401, 403, 404, 410, 451]) expect(isPageRefusal(status, 'site')).toBe(true);
  });

  it('ne retient ni un délai (408) ni une cadence (429), même du site', () => {
    expect(isPageRefusal(408, 'site')).toBe(false);
    expect(isPageRefusal(429, 'site')).toBe(false);
  });

  it('ne retient jamais un 5xx', () => {
    for (const status of [500, 502, 503, 504]) {
      expect(isPageRefusal(status, 'site')).toBe(false);
      expect(isPageRefusal(status, 'proxy')).toBe(false);
    }
  });

  it('ne retient pas un 401/403 de /api/proxy : il peut venir de FriRSS (session expirée, cible refusée)', () => {
    expect(isPageRefusal(401, 'proxy')).toBe(false);
    expect(isPageRefusal(403, 'proxy')).toBe(false);
    expect(isPageRefusal(404, 'proxy')).toBe(true);
  });
});

describe('isExtractableUrl', () => {
  it('une vidéo YouTube, sous ses hôtes, n’est pas extractible', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://music.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ?t=90',
    ]) expect(isExtractableUrl(url), url).toBe(false);
  });

  it('une page qui ne fait que porter une adresse YouTube dans la sienne reste extractible (D-02)', () => {
    expect(isExtractableUrl('https://www.example-news.ch/redirect?to=https://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
    expect(isExtractableUrl('https://blog.example.com/2026/11/why-youtu.be/dQw4w9WgXcQ-matters')).toBe(true);
    expect(isExtractableUrl('https://notyoutube.com/watch?v=dQw4w9WgXcQ')).toBe(true);
  });

  it('une page YouTube sans vidéo, une adresse illisible ou vide : comme avant', () => {
    expect(isExtractableUrl('https://www.youtube.com/@chaine')).toBe(true);
    expect(isExtractableUrl('pas une adresse')).toBe(true);
    expect(isExtractableUrl('')).toBe(false);
    expect(isExtractableUrl(null)).toBe(false);
  });
});
