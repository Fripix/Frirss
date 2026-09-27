// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import SearchBar from './SearchBar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string, o?: { scope?: string }) => (o?.scope ? `${k}:${o.scope}` : k) }),
}));

afterEach(cleanup);

function renderBar(over: Partial<Parameters<typeof SearchBar>[0]> = {}) {
  const props = {
    value: 'docker',
    scope: 'Non lus',
    mobile: false,
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  return { props, ...render(<SearchBar {...props} />) };
}

describe('SearchBar', () => {
  /**
   * La loupe était un décor (`pointer-events: none`) et le formulaire n'avait
   * AUCUN bouton d'envoi : la recherche ne partait que par la soumission
   * implicite du navigateur, qui dépend d'un événement `keypress`. Un clavier
   * logiciel qui ne l'émet pas — c'est le cas du pilotage d'Oya, et le vieux
   * piège du « Go » d'iOS — laissait la recherche inatteignable.
   */
  it('soumet la recherche au clic sur la loupe', () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'articleList.search' }));
    expect(props.onSubmit).toHaveBeenCalled();
  });

  it('expose la loupe comme bouton d’envoi du formulaire', () => {
    const { container } = renderBar();
    const submit = container.querySelector('button[type="submit"]');
    expect(submit).toBeTruthy();
    expect(submit!.getAttribute('aria-label')).toBe('articleList.search');
  });

  it('place l’envoi APRÈS le champ dans l’ordre de tabulation', () => {
    // Le bouton est posé à gauche DANS le champ : s'il le précédait dans le
    // DOM, la tabulation atteindrait l'envoi avant la saisie.
    const { container } = renderBar();
    const ordre = [...container.querySelectorAll('input, button')].map((el) =>
      el.tagName === 'INPUT' ? 'champ' : el.getAttribute('type'));
    expect(ordre).toEqual(['champ', 'submit', 'button']);
  });

  it('ferme au clic sur la croix', () => {
    const { props } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'articleList.closeSearch' }));
    expect(props.onClose).toHaveBeenCalled();
  });

  it('ferme sur Échap', () => {
    const { props } = renderBar();
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Escape' });
    expect(props.onClose).toHaveBeenCalled();
  });

  it('annonce le périmètre dans le champ', () => {
    renderBar({ scope: 'CERT-FR — Avis' });
    expect(screen.getByPlaceholderText('articleList.searchIn:CERT-FR — Avis')).toBeTruthy();
  });

  it('remonte la frappe', () => {
    const { props } = renderBar();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'kubernetes' } });
    expect(props.onChange).toHaveBeenCalledWith('kubernetes');
  });

  // iOS zoome dans tout champ dont la police descend sous 16 px.
  it('force 16 px sur mobile', () => {
    renderBar({ mobile: true });
    expect((screen.getByRole('textbox') as HTMLInputElement).style.fontSize).toBe('16px');
  });
});
