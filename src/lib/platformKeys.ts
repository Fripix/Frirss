/**
 * Quelle touche de commande nommer dans l'interface ?
 *
 * ⌘K sur un clavier Apple, Ctrl+K partout ailleurs. Nommer ⌘ sur une machine
 * qui n'a pas cette touche est la pire des deux erreurs : l'indication
 * désigne alors quelque chose d'introuvable.
 *
 * `navigator.platform` est officiellement déprécié mais reste la donnée la
 * plus fiable ici, et l'`userAgent` sert de second regard. Aucune des deux
 * n'est indispensable : sans elles, on retombe sur Ctrl.
 */
export function isAppleKeyboard(): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator) return false;
    const hint = `${navigator.platform ?? ''} ${navigator.userAgent ?? ''}`;
    return /mac|iphone|ipad|ipod/i.test(hint);
  } catch {
    return false;
  }
}

export function commandKeyLabel(): string {
  return isAppleKeyboard() ? '⌘' : 'Ctrl';
}
