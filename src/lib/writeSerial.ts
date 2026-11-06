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
 *
 * `serial.many` (relecture du second round) : une écriture groupée — un lot
 * de `markAsRead`/`markAsUnread` — attend les écritures en vol de TOUTES ses
 * clés, et chacune d'elles attend à son tour la fin du lot. Un lot dont
 * aucune clé n'est en vol part dans le même tour, comme une écriture seule.
 */
export interface WriteSerial {
  <T>(key: string, write: () => Promise<T>): Promise<T>;
  many<T>(keys: readonly string[], write: () => Promise<T>): Promise<T>;
}

export function createWriteSerial(): WriteSerial {
  const tails = new Map<string, Promise<void>>();
  function enqueue<T>(keys: readonly string[], write: () => Promise<T>): Promise<T> {
    const unique = [...new Set(keys)];
    const previous = unique.map((k) => tails.get(k)).filter((p): p is Promise<void> => !!p);
    const start = (): Promise<T> => {
      try {
        return Promise.resolve(write());
      } catch (err) {
        return Promise.reject(err);
      }
    };
    // Les queues ne rejettent jamais (voir `tail`) : `Promise.all` attend
    // simplement la dernière d'entre elles.
    const run = previous.length === 0 ? start()
      : previous.length === 1 ? previous[0].then(start)
        : Promise.all(previous).then(start);
    const tail = run.then(() => {}, () => {});
    for (const key of unique) tails.set(key, tail);
    void tail.then(() => {
      for (const key of unique) if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  }
  const serial = (<T>(key: string, write: () => Promise<T>) => enqueue([key], write)) as WriteSerial;
  serial.many = (keys, write) => enqueue(keys, write);
  return serial;
}
