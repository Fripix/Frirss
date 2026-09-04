// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { extractFullContent } from './extractContent';

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

  for (const [label, reply] of [
    ['404 (serveur plus ancien, route absente)', () => new Response('', { status: 404 })],
    ['422 (page non extractible)', () => new Response('', { status: 422 })],
    ['500', () => new Response('', { status: 500 })],
    ['corps illisible', () => new Response('pas du json', { status: 200 })],
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
