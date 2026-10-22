// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, screen, within } from '@testing-library/react';
import AiSummary, { type AiSummaryProps } from './AiSummary';
import { useUiStore } from '../../stores/uiStore';
import type { AiProviderView, AiSummaryResult } from '../../api/backend';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (k: string, o?: Record<string, unknown>) => (o?.name ? `${k}:${o.name}` : k), i18n: { language: 'fr' } }) }));
const breakpoint = vi.fn<() => 'desktop' | 'tablet' | 'mobile'>(() => 'desktop');
vi.mock('../../hooks/useBreakpoint', () => ({ useBreakpoint: () => breakpoint() }));
beforeEach(() => {
  localStorage.clear();
  useUiStore.setState({ aiPanelCollapsed: false, aiPanelAutoExpanded: false });
});
afterEach(() => { cleanup(); breakpoint.mockReset(); breakpoint.mockImplementation(() => 'desktop'); });

const providers: AiProviderView[] = [
  { id: 1, name: 'Claude', type: 'anthropic', hasAdminKey: true, shared: true, hasUserKey: false, available: true },
  { id: 2, name: 'Ollama', type: 'openai', hasAdminKey: false, shared: false, hasUserKey: false, available: true },
  { id: 3, name: 'Privé', type: 'anthropic', hasAdminKey: true, shared: false, hasUserKey: false, available: false },
];
const result: AiSummaryResult = { text: 'Premier.\n\nSecond.', lang: 'fr', providerId: 2, providerName: 'Ollama', model: 'm', fromCache: false, fellBackFrom: 'Claude' };
const noop = () => {};
const noTranslation: AiSummaryProps['translation'] = { status: 'idle', text: null, lang: null, error: null };
const translationProps = { translation: noTranslation, onTranslate: noop, onShowSource: noop, targetLang: 'en' as const };
const idleProps = { status: 'idle' as const, result: null, error: null, providers, onSummarize: noop, ...translationProps };
const doneProps = { status: 'done' as const, result, error: null, providers, onSummarize: noop, ...translationProps };

/** L'en-tête : son nom accessible commence par le titre, suivi du statut. */
const TOGGLE = { name: /^ai\.summarize\s/ };
const ACTION = { name: 'ai.summarizeAction' };
/** Le statut de l'en-tête (la ligne invisible de la région vivante répète le même texte). */
const headerText = (text: string) => within(screen.getByRole('button', TOGGLE)).getByText(text);

describe('AiSummary — en-tête et repli', () => {
  it('the header is one button that toggles the panel and remembers it globally', () => {
    const { getByRole, queryByText } = render(<AiSummary {...doneProps} />);
    const toggle = getByRole('button', TOGGLE);
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const body = document.getElementById(toggle.getAttribute('aria-controls')!);
    expect(body).toBeTruthy();
    expect(queryByText('Premier.')).toBeTruthy();
    fireEvent.click(toggle);
    expect(useUiStore.getState().aiPanelCollapsed).toBe(true);
    expect(localStorage.getItem('frirss_aiPanelCollapsed')).toBe('true');
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(queryByText('Premier.')).toBeNull();
    // aria-controls ne pointe jamais dans le vide : le corps reste monté, caché et vide.
    expect(body!.isConnected).toBe(true);
    expect(body!.hidden).toBe(true);
    expect(body!.textContent).toBe('');
    fireEvent.click(toggle);
    expect(useUiStore.getState().aiPanelCollapsed).toBe(false);
  });
  it('starts collapsed when the synced preference says so, the status still visible', () => {
    useUiStore.setState({ aiPanelCollapsed: true });
    const { getByRole, queryByText } = render(<AiSummary {...doneProps} />);
    expect(getByRole('button', TOGGLE).getAttribute('aria-expanded')).toBe('false');
    expect(headerText('ai.by:Ollama')).toBeTruthy();
    expect(queryByText('Premier.')).toBeNull();
  });
  it('the action lives outside the toggle: using it never folds the panel', () => {
    const onSummarize = vi.fn();
    const { getByRole } = render(<AiSummary {...doneProps} onSummarize={onSummarize} />);
    const toggle = getByRole('button', TOGGLE);
    const action = getByRole('button', { name: 'ai.withProvider' });
    expect(toggle.contains(action)).toBe(false);
    fireEvent.click(action);
    fireEvent.click(getByRole('menuitem', { name: 'Claude' }));
    expect(onSummarize).toHaveBeenCalledWith(1);
    expect(useUiStore.getState().aiPanelCollapsed).toBe(false);
  });
  it('the first « Résumer » on a collapsed panel opens it, once', () => {
    useUiStore.setState({ aiPanelCollapsed: true });
    const { getByRole, rerender } = render(<AiSummary {...idleProps} />);
    fireEvent.click(getByRole('button', ACTION));
    expect(useUiStore.getState().aiPanelCollapsed).toBe(false);
    expect(useUiStore.getState().aiPanelAutoExpanded).toBe(true);
    // La demande échoue : le panneau montre l'erreur, l'utilisateur le replie,
    // et un second « Résumer » ne le rouvre plus.
    rerender(<AiSummary {...idleProps} status="error" error="ai.errors.technical" />);
    fireEvent.click(getByRole('button', TOGGLE));
    expect(useUiStore.getState().aiPanelCollapsed).toBe(true);
    fireEvent.click(getByRole('button', ACTION));
    expect(useUiStore.getState().aiPanelCollapsed).toBe(true);
  });
  it('a summary arriving while collapsed does not open the panel', () => {
    useUiStore.setState({ aiPanelCollapsed: true, aiPanelAutoExpanded: true });
    const { rerender, queryByText } = render(<AiSummary {...idleProps} status="loading" />);
    rerender(<AiSummary {...doneProps} />);
    expect(useUiStore.getState().aiPanelCollapsed).toBe(true);
    expect(queryByText('Premier.')).toBeNull();
    expect(headerText('ai.by:Ollama')).toBeTruthy();
  });
  it('the chevron turns with the panel', () => {
    const { getByRole } = render(<AiSummary {...doneProps} />);
    const chevron = getByRole('button', TOGGLE).querySelector('[data-chevron]')!;
    expect(chevron.getAttribute('class')).toContain('rotate-180');
    fireEvent.click(getByRole('button', TOGGLE));
    expect(chevron.getAttribute('class')).not.toContain('rotate-180');
  });
});

describe('AiSummary — panneau vide', () => {
  it('sans résumé, ne rend ni corps ni chevron : l\'en-tête n\'est pas un bouton', () => {
    const { container } = render(<AiSummary {...idleProps} />);
    expect(screen.queryByRole('button', TOGGLE)).toBeNull();
    expect(container.querySelector('[data-chevron]')).toBeNull();
    expect(container.querySelector('[id$="-body"]')).toBeNull();
    expect(container.querySelector('[aria-expanded]')).toBeNull();
    expect(screen.getByText('ai.summarize')).toBeTruthy();
    expect(screen.getByRole('button', ACTION)).toBeTruthy();
  });
  it('vide : aucun statut, titre et bouton seulement, sur une ligne compacte', () => {
    const { container } = render(<AiSummary {...idleProps} />);
    expect(container.querySelector('[data-status]')).toBeNull();
    expect(screen.queryByText('ai.status.none')).toBeNull();
    const lead = screen.getByText('ai.summarize').closest('div.grow') as HTMLElement;
    expect(lead.className).toContain('py-1');
    expect(lead.className).not.toContain('py-2');
    const action = screen.getByRole('button', ACTION);
    expect(action.className).toContain('h-8');
    expect((action.parentElement as HTMLElement).className).toContain('py-1');
  });
  it('vide au doigt : le bouton garde 44 px, le conteneur se serre à py-0.5', () => {
    breakpoint.mockImplementation(() => 'mobile');
    render(<AiSummary {...idleProps} />);
    const action = screen.getByRole('button', ACTION);
    expect(action.className).toContain('min-h-[44px]');
    expect((action.parentElement as HTMLElement).className).toContain('py-0.5');
  });
  it('en cours : le statut dit « Résumé en cours… »', () => {
    const { container } = render(<AiSummary {...idleProps} status="loading" />);
    expect(container.querySelector('[data-status]')?.textContent).toBe('ai.summarizing');
  });
  it('vide, la mémoire du repli ne change rien : ni corps, ni chevron, replié ou non', () => {
    useUiStore.setState({ aiPanelCollapsed: true });
    const { container } = render(<AiSummary {...idleProps} />);
    expect(container.querySelector('[data-chevron]')).toBeNull();
    expect(container.querySelector('[id$="-body"]')).toBeNull();
    expect(container.querySelector('[data-status]')).toBeNull();
  });
  it('vide, l\'en-tête garde son gabarit : deux rangs à 320 px et 44 px au doigt', () => {
    breakpoint.mockImplementation(() => 'mobile');
    render(<AiSummary {...idleProps} />);
    const left = screen.getByText('ai.summarize').closest('div.grow') as HTMLElement;
    expect(left.className).toContain('basis-44');
    expect(left.className).toContain('min-w-0');
    expect(left.className).toContain('min-h-[44px]');
    expect(screen.getByRole('button', ACTION).className).toContain('min-h-[44px]');
  });
  it('vide, la région vivante reste montée', () => {
    render(<AiSummary {...idleProps} />);
    const region = screen.getByRole('status');
    expect(region.textContent).toBe('');
    expect(region.getAttribute('aria-live')).toBe('polite');
  });
  it('pendant la première demande, le corps (barres d\'attente) et le chevron reviennent', () => {
    const { container, rerender } = render(<AiSummary {...idleProps} />);
    rerender(<AiSummary {...idleProps} status="loading" />);
    expect(container.querySelector('[data-chevron]')).not.toBeNull();
    expect(screen.getByRole('button', TOGGLE).getAttribute('aria-expanded')).toBe('true');
    const body = container.querySelector('[id$="-body"]') as HTMLElement;
    expect(body.querySelector('.animate-pulse')).not.toBeNull();
  });
  it('une erreur sans résumé se lit sous le titre, le chevron et le corps reviennent', () => {
    const { container } = render(<AiSummary {...idleProps} status="error" error="x" />);
    expect(screen.getByRole('alert').textContent).toBe('x');
    expect(container.querySelector('[data-chevron]')).not.toBeNull();
    expect(container.querySelector('[id$="-body"]')).not.toBeNull();
  });
});

describe('AiSummary — statut et action', () => {
  it('idle: the « Résumer » action and no status line, no body', () => {
    const { container, queryByText, getByRole, queryByRole } = render(<AiSummary {...idleProps} />);
    expect(queryByText('ai.status.none')).toBeNull();
    expect(container.querySelector('[id$="-body"]')).toBeNull();
    expect(getByRole('button', ACTION)).toBeTruthy();
    expect(queryByRole('button', { name: 'ai.withProvider' })).toBeNull();
  });
  it('loading: the action is disabled, busy, and says so', () => {
    const { getByRole } = render(<AiSummary {...idleProps} status="loading" />);
    const action = getByRole('button', { name: 'ai.summarizing' }) as HTMLButtonElement;
    expect(action.disabled).toBe(true);
    expect(action.getAttribute('aria-busy')).toBe('true');
  });
  it('loading: the status reads the loading text, never « Pas encore résumé », folded or not', () => {
    const { queryByText, getByRole } = render(<AiSummary {...idleProps} status="loading" />);
    expect(headerText('ai.summarizing')).toBeTruthy();
    expect(queryByText('ai.status.none')).toBeNull();
    fireEvent.click(getByRole('button', TOGGLE));
    expect(headerText('ai.summarizing')).toBeTruthy();
    expect(queryByText('ai.status.none')).toBeNull();
  });
  it('loading again over a summary: the status still names who wrote the one shown', () => {
    render(<AiSummary {...doneProps} status="loading" />);
    expect(headerText('ai.by:Ollama')).toBeTruthy();
  });
  it('offline: the action is disabled', () => {
    const { getByRole } = render(<AiSummary {...idleProps} disabled />);
    expect((getByRole('button', ACTION) as HTMLButtonElement).disabled).toBe(true);
  });
  it('done: provider and fallback in the header, « Résumer avec… » replaces « Résumer », only available providers listed', () => {
    const onSummarize = vi.fn();
    const { getByText, getByRole, queryByText, queryByRole } = render(<AiSummary {...doneProps} onSummarize={onSummarize} />);
    const toggle = getByRole('button', TOGGLE);
    expect(toggle.contains(headerText('ai.by:Ollama'))).toBe(true);
    expect(getByText('ai.fellBack:Claude')).toBeTruthy();
    expect(queryByRole('button', ACTION)).toBeNull();
    expect(getByText('Premier.')).toBeTruthy();
    expect(getByText('Second.')).toBeTruthy();
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    expect(queryByText('Privé')).toBeNull();
    fireEvent.click(getByText('Claude'));
    expect(onSummarize).toHaveBeenCalledWith(1);
  });
  it('shows the cache note only when the summary came from the cache', () => {
    const fresh = render(<AiSummary {...doneProps} />);
    expect(fresh.queryByText('ai.fromCache')).toBeNull();
    cleanup();
    const cached = render(<AiSummary {...doneProps} result={{ ...result, fromCache: true }} />);
    expect(cached.getByText('ai.fromCache')).toBeTruthy();
  });
  it('the fallback notice is information in the status line, not an alert', () => {
    const { getByText, getByRole, queryByRole } = render(<AiSummary {...doneProps} />);
    const notice = getByText('ai.fellBack:Claude');
    expect(getByRole('button', TOGGLE).contains(notice)).toBe(true);
    expect((notice.parentElement as HTMLElement).style.color).toBe('var(--reading-meta)');
    expect(queryByRole('alert')).toBeNull();
  });
  it('the status wraps instead of pushing the action out (320 px)', () => {
    render(<AiSummary {...doneProps} />);
    const status = headerText('ai.by:Ollama').closest('[data-status]')!;
    expect(status.className).toContain('break-words');
    expect(headerText('ai.by:Ollama').closest('button')!.className).toContain('min-w-0');
  });
});

describe('AiSummary — corps', () => {
  it('sits on the tinted, themable surface and uses the full column width', () => {
    const { container, getByText } = render(<AiSummary {...doneProps} />);
    const panel = container.querySelector('.ai-summary') as HTMLElement;
    expect(panel.style.background).toBe('var(--ai-bg)');
    expect(panel.style.border).toBe('1px solid var(--ai-border)');
    expect(container.innerHTML).not.toContain('max-w-');
    expect(getByText('Premier.').className).toContain('whitespace-pre-line');
  });
  it('error: the message is a role=alert, never nested in the status region', () => {
    const { getByRole } = render(<AiSummary {...idleProps} status="error" error="ai.errors.auth" />);
    expect(getByRole('alert').textContent).toBe('ai.errors.auth');
    expect(getByRole('status').contains(getByRole('alert'))).toBe(false);
  });
  it('error while collapsed: the alert still shows, in place of the status', () => {
    useUiStore.setState({ aiPanelCollapsed: true });
    const { getByRole, queryByText } = render(<AiSummary {...idleProps} status="error" error="ai.errors.auth" />);
    expect(getByRole('alert').textContent).toBe('ai.errors.auth');
    expect(queryByText('ai.status.none')).toBeNull();
  });
  it('error after a summary: the summary stays, the error shows under it', () => {
    const { getByText, getByRole } = render(<AiSummary {...doneProps} status="error" error="ai.errors.technical" />);
    const summary = getByText('Premier.');
    const alert = getByRole('alert');
    expect(alert.textContent).toBe('ai.errors.technical');
    expect(summary.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(getByRole('button', { name: 'ai.withProvider' })).toBeTruthy();
  });
  it('a polite live region, mounted before the result, announces the result only', () => {
    const { getByRole, rerender, getByLabelText } = render(<AiSummary {...idleProps} status="loading" />);
    const region = getByRole('status');
    expect(region.getAttribute('aria-live')).toBe('polite');
    expect(region.textContent).toBe('');
    rerender(<AiSummary {...doneProps} result={{ ...result, fromCache: true }} />);
    expect(getByRole('status')).toBe(region);
    expect(region.textContent).toContain('ai.by:Ollama');
    expect(region.textContent).toContain('ai.fromCache');
    expect(region.className).toContain('sr-only');
    // Le corps n'est pas dans la région : déplier ou replier n'annonce rien.
    expect(region.contains(getByLabelText('ai.summaryTitle'))).toBe(false);
    const before = region.textContent;
    fireEvent.click(getByRole('button', TOGGLE));
    fireEvent.click(getByRole('button', TOGGLE));
    expect(region.textContent).toBe(before);
  });
  it('announces a result that arrives while the panel is collapsed', () => {
    useUiStore.setState({ aiPanelCollapsed: true, aiPanelAutoExpanded: true });
    const { getByRole, rerender } = render(<AiSummary {...idleProps} status="loading" />);
    rerender(<AiSummary {...doneProps} />);
    expect(getByRole('status').textContent).toContain('ai.by:Ollama');
  });
  it('touch: header and action are 44 px tall', () => {
    breakpoint.mockImplementation(() => 'mobile');
    const { getByRole } = render(<AiSummary {...idleProps} status="error" error="x" />);
    expect(getByRole('button', TOGGLE).className).toContain('min-h-[44px]');
    expect(getByRole('button', ACTION).className).toContain('min-h-[44px]');
  });
});

describe('AiSummary — « Résumer avec… »', () => {
  it('desktop: the menu is a role=menu portal under body, with menuitem children', () => {
    const { getByRole, getAllByRole, container } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    const menu = getByRole('menu');
    expect(menu.parentElement).toBe(document.body);
    expect(container.contains(menu)).toBe(false);
    expect(getAllByRole('menuitem').map((b) => b.textContent)).toEqual(['Claude', 'Ollama', 'ai.regenerate']);
  });
  it('opening the menu does not fold the panel', () => {
    const { getByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    expect(useUiStore.getState().aiPanelCollapsed).toBe(false);
  });
  it('desktop: Escape closes the menu and returns focus to the trigger', () => {
    const { getByRole, queryByRole } = render(<AiSummary {...doneProps} />);
    const trigger = getByRole('button', { name: 'ai.withProvider' });
    fireEvent.click(trigger);
    expect(getByRole('menu')).toBeTruthy();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('desktop: Tab closes the menu', () => {
    const { getByRole, queryByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(queryByRole('menu')).toBeNull();
  });
  it('desktop: ArrowDown moves between menu items', () => {
    const { getByRole, getAllByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    const items = getAllByRole('menuitem');
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(document, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
  });
  it('desktop: a click outside closes the menu', () => {
    const { getByRole, queryByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    fireEvent.click(document.body.querySelector('[aria-hidden="true"].fixed') as Element);
    expect(queryByRole('menu')).toBeNull();
  });
  it('touch: the menu is a bottom sheet, not a popover, and Escape returns focus to the trigger', () => {
    breakpoint.mockImplementation(() => 'mobile');
    const { getByRole, queryByRole, getByText } = render(<AiSummary {...doneProps} />);
    const trigger = getByRole('button', { name: 'ai.withProvider' });
    expect(trigger.className).toContain('min-h-[44px]');
    fireEvent.click(trigger);
    const dialog = getByRole('dialog');
    expect(dialog.className).toContain('bottom-sheet');
    expect(queryByRole('menu')).toBeNull();
    expect(getByText('Claude').closest('button')?.className).toContain('sheet-row');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  it('desktop rows do not use the sheet-row class', () => {
    const { getByRole, getAllByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    expect(getAllByRole('menuitem')[0].className).not.toContain('sheet-row');
  });
  it('« Régénérer », last in the menu, asks again with the provider that wrote the summary', () => {
    const onSummarize = vi.fn();
    const { getByRole } = render(<AiSummary {...doneProps} onSummarize={onSummarize} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    const item = getByRole('menuitem', { name: 'ai.regenerate' });
    fireEvent.click(item);
    expect(onSummarize).toHaveBeenCalledWith(2, { regenerate: true });
  });
  it('offers no « Régénérer » when the provider that wrote the summary is no longer available', () => {
    const { getByRole, queryByRole } = render(<AiSummary {...doneProps} result={{ ...result, providerId: 3, providerName: 'Privé' }} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    expect(getByRole('menuitem', { name: 'Claude' })).toBeTruthy();
    expect(queryByRole('menuitem', { name: 'ai.regenerate' })).toBeNull();
  });
  it('touch: « Régénérer » is a sheet row in the bottom sheet', () => {
    breakpoint.mockImplementation(() => 'mobile');
    const { getByRole } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    expect(within(getByRole('dialog')).getByText('ai.regenerate').closest('button')?.className).toContain('sheet-row');
  });
  it('the menu closes when the status leaves done, and does not reopen', () => {
    const { getByRole, queryByRole, rerender } = render(<AiSummary {...doneProps} />);
    fireEvent.click(getByRole('button', { name: 'ai.withProvider' }));
    rerender(<AiSummary {...doneProps} status="loading" result={null} />);
    expect(queryByRole('menu')).toBeNull();
    rerender(<AiSummary {...doneProps} />);
    expect(queryByRole('menu')).toBeNull();
  });
});

describe('AiSummary — traduction du résumé', () => {
  const TRANSLATE = { name: 'ai.translate' };
  const MENU = { name: 'ai.translateMenu' };
  const translated: AiSummaryProps['translation'] = { status: 'done', text: 'First.\n\nSecond one.', lang: 'en', providerId: 1, providerName: 'Claude', fellBackFrom: 'Mistral', error: null };

  it('affiche « Traduire » même quand le résumé est déjà dans la langue cible', () => {
    const { getByRole } = render(<AiSummary {...doneProps} targetLang="fr" />);
    expect(getByRole('button', TRANSLATE)).toBeTruthy();
    expect(getByRole('button', MENU)).toBeTruthy();
  });
  it('offers no translation before there is a summary', () => {
    const { queryByRole } = render(<AiSummary {...idleProps} />);
    expect(queryByRole('button', TRANSLATE)).toBeNull();
  });
  it('a split action: « Traduire » asks for the target, the chevron opens the menu', () => {
    const onTranslate = vi.fn();
    const { getByRole } = render(<AiSummary {...doneProps} onTranslate={onTranslate} />);
    const toggle = getByRole('button', TOGGLE);
    const main = getByRole('button', TRANSLATE);
    const chevron = getByRole('button', MENU);
    expect(toggle.contains(main)).toBe(false);
    expect(chevron.getAttribute('aria-haspopup')).toBe('menu');
    expect(chevron.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(main);
    expect(onTranslate).toHaveBeenCalledWith(undefined);
    fireEvent.click(chevron);
    expect(chevron.getAttribute('aria-expanded')).toBe('true');
    const menu = getByRole('menu');
    fireEvent.click(within(within(menu).getByRole('group', { name: 'ai.translateTo' })).getAllByRole('menuitemradio')[0]);
    expect(onTranslate).toHaveBeenLastCalledWith({ lang: 'en' });
    fireEvent.click(chevron);
    fireEvent.click(within(getByRole('menu')).getByRole('menuitemradio', { name: 'Ollama' }));
    expect(onTranslate).toHaveBeenLastCalledWith({ providerId: 2 });
  });
  it('a pick returns focus to the chevron that opened the menu', () => {
    const { getByRole } = render(<AiSummary {...doneProps} />);
    const chevron = getByRole('button', MENU);
    fireEvent.click(chevron);
    const item = within(getByRole('menu')).getAllByRole('menuitemradio')[0];
    item.focus();
    fireEvent.click(item);
    expect(document.activeElement).toBe(chevron);
  });
  it('touch: both halves are 44 px, the menu is a sheet', () => {
    breakpoint.mockImplementation(() => 'mobile');
    const { getByRole } = render(<AiSummary {...doneProps} />);
    expect(getByRole('button', TRANSLATE).className).toContain('min-h-[44px]');
    const chevron = getByRole('button', MENU);
    expect(chevron.className).toContain('min-h-[44px]');
    expect(chevron.className).toContain('min-w-[44px]');
    fireEvent.click(chevron);
    expect(getByRole('dialog', { name: 'ai.translateMenu' }).className).toContain('bottom-sheet');
  });
  it('loading: the action is disabled and says « Traduction… », the summary stays', () => {
    const { getByRole, getByText } = render(<AiSummary {...doneProps} translation={{ ...noTranslation, status: 'loading' }} />);
    const main = getByRole('button', { name: 'ai.translating' }) as HTMLButtonElement;
    expect(main.disabled).toBe(true);
    expect(main.getAttribute('aria-busy')).toBe('true');
    expect((getByRole('button', MENU) as HTMLButtonElement).disabled).toBe(true);
    expect(getByText('Premier.')).toBeTruthy();
  });
  it('done: the body shows the translation, the status says who translated it, the action turns into « Texte source »', () => {
    const onShowSource = vi.fn();
    const { getByRole, getByText, queryByText, queryByRole } = render(<AiSummary {...doneProps} translation={translated} onShowSource={onShowSource} />);
    expect(getByText('First.')).toBeTruthy();
    expect(getByText('Second one.')).toBeTruthy();
    expect(queryByText('Premier.')).toBeNull();
    expect(headerText('ai.by:Ollama')).toBeTruthy();
    expect(headerText('ai.translatedBy:Claude')).toBeTruthy();
    expect(headerText('ai.fellBack:Mistral')).toBeTruthy();
    expect(queryByRole('button', TRANSLATE)).toBeNull();
    fireEvent.click(getByRole('button', { name: 'ai.showSource' }));
    expect(onShowSource).toHaveBeenCalled();
    expect(getByRole('status').textContent).toContain('ai.translatedBy:Claude');
  });
  it('done while the summary is already in the target language: « Texte source » stays reachable', () => {
    const { getByRole } = render(<AiSummary {...doneProps} targetLang="fr" translation={{ ...translated, lang: 'de' }} />);
    expect(getByRole('button', { name: 'ai.showSource' })).toBeTruthy();
  });
  it('folded: a translation arriving does not unfold the panel', () => {
    useUiStore.setState({ aiPanelCollapsed: true });
    const onTranslate = vi.fn();
    const { getByRole, rerender, queryByText } = render(<AiSummary {...doneProps} onTranslate={onTranslate} />);
    fireEvent.click(getByRole('button', TRANSLATE));
    rerender(<AiSummary {...doneProps} translation={{ ...noTranslation, status: 'loading' }} />);
    rerender(<AiSummary {...doneProps} translation={translated} />);
    expect(useUiStore.getState().aiPanelCollapsed).toBe(true);
    expect(queryByText('First.')).toBeNull();
    expect(headerText('ai.translatedBy:Claude')).toBeTruthy();
  });
  it('error: an alert under the summary, which stays', () => {
    const { getByRole, getByText } = render(<AiSummary {...doneProps} translation={{ ...noTranslation, status: 'error', error: 'ai.errors.translateFailed' }} />);
    expect(getByRole('alert').textContent).toBe('ai.errors.translateFailed');
    expect(getByText('Premier.')).toBeTruthy();
    expect(getByRole('button', TRANSLATE)).toBeTruthy();
  });
  it('offers no « Retraduire » when the provider of the translation is no longer available', () => {
    const { getByRole, queryByRole } = render(<AiSummary {...doneProps} targetLang="en" translation={{ ...translated, providerId: 3, providerName: 'Privé' }} />);
    fireEvent.click(getByRole('button', MENU));
    expect(getByRole('menu')).toBeTruthy();
    expect(queryByRole('menuitem', { name: 'ai.retranslate' })).toBeNull();
  });
  it('a held translation stays on screen while it is asked again, and after a failure with the alert', () => {
    const { getByText, queryByText, getByRole, rerender } = render(<AiSummary {...doneProps} targetLang="en" translation={{ ...translated, status: 'loading' }} />);
    expect(getByText('First.')).toBeTruthy();
    expect(queryByText('Premier.')).toBeNull();
    expect((getByRole('button', { name: 'ai.translating' }) as HTMLButtonElement).disabled).toBe(true);
    rerender(<AiSummary {...doneProps} targetLang="en" translation={{ ...translated, status: 'error', error: 'ai.errors.translateFailed' }} />);
    expect(getByText('First.')).toBeTruthy();
    expect(getByRole('alert').textContent).toBe('ai.errors.translateFailed');
    expect(getByRole('button', { name: 'ai.showSource' })).toBeTruthy();
  });
  it('« Retraduire » appears only with a translation on screen, and asks again in its language with its provider', () => {
    const onTranslate = vi.fn();
    const { getByRole, queryByRole, rerender } = render(<AiSummary {...doneProps} targetLang="en" onTranslate={onTranslate} />);
    fireEvent.click(getByRole('button', MENU));
    expect(queryByRole('menuitem', { name: 'ai.retranslate' })).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(<AiSummary {...doneProps} targetLang="en" onTranslate={onTranslate} translation={translated} />);
    fireEvent.click(getByRole('button', MENU));
    fireEvent.click(getByRole('menuitem', { name: 'ai.retranslate' }));
    expect(onTranslate).toHaveBeenCalledWith({ lang: 'en', providerId: 1, regenerate: true });
  });
});

describe('AiSummary — « Réessayer avec… » dans l\'alerte', () => {
  const RETRY = (name: string) => ({ name: `ai.retryWith:${name}` });
  const failedSummary = { ...doneProps, status: 'error' as const, error: 'ai.errors.technical' };
  const oneProvider: AiProviderView[] = [providers[0]];

  it('une erreur de résumé propose Réessayer avec Claude, et le clic relance chez lui', () => {
    const onSummarize = vi.fn();
    // Ollama (2) a échoué : les indisponibles sont sautés, la liste reboucle sur Claude.
    const { getByRole } = render(<AiSummary {...failedSummary} errorProviderId={2} onSummarize={onSummarize} />);
    expect(getByRole('alert').textContent).toBe('ai.errors.technical');
    fireEvent.click(getByRole('button', RETRY('Claude')));
    expect(onSummarize).toHaveBeenCalledWith(1);
  });
  it('le fournisseur suivant suit l\'ordre de la liste', () => {
    const { getByRole } = render(<AiSummary {...failedSummary} errorProviderId={1} />);
    expect(getByRole('button', RETRY('Ollama'))).toBeTruthy();
  });
  it('sans fournisseur suivant, pas de bouton', () => {
    const { queryByRole } = render(<AiSummary {...failedSummary} providers={oneProvider} errorProviderId={1} />);
    expect(queryByRole('button', { name: /^ai\.retryWith/ })).toBeNull();
  });
  it('une erreur qui ne nomme aucun fournisseur (plafond, trop long, réseau) n\'en propose pas', () => {
    const { queryByRole } = render(<AiSummary {...failedSummary} />);
    expect(queryByRole('button', { name: /^ai\.retryWith/ })).toBeNull();
  });
  it('sans erreur, pas de bouton, même avec un fournisseur fautif mémorisé', () => {
    const { queryByRole } = render(<AiSummary {...doneProps} errorProviderId={2} />);
    expect(queryByRole('button', { name: /^ai\.retryWith/ })).toBeNull();
  });
  it('une erreur de traduction du résumé relance la traduction chez le suivant', () => {
    const onTranslate = vi.fn();
    const onSummarize = vi.fn();
    const translation = { ...noTranslation, status: 'error' as const, error: 'ai.errors.translateFailed', errorProviderId: 1 };
    const { getByRole } = render(<AiSummary {...doneProps} translation={translation} onTranslate={onTranslate} onSummarize={onSummarize} />);
    fireEvent.click(getByRole('button', RETRY('Ollama')));
    expect(onTranslate).toHaveBeenCalledWith({ providerId: 2 });
    expect(onSummarize).not.toHaveBeenCalled();
  });
  it('la traduction du résumé raté est rejouée dans la langue qui a échoué', () => {
    const onTranslate = vi.fn();
    const translation = { ...noTranslation, status: 'error' as const, error: 'ai.errors.translateFailed', errorProviderId: 1, errorLang: 'de' as const };
    const { getByRole } = render(<AiSummary {...doneProps} translation={translation} onTranslate={onTranslate} />);
    fireEvent.click(getByRole('button', RETRY('Ollama')));
    expect(onTranslate).toHaveBeenCalledWith({ lang: 'de', providerId: 2 });
  });
  it('l\'alerte du résumé prime : le bouton relance le résumé, pas la traduction', () => {
    const onTranslate = vi.fn();
    const onSummarize = vi.fn();
    const translation = { ...noTranslation, status: 'error' as const, error: 'ai.errors.translateFailed', errorProviderId: 2 };
    const { getByRole } = render(<AiSummary {...failedSummary} errorProviderId={1} translation={translation} onTranslate={onTranslate} onSummarize={onSummarize} />);
    fireEvent.click(getByRole('button', RETRY('Ollama')));
    expect(onSummarize).toHaveBeenCalledWith(2);
    expect(onTranslate).not.toHaveBeenCalled();
  });
  it('au doigt le bouton fait 44 px, et il reste là panneau replié', () => {
    breakpoint.mockImplementation(() => 'mobile');
    useUiStore.setState({ aiPanelCollapsed: true });
    const { getByRole } = render(<AiSummary {...failedSummary} errorProviderId={2} />);
    expect(getByRole('button', RETRY('Claude')).className).toContain('min-h-[44px]');
  });
});

