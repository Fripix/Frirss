import { isIPv4, isIPv6 } from 'node:net';

/*
 * Contrôles de valeurs venues du client, écrits pour un temps linéaire.
 *
 * Deux expressions de ce serveur revenaient en arrière de façon quadratique
 * sur une entrée piégée : `/^[^\s@]+@[^\s@]+\.[^\s@]+$/` (un `@` suivi de
 * dizaines de milliers de points) et `/\/+$/` (des barres suivies d'un autre
 * caractère). Le corps admis va jusqu'à 5 Mo : une requête gelait l'unique
 * boucle d'événements pendant des heures — la première sans même un compte.
 */

/** Longueur maximale d'une adresse (RFC 5321). */
const EMAIL_MAX = 254;
// Le domaine est découpé par ses points, sans chevauchement : un seul chemin
// possible, donc pas de retour arrière.
const EMAIL_RE = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

/** Forme d'adresse e-mail (pas une validation RFC complète, voulu). */
export function isValidEmail(v: unknown): v is string {
  return typeof v === 'string' && v.length <= EMAIL_MAX && EMAIL_RE.test(v);
}

/** Retire les barres finales, sans expression régulière. */
export function stripTrailingSlashes(s: string): string {
  let end = s.length;
  while (end > 0 && s.charCodeAt(end - 1) === 47 /* / */) end--;
  return s.slice(0, end);
}

/** Développe une IPv6 en huit groupes de 16 bits ; `null` si illisible. */
function ipv6Groups(ip: string): number[] | null {
  let s = ip.toLowerCase();
  // Forme à IPv4 finale (`::ffff:1.2.3.4`) : les deux derniers groupes.
  const v4 = s.match(/:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (v4) {
    const [a, b, c, d] = v4[1].split('.').map(Number);
    s = `${s.slice(0, -v4[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head, tail] = s.split('::');
  const h = head ? head.split(':') : [];
  const t = tail !== undefined && tail !== '' ? tail.split(':') : [];
  const fill = tail !== undefined ? 8 - h.length - t.length : 0;
  const groups = [...h, ...Array(Math.max(0, fill)).fill('0'), ...t].map((g) => parseInt(g, 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

/**
 * Clé d'un limiteur « par adresse ». Une IPv6 est regroupée par /56 : un
 * client en reçoit au moins une /64 de son fournisseur et en change à
 * volonté, ce qui lui donnait un seau neuf par essai (force brute illimitée,
 * et autant de hachages bcrypt sur le thread principal). Une IPv4 mappée se
 * compte comme l'IPv4 qu'elle porte.
 */
export function rateLimitIpKey(ip: string | undefined): string {
  if (!ip) return '';
  if (isIPv4(ip)) return ip;
  if (!isIPv6(ip)) return ip;
  const mapped = ip.toLowerCase().match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mapped) return mapped[1];
  const g = ipv6Groups(ip);
  if (!g) return ip;
  // /56 = trois groupes entiers et l'octet haut du quatrième.
  return `${g.slice(0, 3).map((x) => x.toString(16)).join(':')}:${(g[3] & 0xff00).toString(16)}::/56`;
}
