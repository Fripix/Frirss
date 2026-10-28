import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { TIMEOUT_DEFAULT_MS, TIMEOUT_AI_MS, TIMEOUT_BACKUP_MS } from './requestTimeouts';

// Règle : le serveur répond TOUJOURS avant que le client abandonne. Un abandon
// sans réponse est lu par `isUpstreamCut` comme une coupure amont, et la
// traduction rejoue alors un lot coupé en deux : un délai client plus court
// que le budget serveur fabriquerait exactement ce cas.
//
// Les budgets serveur sont RELUS dans leurs fichiers, pas recopiés : importer
// le code serveur dans le bundle du navigateur n'est pas une option, et une
// copie dériverait en silence le jour où l'un des deux bouge.
const read = (p: string) => fs.readFileSync(path.join(process.cwd(), p), 'utf8');

function proxyTotalMs(): number {
  const m = /export const PROXY_TOTAL_TIMEOUT_MS = ([\d_]+);/.exec(read('server/routes/proxy.ts'));
  expect(m, 'PROXY_TOTAL_TIMEOUT_MS introuvable dans server/routes/proxy.ts').not.toBeNull();
  return Number(m![1].replace(/_/g, ''));
}

function lookupMs(): number {
  const m = /export const LOOKUP_TIMEOUT_MS = ([\d_]+);/.exec(read('server/routes/proxy.ts'));
  expect(m, 'LOOKUP_TIMEOUT_MS introuvable dans server/routes/proxy.ts').not.toBeNull();
  return Number(m![1].replace(/_/g, ''));
}

function nginxReadMs(): number {
  const m = /proxy_read_timeout (\d+)s;/.exec(read('nginx.conf'));
  expect(m, 'proxy_read_timeout introuvable dans nginx.conf').not.toBeNull();
  return Number(m![1]) * 1000;
}

describe('délais client — toujours au-dessus du budget serveur', () => {
  it('lit les budgets serveur attendus', () => {
    expect(proxyTotalMs()).toBe(60_000);
    expect(nginxReadMs()).toBe(120_000);
  });

  it('le délai par défaut dépasse l’échéance totale du proxy, résolution du dernier saut comprise', () => {
    // L'échéance n'interrompt pas une résolution DNS en cours : elle est
    // constatée au saut suivant, au plus `LOOKUP_TIMEOUT_MS` plus tard.
    expect(TIMEOUT_DEFAULT_MS).toBeGreaterThan(proxyTotalMs() + lookupMs());
  });

  it('les appels IA dépassent la coupure de nginx', () => {
    expect(TIMEOUT_AI_MS).toBeGreaterThan(nginxReadMs());
  });

  it('la sauvegarde dépasse la coupure de nginx', () => {
    expect(TIMEOUT_BACKUP_MS).toBeGreaterThan(nginxReadMs());
  });

  it('garde les valeurs fixées', () => {
    expect(TIMEOUT_DEFAULT_MS).toBe(75_000);
    expect(TIMEOUT_AI_MS).toBe(150_000);
    expect(TIMEOUT_BACKUP_MS).toBe(150_000);
  });
});
