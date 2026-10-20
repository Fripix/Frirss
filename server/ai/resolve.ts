import type { AiProvider } from './store.js';

export interface Availability { provider: AiProvider; key: string | null; paidByAdmin: boolean; own: boolean }

/**
 * `own` : vrai seulement pour une clé personnelle, pour dire à l'utilisateur de qui est la clé refusée.
 * Clé personnelle, sinon clé admin partagée ; `openai` sans clé reste utilisable (Ollama).
 * Un administrateur (`opts.adminUser`) se sert de la clé admin même non partagée, et n'est jamais
 * « payé par l'admin » : c'est sa propre clé, donc ni plafond quotidien ni facturation à un tiers.
 */
export function availableFor(
  providers: AiProvider[],
  keys: { user: (id: number) => string | null; admin: (id: number) => string | null },
  opts: { adminUser?: boolean } = {},
): Availability[] {
  const out: Availability[] = [];
  for (const provider of providers) {
    const mine = keys.user(provider.id);
    if (mine) { out.push({ provider, key: mine, paidByAdmin: false, own: true }); continue; }
    // L'admin se sert de sa propre clé, partagée ou non — et ne se facture pas lui-même.
    const admin = provider.shared || opts.adminUser ? keys.admin(provider.id) : null;
    if (admin) { out.push({ provider, key: admin, paidByAdmin: !opts.adminUser, own: false }); continue; }
    if (provider.type === 'openai' && !provider.hasAdminKey) out.push({ provider, key: null, paidByAdmin: false, own: false });
  }
  return out;
}

/**
 * Spec §6 et §17.3 : forçage > traduction > flux > catégorie > préféré > défaut admin ;
 * un étage muet ou indisponible est sauté. `translation` (réglage « fournisseur
 * des traductions ») n'est envoyé que par la route de traduction.
 */
export function resolveProvider(
  input: { force?: number | null; translation?: number | null; feed?: number | null; category?: number | null; preferred?: number | null; adminDefault?: number | null },
  available: Availability[],
): Availability | null {
  for (const id of [input.force, input.translation, input.feed, input.category, input.preferred, input.adminDefault]) {
    if (!id) continue;
    const hit = available.find((a) => a.provider.id === id);
    if (hit) return hit;
  }
  return available[0] ?? null;
}

export type ResolutionInput = Parameters<typeof resolveProvider>[0];

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
