import DOMPurify from 'dompurify';

// Harden links opened in a new tab against reverse-tabnabbing.
// Registered once at module load (DOMPurify hooks are global).
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node instanceof Element && node.tagName === 'A' && node.getAttribute('target')) {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/**
 * Sanitize untrusted article HTML before injecting it via dangerouslySetInnerHTML.
 * DOMPurify strips <script>, event handlers (onerror/onload/…), javascript: URIs, etc.
 * We keep `target` and `loading` so external links and lazy images still work.
 */
export function sanitizeHtml(html: string | null | undefined): string {
  if (!html) return '';
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    ADD_ATTR: ['target', 'loading'],
  });
}
