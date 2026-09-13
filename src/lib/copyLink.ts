export type CopyResult = 'copied' | 'failed';

/** Ce dont on a besoin de `navigator.clipboard` — injecté, pour être testable. */
export interface ClipboardLike {
  writeText(text: string): Promise<void>;
}

/**
 * Copie un lien dans le presse-papiers.
 *
 * `navigator.clipboard` n'existe qu'en contexte sécurisé (HTTPS, localhost) :
 * l'appelant passe `navigator.clipboard ?? null`, et son absence est un échec
 * annoncé, jamais une exception.
 */
export async function copyLink(url: string, clipboard: ClipboardLike | null): Promise<CopyResult> {
  if (!url.trim() || !clipboard) return 'failed';
  try {
    await clipboard.writeText(url);
    return 'copied';
  } catch {
    return 'failed';
  }
}
