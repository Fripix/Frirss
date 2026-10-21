// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent, within } from '@testing-library/react';
import TranslateMenu from './TranslateMenu';
import { AI_LANGUAGES, languageName, type AiLanguage } from '../../lib/aiLanguages';
import type { AiProviderView } from '../../api/backend';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k, i18n: { language: 'fr' } }) }));
afterEach(() => { cleanup(); });

const providers: AiProviderView[] = [
  { id: 1, name: 'Claude', type: 'anthropic', hasAdminKey: true, shared: true, hasUserKey: false, available: true },
  { id: 2, name: 'Ollama', type: 'openai', hasAdminKey: false, shared: false, hasUserKey: false, available: true },
  { id: 3, name: 'Privé', type: 'anthropic', hasAdminKey: true, shared: false, hasUserKey: false, available: false },
];
const languages = [...AI_LANGUAGES] as AiLanguage[];

function setup(over: Partial<Parameters<typeof TranslateMenu>[0]> = {}) {
  const anchor = document.createElement('button');
  document.body.appendChild(anchor);
  const onPick = vi.fn();
  const onClose = vi.fn();
  const utils = render(
    <TranslateMenu
      open anchor={anchor} touch={false} title="ai.translateMenu" languages={languages} providers={providers}
      current={{ lang: 'de', providerId: null }} onPick={onPick} onClose={onClose} {...over}
    />,
  );
  return { ...utils, onPick, onClose };
}

const langSection = (root: HTMLElement) => within(root).getByRole('group', { name: 'ai.translateTo' });
const providerSection = (root: HTMLElement) => within(root).getByRole('group', { name: 'ai.translateWith' });

describe('TranslateMenu', () => {
  it('lists the target language first, then the 27 others by name, with a filter', () => {
    const { getByRole, container } = setup();
    const menu = getByRole('menu');
    expect(container.contains(menu)).toBe(false);
    expect(document.body.contains(menu)).toBe(true);
    const names = within(langSection(menu)).getAllByRole('menuitemradio').map((b) => b.textContent);
    expect(names).toHaveLength(28);
    expect(names[0]).toBe(languageName('de', 'fr'));
    const others = languages.filter((c) => c !== 'de').map((c) => languageName(c, 'fr')).sort((a, b) => a.localeCompare(b, 'fr'));
    expect(names.slice(1)).toEqual(others);
    // Un champ de saisie n'est pas un enfant permis d'un role=menu : il vit au-dessus.
    expect(menu.contains(getByRole('searchbox', { name: 'ai.translation.filter' }))).toBe(false);
  });
  it('filters the languages by name, the target staying first when it matches', () => {
    const { getByRole } = setup();
    fireEvent.change(getByRole('searchbox', { name: 'ai.translation.filter' }), { target: { value: 'ALL' } });
    const names = within(langSection(getByRole('menu'))).getAllByRole('menuitemradio').map((b) => b.textContent);
    expect(names[0]).toBe(languageName('de', 'fr'));
    expect(names.every((n) => n!.toLowerCase().includes('all'))).toBe(true);
  });
  it('shows no filter for twelve languages or fewer', () => {
    const { queryByRole } = setup({ languages: languages.slice(0, 12) });
    expect(queryByRole('searchbox')).toBeNull();
  });
  it('a language returns { lang }', () => {
    const { getByRole, onPick } = setup();
    fireEvent.click(within(langSection(getByRole('menu'))).getByRole('menuitemradio', { name: languageName('it', 'fr') }));
    expect(onPick).toHaveBeenCalledWith({ lang: 'it' });
  });
  it('lists only the available providers, and one returns { providerId }', () => {
    const { getByRole, onPick } = setup();
    const items = within(providerSection(getByRole('menu'))).getAllByRole('menuitemradio');
    expect(items.map((b) => b.textContent)).toEqual(['Claude', 'Ollama']);
    fireEvent.click(items[1]);
    expect(onPick).toHaveBeenCalledWith({ providerId: 2 });
  });
  it('marks the current language and provider as checked radio items, the check mark hidden', () => {
    const { getByRole } = setup({ current: { lang: 'de', providerId: 2 } });
    const menu = getByRole('menu');
    const langs = within(langSection(menu)).getAllByRole('menuitemradio');
    expect(langs[0].getAttribute('aria-checked')).toBe('true');
    expect(langs[0].querySelector('[data-check]')!.closest('[aria-hidden="true"]')).toBeTruthy();
    expect(langs[1].getAttribute('aria-checked')).toBe('false');
    expect(langs[1].querySelector('[data-check]')).toBeNull();
    expect(within(providerSection(menu)).getByRole('menuitemradio', { name: 'Ollama' }).getAttribute('aria-checked')).toBe('true');
    expect(within(providerSection(menu)).getByRole('menuitemradio', { name: 'Claude' }).getAttribute('aria-checked')).toBe('false');
  });
  it('keyboard: the filter has the focus on open, ArrowDown enters the list, ArrowUp from the first item comes back', () => {
    const { getByRole, onClose } = setup();
    const filter = getByRole('searchbox', { name: 'ai.translation.filter' });
    const items = within(getByRole('menu')).getAllByRole('menuitemradio');
    expect(document.activeElement).toBe(filter);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(filter);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(filter);
    expect(onClose).not.toHaveBeenCalled();
  });
  it('keyboard: Tab moves between the filter and the list instead of closing', () => {
    const { getByRole, onClose } = setup();
    const filter = getByRole('searchbox', { name: 'ai.translation.filter' });
    const first = within(getByRole('menu')).getAllByRole('menuitemradio')[0];
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(filter);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
  it('keyboard without a filter: the first item has the focus, ArrowUp wraps to the last', () => {
    const { getByRole } = setup({ languages: languages.slice(0, 3) });
    const items = within(getByRole('menu')).getAllByRole('menuitemradio');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(items[items.length - 1]);
  });
  it('Escape closes', () => {
    const { onClose } = setup();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
  it('renders nothing when closed', () => {
    const { queryByRole } = setup({ open: false });
    expect(queryByRole('menu')).toBeNull();
  });
  it('touch: a bottom sheet titled by the menu, rows of the sheet size', () => {
    const { getByRole, queryByRole, onClose } = setup({ touch: true });
    const dialog = getByRole('dialog', { name: 'ai.translateMenu' });
    expect(dialog.className).toContain('bottom-sheet');
    expect(queryByRole('menu')).toBeNull();
    expect(within(dialog).getByText('Ollama').closest('button')!.className).toContain('sheet-row');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
  it('offers no « Retraduire » without a translation on screen', () => {
    const { getByRole } = setup();
    expect(within(getByRole('menu')).queryByRole('menuitem', { name: 'ai.retranslate' })).toBeNull();
  });
  it('« Retraduire »: a plain menuitem (not a choice), after the two sections, that calls onRetranslate', () => {
    const onRetranslate = vi.fn();
    const { getByRole, onPick } = setup({ onRetranslate });
    const menu = getByRole('menu');
    const item = within(menu).getByRole('menuitem', { name: 'ai.retranslate' });
    expect(item.hasAttribute('aria-checked')).toBe(false);
    expect(providerSection(menu).contains(item)).toBe(false);
    expect(providerSection(menu).compareDocumentPosition(item) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(item);
    expect(onRetranslate).toHaveBeenCalledTimes(1);
    expect(onPick).not.toHaveBeenCalled();
  });
  it('touch: « Retraduire » is a sheet row', () => {
    const { getByRole } = setup({ touch: true, onRetranslate: vi.fn() });
    const row = within(getByRole('dialog', { name: 'ai.translateMenu' })).getByText('ai.retranslate').closest('button')!;
    expect(row.className).toContain('sheet-row');
    expect(row.getAttribute('role')).toBeNull();
  });
});
