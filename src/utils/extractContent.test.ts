// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  extractFullContent,
  retryAfterMs,
  RateLimitedError,
  FALLBACK_EXTRACT_TIMEOUT_MS,
  RATE_LIMIT_MAX_WAIT_MS,
  SERVER_EXTRACT_TIMEOUT_MS,
} from './extractContent';

const serverAnswer = {
  title: 'Titre serveur', content: '<p>corps serveur</p>',
  excerpt: '', byline: '', siteName: '', length: 12,
};

const pageHtml = `<!doctype html><html><body><article>
<p>Un paragraphe assez long pour que Readability retienne ce corps comme article, avec suffisamment de mots.</p>
<p>Un second paragraphe, lui aussi fourni, pour dépasser le seuil de lisibilité.</p>
</article></body></html>`;

beforeEach(() => { vi.restoreAllMocks(); });
afterEach(() => { vi.unstubAllGlobals(); });

describe('extractFullContent', () => {
  it('utilise la réponse du serveur quand elle arrive', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify(serverAnswer), { status: 200 });
      }
      throw new Error('le client ne doit pas aller chercher la page lui-même');
    }));
    const out = await extractFullContent('https://example.com/a');
    expect(out.content).toContain('corps serveur');
  });

  // La route rend du HTML BRUT, délibérément : `createDOMPurify` sur `linkedom`
  // ne filtre rien côté serveur. Sans cet assainissement à la réception, un
  // gestionnaire d'événement porté par la page d'origine partirait tel quel
  // dans IndexedDB (`putExtract`) — une XSS stockée, atteignable depuis
  // n'importe quel flux.
  it('assainit le HTML rendu par le serveur avant de le retourner', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({
          ...serverAnswer,
          content: '<p>corps serveur</p><img src="x" onerror="alert(2)"><a href="#" onclick="alert(1)">lien</a>',
        }), { status: 200 });
      }
      throw new Error('le client ne doit pas aller chercher la page lui-même');
    }));
    const out = await extractFullContent('https://example.com/a');
    expect(out.content).toContain('corps serveur');
    expect(out.content).not.toMatch(/onerror/i);
    expect(out.content).not.toMatch(/onclick/i);
  });

  // La route ne rend que ce que le serveur a réellement extrait — les champs
  // absents ne doivent pas partir tels quels dans IndexedDB (`putExtract`), et
  // une clé que la route ajouterait ne doit pas s'y inviter. Le chemin local
  // normalise déjà ; celui-ci doit le faire de la même façon.
  it('normalise les champs du serveur et n’en garde aucun autre', async () => {
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
      if (String(input).startsWith('/api/extract')) {
        return new Response(JSON.stringify({
          content: '<p>corps serveur</p>', imprevu: 'clé que le client ne connaît pas',
        }), { status: 200 });
      }
      throw new Error('le client ne doit pas aller chercher la page lui-même');
    }));
    const out = await extractFullContent('https://example.com/a');
    expect(out).toEqual({
      title: '', content: '<p>corps serveur</p>',
      excerpt: '', byline: '', siteName: '', length: 0,
    });
    expect(Object.keys(out).sort()).toEqual(
      ['byline', 'content', 'excerpt', 'length', 'siteName', 'title'],
    );
  });

  // Une route qui accepte la connexion et ne répond jamais tenait l'extraction
  // indéfiniment. Les deux appelants étant séquentiels, un article suffisait à
  // bloquer toute la file — et « Article complet » restait sur « Extraction… ».
  it('abandonne une route muette au bout du délai et se replie', async () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('fetch', vi.fn((input: RequestInfo, init?: RequestInit) => {
        if (String(input).startsWith('/api/extract')) {
          // Ne se règle QUE sur l'abandon : sans minuteur côté client, la
          // promesse ci-dessous n'aboutit jamais et ce test expire.
          return new Promise<Response>((_, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          });
        }
        return Promise.resolve(new Response(pageHtml, { status: 200 }));
      }));
      const pending = extractFullContent('https://example.com/a');
      await vi.advanceTimersByTimeAsync(SERVER_EXTRACT_TIMEOUT_MS);
      const out = await pending;
      expect(out.content).toContain('paragraphe');
    } finally {
      vi.useRealTimers();
    }
  });

  for (const [label, reply] of [
    ['404 (serveur plus ancien, route absente)', () => new Response('', { status: 404 })],
    ['422 (page non extractible)', () => new Response('', { status: 422 })],
    ['500', () => new Response('', { status: 500 })],
    ['corps illisible', () => new Response('pas du json', { status: 200 })],
    // Le 200 à `content` vide est la raison d'être du 422 côté serveur : sans
    // cette garde, le volet afficherait un article vide au lieu d'extraire.
    ['200 au content vide', () => new Response(JSON.stringify({ ...serverAnswer, content: '' }), { status: 200 })],
    ['200 sans champ content', () => new Response(JSON.stringify({ title: 'Titre seul' }), { status: 200 })],
    ['erreur réseau', (): Response => { throw new TypeError('Failed to fetch'); }],
  ] as const) {
    it(`se replie sur l’extraction locale — ${label}`, async () => {
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
        if (String(input).startsWith('/api/extract')) return reply();
        return new Response(pageHtml, { status: 200 });
      }));
      const out = await extractFullContent('https://example.com/a');
      expect(out.content).toContain('paragraphe');
      expect(out.content).not.toContain('corps serveur');
    });
  }
});

// ── La jambe de repli doit être bornée elle aussi ────────────────────
// Le minuteur de la route serveur visait un backend qui accepte la connexion
// et ne répond jamais. Or cette panne-là frappe `/api/proxy` exactement de la
// même façon : ne minuter que la première jambe déplaçait le blocage d'une
// ligne au lieu de le supprimer, et la file séquentielle restait bloquée pour
// toujours.
describe('extractFullContent — délais des deux jambes', () => {
  it('abandonne aussi un repli muet, au lieu de bloquer la file pour toujours', async () => {
    vi.useFakeTimers();
    try {
      // Les deux routes acceptent puis se taisent : elles ne se règlent QUE
      // sur l'abandon. Sans minuteur sur la seconde, ce test expire.
      vi.stubGlobal('fetch', vi.fn((_input: RequestInfo, init?: RequestInit) =>
        new Promise<Response>((_, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        })));

      const pending = extractFullContent('https://example.com/a');
      const settled = vi.fn();
      void pending.then(settled, settled);

      await vi.advanceTimersByTimeAsync(SERVER_EXTRACT_TIMEOUT_MS);
      expect(settled).not.toHaveBeenCalled();          // la jambe de repli court

      await vi.advanceTimersByTimeAsync(FALLBACK_EXTRACT_TIMEOUT_MS);
      expect(settled).toHaveBeenCalledTimes(1);
      await expect(pending).rejects.toThrow();
    } finally {
      vi.useRealTimers();
    }
  });
});

// ── 429 : attendre, pas perdre l'article ─────────────────────────────
// Le seau de cadence est partagé par `/api/extract`, `/api/proxy` et le
// préchargement d'images. Depuis que la route serveur répond à la vitesse de
// Redis, un balayage `prepareOffline` peut l'atteindre — et l'article
// disparaissait alors du jeu hors ligne sans un mot, `feedStore` avalant
// l'échec.
describe('extractFullContent — cadence dépassée', () => {
  const tooMany = (retryAfter: string) =>
    new Response('', { status: 429, headers: { 'Retry-After': retryAfter } });

  it('honore Retry-After puis réessaie', async () => {
    vi.useFakeTimers();
    try {
      let asked = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
        if (String(input).startsWith('/api/extract')) {
          asked++;
          return asked === 1 ? tooMany('30') : new Response(JSON.stringify(serverAnswer), { status: 200 });
        }
        throw new Error('pas de repli sur /api/proxy : c’est le même seau');
      }));

      const pending = extractFullContent('https://example.com/a');
      await vi.advanceTimersByTimeAsync(30_000);
      const out = await pending;

      expect(out.content).toContain('corps serveur');
      expect(asked).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('ne se replie pas sur /api/proxy quand l’attente n’a pas suffi', async () => {
    vi.useFakeTimers();
    try {
      let proxied = 0;
      vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo) => {
        if (String(input).startsWith('/api/extract')) return tooMany('1');
        proxied++;
        return new Response(pageHtml, { status: 200 });
      }));

      const pending = extractFullContent('https://example.com/a');
      const settled = vi.fn();
      void pending.then(settled, settled);
      await vi.advanceTimersByTimeAsync(1000);

      await expect(pending).rejects.toBeInstanceOf(RateLimitedError);
      expect(proxied).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('retryAfterMs', () => {
  const headers = (v?: string) => new Headers(v == null ? {} : { 'Retry-After': v });

  it('lit les secondes émises par express-rate-limit', () => {
    expect(retryAfterMs(headers('42'))).toBe(42_000);
  });

  it('lit aussi la forme date HTTP', () => {
    const now = Date.parse('2026-09-04T10:00:00Z');
    expect(retryAfterMs(headers('Fri, 04 Sep 2026 10:00:20 GMT'), now)).toBe(20_000);
  });

  it('rend null sans en-tête', () => {
    expect(retryAfterMs(headers())).toBeNull();
  });

  // Tronquer une attente trop longue, c'est retomber sur un 429 : mieux vaut
  // refuser l'attente que la raccourcir.
  it('refuse une attente au-delà du plafond plutôt que de la tronquer', () => {
    expect(retryAfterMs(headers(String(RATE_LIMIT_MAX_WAIT_MS / 1000 + 1)))).toBeNull();
  });

  it('ramène une date déjà passée à zéro', () => {
    const now = Date.parse('2026-09-04T10:00:00Z');
    expect(retryAfterMs(headers('Fri, 04 Sep 2026 09:59:00 GMT'), now)).toBe(0);
  });
});
