import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';

/*
 * En production, Express fait confiance au premier saut (nginx, qui pose
 * l'adresse réelle depuis 1.8.0). Le limiteur de connexion comptait l'adresse
 * brute : en IPv6, une adresse neuve de sa /64 à chaque essai, et la force
 * brute devenait illimitée.
 */
let app: Express;
beforeAll(async () => {
  process.env.NODE_ENV = 'production';
  app = (await import('../index.js')).default;
});

describe('limite de connexion — IPv6', () => {
  // Onze connexions, donc onze bcrypt de 12 tours : sous la charge de la suite
  // complète, plus que les 5 s par défaut (échec intermittent du 2026-10-29).
  it('compte ensemble les adresses d’une même /56', { timeout: 30_000 }, async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await request(app).post('/api/auth/login')
        .set('X-Forwarded-For', `2001:db8:1234:56${(i % 16).toString(16)}0::${i + 1}`)
        .send({ username: 'nobody', password: 'wrong-password' });
      statuses.push(res.status);
    }
    expect(statuses.slice(0, 10).every((s) => s === 401)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('laisse une autre /56 tranquille', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('X-Forwarded-For', '2001:db8:9999:100::1')
      .send({ username: 'nobody', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });
});
