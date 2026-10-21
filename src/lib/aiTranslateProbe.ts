// La palette (⌘K) propose « Traduire l'article (IA) » ; c'est le volet de
// lecture qui sait si l'action ferait quelque chose (du texte à traduire,
// aucune traduction déjà affichée, rien en cours). Plutôt qu'un état de plus
// dans un store, la palette le lui demande par un événement synchrone : le
// volet y répond tant qu'il écoute `frirss:ai-translate`, avec les mêmes
// gardes. Personne ne répond → l'entrée n'est pas proposée.

/** Nom de l'événement-sonde. */
export const AI_TRANSLATE_PROBE = 'frirss:ai-translate-probe';

interface TranslateProbe {
  ready: boolean;
}

/** Côté palette : `frirss:ai-translate` ferait-il quelque chose maintenant ? */
export function translateWouldAct(): boolean {
  const detail: TranslateProbe = { ready: false };
  window.dispatchEvent(new CustomEvent<TranslateProbe>(AI_TRANSLATE_PROBE, { detail }));
  return detail.ready;
}

/** Côté volet : écouteur de la sonde, posé avec celui de `frirss:ai-translate`. */
export function answerTranslateProbe(e: Event): void {
  const detail = (e as CustomEvent<TranslateProbe | null>).detail;
  if (detail) detail.ready = true;
}
