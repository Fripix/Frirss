/**
 * Le HTML envoyé pour un résumé, allégé de ce qu'un modèle ne lit pas.
 *
 * Le serveur refuse un corps au-delà de 200 Ko (`invalid_body`) : une seule
 * image en `data:` base64 suffit à l'atteindre, et l'utilisateur lirait
 * « trop long » pour un article de dix lignes. Le texte, lui, reste intact.
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
