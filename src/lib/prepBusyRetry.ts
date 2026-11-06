/**
 * Reprise, dans une même préparation hors ligne, des articles que
 * l'extracteur du serveur a refusés parce que sa file était pleine
 * (`ExtractorBusyError`, 503 `busy`).
 *
 * Un tel refus est passager : la file (`EXTRACT_MAX_PENDING`, cinq analyses
 * de 10 s au plus) se libère en quelques secondes. Sans reprise, l'article
 * restait sans article complet jusqu'à la préparation suivante — souvent le
 * lendemain, ou jamais avant l'avion. Les refusés sont donc redemandés en fin
 * de passage, après une attente courte et croissante, deux fois au plus.
 */
export const PREP_BUSY_RETRY_DELAYS_MS = [5_000, 10_000] as const;

/** Pas de la vérification d'arrêt pendant une attente. */
const STOP_POLL_MS = 250;

/**
 * Attend `ms`, en revérifiant `stop` tous les quarts de seconde : « Annuler »,
 * une coupure ou un changement de serveur rendent la main aussitôt. Rend
 * `true` si l'attente est allée au bout, `false` si elle a été interrompue.
 */
export async function waitUnless(ms: number, stop: () => boolean): Promise<boolean> {
  const end = Date.now() + ms;
  for (;;) {
    if (stop()) return false;
    const left = end - Date.now();
    if (left <= 0) return true;
    await new Promise((resolve) => setTimeout(resolve, Math.min(STOP_POLL_MS, left)));
  }
}
