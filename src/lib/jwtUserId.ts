/**
 * L'identifiant utilisateur porté par un jeton de session FriRSS (`userId`,
 * `server/routes/auth.ts` → `createSession`), ou `null` s'il est illisible.
 *
 * Lecture seule, SANS vérification de signature : ce n'est pas une preuve
 * d'identité (le serveur vérifie chaque requête), seulement une étiquette pour
 * savoir à quel compte appartient un état local — les préférences pas encore
 * envoyées (`prefsSync.ts`). Un jeton renouvelé du même compte garde le même
 * identifiant ; celui d'un autre compte, posé par-dessus (retour OIDC), non.
 */
export function jwtUserId(token: string | null | undefined): number | null {
  if (!token) return null;
  const part = token.split('.')[1];
  if (!part) return null;
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4))) as { userId?: unknown };
    return typeof payload?.userId === 'number' && Number.isFinite(payload.userId) ? payload.userId : null;
  } catch {
    return null;
  }
}
