// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { LabelSection } from './Sidebar';
import { useFeedStore } from '../../stores/feedStore';
import { useUiStore } from '../../stores/uiStore';
import type { Tag } from '../../types';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

const V = 'user/-/label/Veille';
const R = 'user/-/label/Tech/Rust';
const labels = [{ id: V, type: 'tag' }, { id: R, type: 'tag' }] as Tag[];

beforeEach(() => {
  useUiStore.setState({ labelsCollapsed: false, collapsedLabelGroups: {} });
  useFeedStore.setState({ labelCounts: { [V]: 12, [R]: 3 }, unreadCounts: { [V]: 7, [R]: 2 } });
});
afterEach(cleanup);

const mount = () => render(
  <LabelSection labels={labels} selectedFeed={null} selectLabel={() => {}} onArticleDrop={() => {}} />,
);
const spokenUnread = (c: HTMLElement) => Array.from(c.querySelectorAll('[aria-label]')).map((e) => e.getAttribute('aria-label'));
const spokenTotals = (c: HTMLElement) => Array.from(c.querySelectorAll('.sr-only')).map((e) => e.textContent);

describe('non-lus d’une étiquette dans la barre latérale (issue #29)', () => {
  it('non-lus seuls : la pastille des flux, « N non lus », et aucun total', () => {
    useUiStore.setState({ showLabelCounts: false, showLabelUnread: true });
    const { container } = mount();
    expect(spokenUnread(container)).toContain('sidebar.unreadCount:7');
    expect(spokenTotals(container).some((l) => l?.includes('itemCount'))).toBe(false);
  });

  it('total seul : rien ne change par rapport à avant', () => {
    useUiStore.setState({ showLabelCounts: true, showLabelUnread: false });
    const { container } = mount();
    expect(spokenTotals(container)).toContain('sidebar.itemCount:12');
    expect(spokenUnread(container).some((l) => l?.includes('unreadCount'))).toBe(false);
  });

  it('les deux : les non-lus d’abord, puis le total, dans la même ligne', () => {
    useUiStore.setState({ showLabelCounts: true, showLabelUnread: true });
    const { container } = mount();
    const unread = container.querySelector('[aria-label="sidebar.unreadCount:7"]')!;
    const total = Array.from(container.querySelectorAll('.sr-only')).find((e) => e.textContent === 'sidebar.itemCount:12')!.parentElement!;
    expect(unread.closest('button')).toBe(total.closest('button'));
    expect(unread.compareDocumentPosition(total) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('un groupe sans étiquette parente additionne les non-lus de ses enfants', () => {
    useUiStore.setState({ showLabelCounts: false, showLabelUnread: true });
    useFeedStore.setState({ unreadCounts: { [V]: 7, [R]: 2, 'user/-/label/Tech/Go': 4 } });
    const { container } = render(
      <LabelSection labels={[...labels, { id: 'user/-/label/Tech/Go', type: 'tag' } as Tag]} selectedFeed={null} selectLabel={() => {}} onArticleDrop={() => {}} />,
    );
    expect(spokenUnread(container)).toContain('sidebar.unreadCount:6');
  });

  it('une étiquette sans non-lu ne porte pas de pastille', () => {
    useUiStore.setState({ showLabelCounts: false, showLabelUnread: true });
    useFeedStore.setState({ unreadCounts: { [V]: 0, [R]: 0 } });
    const { container } = mount();
    expect(spokenUnread(container).some((l) => l?.includes('unreadCount'))).toBe(false);
  });
});
