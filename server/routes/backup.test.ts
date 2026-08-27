import { describe, it, expect, beforeEach, vi } from 'vitest';
import db from '../db.js';
import { requireEmptyInstance, backupErrorStatus, fail } from './backup.js';
import { BackupError, type BackupErrorCode } from '../backupCrypto.js';

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

describe('backupErrorStatus', () => {
  it("rend 400 pour une phrase de passe trop faible (erreur de saisie)", () => {
    expect(backupErrorStatus('weak_passphrase')).toBe(400);
  });

  it("rend 422 pour toutes les pannes de contenu", () => {
    const codes: BackupErrorCode[] = ['not_a_backup', 'unsupported_version', 'bad_passphrase', 'schema_mismatch'];
    for (const code of codes) expect(backupErrorStatus(code)).toBe(422);
  });

  it("ne rend jamais 401 : l'intercepteur d'axios lirait ça comme une session expirée et déconnecterait un administrateur pourtant authentifié", () => {
    const codes: BackupErrorCode[] = ['not_a_backup', 'unsupported_version', 'bad_passphrase', 'weak_passphrase', 'schema_mismatch'];
    for (const code of codes) expect(backupErrorStatus(code)).not.toBe(401);
  });
});

describe('fail', () => {
  it('rend le statut attendu pour chaque BackupError', () => {
    const cases: [BackupErrorCode, number][] = [
      ['weak_passphrase', 400],
      ['not_a_backup', 422],
      ['unsupported_version', 422],
      ['bad_passphrase', 422],
      ['schema_mismatch', 422],
    ];
    for (const [code, status] of cases) {
      const res = fakeRes();
      fail(res as never, new BackupError(code, 'message'));
      expect(res._res.statusCode).toBe(status);
      expect(res._res.body).toMatchObject({ code });
    }
  });

  it('rend 500 pour une erreur non typée, et journalise sans exposer le corps de la requête', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = fakeRes();
      fail(res as never, new Error('SQLITE_ERROR: quelque chose a explosé'));
      expect(res._res.statusCode).toBe(500);
      expect(res._res.body).toEqual({ error: 'Backup operation failed' });
      expect(spy).toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });
});
