import type { Request, Response, NextFunction } from 'express';

/**
 * Journal d'accès : une ligne par requête — horodatage, méthode, chemin, code,
 * durée.
 *
 * `req.path` et JAMAIS `req.originalUrl` : la chaîne de requête ne doit pas
 * atteindre le journal. `GET /api/extract?url=…` y déposerait l'URL complète de
 * chaque article lu par chaque compte — préchargement des dix articles suivants
 * et balayage `prepareOffline` de trente jours compris, donc bien plus que ce
 * que la personne a réellement lu. Le refus de cible, lui, journalise déjà sa
 * cible expurgée (`finishError`) : c'est cette intention-là que la ligne
 * d'accès défaisait, sur le chemin du succès qui est le cas courant.
 * La règle est volontairement globale, et non une exception pour cette route :
 * la prochaine route qui portera une donnée en query string en héritera.
 *
 * ⚠️ **Le chemin est lu MAINTENANT, pas dans `finish`.** Express réécrit
 * `req.url` en relatif au routeur qui traite la requête, et ne le restaure
 * qu'au retour de `next()` — ce qu'une route qui RÉPOND ne fait jamais. Lu
 * depuis `res.on('finish')`, `req.path` valait donc `/` pour `/api/proxy`
 * comme pour `/api/extract` (les deux routes les plus volumineuses, devenues
 * indiscernables), `/login` pour `/api/auth/login`, `/users/3` pour
 * `/api/admin/users/3` : toutes les routes sauf `/api/health` perdaient leur
 * préfixe. Le but de confidentialité était tenu, la valeur d'exploitation du
 * journal était perdue. Ici, avant tout routage, `req.path` est le chemin
 * complet. Couvert par `server/test/accessLog.test.ts`.
 *
 * `write` est injectable pour que le test lise ce qui est écrit plutôt que
 * d'espionner la console.
 */
export function accessLog(
  write: (line: string) => void = (line) => console.log(line),
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const path = req.path;
    if (path === '/api/health') return next();   // bruit de sonde
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - start) / 1e6;
      write(`${new Date().toISOString()} ${req.method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  };
}
