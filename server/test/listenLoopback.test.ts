import { describe, it, expect, afterEach } from 'vitest';
import http from 'node:http';
import request from 'supertest';
import type { AddressInfo } from 'node:net';

/*
 * `supertest` écoute sur `::` et appelait 127.0.0.1. Sur macOS, une application
 * qui tient déjà 127.0.0.1:<port> n'empêche pas d'obtenir ce port sur `::`, et la
 * requête partait chez elle : 404, 405, 401 ou « socket hang up » au hasard, sur
 * ce Mac seulement (`setup.ts`). Linux refuse ce partage, le test s'y arrête.
 */
describe('supertest et le port d’une autre application', () => {
  const servers: http.Server[] = [];
  const open = (server: http.Server, port: number, host?: string) => new Promise<boolean>((resolve) => {
    server.once('error', () => resolve(false));
    server.listen(port, host, () => { servers.push(server); resolve(true); });
  });
  const answering = (name: string) => http.createServer((_req, res) => { res.end(name); });

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => { s.close(resolve); })));
  });

  it('la requête arrive à notre serveur, pas à l’occupant de 127.0.0.1', async () => {
    const squatter = answering('occupant');
    await open(squatter, 0, '127.0.0.1');
    const { port } = squatter.address() as AddressInfo;
    const ours = answering('nous');
    if (!await open(ours, port)) return;
    const res = await request(ours).get('/');
    expect(res.text).toBe('nous');
  });

  it('un serveur tenu sur 127.0.0.1 reste joignable', async () => {
    const ours = answering('nous');
    await open(ours, 0, '127.0.0.1');
    const res = await request(ours).get('/');
    expect(res.text).toBe('nous');
  });
});
