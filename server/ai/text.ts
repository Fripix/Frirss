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
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') {
        const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[code.toLowerCase()] ?? m;
    })
    .replace(/[ \t\r\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxChars ? text.slice(0, maxChars) : text;
}
