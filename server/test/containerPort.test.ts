import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Port d'écoute du conteneur (#33). En réseau « host » ou avec une IP propre
// (macvlan, br0 d'Unraid), `-p hôte:80` ne s'applique pas : nginx doit pouvoir
// écouter ailleurs que sur 80. Le comportement réel (conteneur démarré avec
// FRIRSS_PORT, santé, refus d'une valeur invalide) est vérifié par le job
// `docker` de la CI ; ces tests gardent les trois fils qui doivent rester liés.

const root = process.cwd();
const entrypoint = fs.readFileSync(path.join(root, 'docker-entrypoint.sh'), 'utf8');
const dockerfile = fs.readFileSync(path.join(root, 'Dockerfile'), 'utf8');
const nginxConf = fs.readFileSync(path.join(root, 'nginx.conf'), 'utf8');

describe('FRIRSS_PORT — port d’écoute de nginx', () => {
  it('garde 80 par défaut dans nginx.conf, sous une forme que l’entrypoint sait réécrire', () => {
    expect(nginxConf).toMatch(/^\s*listen 80;$/m);
  });

  it('est lu par l’entrypoint, avec 80 par défaut', () => {
    expect(entrypoint).toMatch(/FRIRSS_PORT="\$\{FRIRSS_PORT:-80\}"/);
  });

  // Le contrôle de santé interrogeait 127.0.0.1:80 en dur : sur un autre port,
  // le conteneur aurait passé pour malade alors qu'il répondait.
  it('est suivi par le contrôle de santé de l’image', () => {
    const health = dockerfile.split('\n').filter((l) => /HEALTHCHECK|CMD wget/.test(l)).join('\n');
    expect(health).toMatch(/127\.0\.0\.1:\$\{FRIRSS_PORT:-80\}\/api\/health/);
    expect(health).not.toMatch(/127\.0\.0\.1:80\//);
  });

  // Node lit `PORT` (3001 par défaut) et nginx lui envoie l’API sur 3001 en dur.
  // Quelqu’un qui tente `PORT=8081` pour changer le port public déplaçait Node
  // et cassait toute l’API : le conteneur fixe donc le port de Node.
  it('ne laisse pas une variable PORT déplacer Node hors de 3001', () => {
    expect(nginxConf).toMatch(/proxy_pass http:\/\/127\.0\.0\.1:3001;/);
    const nodeLaunches = entrypoint.split('\n').filter((l) => /exec .*node server-dist\/index\.js/.test(l));
    expect(nodeLaunches.length).toBe(2);
    for (const line of nodeLaunches) expect(line).toMatch(/PORT=3001 /);
  });

  it('refuse 3001, qui est le port interne de Node', () => {
    expect(entrypoint).toMatch(/3001/);
    expect(entrypoint).toMatch(/FRIRSS_PORT[^\n]*3001|3001[^\n]*FRIRSS_PORT/);
  });
});

// M2, campagne 1.9.2 : en réseau « host » ou avec une IP propre (les
// déploiements de FRIRSS_PORT), Node écoutait sur toutes les interfaces : le
// 3001 était joignable sans nginx, et `trust proxy` croyait le
// `X-Forwarded-For` du premier venu, ce qui contournait les limites par IP
// (connexion, inscription, sauvegarde). Seul nginx a besoin de Node, par
// 127.0.0.1 : l'image l'y attache. Le comportement réel est vérifié par le
// job `docker` de la CI.
describe('Node écoute seulement l’intérieur du conteneur', () => {
  const server = fs.readFileSync(path.join(root, 'server/index.ts'), 'utf8');

  it('l’entrypoint attache Node à 127.0.0.1, à côté du port 3001', () => {
    const nodeLaunches = entrypoint.split('\n').filter((l) => /exec .*node server-dist\/index\.js/.test(l));
    expect(nodeLaunches.length).toBe(2);
    for (const line of nodeLaunches) expect(line).toMatch(/FRIRSS_BACKEND_HOST=127\.0\.0\.1 /);
  });

  it('le serveur écoute sur cette adresse quand elle est donnée, partout sinon (développement)', () => {
    expect(server).toMatch(/app\.listen\(Number\(PORT\), BACKEND_HOST/);
    expect(server).toMatch(/const BACKEND_HOST = process\.env\.FRIRSS_BACKEND_HOST \|\| undefined/);
  });

  it('nginx joint bien Node par 127.0.0.1', () => {
    expect(nginxConf).not.toMatch(/proxy_pass http:\/\/(localhost|\[::1\]):3001/);
    expect(nginxConf.match(/proxy_pass http:\/\/127\.0\.0\.1:3001;/g)?.length).toBeGreaterThan(0);
  });
});
