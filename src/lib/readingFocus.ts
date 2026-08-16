// Whether a double-click on `el` should toggle the reading Focus mode. Only
// "neutral" areas count — the article body is excluded so double-clicking text
// still selects a word, and interactive controls keep their own behaviour.
export function isFocusToggleTarget(el: Element | null): boolean {
  if (!el) return false;
  if (el.closest('.article-content')) return false;
  if (el.closest('a, button, input, textarea, select, label')) return false;
  return true;
}
