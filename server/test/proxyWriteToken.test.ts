import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import http from 'http';
import express from 'express';
import request from 'supertest';
import type { AddressInfo } from 'net';
import type { Request, Response, NextFunction } from 'express';

/*
 * Le jeton d'écriture greader (`T`) n'est pas un simple jeton CSRF : FreshRSS le
 * calcule comme la partie secrète de `Auth=` complétée par des `Z`. Le relayer
 * au navigateur lui redonnait le jeton FreshRSS complet, obtenable à tout moment
 * avec un JWT FriRSS et valable bien après la déconnexion. Le serveur l'obtient
 * et l'injecte lui-même ; le corps de `/reader/api/0/token` ne sort plus.
 *
 * Amont local qui se comporte comme FreshRSS : le jeton dérive de l'en-tête
 * `Authorization`, une génération qu'on peut faire tourner simule un jeton
 * périmé, et une écriture n'est acceptée qu'avec le jeton du moment.
 */
process.env.PROXY_INTERNAL_HOSTS = '127.0.0.1';

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: Request, _res: Response, next: NextFunction) => {
    (req as Request & { user: { id: number } }).user = { id: 1 };
    next();
  },
  requireAdmin: (_req: Request, _res: Response, next: NextFunction) => next(),
}));

const { default: proxyRouter } = await import('../routes/proxy.js');
const { default: db } = await import('../db.js');
const { encrypt } = await import('../crypto.js');

let generation = 1;
let tokenStatus = 200;
let writeStatus: number | null = null;
let rotateOnFetch = false;
const tokenHits: string[] = [];
const writes: { path: string; body: string; auth: string | undefined }[] = [];
const foreignHits: string[] = [];

const tokenFor = (auth: string | undefined) => `${(auth ?? '').replace('GoogleLogin auth=', '').replace(/\W/g, '')}${generation}`.padEnd(57, 'Z');

const upstream = http.createServer((req, res) => {
  const url = req.url ?? '';
  let body = '';
  req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
  req.on('end', () => {
    if (url.includes('/reader/api/0/token')) {
      tokenHits.push(req.headers.authorization ?? '');
      if (rotateOnFetch) generation++;
      if (!req.headers.authorization || tokenStatus !== 200) { res.writeHead(tokenStatus === 200 ? 401 : tokenStatus); res.end('Unauthorized'); return; }
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`${tokenFor(req.headers.authorization)}\n`);
      return;
    }
    if (url.startsWith('/redirect-write')) {
      res.writeHead(307, { Location: `${foreignBase}/collect` });
      res.end();
      return;
    }
    writes.push({ path: url, body, auth: req.headers.authorization });
    if (writeStatus) { res.writeHead(writeStatus); res.end('nope'); return; }
    const t = new URLSearchParams(body).getAll('T');
    if (t.length === 1 && t[0] === tokenFor(req.headers.authorization)) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('OK');
      return;
    }
    res.writeHead(401, { 'Google-Bad-Token': 'true' });
    res.end('Unauthorized!');
  });
});

const foreign = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c: Buffer) => { body += c.toString('utf8'); });
  req.on('end', () => {
    foreignHits.push(`${req.method} ${body}`);
    res.writeHead(200);
    res.end('collected');
  });
});

const app = express();
app.use('/api/proxy', proxyRouter);

let upBase = '';
let foreignBase = '';
let serverId = 0;
const API = '/api/greader.php/reader/api/0';

beforeAll(async () => {
  await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r));
  await new Promise<void>((r) => foreign.listen(0, '127.0.0.1', r));
  upBase = `http://127.0.0.1:${(upstream.address() as AddressInfo).port}`;
  foreignBase = `http://127.0.0.1:${(foreign.address() as AddressInfo).port}`;
  db.prepare("INSERT OR IGNORE INTO users (id, username, email, password_hash, role, active, auth_provider) VALUES (1, 'u1', 'u1@example.com', NULL, 'admin', 1, 'local')").run();
  serverId = Number(db.prepare("INSERT INTO servers (user_id, url, freshrss_user, freshrss_token) VALUES (1, ?, 'u', ?)")
    .run(upBase, encrypt('alice/secret1')).lastInsertRowid);
});
afterAll(async () => {
  upstream.closeAllConnections();
  foreign.closeAllConnections();
  await new Promise<void>((r) => upstream.close(() => r()));
  await new Promise<void>((r) => foreign.close(() => r()));
});
beforeEach(() => {
  tokenHits.length = 0;
  writes.length = 0;
  foreignHits.length = 0;
  tokenStatus = 200;
  writeStatus = null;
  rotateOnFetch = false;
});

const write = (path: string, form: string, withServer = true) => {
  const r = request(app).post('/api/proxy')
    .set('X-Proxy-Target', `${upBase}${path}`)
    .set('Content-Type', 'application/x-www-form-urlencoded;charset=utf-8');
  return (withServer ? r.set('X-Server-Id', String(serverId)) : r).send(form);
};
const realToken = () => tokenFor('GoogleLogin auth=alice/secret1');

describe('/api/proxy — le jeton d’écriture ne sort pas du serveur', () => {
  it('le corps de /token n’est jamais relayé au navigateur', async () => {
    const res = await request(app).get('/api/proxy')
      .set('X-Proxy-Target', `${upBase}${API}/token`)
      .set('X-Server-Id', String(serverId));
    expect(res.status).toBe(200);
    expect(res.text).not.toContain(realToken());
    expect(res.text).not.toContain('secret1');
  });

  it('ni sous une forme encodée, prolongée ou par un autre verbe', async () => {
    for (const [method, path] of [
      ['get', `${API}/tok%65n`],
      ['get', `${API}/%2574oken`],
      ['get', `${API}/token/extra`],
      ['get', `${API}//token`],
      ['post', `${API}/token`],
    ] as const) {
      const res = await request(app)[method]('/api/proxy')
        .set('X-Proxy-Target', `${upBase}${path}`)
        .set('X-Server-Id', String(serverId));
      expect(res.text, path).not.toContain('secret1');
      expect(res.text, path).not.toContain(realToken());
    }
  });

  it('signe lui-même une écriture envoyée sans jeton', async () => {
    const res = await write(`${API}/edit-tag`, 'i=42&a=user%2F-%2Fstate%2Fcom.google%2Fread');
    expect(res.status).toBe(200);
    expect(res.text).toBe('OK');
    expect(writes).toHaveLength(1);
    const sent = new URLSearchParams(writes[0].body);
    expect(sent.getAll('T')).toEqual([realToken()]);
    expect(sent.get('i')).toBe('42');
    expect(sent.get('a')).toBe('user/-/state/com.google/read');
  });

  it('remplace le jeton factice d’un client resté sur l’ancienne version', async () => {
    // Pendant une mise à jour, un onglet ouvert garde l'ancien code : il lit
    // /token (il reçoit le jeton factice) puis l'envoie en `T`.
    const placeholder = (await request(app).get('/api/proxy')
      .set('X-Proxy-Target', `${upBase}${API}/token`)
      .set('X-Server-Id', String(serverId))).text.trim();
    expect(placeholder).not.toBe('');
    const res = await write(`${API}/mark-all-as-read`, `T=${encodeURIComponent(placeholder)}&s=feed%2F1`);
    expect(res.status).toBe(200);
    expect(new URLSearchParams(writes[0].body).getAll('T')).toEqual([realToken()]);
  });

  it('garde le jeton en mémoire : une seule demande pour plusieurs écritures', async () => {
    await write(`${API}/edit-tag`, 'i=1');
    await write(`${API}/edit-tag`, 'i=2');
    expect(writes).toHaveLength(2);
    expect(tokenHits.length).toBeLessThanOrEqual(1);
  });

  // SQLite fait correspondre « 01 », « 1.0 », « 1e0 » au serveur 1 : la clé
  // de la mémoire doit être l'id lu en base, sinon chaque variante crée une
  // entrée (et une demande /token) qui évince les jetons des autres comptes.
  it('une variante de l’identifiant du serveur réutilise le même jeton', async () => {
    await write(`${API}/edit-tag`, 'i=1');
    tokenHits.length = 0;
    for (const variant of [`0${serverId}`, `${serverId}.0`, `${serverId}e0`]) {
      await request(app).post('/api/proxy')
        .set('X-Proxy-Target', `${upBase}${API}/edit-tag`)
        .set('Content-Type', 'application/x-www-form-urlencoded;charset=utf-8')
        .set('X-Server-Id', variant).send('i=3');
    }
    expect(tokenHits).toHaveLength(0);
  });

  it('jeton périmé : en redemande un et rejoue l’écriture une fois', async () => {
    await write(`${API}/edit-tag`, 'i=1'); // jeton en mémoire
    tokenHits.length = 0;
    writes.length = 0;
    generation++;
    const res = await write(`${API}/edit-tag`, 'i=2');
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(2);
    expect(tokenHits).toHaveLength(1);
    expect(new URLSearchParams(writes[1].body).getAll('T')).toEqual([realToken()]);
  });

  it('ne rejoue qu’une fois, et rend le refus tel quel', async () => {
    await write(`${API}/edit-tag`, 'i=1');
    writes.length = 0;
    tokenHits.length = 0;
    writeStatus = 401;
    rotateOnFetch = true; // chaque demande rend un jeton neuf
    const res = await write(`${API}/edit-tag`, 'i=2');
    expect(res.status).toBe(401);
    expect(writes).toHaveLength(2);
    expect(tokenHits).toHaveLength(1);
  });

  it('ne rejoue pas quand le jeton redemandé est le même : le refus n’en vient pas', async () => {
    await write(`${API}/edit-tag`, 'i=1');
    writes.length = 0;
    writeStatus = 403;
    const res = await write(`${API}/edit-tag`, 'i=2');
    expect(res.status).toBe(403);
    expect(writes).toHaveLength(1);
  });

  it('ne rejoue pas une panne serveur', async () => {
    await write(`${API}/edit-tag`, 'i=1');
    writes.length = 0;
    writeStatus = 502;
    const res = await write(`${API}/edit-tag`, 'i=2');
    expect(res.status).toBe(502);
    expect(writes).toHaveLength(1);
  });

  it('un jeton refusé par FreshRSS n’envoie pas l’écriture', async () => {
    generation++; // vide la mémoire au premier refus
    tokenStatus = 401;
    // Changer d'identifiants invalide le jeton gardé : on part de zéro.
    db.prepare('UPDATE servers SET freshrss_token = ? WHERE id = ?').run(encrypt('alice/secret2'), serverId);
    const res = await write(`${API}/edit-tag`, 'i=3');
    db.prepare('UPDATE servers SET freshrss_token = ? WHERE id = ?').run(encrypt('alice/secret1'), serverId);
    expect(res.status).toBe(401);
    expect(writes).toHaveLength(0);
  });

  it('suit les identifiants enregistrés : un nouveau jeton FreshRSS, un nouveau jeton d’écriture', async () => {
    await write(`${API}/edit-tag`, 'i=1');
    db.prepare('UPDATE servers SET freshrss_token = ? WHERE id = ?').run(encrypt('alice/secret3'), serverId);
    writes.length = 0;
    tokenHits.length = 0;
    const res = await write(`${API}/edit-tag`, 'i=2');
    db.prepare('UPDATE servers SET freshrss_token = ? WHERE id = ?').run(encrypt('alice/secret1'), serverId);
    expect(res.status).toBe(200);
    expect(writes).toHaveLength(1);
    expect(tokenHits).toEqual(['GoogleLogin auth=alice/secret3']);
  });

  it('ne signe rien pour une cible qui n’est pas un serveur du compte', async () => {
    const res = await write(`${API}/edit-tag`, 'i=1&T=client', false);
    expect(res.status).toBe(401);
    expect(tokenHits).toHaveLength(0);
    expect(new URLSearchParams(writes[0].body).getAll('T')).toEqual(['client']);
  });

  it('une redirection vers une autre origine n’emporte pas le corps signé', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await write('/redirect-write/reader/api/0/edit-tag', 'i=1');
    warn.mockRestore();
    expect(res.status).toBe(502);
    expect(foreignHits).toEqual([]);
  });
});
