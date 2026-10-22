import type { AiProviderView } from '../api/backend';

/** Un choix de fournisseur : `value` vide (`null`) pour l'option par défaut. */
export interface ProviderChoice { value: number | null; label: string; disabled: boolean }

/**
 * Les choix d'une liste de fournisseurs, une seule règle pour les `<option>`
 * des sélecteurs et pour le menu de « Par flux et catégorie » : l'option par
 * défaut (`defaultLabel`), un fournisseur par choix — grisé et marqué « clé
 * requise » s'il n'est pas utilisable par cet utilisateur — et, si `value`
 * désigne un fournisseur qui n'existe plus, un choix « Fournisseur supprimé »
 * qui garde la valeur visible au lieu de retomber en silence sur le défaut.
 */
export function providerChoices(
  providers: AiProviderView[], value: number | null, defaultLabel: string, t: (key: string, o?: Record<string, unknown>) => string,
): ProviderChoice[] {
  const removed = value !== null && !providers.some((p) => p.id === value);
  return [
    { value: null, label: defaultLabel, disabled: false },
    ...providers.map((p) => ({ value: p.id, label: p.available ? p.name : t('ai.user.keyRequired', { name: p.name }), disabled: !p.available })),
    ...(removed ? [{ value, label: t('ai.user.removedProvider'), disabled: false }] : []),
  ];
}
