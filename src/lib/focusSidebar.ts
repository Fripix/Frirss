/**
 * Met le focus dans la barre latérale qui vient de s'ouvrir : sa première
 * entrée de navigation, à défaut son premier bouton. Pour un bouton qui
 * disparaît avec son clic (les ☰ de secours, L-10) : sans lui, le focus
 * retombait sur `<body>`. L'appelant rend d'abord la barre (`flushSync`).
 */
export function focusSidebar(): void {
  const side = document.querySelector<HTMLElement>('.sidebar');
  (side?.querySelector<HTMLElement>('nav button, nav a[href]') ?? side?.querySelector<HTMLElement>('button, a[href]'))?.focus();
}
