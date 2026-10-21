/**
 * HTML nettoyé → texte brut pour le prompt. Pas de DOM : une passe de regex
 * suffit pour un contenu déjà passé par le sanitiseur, et c'est synchrone.
 */
const ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', hellip: '…', mdash: '—', ndash: '–',
};

/**
 * Retire `<script>`, `<style>`, `<noscript>` et leur contenu, en temps linéaire.
 * Une regex `<script…>[\s\S]*?<\/script>` rebalaye toute la fin du texte à
 * chaque ouvrante sans fermante : quadratique sur 200 Ko de `<script>`. Ici,
 * une fermante absente l'est pour toutes les ouvrantes suivantes du même nom.
 */
function stripRawTextElements(html: string): string {
  const open = /<(script|style|noscript)\b[^<>]*>/gi;
  const unclosed = new Set<string>();
  let out = '';
  let from = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(html)) !== null) {
    const name = m[1].toLowerCase();
    if (unclosed.has(name)) continue;
    // Pas de `toLowerCase()` + `indexOf` : la casse peut changer la longueur (« İ ») et décaler les index.
    const closeRe = new RegExp(`</${name}>`, 'gi');
    closeRe.lastIndex = open.lastIndex;
    const close = closeRe.exec(html);
    if (!close) { unclosed.add(name); continue; }
    out += html.slice(from, m.index) + ' ';
    from = closeRe.lastIndex;
    open.lastIndex = from;
  }
  return out + html.slice(from);
}

/**
 * Chaque motif est linéaire sur une entrée hostile (200 Ko d'espaces, de `<`,
 * de `<a`) : les balises s'arrêtent à `[^<>]`, jamais à `[^>]` qui rebalayerait
 * tout le reste du texte depuis chaque `<`, et aucun quantificateur d'espaces
 * ne précède un caractère qui peut manquer.
 */
export function htmlToText(html: string, maxChars = 200_000): string {
  const text = stripRawTextElements(
    // Un saut de ligne dans la source est un espace en HTML : seuls les blocs et <br> cassent la ligne.
    html.replace(/\r\n?|\n/g, ' '),
  )
    .replace(/<\/(p|div|h[1-6]|li|blockquote|tr|section|article|figcaption)>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    // Balises en ligne : elles ne séparent pas les mots (« <b>mot</b>. » reste « mot. »).
    .replace(/<\/?(?:a|abbr|b|cite|code|em|font|i|ins|kbd|mark|q|s|small|span|strong|sub|sup|time|u)\b[^<>]*>/gi, '')
    .replace(/<[^<>]+>/g, ' ')
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
    // Après la passe précédente, un espace est toujours seul : ` ?` suffit, ` *` serait quadratique sans `\n`.
    .replace(/ ?\n ?/g, '\n')
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

// Copie de `wordCount` (`src/lib/articleSegments.ts`), qui découpe les lots
// côté client : l'échéance d'un lot de traduction doit compter les mots comme
// lui. Le serveur ne peut pas importer `src/` (`rootDir`) ; un test de parité
// (`src/lib/articleSegments.test.ts`) garde les deux en phase.
const SPACELESS = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Script=Thai}]/gu;

/** Mots d'un segment HTML : par espaces, ou une paire de caractères pour une écriture sans espaces. */
export function segmentWordCount(html: string): number {
  const text = html.replace(/<[^>]*>/g, ' ').trim();
  if (!text) return 0;
  const bySpace = text.split(/\s+/).length;
  const spaceless = text.match(SPACELESS)?.length ?? 0;
  return Math.max(bySpace, Math.ceil(spaceless / 2));
}
