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
    const { getByRole } = setup();
    const menu = getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    const names = within(langSection(menu)).getAllByRole('menuitem').map((b) => b.textContent);
    expect(names).toHaveLength(28);
    expect(names[0]).toBe(languageName('de', 'fr'));
    const others = languages.filter((c) => c !== 'de').map((c) => languageName(c, 'fr')).sort((a, b) => a.localeCompare(b, 'fr'));
    expect(names.slice(1)).toEqual(others);
    expect(getByRole('searchbox', { name: 'ai.translation.filter' })).toBeTruthy();
  });
  it('filters the languages by name, the target staying first when it matches', () => {
    const { getByRole } = setup();
    fireEvent.change(getByRole('searchbox', { name: 'ai.translation.filter' }), { target: { value: 'ALL' } });
    const names = within(langSection(getByRole('menu'))).getAllByRole('menuitem').map((b) => b.textContent);
    expect(names[0]).toBe(languageName('de', 'fr'));
    expect(names.every((n) => n!.toLowerCase().includes('all'))).toBe(true);
  });
  it('shows no filter for twelve languages or fewer', () => {
    const { queryByRole } = setup({ languages: languages.slice(0, 12) });
    expect(queryByRole('searchbox')).toBeNull();
  });
  it('a language returns { lang }', () => {
    const { getByRole, onPick } = setup();
    fireEvent.click(within(langSection(getByRole('menu'))).getByRole('menuitem', { name: languageName('it', 'fr') }));
    expect(onPick).toHaveBeenCalledWith({ lang: 'it' });
  });
  it('lists only the available providers, and one returns { providerId }', () => {
    const { getByRole, onPick } = setup();
    const items = within(providerSection(getByRole('menu'))).getAllByRole('menuitem');
    expect(items.map((b) => b.textContent)).toEqual(['Claude', 'Ollama']);
    fireEvent.click(items[1]);
    expect(onPick).toHaveBeenCalledWith({ providerId: 2 });
  });
  it('marks the current language and provider', () => {
    const { getByRole } = setup({ current: { lang: 'de', providerId: 2 } });
    const menu = getByRole('menu');
    expect(within(langSection(menu)).getAllByRole('menuitem')[0].querySelector('[data-check]')).toBeTruthy();
    expect(within(langSection(menu)).getAllByRole('menuitem')[1].querySelector('[data-check]')).toBeNull();
    expect(within(providerSection(menu)).getByRole('menuitem', { name: 'Ollama' }).querySelector('[data-check]')).toBeTruthy();
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
});
