import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import { MAX_DISPLAY_NAME_LENGTH, MAX_PASSWORD_LENGTH, MAX_USERNAME_LENGTH } from '../validate.js';

/*
 * Inscriptions ouvertes : seuls les ÉCHECS comptaient (`skipSuccessfulRequests`),
 * une seule adresse créait donc autant de comptes qu'elle voulait, chacun avec
 * son stockage de préférences, ses serveurs et son accès au proxy sortant. Le
 * nom et le nom affiché n'étaient bornés qu'en minimum : 2 Mo passaient.
 */
let app: Express;
let db: typeof import('../db.js').default;
let adminToken = '';

const FROM = '2001:db8:1234:5600::1';
const body = (username: string, extra: object = {}) =>
  ({ username, password: 'secret123', email: `${username.slice(0, 8)}@example.com`, ...extra });
const register = (b: object, ip = FROM) => request(app).post('/api/auth/register').set('X-Forwarded-For', ip).send(b);
const countUsers = () => (db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n;

beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  app = (await import('../index.js')).default;
  const dbm = await import('../db.js');
  db = dbm.default;
  const first = await register(body('owner'), '198.51.100.7');
  expect(first.status).toBe(201);
  adminToken = first.body.token;
  dbm.setSetting('registration_enabled', 'true');
});

describe('inscription — bornes de longueur', () => {
  it('refuse un nom, un nom affiché ou un mot de passe démesuré, sans créer de compte', async () => {
    const before = countUsers();
    const cases = [
      body('u'.repeat(MAX_USERNAME_LENGTH + 1)),
      body('dave', { displayName: 'd'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) }),
      body('dave', { password: 'p'.repeat(MAX_PASSWORD_LENGTH + 1) }),
      body('dave', { email: `${'a'.repeat(260)}@example.com` }),
    ];
    for (const c of cases) expect((await register(c)).status).toBe(400);
    expect(countUsers()).toBe(before);
  });

  it('refuse ce qui n’est pas une chaîne', async () => {
    expect((await register(body('dave', { username: ['a', 'b', 'c'] }))).status).toBe(400);
    expect((await register(body('dave', { displayName: { a: 1 } }))).status).toBe(400);
    expect((await register(body('dave', { password: ['aaaaaaa'] }))).status).toBe(400);
  });

  it('accepte les longueurs maximales', async () => {
    const res = await register(body('n'.repeat(MAX_USERNAME_LENGTH), { displayName: 'd'.repeat(MAX_DISPLAY_NAME_LENGTH) }), '198.51.100.8');
    expect(res.status).toBe(201);
  });

  it('la création par l’admin porte les mêmes bornes', async () => {
    const create = (b: object) => request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '198.51.100.7').send(b);
    expect((await create(body('u'.repeat(MAX_USERNAME_LENGTH + 1)))).status).toBe(400);
    expect((await create(body('erin', { displayName: 'd'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) }))).status).toBe(400);
    expect((await create(body('erin', { password: 'p'.repeat(MAX_PASSWORD_LENGTH + 1) }))).status).toBe(400);
  });

  it('la modification par l’admin aussi', async () => {
    const list = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${adminToken}`).set('X-Forwarded-For', '198.51.100.7');
    const id = list.body.users[0].id as number;
    const res = await request(app).put(`/api/admin/users/${id}`).set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '198.51.100.7').send({ displayName: 'd'.repeat(MAX_DISPLAY_NAME_LENGTH + 1) });
    expect(res.status).toBe(400);
  });
});

describe('mot de passe — borne haute', () => {
  const tooLong = 'p'.repeat(MAX_PASSWORD_LENGTH + 1);

  it('au changement par le compte', async () => {
    const res = await request(app).post('/api/auth/change-password').set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '198.51.100.7').send({ currentPassword: 'secret123', newPassword: tooLong });
    expect(res.status).toBe(400);
  });

  it('à la réinitialisation par l’admin', async () => {
    const list = await request(app).get('/api/admin/users').set('Authorization', `Bearer ${adminToken}`).set('X-Forwarded-For', '198.51.100.7');
    const id = list.body.users[0].id as number;
    const res = await request(app).put(`/api/admin/users/${id}/password`).set('Authorization', `Bearer ${adminToken}`)
      .set('X-Forwarded-For', '198.51.100.7').send({ password: tooLong });
    expect(res.status).toBe(400);
  });
});

describe('inscription — cadence des réussites', () => {
  it('coupe après quelques comptes, sans compter les refus, et par /56 en IPv6', { timeout: 60_000 }, async () => {
    const taken = await register(body('owner'));
    expect(taken.status).toBe(409);
    const statuses: number[] = [];
    for (let i = 0; i < 6; i++) {
      const res = await register(body(`alt${i}`), `2001:db8:1234:56${(i % 16).toString(16)}0::${i + 1}`);
      statuses.push(res.status);
    }
    expect(statuses).toEqual([201, 201, 201, 201, 201, 429]);
    expect(db.prepare('SELECT id FROM users WHERE username = ?').get('alt5')).toBeUndefined();
  });

  it('laisse tranquille une autre adresse', { timeout: 30_000 }, async () => {
    expect((await register(body('ailleurs'), '2001:db8:9999:100::1')).status).toBe(201);
  });
});
