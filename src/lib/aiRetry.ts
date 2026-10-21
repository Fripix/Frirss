import type { AiProviderView } from '../api/backend';

/**
 * Le fournisseur à proposer après un échec : le premier `available` qui suit
 * `failedId` dans l'ordre de la liste (celui de l'admin, que le repli du
 * serveur suit aussi), sinon — fin de liste — le premier `available` autre que
 * `failedId`, sinon `null`. Un `failedId` inconnu ou absent (une erreur sans
 * fournisseur nommé) donne le premier `available`.
 */
export function nextProvider(providers: AiProviderView[], failedId: number | undefined): AiProviderView | null {
  const at = failedId === undefined ? -1 : providers.findIndex((p) => p.id === failedId);
  const after = providers.slice(at + 1).find((p) => p.available);
  if (after) return after;
  return providers.find((p) => p.available && p.id !== failedId) ?? null;
}
