// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, fireEvent, act } from '@testing-library/react';
import CommandPalette from './CommandPalette';
import { useUiStore } from '../stores/uiStore';
import { useFeedStore } from '../stores/feedStore';
import { useAiStore } from '../stores/aiStore';
import { AI_TRANSLATE_PROBE, AI_SUMMARIZE_PROBE, answerTranslateProbe } from '../lib/aiTranslateProbe';
import { useToolbarCommands } from '../lib/toolbarCommands';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string) => k }) }));

const provider = { id: 1, name: 'P', type: 'openai' as const, hasAdminKey: false, shared: false, hasUserKey: false, available: true };
const ON = { enabled: true, providers: [provider], userKeysAllowed: false, dailyCap: 0, usageToday: 0, defaultProvider: 1 };
const article = { id: 'a1', title: 'T' } as never;
const LABEL = 'preferences.shortcuts.summarize';

beforeEach(() => {
  // jsdom has no layout: the palette scrolls its cursor row into view.
  Element.prototype.scrollIntoView = vi.fn();
  useUiStore.setState({ commandPaletteOpen: true });
  useFeedStore.setState({ selectedArticle: article });
  useAiStore.setState({ config: ON });
});
afterEach(cleanup);

describe('CommandPalette — summarize action', () => {
  // Le volet de lecture répond à la sonde tant que « Résumer » ferait quelque chose.
  beforeEach(() => { window.addEventListener(AI_SUMMARIZE_PROBE, answerTranslateProbe); });
  afterEach(() => { window.removeEventListener(AI_SUMMARIZE_PROBE, answerTranslateProbe); });

  it('is not offered when the reading pane would not summarise (a summary already shown, offline)', () => {
    window.removeEventListener(AI_SUMMARIZE_PROBE, answerTranslateProbe);
    const { queryByText } = render(<CommandPalette />);
    expect(queryByText(LABEL)).toBeNull();
  });

  it('is offered when an article is open and AI is usable', () => {
    const { getByText } = render(<CommandPalette />);
    expect(getByText(LABEL)).toBeTruthy();
  });

  it('is not offered without an open article', () => {
    useFeedStore.setState({ selectedArticle: null });
    const { queryByText } = render(<CommandPalette />);
    expect(queryByText(LABEL)).toBeNull();
  });

  it('is not offered while AI is off', () => {
    useAiStore.setState({ config: { ...ON, enabled: false } });
    const { queryByText } = render(<CommandPalette />);
    expect(queryByText(LABEL)).toBeNull();
  });

  it('is not offered while no provider is usable', () => {
    useAiStore.setState({ config: { ...ON, providers: [{ ...provider, available: false }] } });
    const { queryByText } = render(<CommandPalette />);
    expect(queryByText(LABEL)).toBeNull();
  });

  it('closes the palette and broadcasts the summarize event when chosen', () => {
    const heard = vi.fn();
    window.addEventListener('frirss:ai-summarize', heard);
    const { getByText } = render(<CommandPalette />);
    fireEvent.click(getByText(LABEL));
    window.removeEventListener('frirss:ai-summarize', heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });
});

describe('CommandPalette — translate action', () => {
  const TRANSLATE = 'preferences.shortcuts.translate';
  // Le volet de lecture répond à la sonde tant que « Traduire l'article »
  // ferait quelque chose (du texte à traduire, aucune traduction affichée).
  beforeEach(() => {
    window.addEventListener(AI_TRANSLATE_PROBE, answerTranslateProbe);
    window.addEventListener(AI_SUMMARIZE_PROBE, answerTranslateProbe);
  });
  afterEach(() => {
    window.removeEventListener(AI_TRANSLATE_PROBE, answerTranslateProbe);
    window.removeEventListener(AI_SUMMARIZE_PROBE, answerTranslateProbe);
  });

  it('is offered next to the summary when an article is open, AI is usable and the reading pane can translate', () => {
    const { getByText } = render(<CommandPalette />);
    expect(getByText(TRANSLATE)).toBeTruthy();
  });

  it('is not offered when the reading pane would do nothing (translation already shown, nothing to translate)', () => {
    window.removeEventListener(AI_TRANSLATE_PROBE, answerTranslateProbe);
    const { queryByText, getByText } = render(<CommandPalette />);
    expect(queryByText(TRANSLATE)).toBeNull();
    // Le résumé, lui, reste proposé.
    expect(getByText(LABEL)).toBeTruthy();
  });

  it.each([
    ['without an open article', () => useFeedStore.setState({ selectedArticle: null })],
    ['while AI is off', () => useAiStore.setState({ config: { ...ON, enabled: false } })],
    ['while no provider is usable', () => useAiStore.setState({ config: { ...ON, providers: [{ ...provider, available: false }] } })],
  ] as const)('is not offered %s', (_label, setup) => {
    setup();
    const { queryByText } = render(<CommandPalette />);
    expect(queryByText(TRANSLATE)).toBeNull();
  });

  it('closes the palette and broadcasts the translate event, not the summary one, when chosen', () => {
    const translate = vi.fn();
    const summarize = vi.fn();
    window.addEventListener('frirss:ai-translate', translate);
    window.addEventListener('frirss:ai-summarize', summarize);
    const { getByText } = render(<CommandPalette />);
    fireEvent.click(getByText(TRANSLATE));
    window.removeEventListener('frirss:ai-translate', translate);
    window.removeEventListener('frirss:ai-summarize', summarize);
    expect(translate).toHaveBeenCalledTimes(1);
    expect(summarize).not.toHaveBeenCalled();
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });
});

// Un clic dans la liste (hors d'une ligne) pose le focus sur <body> : Échap,
// écouté sur le seul champ, ne fermait plus la palette — et le tiroir se tait
// désormais tant qu'une boîte modale est ouverte.
describe('CommandPalette — Échap', () => {
  it('se ferme aussi quand le focus est retombé sur la page', () => {
    render(<CommandPalette />);
    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).toBe(document.body);
    const ev = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    document.body.dispatchEvent(ev);
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
    expect(ev.defaultPrevented).toBe(true);
  });
});

describe('CommandPalette — commandes offertes par les barres', () => {
  function Bar({ run }: { run: (c: string) => void }) {
    useToolbarCommands(() => [{ command: 'demo', item: 'random', label: 'Demo' }], run);
    return null;
  }

  it('liste l’offre sous Actions ; la choisir ferme la palette puis l’exécute', () => {
    const run = vi.fn(() => { expect(useUiStore.getState().commandPaletteOpen).toBe(false); });
    // Les barres sont montées bien avant qu'on ouvre la palette.
    useUiStore.setState({ commandPaletteOpen: false });
    const { getByText } = render(<><Bar run={run} /><CommandPalette /></>);
    act(() => { useUiStore.setState({ commandPaletteOpen: true }); });
    expect(getByText('Demo').closest('button')?.id).toBe('palette-toolbar:demo');
    fireEvent.click(getByText('Demo'));
    expect(run).toHaveBeenCalledWith('demo', undefined);
  });

  it('propose d’afficher ou masquer la barre latérale (le ☰ peut être masqué avec la barre de la liste)', () => {
    useUiStore.setState({ sidebarVisible: false });
    const { getByText } = render(<CommandPalette />);
    fireEvent.click(getByText('preferences.shortcuts.toggleSidebar'));
    expect(useUiStore.getState().sidebarVisible).toBe(true);
  });
});

describe('CommandPalette — créer une étiquette depuis la saisie', () => {
  function Pane({ run }: { run: (c: string, arg?: string) => void }) {
    useToolbarCommands(() => [{ command: 'newLabel', item: 'labels', label: 'palette.labelCreate' }], run);
    return null;
  }
  const open = (run: (c: string, arg?: string) => void) => {
    useUiStore.setState({ commandPaletteOpen: false });
    useFeedStore.setState({ labels: [{ id: 'user/-/label/Tech' }] } as never);
    const c = render(<><Pane run={run} /><CommandPalette /></>);
    act(() => { useUiStore.setState({ commandPaletteOpen: true }); });
    return c;
  };
  const input = (c: ReturnType<typeof render>) => c.getByRole('combobox');

  it('propose « Créer l’étiquette » pour un nom tapé, et le transmet', () => {
    const run = vi.fn();
    const c = open(run);
    fireEvent.change(input(c), { target: { value: 'Neuve' } });
    fireEvent.click(c.getByText('palette.labelCreate'));
    expect(run).toHaveBeenCalledWith('newLabel', 'Neuve');
  });

  it('rien sans saisie, rien pour une étiquette qui existe déjà', () => {
    const c = open(vi.fn());
    expect(c.queryByText('palette.labelCreate')).toBeNull();
    fireEvent.change(input(c), { target: { value: 'tech' } });
    expect(c.queryByText('palette.labelCreate')).toBeNull();
  });

  // Une faute de frappe + Entrée posait une étiquette sur l'article ouvert :
  // « Créer l'étiquette … », seule entrée, était sous le curseur d'office
  // (campagne 1.9.0, L-17).
  it('seule entrée, « Créer l’étiquette » n’est pas choisie d’office : Entrée ne crée rien', () => {
    const run = vi.fn();
    const c = open(run);
    fireEvent.change(input(c), { target: { value: 'Tecj' } });
    expect(c.getByText('palette.labelCreate')).toBeTruthy();
    expect(c.getByText('palette.empty')).toBeTruthy();
    expect(input(c).getAttribute('aria-activedescendant')).toBeNull();
    fireEvent.keyDown(input(c), { key: 'Enter' });
    expect(run).not.toHaveBeenCalled();
    expect(useUiStore.getState().commandPaletteOpen).toBe(true);
  });

  it('↓ la choisit, puis Entrée la crée', () => {
    const run = vi.fn();
    const c = open(run);
    fireEvent.change(input(c), { target: { value: 'Neuve' } });
    fireEvent.keyDown(input(c), { key: 'ArrowDown' });
    expect(input(c).getAttribute('aria-activedescendant')).toBe('palette-toolbar:newLabel');
    fireEvent.keyDown(input(c), { key: 'Enter' });
    expect(run).toHaveBeenCalledWith('newLabel', 'Neuve');
  });

  it('avec d’autres résultats, le premier reste choisi et « Aucun résultat » ne s’affiche pas', () => {
    const c = open(vi.fn());
    fireEvent.change(input(c), { target: { value: 'sidebar.unread' } });
    expect(c.queryByText('palette.empty')).toBeNull();
    expect(input(c).getAttribute('aria-activedescendant')).toBe('palette-view:unread');
  });
});

// Atteinte par Tab, une option gardait le focus : Échap et les flèches,
// écoutés sur le seul champ, n'y faisaient plus rien (campagne 1.9.0, L-20).
describe('CommandPalette — clavier hors du champ', () => {
  const options = () => [...document.querySelectorAll<HTMLElement>('[role="option"]')];

  it('Échap ferme la palette quand le focus est sur une option', () => {
    render(<CommandPalette />);
    const option = options()[1];
    option.focus();
    fireEvent.keyDown(option, { key: 'Escape' });
    expect(useUiStore.getState().commandPaletteOpen).toBe(false);
  });

  it('↓ déplace le curseur quand le focus est sur une option', () => {
    render(<CommandPalette />);
    const option = options()[0];
    option.focus();
    fireEvent.keyDown(option, { key: 'ArrowDown' });
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
  });

  it('Tab n’atteint pas les options : le focus reste dans le champ (curseur porté par aria-activedescendant)', () => {
    render(<CommandPalette />);
    expect(options().length).toBeGreaterThan(0);
    expect(options().every((o) => o.tabIndex === -1)).toBe(true);
  });

  // Relecture 1.9.0 : le piège de focus comptait les options (hors
  // tabulation) — Tab sortait de la boîte depuis le champ, Maj+Tab posait le
  // focus sur une option qu'Entrée n'exécutait pas.
  it('Tab et Maj+Tab laissent le focus dans le champ', () => {
    const c = render(<><button>dehors</button><CommandPalette /></>);
    const field = c.getByRole('combobox');
    act(() => { field.focus(); });
    fireEvent.keyDown(field, { key: 'Tab' });
    expect(document.activeElement).toBe(field);
    fireEvent.keyDown(field, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(field);
  });

  it('aria-activedescendant désigne une option qui existe, même pour un id avec blancs et barres', () => {
    useFeedStore.setState({ labels: [{ id: 'user/-/label/Mon étiquette' }] } as never);
    const c = render(<CommandPalette />);
    const field = c.getByRole('combobox');
    fireEvent.change(field, { target: { value: 'Mon étiquette' } });
    const target = field.getAttribute('aria-activedescendant');
    expect(target).toBeTruthy();
    expect(target).not.toMatch(/\s|\//);
    expect(document.getElementById(target!)?.getAttribute('role')).toBe('option');
  });
});

// axe : un <li> s'intercalait entre la liste et ses options, structure
// listbox/option invalide (campagne 1.9.0, L-29).
describe('CommandPalette — structure listbox', () => {
  it('la liste ne contient que des groupes nommés, et les groupes que des options', () => {
    render(<CommandPalette />);
    const listbox = document.querySelector('[role="listbox"]') as HTMLElement;
    expect(listbox.getAttribute('aria-label')).toBeTruthy();
    const children = [...listbox.children];
    expect(children.length).toBeGreaterThan(0);
    for (const group of children) {
      expect(group.getAttribute('role')).toBe('group');
      expect(group.getAttribute('aria-label')).toMatch(/^palette\.group\./);
      for (const child of group.children) {
        const role = child.getAttribute('role');
        const hidden = child.getAttribute('aria-hidden') === 'true';
        expect(role === 'option' || hidden).toBe(true);
      }
    }
    for (const option of document.querySelectorAll('[role="option"]')) {
      expect(option.parentElement?.getAttribute('role')).toBe('group');
    }
  });
});
