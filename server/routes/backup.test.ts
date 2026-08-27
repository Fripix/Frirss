import { describe, it, expect, beforeEach, vi } from 'vitest';
import db from '../db.js';
import { requireEmptyInstance } from './backup.js';

function fakeRes() {
  const res = { statusCode: 0, body: null as unknown };
  return {
    status(code: number) { res.statusCode = code; return this; },
    json(payload: unknown) { res.body = payload; return this; },
    _res: res,
  };
}

describe('requireEmptyInstance', () => {
  beforeEach(() => {
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM preferences').run();
    db.prepare('DELETE FROM servers').run();
    db.prepare('DELETE FROM users').run();
  });

  it('laisse passer quand aucun compte n’existe', () => {
    const next = vi.fn();
    const res = fakeRes();
    requireEmptyInstance({} as never, res as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(res._res.statusCode).toBe(0);
  });

  it('refuse dès qu’un seul compte existe', () => {
    db.prepare('INSERT INTO users (username, role) VALUES (?, ?)').run('alice', 'admin');
    const next = vi.fn();
    const res = fakeRes();
    requireEmptyInstance({} as never, res as never, next);
    expect(next).not.toHaveBeenCalled();
    expect(res._res.statusCode).toBe(403);
  });
});
