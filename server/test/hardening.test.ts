import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import type { Request } from 'express';
import { isPrivateIp, targetAllowedLiteral } from '../routes/proxy.js';
import { sniffCharset } from '../charset.js';
import { parseTranslation } from '../ai/prompts.js';
import { getRedirectUri } from '../oidc.js';

// Durcissements de la relecture de sécurité 1.8.0 : chaque test échouait
// avant son correctif.

describe('isPrivateIp — IPv4 mappées sous leur forme hexadécimale', () => {
  // `new URL('http://[::ffff:127.0.0.1]/')` normalise l'hôte en
  // `[::ffff:7f00:1]`, que seule la forme pointée était reconnue. La cible
  // n'était refusée que par accident (le DNS recevait l'hôte avec crochets).
  it('reconnaît ::ffff:7f00:1 et ses voisines', () => {
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true);
    expect(isPrivateIp('[::ffff:a00:1]')).toBe(true);      // 10.0.0.1
    expect(isPrivateIp('::ffff:a9fe:a9fe')).toBe(true);    // 169.254.169.254
    expect(isPrivateIp('::ffff:5db8:d822')).toBe(false);   // 93.184.216.34, public
  });

  it('reconnaît les formes compatibles et NAT64 qui embarquent une IPv4 privée', () => {
    expect(isPrivateIp('::127.0.0.1')).toBe(true);
    expect(isPrivateIp('64:ff9b::a00:1')).toBe(true);
    expect(isPrivateIp('64:ff9b::10.0.0.1')).toBe(true);
    expect(isPrivateIp('fec0::1')).toBe(true);
  });

  it('refuse l’URL qui porte la forme mappée', () => {
    expect(targetAllowedLiteral('http://[::ffff:127.0.0.1]/')).toBe(false);
  });
});

describe('expressions sans retour arrière quadratique', () => {
  it('lit le jeu de caractères d’un en-tête démesuré en temps linéaire', () => {
    const header = 'text/html; charset=' + ' '.repeat(15_000);
    const t0 = performance.now();
    sniffCharset(header, new Uint8Array());
    expect(performance.now() - t0).toBeLessThan(50);
    expect(sniffCharset('text/html; charset=" iso-8859-1"', new Uint8Array())).toBe('windows-1252');
  });

  it('retire la clôture de code finale sans s’étrangler sur une rafale de retours à la ligne', () => {
    const text = '<seg n="0">Bonjour</seg>' + '\n'.repeat(40_000) + 'x';
    const t0 = performance.now();
    parseTranslation(text, 1);
    expect(performance.now() - t0).toBeLessThan(100);
    expect(parseTranslation('```\nlang: fr\n<seg n="0">Salut</seg>\n```', 1).segments).toEqual(['Salut']);
  });
});

describe('getRedirectUri — l’hôte ne vient pas d’un en-tête du client', () => {
  const saved = process.env.FRIRSS_BASE_URL;
  afterEach(() => { if (saved === undefined) delete process.env.FRIRSS_BASE_URL; else process.env.FRIRSS_BASE_URL = saved; });

  // nginx réécrit `Host`, pas `X-Forwarded-Host` : la valeur du client passait
  // telle quelle dans le `redirect_uri` signé.
  it('ignore X-Forwarded-Host', () => {
    delete process.env.FRIRSS_BASE_URL;
    const req = { headers: { host: 'rss.example.org', 'x-forwarded-host': 'evil.example', 'x-forwarded-proto': 'https' }, protocol: 'http' } as unknown as Request;
    expect(getRedirectUri(req)).toBe('https://rss.example.org/api/auth/oidc/callback');
  });
});

describe('nginx.conf — adresse et schéma du client réel', () => {
  const conf = fs.readFileSync(path.join(process.cwd(), 'nginx.conf'), 'utf8');

  // Derrière un reverse proxy, `trust proxy 1` voyait l'IP du proxy pour tout
  // le monde : un seul seau de limite, qu'un inconnu remplissait en dix essais
  // pour bloquer la connexion de toute l'instance.
  it('reprend l’IP du client depuis un proxy du réseau privé', () => {
    expect(conf).toMatch(/set_real_ip_from\s+10\.0\.0\.0\/8;/);
    expect(conf).toMatch(/set_real_ip_from\s+172\.16\.0\.0\/12;/);
    expect(conf).toMatch(/set_real_ip_from\s+192\.168\.0\.0\/16;/);
    expect(conf).toMatch(/real_ip_header\s+X-Forwarded-For;/);
    expect(conf).toMatch(/real_ip_recursive\s+on;/);
    expect(conf).toMatch(/proxy_set_header X-Forwarded-For \$remote_addr;/);
  });

  // `X-Forwarded-Proto $scheme` remplaçait le `https` du proxy amont par `http` :
  // cookies OIDC jamais `Secure`, redirect_uri calculé en http://.
  // `$host` est l'en-tête Host SANS son port : derrière un proxy sur un port
  // non standard, sans FRIRSS_BASE_URL, le redirect_uri du SSO perdait `:port`
  // (le port arrivait avant par X-Forwarded-Host, qui n'est plus lu).
  it('transmet l’hôte avec son port', () => {
    expect(conf).toMatch(/proxy_set_header Host \$http_host;/);
  });

  it('relaie le schéma annoncé par le proxy amont', () => {
    expect(conf).toMatch(/map \$http_x_forwarded_proto \$frirss_forwarded_proto/);
    expect(conf).toMatch(/proxy_set_header X-Forwarded-Proto \$frirss_forwarded_proto;/);
  });
});
