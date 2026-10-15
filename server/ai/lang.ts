/**
 * Le résumé commence par `lang: <code>` (consigne de `prompts.ts`). On retire
 * la ligne et on garde le code : il décide si « Traduire » a un sens.
 */
export function splitLangLine(text: string): { lang: string | null; text: string } {
  const m = text.match(/^\s*lang:\s*([A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*)\s*\n+/i);
  if (!m) return { lang: null, text: text.trim() };
  const [base, ...rest] = m[1].split('-');
  const lang = [base.toLowerCase(), ...rest].join('-');
  return { lang, text: text.slice(m[0].length).trim() };
}
