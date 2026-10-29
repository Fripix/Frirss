import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../index.js';

/*
 * Les deux routes de restauration lisent jusqu'à `MAX_BACKUP_BYTES` : le
 * lecteur JSON global (5 Mo) refusait une sauvegarde plus grosse par un 413,
 * alors que l'export, lui, n'avait aucune limite. Instance vierge ici (aucun
 * compte) : `/api/setup/*` est ouvert.
 */
describe('restauration — corps au-delà de 5 Mo', () => {
  it('lit une enveloppe de 6 Mo au lieu de la refuser par un 413', async () => {
    const res = await request(app).post('/api/setup/restore/preview')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ backup: { format: 'pas-frirss', blob: 'x'.repeat(6 * 1024 * 1024) }, passphrase: 'p' }));
    expect(res.status).not.toBe(413);
    expect(res.body.code).toBe('not_a_backup');
  });

  it('garde la limite de 5 Mo ailleurs', async () => {
    const res = await request(app).post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ username: 'x'.repeat(6 * 1024 * 1024), password: 'p' }));
    expect(res.status).toBe(413);
  });
});
