import { describe, it, expect, vi } from 'vitest';
import { titleClickIsNative, markReadOnBackgroundOpen } from './titleLink';
import type { Article } from '../types';

const click = (over: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...over,
});

describe('titleClickIsNative', () => {
  it('le clic gauche simple reste celui de la ligne (sélection)', () => {
    expect(titleClickIsNative(click())).toBe(false);
  });

  it('⌘-clic, Ctrl-clic et Maj-clic sont laissés au navigateur', () => {
    expect(titleClickIsNative(click({ metaKey: true }))).toBe(true);
    expect(titleClickIsNative(click({ ctrlKey: true }))).toBe(true);
    expect(titleClickIsNative(click({ shiftKey: true }))).toBe(true);
  });

  it('Alt-clic ne l’est pas : il TÉLÉCHARGERAIT la page (Chrome, Firefox)', () => {
    expect(titleClickIsNative(click({ altKey: true }))).toBe(false);
    expect(titleClickIsNative(click({ altKey: true, metaKey: true }))).toBe(false);
  });

  it('le clic molette est laissé au navigateur', () => {
    expect(titleClickIsNative(click({ button: 1 }))).toBe(true);
  });
});

describe('markReadOnBackgroundOpen', () => {
  const article = (over: Partial<Article> = {}) =>
    ({ id: 'a1', url: 'https://example.com/1', read: false, ...over }) as Article;

  it('marque lu un article non lu, en marquage implicite (la ligne reste sous « Non lus »)', () => {
    const toggleRead = vi.fn();
    markReadOnBackgroundOpen(article(), toggleRead);
    expect(toggleRead).toHaveBeenCalledWith(expect.objectContaining({ id: 'a1' }), { implicit: true });
  });

  it('jamais une bascule : un article déjà lu n’est pas repassé non lu', () => {
    const toggleRead = vi.fn();
    markReadOnBackgroundOpen(article({ read: true }), toggleRead);
    expect(toggleRead).not.toHaveBeenCalled();
  });

  it('rien sans URL ouvrable : aucun onglet n’est parti', () => {
    const toggleRead = vi.fn();
    markReadOnBackgroundOpen(article({ url: 'javascript:alert(1)' }), toggleRead);
    markReadOnBackgroundOpen(article({ url: '' }), toggleRead);
    expect(toggleRead).not.toHaveBeenCalled();
  });
});
