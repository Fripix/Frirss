import { describe, it, expect } from 'vitest';
import express from 'express';
import { Router } from 'express';
import request from 'supertest';
import { accessLog } from '../accessLog.js';

// ── Le chemin journalisé doit être le chemin COMPLET ─────────────────
// Express réécrit `req.url` en relatif au routeur qui traite la requête et ne
// le restaure qu'au retour de `next()` — ce qu'une route qui RÉPOND ne fait
// jamais. Un `req.path` lu depuis `res.on('finish')` valait donc `/` pour
// `/api/proxy` comme pour `/api/extract`, `/login` pour `/api/auth/login` :
// toutes les routes montées perdaient leur préfixe, et les deux plus
// volumineuses devenaient indiscernables dans le journal de production.
//
// Aucun test ne couvrait le journal, c'est pour cela que c'est passé.
function appWithRouters(lines: string[]) {
  const app = express();
  app.use(accessLog((l) => { lines.push(l); }));

  const extract = Router();
  extract.get('/', (_req, res) => { res.json({ ok: true }); });

  const auth = Router();
  auth.post('/login', (_req, res) => { res.status(401).json({ error: 'nope' }); });

  const admin = Router();
  admin.put('/users/:id', (_req, res) => { res.json({ ok: true }); });

  app.use('/api/extract', extract);
  app.use('/api/auth', auth);
  app.use('/api/admin', admin);
  app.get('/api/health', (_req, res) => { res.json({ status: 'ok' }); });
  return app;
}

describe('journal d’accès', () => {
  it('écrit le chemin complet des routes montées, pas le chemin relatif au routeur', async () => {
    const lines: string[] = [];
    const app = appWithRouters(lines);

    await request(app).get('/api/extract').query({ url: 'https://news.example.com/a' });
    await request(app).post('/api/auth/login').send({});
    await request(app).put('/api/admin/users/3').send({});

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('GET /api/extract 200');
    expect(lines[1]).toContain('POST /api/auth/login 401');
    expect(lines[2]).toContain('PUT /api/admin/users/3 200');
  });

  // La raison d'être du `req.path` : une URL d'article ne doit jamais atteindre
  // le journal, même expurgée. C'est un historique de lecture, élargi par le
  // préchargement et la préparation hors-ligne à bien plus que ce qui a été lu.
  it('n’écrit pas la chaîne de requête', async () => {
    const lines: string[] = [];
    const app = appWithRouters(lines);

    await request(app).get('/api/extract').query({ url: 'https://news.example.com/un-article-prive' });

    expect(lines[0]).not.toContain('?');
    expect(lines[0]).not.toContain('news.example.com');
  });

  it('saute la sonde de santé', async () => {
    const lines: string[] = [];
    const app = appWithRouters(lines);

    await request(app).get('/api/health');

    expect(lines).toEqual([]);
  });
});
