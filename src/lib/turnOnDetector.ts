/**
 * Retient la dernière valeur vue d'un réglage booléen, HORS de tout composant,
 * et dit quand il vient de s'allumer.
 *
 * Sert la barre latérale (R-5) : son effet relançait le relevé des Favoris et
 * d'« À lire plus tard » (quatre requêtes) à chaque MONTAGE — `b` et la sortie
 * du mode Focus la remontent — alors qu'il n'existe que pour réagir à un
 * réglage allumé ici ou sur un autre appareil. Un `useRef` meurt avec le
 * composant : la mémoire doit vivre au niveau du module. Le démarrage, lui,
 * est couvert par `loadSubscriptions`, et `syncCounts` relève chaque minute.
 *
 * `initial` : la valeur au démarrage, déjà servie par le premier relevé.
 */
export function createTurnOnDetector(initial: boolean): (value: boolean) => boolean {
  let last = initial;
  return (value) => {
    const turnedOn = value && !last;
    last = value;
    return turnedOn;
  };
}
