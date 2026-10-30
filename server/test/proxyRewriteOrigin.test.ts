import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import http from 'http';
import express from 'express';
import request from 'supertest';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

/*
 * Les deux côtés de `PROXY_REWRITES` étaient de confiance par leur NOM seul, sans
 * résolution, et quels que soient le schéma et le port. Avec un split-DNS, le nom
 * public se résout vers le reverse proxy : `http://rss.…:81/` n'est pas réécrit
 * (le schéma diffère), mais il était autorisé, et tout compte joignait alors
 * n'importe quel port du reverse proxy, son interface d'administration comprise.
 * Ici `rss.localhost` tient lieu de ce nom public résolu en privé.
 */
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const hits: string[] = [];
const service = (name: string) => http.createServer((req, res) => {
  hits.push(`${name} ${req.method} ${req.url}`);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end('{"ok":true}');
});
const freshrss = service('freshrss');
const admin = service('admin');
await new Promise<void>((r) => freshrss.listen(0, '127.0.0.1', r));
await new Promise<void>((r) => admin.listen(0, '127.0.0.1', r));
const freshrssPort = (freshrss.address() as AddressInfo).port;
const adminPort = (admin.address() as AddressInfo).port;

process.env.PROXY_REWRITES = `https://rss.localhost=http://127.0.0.1:${freshrssPort}`;
process.env.PROXY_INTERNAL_HOSTS = 'interne.localhost';

const { default: proxyRouter, assertTargetSafe, targetAllowedLiteral, BlockedTargetError, rewriteTarget } = await import('../routes/proxy.js');

const app = express();
app.use('/api/proxy', proxyRouter);
const ask = (target: string, method: 'get' | 'post' = 'get') => request(app)[method]('/api/proxy').set('X-Proxy-Target', target);

afterAll(async () => {
  freshrss.closeAllConnections();
  admin.closeAllConnections();
  await new Promise<void>((r) => freshrss.close(() => r()));
  await new Promise<void>((r) => admin.close(() => r()));
});
beforeEach(() => { hits.length = 0; });

describe('PROXY_REWRITES — frontière de la règle', () => {
  // `startsWith` réécrivait `https://rss.localhost:8443/…` en `http://…:port:8443/…`,
  // une URL invalide, et une cible refusée ne se replie jamais : 403 sur toute
  // lecture d'un serveur enregistré avec un port.
  it('ne réécrit pas une URL dont l’hôte seulement commence comme la règle', () => {
    expect(rewriteTarget('https://rss.localhost:8443/api')).toBe('https://rss.localhost:8443/api');
    expect(rewriteTarget('https://rss.localhost.example.com/api')).toBe('https://rss.localhost.example.com/api');
  });

  it('réécrit l’origine de la règle, port par défaut écrit ou non', () => {
    expect(rewriteTarget('https://rss.localhost/api?x=1')).toBe(`http://127.0.0.1:${freshrssPort}/api?x=1`);
    expect(rewriteTarget('https://rss.localhost:443/api')).toBe(`http://127.0.0.1:${freshrssPort}/api`);
    expect(rewriteTarget('https://rss.localhost')).toBe(`http://127.0.0.1:${freshrssPort}`);
  });
});

describe('PROXY_REWRITES — confiance par origine', () => {
  it('garde le chemin voulu : le nom public de la règle est réécrit vers l’interne', async () => {
    const res = await ask('https://rss.localhost/api/greader.php/reader/api/0/token');
    expect(res.status).toBe(200);
    expect(hits).toEqual(['freshrss GET /api/greader.php/reader/api/0/token']);
  });

  it('accepte l’origine exacte de chaque côté, port par défaut normalisé compris', () => {
    expect(targetAllowedLiteral('https://rss.localhost/x')).toBe(true);
    expect(targetAllowedLiteral('https://rss.localhost:443/x')).toBe(true);
    expect(targetAllowedLiteral(`http://127.0.0.1:${freshrssPort}/x`)).toBe(true);
  });

  it('refuse un autre port du nom public, en lecture comme en écriture', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const get = await ask(`http://rss.localhost:${adminPort}/api/nginx/proxy-hosts`);
    const post = await ask(`http://rss.localhost:${adminPort}/api/tokens`, 'post');
    warn.mockRestore();
    expect(get.status).toBe(403);
    expect(post.status).toBe(403);
    expect(hits).toEqual([]);
  });

  it('refuse un autre schéma du nom public', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await ask('http://rss.localhost/');
    warn.mockRestore();
    expect(res.status).toBe(403);
    await expect(assertTargetSafe('http://rss.localhost/')).rejects.toBeInstanceOf(BlockedTargetError);
  });

  it('refuse un autre port du côté interne', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await ask(`http://127.0.0.1:${adminPort}/`);
    warn.mockRestore();
    expect(res.status).toBe(403);
    expect(hits).toEqual([]);
    expect(targetAllowedLiteral('http://127.0.0.1:3001/')).toBe(false);
  });

  it('laisse PROXY_INTERNAL_HOSTS porter sur l’hôte : c’est son contrat', () => {
    expect(targetAllowedLiteral('http://interne.localhost:8080/')).toBe(true);
  });
});
