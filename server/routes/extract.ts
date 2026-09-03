import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { fetchUpstream } from './proxy.js';
import { cacheEnabled, cacheGet, cacheSet, extractKey } from '../cache.js';
import { extractArticle } from '../extract.js';

const router = Router();

router.get('/', requireAuth, async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url : '';
  if (!url) return res.status(400).json({ error: 'Missing url' });

  const key = cacheEnabled ? extractKey(url) : null;
  if (key) {
    const hit = await cacheGet(key);
    if (hit != null) {
      res.set('X-From-Cache', '1');
      res.set('Content-Type', 'application/json');
      return res.send(hit);
    }
  }

  let html: string;
  try {
    // `fetchUpstream` et pas `fetch` : c'est lui qui porte la garde anti-SSRF
    // et les réécritures PROXY_REWRITES. Un appel direct rouvrirait la porte
    // que le proxy ferme.
    const upstream = await fetchUpstream(url, { headers: { Accept: 'text/html' } });
    if (!upstream.ok) return res.status(502).json({ error: 'Upstream request failed' });
    html = await upstream.text();
  } catch {
    return res.status(502).json({ error: 'Upstream request failed' });
  }

  const article = extractArticle(url, html);
  // Pas d'article lisible : on le dit, et le client extrait de son côté. Un
  // corps vide renvoyé en 200 le priverait de son repli.
  if (!article) return res.status(422).json({ error: 'Not extractable' });

  const body = JSON.stringify(article);
  // Écriture au mieux : un Redis en panne ne doit pas priver le client de sa
  // réponse, qui est déjà calculée.
  if (key) cacheSet(key, body).catch(() => {});
  res.set('Content-Type', 'application/json');
  res.send(body);
});

export default router;
