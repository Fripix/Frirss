/**
 * Écritures mises en série par clé (M-12, second round 1.9.0).
 *
 * « Lu » puis « non lu » aussitôt sur le même article partaient en parallèle :
 * sur un réseau lent, FreshRSS pouvait recevoir le second avant le premier et
 * garder « lu » pendant que l'écran disait « non lu », jusqu'au rechargement.
 * Une écriture attend désormais que la précédente sur la même clé (article et
 * attribut) soit réglée — réussie ou échouée — avant de partir : le serveur
 * les reçoit dans l'ordre des gestes, et la dernière intention gagne, chez lui
 * comme à l'écran.
 *
 * La première écriture d'une clé part tout de suite, dans le même tour : rien
 * ne change pour un geste isolé. Deux clés différentes ne s'attendent jamais.
 * Chaque écriture rend son propre résultat ou sa propre erreur : la logique de
 * chaque geste (file hors ligne, retour arrière sur refus) reste la sienne.
 */
export function createWriteSerial() {
  const tails = new Map<string, Promise<void>>();
  return function serial<T>(key: string, write: () => Promise<T>): Promise<T> {
    const previous = tails.get(key);
    const start = (): Promise<T> => {
      try {
        return Promise.resolve(write());
      } catch (err) {
        return Promise.reject(err);
      }
    };
    const run = previous ? previous.then(start) : start();
    const tail = run.then(() => {}, () => {});
    tails.set(key, tail);
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  };
}
