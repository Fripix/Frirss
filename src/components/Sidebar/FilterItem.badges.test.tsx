// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { FilterItem } from './Sidebar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
afterEach(cleanup);

const row = (count?: number, badge?: number) =>
  render(<FilterItem icon={null} label="Favoris" active={false} count={count} badge={badge} badgeColor="var(--sidebar-star)" onClick={() => {}} />);

describe('ligne Favoris / À lire plus tard — deux pastilles indépendantes', () => {
  it('montre les non-lus (pastille des flux) PUIS le total (pastille colorée)', () => {
    const c = row(3, 42);
    const unread = c.container.querySelector('.unread-badge');
    expect(unread?.textContent).toBe('3');
    expect(unread?.getAttribute('aria-label')).toBe('sidebar.unreadCount:3');
    const texts = Array.from(c.container.querySelectorAll('button span')).map((e) => e.textContent);
    expect(texts.indexOf('3')).toBeLessThan(texts.indexOf('42'));
  });

  it('garde la pastille du total telle quelle, couleur comprise', () => {
    const c = row(undefined, 42);
    expect(c.container.querySelector('.unread-badge')).toBeNull();
    const total = Array.from(c.container.querySelectorAll('span')).find((e) => e.textContent === '42' && e.style.color) as HTMLElement;
    expect(total.style.color).toBe('var(--sidebar-star)');
  });

  it('les non-lus seuls, sans total', () => {
    const c = row(3, undefined);
    expect(c.container.querySelector('.unread-badge')?.textContent).toBe('3');
    expect(Array.from(c.container.querySelectorAll('span')).some((e) => e.textContent === '42')).toBe(false);
  });
});
