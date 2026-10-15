import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import app from '../index.js';
import db, { getSetting } from '../db.js';

let adminToken: string;
let userToken: string;

beforeAll(async () => {
  const reg = await request(app).post('/api/auth/register')
    .send({ username: 'root', password: 'secret123', email: 'root@example.com', displayName: 'Root' });
  adminToken = reg.body.token;
  await request(app).post('/api/admin/users').set('Authorization', `Bearer ${adminToken}`)
    .send({ username: 'alice', password: 'secret123', email: 'alice@example.com', role: 'user' });
  const login = await request(app).post('/api/auth/login').send({ username: 'alice', password: 'secret123' });
  userToken = login.body.token;
});

describe('ai schema', () => {
  it('creates the four ai_ tables', () => {
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'ai_%'").all() as { name: string }[]).map((r) => r.name).sort();
    expect(names).toEqual(['ai_cache', 'ai_providers', 'ai_usage', 'ai_user_keys']);
  });
  it('ships disabled, keys admin-only, cap 50', () => {
    expect(getSetting('ai_enabled')).toBe('false');
    expect(getSetting('ai_user_keys_allowed')).toBe('false');
    expect(getSetting('ai_daily_cap')).toBe('50');
  });
});
