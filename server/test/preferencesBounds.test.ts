import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';
import { MAX_TOTAL_BYTES, MAX_VALUE_BYTES, PREFERENCES_RATE_LIMIT } from '../routes/preferences.js';

/*
 * 1 Mio par valeur et 500 clés, c'était 500 Mio par compte, sans limite de
 * cadence. Un compte ordinaire faisait échouer l'export de sauvegarde de toute
 * l'instance (70 préférences de 1 Mio suffisaient à dépasser ses 64 Mio), et
 * chaque `GET` à 500 Mio gelait la boucle d'événements trois secondes.
 */
let token = '';
let userId = 0;

const put = (body: unknown) => request(app).put('/api/preferences').set('Authorization', `Bearer ${token}`).send(body as object);
/** Une valeur qui pèse exactement `bytes` une fois sérialisée (guillemets compris). */
const sized = (bytes: number) => 'x'.repeat(bytes - 2);
const storedBytes = () => (db.prepare('SELECT COALESCE(SUM(LENGTH(CAST(value AS BLOB))), 0) AS n FROM preferences WHERE user_id = ?')
  .get(userId) as { n: number }).n;
const clear = () => db.prepare('DELETE FROM preferences WHERE user_id = ?').run(userId);

/** Remplit le compte jusqu'à exactement le plafond. */
async function fill() {
  const whole = Math.floor(MAX_TOTAL_BYTES / MAX_VALUE_BYTES);
  const rest = MAX_TOTAL_BYTES - whole * MAX_VALUE_BYTES;
  for (let i = 0; i < whole; i++) expect((await put({ [`big${i}`]: sized(MAX_VALUE_BYTES) })).status).toBe(200);
  if (rest) expect((await put({ rest: sized(rest) })).status).toBe(200);
  expect(storedBytes()).toBe(MAX_TOTAL_BYTES);
}

beforeAll(async () => {
  const res = await request(app).post('/api/auth/register')
    .send({ username: 'owner', password: 'secret123', email: 'owner@example.com' });
  token = res.body.token;
  userId = res.body.user.id;
});

describe('préférences — volume total par compte', () => {
  it('laisse passer un logo et un thème réels, très en dessous du plafond', async () => {
    clear();
    // PNG 256×256 sans perte, au pire : 256 × 256 × 4 octets, en base64.
    const logo = `data:image/png;base64,${'A'.repeat(Math.ceil((256 * 256 * 4 * 4) / 3))}`;
    const res = await put({ appLogo: logo, theme: 'dark', accent: '#123456' });
    expect(res.status).toBe(200);
    expect(MAX_TOTAL_BYTES).toBeGreaterThan(Buffer.byteLength(logo) * 5);
  });

  it('accepte jusqu’au plafond, et refuse ce qui le dépasse, en 413 avec un code', async () => {
    clear();
    await fill();
    const res = await put({ encore: 'x' });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe('preferences_too_large');
    expect(storedBytes()).toBe(MAX_TOTAL_BYTES);
  });

  it('ne compte pas deux fois une clé remplacée', async () => {
    clear();
    await fill();
    expect((await put({ big0: sized(MAX_VALUE_BYTES) })).status).toBe(200);
    expect(storedBytes()).toBe(MAX_TOTAL_BYTES);
  });

  it('refuse le lot entier : rien de ce qu’il portait n’est écrit', async () => {
    clear();
    await fill();
    expect((await put({ petite: 1, grosse: sized(1024) })).status).toBe(413);
    const row = db.prepare("SELECT COUNT(*) AS n FROM preferences WHERE user_id = ? AND key = 'petite'").get(userId) as { n: number };
    expect(row.n).toBe(0);
  });

  it('laisse un compte déjà au-dessus, d’avant le plafond, maigrir', async () => {
    clear();
    await fill();
    db.prepare("INSERT INTO preferences (user_id, key, value) VALUES (?, 'ancien', ?)").run(userId, JSON.stringify(sized(1024)));
    // Plus grosse qu'avant : refusé ; plus petite : accepté, même au-dessus.
    expect((await put({ ancien: sized(2048) })).status).toBe(413);
    expect((await put({ ancien: sized(512) })).status).toBe(200);
  });

  it('ne s’applique qu’au compte concerné', async () => {
    clear();
    await fill();
    const other = await request(app).post('/api/admin/users').set('Authorization', `Bearer ${token}`)
      .send({ username: 'bob', password: 'secret123', email: 'bob@example.com', role: 'user' });
    expect(other.status).toBe(201);
    const bob = (await request(app).post('/api/auth/login').send({ username: 'bob', password: 'secret123' })).body.token;
    const res = await request(app).put('/api/preferences').set('Authorization', `Bearer ${bob}`).send({ theme: 'dark' });
    expect(res.status).toBe(200);
  });
});

describe('préférences — cadence', () => {
  // En dernier : le seau du compte reste plein pour le reste de la minute.
  it('coupe un compte qui boucle sur la route, sans gêner les autres', async () => {
    clear();
    let last = 200;
    for (let i = 0; i <= PREFERENCES_RATE_LIMIT; i++) {
      last = (await request(app).get('/api/preferences').set('Authorization', `Bearer ${token}`)).status;
    }
    expect(last).toBe(429);
    const bob = (await request(app).post('/api/auth/login').send({ username: 'bob', password: 'secret123' })).body.token;
    expect((await request(app).get('/api/preferences').set('Authorization', `Bearer ${bob}`)).status).toBe(200);
  }, 30_000);
});
