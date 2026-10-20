/**
 * Le HTML envoyé pour un résumé, allégé de ce qu'un modèle ne lit pas.
 *
 * Le serveur refuse un corps au-delà de 200 Ko (`invalid_body`) : une seule
 * image en `data:` base64 suffit à l'atteindre, et l'utilisateur lirait
 * « trop long » pour un article de dix lignes. Le texte, lui, reste intact
 * (`stripMediaForSummary`) ; un article encore trop gros est coupé à la
 * limite (`fitSummaryPayload`) — c'est le TEXTE que le serveur borne ensuite.
 *
 * Linéaire : chaque ouvrante cherche sa fermante une seule fois, et une
 * fermante absente l'est pour toutes les ouvrantes suivantes du même nom.
 */
const CONTAINERS = ['svg', 'video', 'audio', 'iframe', 'picture'] as const;

function stripContainer(html: string, name: string): string {
  const open = new RegExp(`<${name}\\b[^<>]*>`, 'gi');
  const close = new RegExp(`</${name}\\s*>`, 'gi');
  let out = '';
  let from = 0;
  let closed = true;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html)) !== null) {
    out += html.slice(from, m.index);
    from = open.lastIndex;
    if (!closed) continue;
    close.lastIndex = open.lastIndex;
    const c = close.exec(html);
    if (!c) { closed = false; continue; }   // ouvrante orpheline : seule la balise part
    from = close.lastIndex;
    open.lastIndex = from;
  }
  return (out + html.slice(from)).replace(close, '');
}

export function stripMediaForSummary(html: string): string {
  let out = html.replace(/<img\b[^<>]*>/gi, '');
  for (const name of CONTAINERS) out = stripContainer(out, name);
  // Tout attribut dont la valeur est une URI `data:` (src, srcset, poster, href…).
  return out.replace(/\s[\w:-]+\s*=\s*(?:"\s*data:[^"]*"|'\s*data:[^']*'|data:[^\s>]*)/gi, '');
}

/** Sous la limite du serveur (`MAX_HTML_BYTES`, 200 Kio), en octets UTF-8. */
export const MAX_SUMMARY_HTML_BYTES = 200_000;

/**
 * Coupe un HTML trop gros à `MAX_SUMMARY_HTML_BYTES` octets au lieu de le
 * laisser refuser : un long article rendait « Article trop long » alors que
 * le serveur sait déjà couper le texte. La coupe ne fend jamais un caractère
 * (`encodeInto` s'arrête avant) et ne laisse pas de balise entamée : si elle
 * tombe dans une balise, on recule à son `<`. Tombée dans du texte, elle reste
 * là — reculer au dernier `<` viderait un article fait d'un seul paragraphe.
 */
export function fitSummaryPayload(html: string): string {
  const encoder = new TextEncoder();
  if (html.length <= MAX_SUMMARY_HTML_BYTES / 3 || encoder.encode(html).length <= MAX_SUMMARY_HTML_BYTES) return html;
  const { read } = encoder.encodeInto(html, new Uint8Array(MAX_SUMMARY_HTML_BYTES));
  const cut = html.slice(0, read);
  const lt = cut.lastIndexOf('<');
  return lt > cut.lastIndexOf('>') ? cut.slice(0, lt) : cut;
}
