/**
 * Colour of the band the OS draws above the app — on Android, the status bar
 * of an installed web app takes `<meta name="theme-color">`, and Chrome tints
 * the navigation bar to match.
 *
 * One rule: the bar takes the colour of the surface directly beneath it,
 * so it never reads as a dark browser frame over a light app (discussion
 * #19). The server topbar when it is shown, else the list header, else the
 * reading pane. All three are theme colours the user can already adjust;
 * there is no setting of its own. iOS is untouched: its strip is painted by
 * the page (`.safe-area-top`), not by this tag.
 */
export function statusBarColor(
  view: { topbarVisible: boolean; reading: boolean },
  colors: Record<string, string | undefined>,
): string {
  if (view.topbarVisible) return colors['topbar-bg'] || '#201f1b';
  if (view.reading) return colors['panel-bg'] || '#ffffff';
  return colors['panel-header-bg'] || '#fafafa';
}
