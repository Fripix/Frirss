// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';

vi.mock('../i18n', () => ({ default: { t: (k: string) => `t:${k}` } }));

import ErrorBoundary from './ErrorBoundary';

afterEach(cleanup);

function Boom(): never { throw new Error('boom'); }

// Le repli d'erreur était écrit en français pour les dix langues, en blanc sur
// l'accent, et calé sur `100vh` — que Chrome fige sur Android en app installée.
describe('ErrorBoundary', () => {
  it('parle la langue de l’interface et suit la hauteur réelle de l’écran', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<ErrorBoundary><Boom /></ErrorBoundary>);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('t:app.errorTitle');
    expect(alert.textContent).toContain('t:app.errorBody');
    expect(screen.getByRole('button').textContent).toBe('t:app.errorReload');
    expect(alert.getAttribute('style')).toContain('var(--app-height');
    expect(screen.getByRole('button').getAttribute('style')).toContain('var(--on-accent');
  });
});
