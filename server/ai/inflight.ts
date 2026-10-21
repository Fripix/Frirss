/**
 * Générations en cours, côté SERVEUR. Le navigateur partage déjà ses propres
 * demandes en vol (`src/components/ReadingPane/aiPending.ts`), mais deux
 * onglets ou deux appareils du même compte restaient deux appels au
 * fournisseur, payés et comptés deux fois. Ici, une demande identique à une
 * génération en cours se rattache à sa promesse au lieu de rappeler le modèle.
 *
 * - La clé (`inflightKey`) porte le compte : deux utilisateurs ne partagent
 *   jamais une génération, même pour un contenu identique.
 * - Le rattaché ne réserve aucune unité de plafond : il attend un résultat que
 *   le premier a déjà réservé. Un échec rejette tout le monde ; rien n'est mis
 *   en cache (c'est `runWithFallback` qui écrit le cache, à la réussite seule).
 * - L'entrée disparaît dès que la génération se règle, réussite ou échec.
 * - « Régénérer » n'y passe pas : il ignore le cache ET ce partage (voir
 *   `summarize` et `translate`).
 */
const table = new Map<string, Promise<unknown>>();

export function inflightKey(userId: number, op: 'summary' | 'translate', parts: Record<string, unknown>): string {
  return JSON.stringify([userId, op, parts]);
}

/** `shared` : vrai pour qui s'est rattaché à une génération déjà en cours. */
export function shareInflight<T>(key: string, start: () => Promise<T>): Promise<{ value: T; shared: boolean }> {
  const existing = table.get(key) as Promise<T> | undefined;
  if (existing) return existing.then((value) => ({ value, shared: true }));
  const p = start();
  table.set(key, p);
  const clear = () => { if (table.get(key) === p) table.delete(key); };
  p.then(clear, clear);
  return p.then((value) => ({ value, shared: false }));
}

/** Tests : nombre de générations en cours. */
export function inflightSize(): number {
  return table.size;
}
