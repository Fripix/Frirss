// Combien de temps reste-t-il à une préparation hors ligne ?
//
// Une préparation de 6 000 articles dure de l'ordre de 40 minutes (campagne
// 1.9.0), et rien ne le disait. L'estimation extrapole le rythme OBSERVÉ de la
// phase des articles — celle qui coûte, une extraction et des images par
// article — sur ce qui reste. Elle se tait tant que la mesure est trop jeune
// pour valoir quelque chose : un chiffre qui saute de 2 à 90 minutes dans les
// premières secondes ferait plus de mal que de silence.

/** Articles traités avant d'oser un chiffre. */
export const ETA_MIN_DONE = 10;
/** Durée observée avant d'oser un chiffre. */
export const ETA_MIN_ELAPSED_MS = 5_000;

export function prepRemainingMs(input: {
  startedAt: number | undefined;
  now: number;
  done: number;
  total: number;
}): number | null {
  const { startedAt, now, done, total } = input;
  if (startedAt === undefined || done >= total) return null;
  const elapsed = now - startedAt;
  if (done < ETA_MIN_DONE || elapsed < ETA_MIN_ELAPSED_MS) return null;
  return Math.round((elapsed / done) * (total - done));
}

export type EtaParts =
  | { kind: 'soon' }
  | { kind: 'minutes'; minutes: number }
  | { kind: 'hours'; hours: number; minutes: number };

/** La forme à dire : minutes arrondies au-dessus (on ne promet pas plus tôt). */
export function etaParts(ms: number): EtaParts {
  if (ms < 60_000) return { kind: 'soon' };
  const minutes = Math.ceil(ms / 60_000);
  if (minutes <= 60) return { kind: 'minutes', minutes };
  return { kind: 'hours', hours: Math.floor(minutes / 60), minutes: minutes % 60 };
}
