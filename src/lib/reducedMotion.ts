/**
 * Does the system ask for reduced motion?
 *
 * The CSS side is handled by `@media (prefers-reduced-motion: reduce)` blocks
 * in `index.css`, but the two mobile navigation transitions (`MobileStack`,
 * `MobileDrawer`) set their durations in inline styles from JavaScript, where
 * no CSS rule can reach them. They read this instead.
 *
 * Never throws: this only decides an animation duration, so a browser without
 * `matchMedia` gets the animated path rather than a crash.
 */
export function prefersReducedMotion(): boolean {
  try {
    if (typeof matchMedia !== 'function') return false;
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}
