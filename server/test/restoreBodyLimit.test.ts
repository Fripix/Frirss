import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import request from 'supertest';
import { brotliCompressSync } from 'node:zlib';
import app from '../index.js';
import { oneRestoreAtATime, MAX_BACKUP_BYTES } from '../routes/backup.js';

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

/*
 * Le lecteur de 64 Mio était monté au niveau de l'app : il lisait et
 * analysait le corps AVANT l'authentification, et décompressait (gzip, br) —
 * 115 octets en brotli devenaient 60 Mio analysés. Quelques dizaines de
 * requêtes anonymes faisaient tomber Node, donc le conteneur. Les gardes
 * passent désormais avant la lecture, et aucun corps compressé n'est lu.
 */
describe('restauration — les gardes passent avant la lecture', () => {
  const malformed = '{"backup": ';

  it('un anonyme reçoit 401 sur /api/admin/restore sans que son corps soit lu', async () => {
    for (const path of ['/api/admin/restore', '/api/admin/restore/preview']) {
      const res = await request(app).post(path).set('Content-Type', 'application/json').send(malformed);
      expect(res.status, path).toBe(401);
    }
  });

  it('un corps compressé est refusé (415), ici comme ailleurs', async () => {
    const br = brotliCompressSync(Buffer.from(JSON.stringify({ backup: {}, passphrase: 'p' })));
    for (const path of ['/api/setup/restore/preview', '/api/auth/login']) {
      const res = await request(app).post(path)
        .set('Content-Type', 'application/json').set('Content-Encoding', 'br').send(br);
      expect(res.status, path).toBe(415);
    }
  });

  it('une seule restauration lue à la fois', () => {
    const res = () => {
      const r = new EventEmitter() as EventEmitter & { status: (n: number) => typeof r; json: (b: unknown) => void; statusCode?: number; body?: unknown };
      r.status = (n: number) => { r.statusCode = n; return r; };
      r.json = (b: unknown) => { r.body = b; };
      return r;
    };
    const first = res(); const second = res(); const third = res();
    const next = vi.fn();
    oneRestoreAtATime({} as never, first as never, next);
    oneRestoreAtATime({} as never, second as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(second.statusCode).toBe(429);
    expect((second.body as { code: string }).code).toBe('restore_in_progress');
    first.emit('close');
    oneRestoreAtATime({} as never, third as never, next);
    expect(next).toHaveBeenCalledTimes(2);
    third.emit('close');
  });

  // body-parser lit TOUT le corps annoncé avant de refuser par 413 : envoyé au
  // goutte-à-goutte (sans nginx devant), un corps annoncé trop gros tenait le
  // verrou jusqu'à 300 s. La longueur annoncée est jugée avant de le prendre.
  it('refuse un corps annoncé trop gros sans prendre le verrou', () => {
    const res = () => {
      const r = new EventEmitter() as EventEmitter & { status: (n: number) => typeof r; json: (b: unknown) => void; statusCode?: number; body?: unknown };
      r.status = (n: number) => { r.statusCode = n; return r; };
      r.json = (b: unknown) => { r.body = b; };
      return r;
    };
    const big = res(); const next = vi.fn();
    oneRestoreAtATime({ headers: { 'content-length': String(MAX_BACKUP_BYTES + 1) } } as never, big as never, next);
    expect(big.statusCode).toBe(413);
    expect((big.body as { code: string }).code).toBe('too_large');
    const ok = res();
    oneRestoreAtATime({ headers: {} } as never, ok as never, next);
    expect(next).toHaveBeenCalledTimes(1);
    ok.emit('close');
  });
});
