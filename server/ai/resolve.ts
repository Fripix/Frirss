import type { AiProvider } from './store.js';

export interface Availability { provider: AiProvider; key: string | null; paidByAdmin: boolean }

/** Clé personnelle, sinon clé admin partagée ; `openai` sans clé reste utilisable (Ollama). */
export function availableFor(
  providers: AiProvider[],
  keys: { user: (id: number) => string | null; admin: (id: number) => string | null },
  opts: { adminUser?: boolean } = {},
): Availability[] {
  const out: Availability[] = [];
  for (const provider of providers) {
    const mine = keys.user(provider.id);
    if (mine) { out.push({ provider, key: mine, paidByAdmin: false }); continue; }
    // L'admin se sert de sa propre clé, partagée ou non — et ne se facture pas lui-même.
    const admin = provider.shared || opts.adminUser ? keys.admin(provider.id) : null;
    if (admin) { out.push({ provider, key: admin, paidByAdmin: !opts.adminUser }); continue; }
    if (provider.type === 'openai' && !provider.hasAdminKey) out.push({ provider, key: null, paidByAdmin: false });
  }
  return out;
}

/** Spec §6 : forçage > flux > catégorie > préféré > défaut admin ; un étage muet ou indisponible est sauté. */
export function resolveProvider(
  input: { force?: number | null; feed?: number | null; category?: number | null; preferred?: number | null; adminDefault?: number | null },
  available: Availability[],
): Availability | null {
  for (const id of [input.force, input.feed, input.category, input.preferred, input.adminDefault]) {
    if (!id) continue;
    const hit = available.find((a) => a.provider.id === id);
    if (hit) return hit;
  }
  return available[0] ?? null;
}

export function fallbackOrder(first: Availability, available: Availability[]): Availability[] {
  const seen = new Set<number>([first.provider.id]);
  const out: Availability[] = [first];
  for (const a of available) {
    if (seen.has(a.provider.id)) continue;
    seen.add(a.provider.id);
    out.push(a);
  }
  return out;
}
