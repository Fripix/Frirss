// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));
import { LabelGroupHeader } from './Sidebar';

afterEach(cleanup);

/*
 * Un groupe d'étiquettes dont le parent est lui-même une étiquette : le clic
 * ouvre ses articles, replier passait par le double-clic ou par le chevron —
 * un <span onClick> sans rôle ni tabulation, de 16 px. Au clavier, on ne
 * pouvait ni replier ni déplier.
 */
describe('LabelGroupHeader — replier au clavier', () => {
  const props = { name: 'Hardware', isCollapsed: false, isSelected: false, hasParentTag: true, onToggle: vi.fn(), onViewArticles: vi.fn(), labelColor: null };

  it('le chevron est un bouton qui dit son état et replie', () => {
    const p = { ...props, onToggle: vi.fn(), onViewArticles: vi.fn() };
    const c = render(<LabelGroupHeader {...p} />);
    const chevron = c.getByRole('button', { name: 'sidebar.collapse' });
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(chevron);
    expect(p.onToggle).toHaveBeenCalledTimes(1);
    expect(p.onViewArticles).not.toHaveBeenCalled();
  });

  it('replié, il le dit aussi', () => {
    const c = render(<LabelGroupHeader {...props} isCollapsed />);
    expect(c.getByRole('button', { name: 'sidebar.expand' }).getAttribute('aria-expanded')).toBe('false');
  });
});
