/**
 * Choix du jeu de caractères d'une page, avant de la décoder.
 *
 * Tout était lu en UTF-8. Une page servie en ISO-8859-1 (developpez.com) sortait
 * criblée de U+FFFD (« a rapport� qu'Elon Musk… ») alors que la copie de
 * FreshRSS du même article était propre : le défaut était chez nous.
 *
 * Ordre, celui des navigateurs : BOM, puis `charset=` de l'en-tête, puis balise
 * `<meta>` dans les premiers octets, puis UTF-8.
 */

/** Étendue où l'on cherche la balise `<meta>` (la norme HTML en prescrit 1 024). */
const META_SCAN_BYTES = 2048;

const HEADER_CHARSET = /charset\s*=\s*["']?\s*([^\s"';,]+)/i;
const META_CHARSET = /<meta[^>]+charset\s*=\s*["']?\s*([^\s"';,>/]+)/i;

/**
 * Normalise un libellé par `TextDecoder` ; `null` s'il est inconnu.
 *
 * `iso-8859-1` devient `windows-1252` : c'est ce que font les navigateurs
 * (la norme WHATWG les confond), et des pages étiquetées latin-1 contiennent
 * couramment des guillemets ou apostrophes typographiques en 0x80-0x9F.
 */
function normalise(label: string): string | null {
  try {
    const name = new TextDecoder(label).encoding;
    return name === 'iso-8859-1' ? 'windows-1252' : name;
  } catch {
    return null;
  }
}

export function sniffCharset(contentType: string | undefined, head: Uint8Array): string {
  if (head.length >= 3 && head[0] === 0xef && head[1] === 0xbb && head[2] === 0xbf) return 'utf-8';

  const fromHeader = contentType ? HEADER_CHARSET.exec(contentType)?.[1] : undefined;
  if (fromHeader) {
    const name = normalise(fromHeader);
    if (name) return name;
  }

  // Latin-1 pour le balayage : un octet = un caractère, rien ne peut échouer
  // et les déclarations (ASCII) ressortent telles quelles.
  const scan = Buffer.from(head.subarray(0, META_SCAN_BYTES)).toString('latin1');
  const fromMeta = META_CHARSET.exec(scan)?.[1];
  if (fromMeta) {
    const name = normalise(fromMeta);
    if (name) return name;
  }

  return 'utf-8';
}

/** Décode des octets de page selon leur jeu de caractères déclaré. */
export function decodeBody(bytes: Uint8Array, contentType: string | undefined): string {
  return new TextDecoder(sniffCharset(contentType, bytes), { fatal: false }).decode(bytes);
}
