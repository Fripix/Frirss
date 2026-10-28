import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db from '../db.js';

// Sur une instance vide, le premier compte devient admin. Le compte de
// comptes était lu AVANT le hachage du mot de passe (asynchrone) : deux
// inscriptions simultanées lisaient toutes deux « zéro » et devenaient
// toutes deux admin.
describe('inscription — premier compte', () => {
  it('un seul admin quand deux inscriptions arrivent ensemble sur une base vide', async () => {
    const [a, b] = await Promise.all([
      request(app).post('/api/auth/register').send({ username: 'alice', password: 'secret123', email: 'alice@example.com' }),
      request(app).post('/api/auth/register').send({ username: 'carol', password: 'secret123', email: 'carol@example.com' }),
    ]);
    const admins = (db.prepare("SELECT COUNT(*) AS n FROM users WHERE role = 'admin'").get() as { n: number }).n;
    expect(admins).toBe(1);
    // La seconde est refusée : les inscriptions sont fermées dès qu'un compte existe.
    expect([a.status, b.status].sort()).toEqual([201, 403]);
  });
});
