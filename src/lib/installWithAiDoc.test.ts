import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Anti-dérive de `docs/INSTALL-WITH-AI.md`, le guide que les assistants IA des
 * utilisateurs lisent (lien brut depuis `main`) pour guider une installation.
 *
 * Ce test échoue si le guide et `docs/CONFIGURATION.md` ne listent pas exactement les mêmes
 * variables d'environnement (le guide et `docs/CONFIGURATION.md`), s'il quitte l'image, le volume ou les ports du
 * README, si le lien à copier du README ne pointe plus vers lui, ou s'il perd
 * ses interdits et les pièges connus.
 *
 * CE QU'IL N'ATTRAPE PAS : une phrase du guide devenue fausse (un défaut, un
 * symptôme, une étape). Tout changement d'installation relit sa prose, dans le
 * même commit (règle du CLAUDE.md du projet).
 */
const ROOT = process.cwd();
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const README = read('README.md');
const GUIDE = read('docs/INSTALL-WITH-AI.md');
const COMPOSE = read('docker-compose.yml');
const CONFIG = read('docs/CONFIGURATION.md');
const INSTALL = read('docs/INSTALL.md');

/** Toutes les variables des tableaux d'un document (lignes `` | `NOM` | ``). */
const allVars = (md: string) => [...md.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]).sort();

/** Variables d'un tableau Markdown (lignes `` | `NOM` | ``) sous un titre `##`, jusqu'au suivant. */
const vars = (md: string, heading: string) => {
  const part = md.split(new RegExp(`^## ${heading}\\s*$`, 'm'))[1]?.split(/^## /m)[0] ?? '';
  return [...part.matchAll(/^\|\s*`([A-Z0-9_]+)`\s*\|/gm)].map((m) => m[1]).sort();
};

describe('docs/INSTALL-WITH-AI.md', () => {
  it('lists exactly the variables of docs/CONFIGURATION.md', () => {
    expect(allVars(CONFIG).length).toBeGreaterThan(10);
    expect(vars(GUIDE, 'Environment variables')).toEqual(allVars(CONFIG));
  });

  it('uses the image, volume and ports of the README and compose file', () => {
    for (const s of ['ghcr.io/fripix/frirss:latest', '/app/data', '8080:80', '--restart unless-stopped']) {
      expect(GUIDE).toContain(s);
      expect(README).toContain(s);
      expect(INSTALL).toContain(s);
    }
    expect(COMPOSE).toContain('ghcr.io/fripix/frirss:latest');
    expect(COMPOSE).toContain('/app/data');
    expect(GUIDE).toContain('8787');
  });

  it('is the link the README and the install guide tell people to copy', () => {
    expect(INSTALL).toContain('https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md');
    expect(README).toContain('https://raw.githubusercontent.com/Fripix/Frirss/main/docs/INSTALL-WITH-AI.md');
  });

  it('keeps the safety rules and the known traps', () => {
    expect(GUIDE).toMatch(/^## Never do this/m);
    expect(GUIDE).toContain('Never ask for a password');
    expect(GUIDE).toContain('**Never `localhost`**');
    expect(GUIDE).toContain('Never put `localhost`, `127.0.0.1` or `::1` in `PROXY_INTERNAL_HOSTS`');
    expect(GUIDE).toContain('POST /api/proxy 403');
    expect(GUIDE).toContain('OLLAMA_CONTEXT_LENGTH=16384');
    // 32 bits : un noyau 64 bits sous un OS 32 bits affiche aarch64 ; seule l'architecture du système tranche.
    expect(GUIDE).toContain('dpkg --print-architecture');
    expect(GUIDE).not.toContain('uname -m');
    expect(GUIDE).toContain('no matching manifest');
  });

  it('quotes the messages FriRSS really shows', () => {
    const login = (JSON.parse(read('src/locales/en.json')) as { login: Record<string, string> }).login;
    for (const key of ['errorServer', 'errorServerBlocked', 'errorServerCredentials']) {
      expect(GUIDE).toContain(login[key].split('. ')[0]);
    }
  });

  it('describes the compose file as it is', () => {
    expect(COMPOSE).toContain('"8080:80"');
    for (const name of ['PUID', 'PGID', 'FRIRSS_BASE_URL', 'PROXY_INTERNAL_HOSTS', 'REDIS_URL', 'CACHE_SYNC_INTERVAL', 'PROXY_REWRITES']) {
      expect(COMPOSE).toMatch(new RegExp(`^\\s*# - ${name}=`, 'm'));
    }
  });

  it('asks for a host, never a whole URL, in PROXY_INTERNAL_HOSTS', () => {
    expect(README).toContain('host or IP only');
    expect(INSTALL).toContain('host or IP only');
    expect(GUIDE).toContain('host name or IP only');
  });
});
