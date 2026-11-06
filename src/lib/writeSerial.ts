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
 *
 * `serial.barrier` (limites restantes du second round) : une écriture À
 * BORNE — « tout marquer comme lu », marquage « en dessous » — ne nomme aucun
 * article : rien ne dit lesquels elle touche avant la réponse. Elle attend
 * donc toutes les écritures en vol de son GROUPE (`groupOf`, fourni à la
 * création : dans `feedStore`, les écritures « lu » d'une portée), et toute
 * écriture du groupe lancée pendant elle — geste, lot, rejeu, autre borne —
 * attend son règlement. Rien du groupe en vol : elle part dans le même tour.
 */
export interface WriteSerial {
  <T>(key: string, write: () => Promise<T>): Promise<T>;
  many<T>(keys: readonly string[], write: () => Promise<T>): Promise<T>;
  barrier<T>(group: string, write: () => Promise<T>): Promise<T>;
}

export function createWriteSerial(opts: { groupOf?: (key: string) => string | null } = {}): WriteSerial {
  const tails = new Map<string, Promise<void>>();
  /** La dernière écriture à borne de chaque groupe, tant qu'elle n'est pas réglée. */
  const barriers = new Map<string, Promise<void>>();
  const groupOf = opts.groupOf ?? (() => null);
  function settleTail<T>(run: Promise<T>): Promise<void> {
    return run.then(() => {}, () => {});
  }
  /** Lance `write` après `previous` — tout de suite, dans le même tour, s'il
   *  n'y a rien. Les queues ne rejettent jamais (`settleTail`) : `Promise.all`
   *  attend simplement la dernière d'entre elles. */
  function begin<T>(previous: Promise<void>[], write: () => Promise<T>): Promise<T> {
    const start = (): Promise<T> => {
      try {
        return Promise.resolve(write());
      } catch (err) {
        return Promise.reject(err);
      }
    };
    return previous.length === 0 ? start()
      : previous.length === 1 ? previous[0].then(start)
        : Promise.all(previous).then(start);
  }
  function enqueue<T>(keys: readonly string[], write: () => Promise<T>): Promise<T> {
    const unique = [...new Set(keys)];
    const previous = unique.map((k) => tails.get(k)).filter((p): p is Promise<void> => !!p);
    // Une borne en cours sur le groupe d'une clé passe avant elle.
    for (const key of unique) {
      const group = groupOf(key);
      const pending = group == null ? undefined : barriers.get(group);
      if (pending && !previous.includes(pending)) previous.push(pending);
    }
    const run = begin(previous, write);
    const tail = settleTail(run);
    for (const key of unique) tails.set(key, tail);
    void tail.then(() => {
      for (const key of unique) if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  }
  function barrier<T>(group: string, write: () => Promise<T>): Promise<T> {
    const previous = [...tails].filter(([key]) => groupOf(key) === group).map(([, tail]) => tail);
    const pending = barriers.get(group);
    if (pending) previous.push(pending);
    const run = begin(previous, write);
    const tail = settleTail(run);
    barriers.set(group, tail);
    void tail.then(() => {
      if (barriers.get(group) === tail) barriers.delete(group);
    });
    return run;
  }
  const serial = (<T>(key: string, write: () => Promise<T>) => enqueue([key], write)) as WriteSerial;
  serial.many = (keys, write) => enqueue(keys, write);
  serial.barrier = barrier;
  return serial;
}
