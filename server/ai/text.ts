/**
 * HTML nettoyé → texte brut pour le prompt. Pas de DOM : une passe de regex
 * suffit pour un contenu déjà passé par le sanitiseur, et c'est synchrone.
 */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
};

export function htmlToText(html: string, maxChars = 200_000): string {
  const text = html
    // Un saut de ligne dans la source est un espace en HTML : seuls les blocs et <br> cassent la ligne.
    .replace(/[ \t\r\f\v]*\n[ \t\r\f\v]*/g, ' ')
    .replace(/<(script|style|noscript)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article|figcaption)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Balises en ligne : elles ne séparent pas les mots (« <b>mot</b>. » reste « mot. »).
    .replace(/<\/?(?:a|abbr|b|cite|code|em|font|i|ins|kbd|mark|q|s|small|span|strong|sub|sup|time|u)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        // String.fromCodePoint lève une RangeError hors de 0..0x10FFFF ; les surrogates ne sont pas des caractères.
        const valid = Number.isFinite(n) && n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff);
        return valid ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (text.length <= maxChars) return text;
  // Coupe, retire un surrogate haut resté seul en fin de coupe, puis rogne l'espace résiduel.
  let cut = text.slice(0, maxChars);
  if (/[\uD800-\uDBFF]$/.test(cut)) cut = cut.slice(0, -1);
  return cut.trimEnd();
}

/**
 * Nombre de mots, y compris pour les écritures sans espaces (chinois, japonais) :
 * un `split(/\s+/)` y compterait une phrase entière pour un seul mot.
 */
export function countWords(text: string): number {
  let n = 0;
  for (const seg of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(text)) if (seg.isWordLike) n++;
  return n;
}
