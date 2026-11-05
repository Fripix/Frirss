// Jeton d'écriture greader (`T`), tenu par le serveur et lui seul.
//
// Ce n'est pas un simple jeton CSRF : FreshRSS le calcule comme la partie
// secrète de `Auth=` (le jeton FreshRSS complet) complétée par des `Z`.
// Relayé au navigateur, il redonnait donc le jeton FreshRSS entier, obtenable
// à tout moment avec un JWT FriRSS et valable après la déconnexion, jusqu'au
// changement du mot de passe d'API. Depuis 1.9.0 :
//
//  - le corps de `/reader/api/0/token` ne sort plus : le proxy répond un jeton
//    FACTICE (`WRITE_TOKEN_PLACEHOLDER`), pour qu'un onglet resté sur l'ancien
//    code pendant une mise à jour continue d'écrire ;
//  - toute écriture greader vers un serveur du compte est signée ICI : le `T`
//    du client (factice ou absent) est retiré, le vrai est ajouté ;
//  - un jeton gardé en mémoire et refusé est redemandé, l'écriture rejouée UNE
//    fois (la reprise que faisait `postSigned` côté client jusqu'en 1.8).

/** Ce que reçoit un client qui lit encore `/token` : un jeton qui ne vaut rien. */
export const WRITE_TOKEN_PLACEHOLDER = 'frirss-server-signed';

/** Octets lus au plus pour la réponse de `/token` (57 caractères chez FreshRSS). */
export const MAX_WRITE_TOKEN_BYTES = 4096;

/**
 * Le chemin tel que FreshRSS le lira : `greader.php` applique `rawurldecode`
 * à un `PATH_INFO` que le serveur web a souvent déjà décodé, et nginx fusionne
 * les barres répétées. Décoder jusqu'à stabilité et ignorer les segments vides
 * donne un SUR-ensemble de ce que FreshRSS route : c'est le bon côté pour une
 * garde.
 */
function freshrssSegments(rawTarget: string): string[] | null {
  let path: string;
  try { path = new URL(rawTarget).pathname; } catch { return null; }
  for (let i = 0; i < 5; i++) {
    const next = path.replace(/%([0-9a-f]{2})/gi, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
    if (next === path) break;
    path = next;
  }
  return path.toLowerCase().split('/').filter(Boolean);
}

function indexOfApi(segs: string[]): number {
  for (let i = 0; i + 2 < segs.length; i++) {
    if (segs[i] === 'reader' && segs[i + 1] === 'api' && segs[i + 2] === '0') return i + 3;
  }
  return -1;
}

/**
 * La cible désigne-t-elle le point d'accès qui rend le jeton ? Tout verbe :
 * FreshRSS ne regarde pas la méthode, et `token/autre-chose` y mène aussi.
 */
export function isWriteTokenPath(rawTarget: string): boolean {
  const segs = freshrssSegments(rawTarget);
  if (!segs) return false;
  const at = indexOfApi(segs);
  return at >= 0 && segs[at] === 'token';
}

/** Une écriture greader : tout sauf GET/HEAD sous `/reader/api/0/`, `/token` exclu. */
export function isGreaderWrite(method: string, rawTarget: string): boolean {
  if (method === 'GET' || method === 'HEAD') return false;
  const segs = freshrssSegments(rawTarget);
  return !!segs && indexOfApi(segs) >= 0 && !isWriteTokenPath(rawTarget);
}

/**
 * L'URL de `/token` voisine d'une écriture : même origine, même préfixe. Lue
 * sur le chemin BRUT : une écriture au chemin encodé n'est pas signée (elle
 * échoue chez FreshRSS), plutôt que de deviner un préfixe.
 */
export function writeTokenUrl(rawTarget: string): string | null {
  let u: URL;
  try { u = new URL(rawTarget); } catch { return null; }
  const at = u.pathname.indexOf('/reader/api/0/');
  if (at < 0) return null;
  return `${u.origin}${u.pathname.slice(0, at)}/reader/api/0/token`;
}

/** Un corps de formulaire peut-il être signé ? Formulaire ou corps vide seulement. */
export function isSignableContentType(ct: string | undefined): boolean {
  if (!ct) return true;
  return ct.split(';')[0].trim().toLowerCase() === 'application/x-www-form-urlencoded';
}

/** Le corps avec le seul vrai `T` : celui du client (factice, ancien) est retiré. */
export function signFormBody(body: Buffer | undefined, token: string): Buffer {
  const params = new URLSearchParams(body ? body.toString('utf8') : '');
  params.delete('T');
  params.append('T', token);
  return Buffer.from(params.toString(), 'utf8');
}

/**
 * Le refus d'un jeton : 401 (réponse canonique de greader, `Google-Bad-Token`),
 * 403 et 400 selon la version de FreshRSS et le proxy devant. Pas un 5xx
 * (la file d'attente du client le rejoue), pas les autres 4xx.
 */
const TOKEN_REJECTED_STATUSES = new Set([400, 401, 403]);
export function isStaleWriteTokenStatus(status: number): boolean {
  return TOKEN_REJECTED_STATUSES.has(status);
}

/**
 * Un jeton lisible : FreshRSS rend un condensé hexadécimal complété par des
 * `Z`. L'alphabet admis reste large (base64, URL), pas au point d'accepter
 * une page HTML servie en 200 par un proxy ou une maintenance.
 */
export function parseWriteToken(text: string): string | null {
  const t = text.trim();
  return /^[A-Za-z0-9._~+/=-]{1,512}$/.test(t) ? t : null;
}

/**
 * Jetons en mémoire, par compte et par serveur. L'entrée porte l'empreinte de
 * ce qui l'a produite (jeton FreshRSS CHIFFRÉ tel qu'en base, URL du serveur) :
 * changer d'identifiants ou d'adresse la rend caduque sans qu'aucune route
 * n'ait à y penser. Rien n'y est écrit sur disque.
 */
const MAX_ENTRIES = 1000;
const tokens = new Map<string, { stamp: string; token: string }>();
const inFlight = new Map<string, { stamp: string; promise: Promise<string> }>();

export function cachedWriteToken(key: string, stamp: string): string | null {
  const hit = tokens.get(key);
  return hit && hit.stamp === stamp ? hit.token : null;
}

export function forgetWriteToken(key: string): void {
  tokens.delete(key);
}

/**
 * Demande un jeton, une seule fois pour toutes les écritures simultanées d'un
 * même serveur (un défilement qui marque dix articles d'un coup).
 */
export function fetchWriteTokenOnce(key: string, stamp: string, fetcher: () => Promise<string>): Promise<string> {
  const pending = inFlight.get(key);
  if (pending && pending.stamp === stamp) return pending.promise;
  const promise = fetcher().then((token) => {
    if (tokens.size >= MAX_ENTRIES && !tokens.has(key)) {
      const oldest = tokens.keys().next().value;
      if (oldest !== undefined) tokens.delete(oldest);
    }
    tokens.set(key, { stamp, token });
    return token;
  }).finally(() => {
    if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
  });
  inFlight.set(key, { stamp, promise });
  return promise;
}

/** Pour les tests : repartir d'une mémoire vide. */
export function resetWriteTokens(): void {
  tokens.clear();
  inFlight.clear();
}

/** Échec de `/token` avec un statut amont, relayé tel quel au client. */
export class WriteTokenRefusedError extends Error {
  constructor(readonly status: number) { super(`write token refused (${status})`); }
}
