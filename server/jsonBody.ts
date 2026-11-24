import type { IncomingMessage, ServerResponse } from 'node:http';
import { jsonTooDeep } from './jsonDepth.js';

/** `type` de l'erreur rendue par `rejectTooDeep`, traduite en 400 par `index.ts`. */
export const JSON_TOO_DEEP = 'entity.too.deep';

/**
 * `verify` d'`express.json()` : refuse un corps trop imbriqué AVANT l'analyse.
 * Sous Node 26, un corps imbriqué sur des millions de niveaux s'analyse puis
 * se réécrit (`JSON.stringify` des préférences, d'une sauvegarde) en
 * secondes, pendant lesquelles le serveur ne répond à personne (`jsonDepth.ts`).
 * body-parser garde le `type` de l'erreur levée ici.
 */
export function rejectTooDeep(_req: IncomingMessage, _res: ServerResponse, buf: Buffer): void {
  if (jsonTooDeep(buf)) {
    throw Object.assign(new Error('JSON nested too deeply'), { type: JSON_TOO_DEEP, status: 400 });
  }
}
