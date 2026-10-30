import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import type { AddressInfo, Server } from 'net';

// Isolate tests from the real database: each run gets a fresh temp data dir.
// Must be set BEFORE any module imports server/db.js.
process.env.NODE_ENV = 'test';
process.env.FRIRSS_DATA_DIR = mkdtempSync(path.join(tmpdir(), 'frirss-test-'));

// `supertest` écoute sur `::` puis appelle 127.0.0.1 : sur macOS, une application
// qui tient ce port sur 127.0.0.1 recevait la requête à notre place (404, 405,
// 401, « socket hang up » au hasard ; `listenLoopback.test.ts`). `listen` n'y peut
// rien : avec un hôte il devient asynchrone, et `supertest` lit l'adresse aussitôt.
// Hors jsdom seulement : les tests de l'interface ne s'en servent pas.
if (typeof document === 'undefined') {
  const { default: Test } = await import('supertest/lib/test.js');
  const serverAddress = Test.prototype.serverAddress;
  Test.prototype.serverAddress = function patched(app, urlPath) {
    const url = serverAddress.call(this, app, urlPath);
    const { family } = (app as unknown as Server).address() as AddressInfo;
    return family === 'IPv6' ? url.replace('127.0.0.1', '[::1]') : url;
  };
}
