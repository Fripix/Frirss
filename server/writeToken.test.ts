import { describe, it, expect, beforeEach } from 'vitest';
import {
  isWriteTokenPath, hasDotSegment, isGreaderWrite, writeTokenUrl, signFormBody, isSignableContentType,
  isStaleWriteTokenStatus, parseWriteToken, cachedWriteToken, forgetWriteToken, fetchWriteTokenOnce, resetWriteTokens,
} from './writeToken.js';

const S = 'https://rss.example.com/api/greader.php/reader/api/0';

describe('isWriteTokenPath', () => {
  it('reconnaît /token sous toutes les formes que FreshRSS route', () => {
    for (const p of ['/token', '/token/', '/token/x', '/tok%65n', '/%2574oken', '//token', '/TOKEN']) {
      expect(isWriteTokenPath(`${S}${p}`), p).toBe(true);
    }
    expect(isWriteTokenPath('https://rss.example.com/p/api/greader.php/reader/api/0/token?x=1')).toBe(true);
  });

  it('ne confond pas une lecture ou une écriture avec /token', () => {
    for (const p of ['/edit-tag', '/stream/contents/feed%2F1', '/tag/list', '/tokens']) {
      expect(isWriteTokenPath(`${S}${p}`), p).toBe(false);
    }
    expect(isWriteTokenPath('pas une url')).toBe(false);
  });
});

// C-02 : nginx (image FreshRSS linuxserver) décode `%2F` PUIS résout `..`.
// `x/..%2Ftoken` n'avait aucun segment `token` derrière `reader/api/0`, et
// FreshRSS rendait pourtant le vrai jeton.
const DOT_ESCAPES = [
  `${S}/x/..%2Ftoken`,
  `${S}/x/..%2ftoken`,
  `${S}/x/%2e%2e%2ftoken`,
  `${S}/x/%2E%2E%2Ftoken`,
  `${S}/x/..%252Ftoken`,
  `${S}/x/.%2F..%2Ftoken`,
  `${S}/x/..%5Ctoken`,
  `${S}/x/..%2Ftoken?output=json`,
  'https://rss.example.com/reader/api/0/x/..%2F..%2F..%2F..%2Fapi/greader.php/reader/api/0/token',
  'https://rss.example.com/freshrss/api/greader.php/reader/api/0/x/..%2Ftoken',
];

describe('isWriteTokenPath — segments . et .. résolus comme nginx', () => {
  it('reconnaît /token derrière un segment .. encodé, sous toutes ses casses et encodages', () => {
    for (const t of DOT_ESCAPES) expect(isWriteTokenPath(t), t).toBe(true);
  });

  it('reconnaît /token derrière n’importe quelle occurrence de reader/api/0', () => {
    expect(isWriteTokenPath(`${S}/x/reader/api/0/token`)).toBe(true);
  });
});

describe('hasDotSegment', () => {
  it('voit un segment . ou .. une fois le chemin décodé', () => {
    for (const t of DOT_ESCAPES) expect(hasDotSegment(t), t).toBe(true);
    expect(hasDotSegment('https://rss.example.com/freshrss/..%2Fautre/')).toBe(true);
  });

  it('laisse passer les chemins de l’application, étiquettes encodées comprises', () => {
    for (const p of [
      '/stream/contents/feed%2F123',
      '/stream/contents/user/-/label/test1%2Ffilms',
      '/stream/contents/user/-/label/Films...',
      '/stream/contents/user/-/label/..Films',
      '/stream/contents/user/-/state/com.google/reading-list',
      '/stream/items/ids',
      '/edit-tag',
    ]) expect(hasDotSegment(`${S}${p}?s=user%2F-%2Flabel%2F..&n=20`), p).toBe(false);
    expect(hasDotSegment('pas une url')).toBe(false);
  });
});

describe('isGreaderWrite', () => {
  it('toute méthode d’écriture sous /reader/api/0/, /token exclu', () => {
    expect(isGreaderWrite('POST', `${S}/edit-tag`)).toBe(true);
    expect(isGreaderWrite('POST', `${S}/subscription/edit`)).toBe(true);
    expect(isGreaderWrite('GET', `${S}/edit-tag`)).toBe(false);
    expect(isGreaderWrite('POST', `${S}/token`)).toBe(false);
    expect(isGreaderWrite('POST', 'https://rss.example.com/api/greader.php/accounts/ClientLogin')).toBe(false);
  });
});

describe('writeTokenUrl', () => {
  it('garde l’origine et le préfixe du serveur', () => {
    expect(writeTokenUrl(`${S}/edit-tag?x=1`)).toBe(`${S}/token`);
    expect(writeTokenUrl('http://10.0.0.1:8080/fr/api/greader.php/reader/api/0/rename-tag')).toBe('http://10.0.0.1:8080/fr/api/greader.php/reader/api/0/token');
  });

  it('ne devine pas un préfixe écrit en encodé', () => {
    expect(writeTokenUrl('https://rss.example.com/api/greader.php/reader/%61pi/0/edit-tag')).toBeNull();
  });
});

describe('signFormBody', () => {
  it('remplace tout T du client par le seul vrai, et garde le reste', () => {
    const out = new URLSearchParams(signFormBody(Buffer.from('T=faux&i=1&i=2&T=autre&a=user%2F-%2Fx'), 'vrai').toString());
    expect(out.getAll('T')).toEqual(['vrai']);
    expect(out.getAll('i')).toEqual(['1', '2']);
    expect(out.get('a')).toBe('user/-/x');
  });

  it('signe un corps vide', () => {
    expect(signFormBody(undefined, 'vrai').toString()).toBe('T=vrai');
  });
});

describe('isSignableContentType', () => {
  it('formulaire ou rien', () => {
    expect(isSignableContentType(undefined)).toBe(true);
    expect(isSignableContentType('application/x-www-form-urlencoded;charset=utf-8')).toBe(true);
    expect(isSignableContentType('application/json')).toBe(false);
    expect(isSignableContentType('multipart/form-data; boundary=x')).toBe(false);
  });
});

describe('isStaleWriteTokenStatus', () => {
  it('401, 403 et 400 : les refus d’un jeton périmé', () => {
    for (const s of [400, 401, 403]) expect(isStaleWriteTokenStatus(s)).toBe(true);
  });
  it('ni les pannes serveur ni les autres 4xx', () => {
    for (const s of [200, 404, 429, 500, 502]) expect(isStaleWriteTokenStatus(s)).toBe(false);
  });
});

describe('parseWriteToken', () => {
  it('lit un jeton FreshRSS et refuse une page HTML', () => {
    expect(parseWriteToken('abcZZZZ\n')).toBe('abcZZZZ');
    expect(parseWriteToken('<html><body>Maintenance</body></html>')).toBeNull();
    expect(parseWriteToken('')).toBeNull();
  });
});

describe('mémoire des jetons', () => {
  beforeEach(() => resetWriteTokens());

  it('une seule demande pour des écritures simultanées', async () => {
    let n = 0;
    const fetcher = async () => `t${++n}`;
    const [a, b] = await Promise.all([fetchWriteTokenOnce('1:2', 's', fetcher), fetchWriteTokenOnce('1:2', 's', fetcher)]);
    expect([a, b]).toEqual(['t1', 't1']);
    expect(n).toBe(1);
    expect(cachedWriteToken('1:2', 's')).toBe('t1');
  });

  it('une autre empreinte (identifiants changés) ne relit pas l’ancien jeton', async () => {
    await fetchWriteTokenOnce('1:2', 'ancien', async () => 'vieux');
    expect(cachedWriteToken('1:2', 'nouveau')).toBeNull();
  });

  it('un échec ne laisse rien en mémoire', async () => {
    await expect(fetchWriteTokenOnce('1:2', 's', async () => { throw new Error('x'); })).rejects.toThrow('x');
    expect(cachedWriteToken('1:2', 's')).toBeNull();
    expect(await fetchWriteTokenOnce('1:2', 's', async () => 'ok')).toBe('ok');
  });

  it('oublier un jeton le fait redemander', async () => {
    await fetchWriteTokenOnce('1:2', 's', async () => 'a');
    forgetWriteToken('1:2');
    expect(cachedWriteToken('1:2', 's')).toBeNull();
  });
});
