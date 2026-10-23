// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useDrawerOffDesktop } from './useDrawerOffDesktop';
import { useUiStore } from '../stores/uiStore';

// `sidebarVisible` est la préférence de la barre latérale du bureau, mais sur
// téléphone et tablette elle pilote aussi l'ouverture du tiroir. Sa valeur par
// défaut (`true`) ouvrait donc le tiroir de lui-même au chargement.
describe('tiroir fermé hors bureau', () => {
  beforeEach(() => {
    localStorage.setItem('frirss_sidebarVisible', 'true');
    useUiStore.setState({ sidebarVisible: true });
  });

  it('monté sur un téléphone : tiroir fermé, préférence du bureau intacte', () => {
    renderHook(() => useDrawerOffDesktop(false));
    expect(useUiStore.getState().sidebarVisible).toBe(false);
    expect(localStorage.getItem('frirss_sidebarVisible')).toBe('true');
  });

  it('monté sur le bureau : la barre latérale reste affichée', () => {
    renderHook(() => useDrawerOffDesktop(true));
    expect(useUiStore.getState().sidebarVisible).toBe(true);
  });

  it('bureau → téléphone ferme le tiroir, le retour au bureau rend la préférence', () => {
    const { rerender } = renderHook(({ d }) => useDrawerOffDesktop(d), { initialProps: { d: true } });
    rerender({ d: false });
    expect(useUiStore.getState().sidebarVisible).toBe(false);
    expect(localStorage.getItem('frirss_sidebarVisible')).toBe('true');
    rerender({ d: true });
    expect(useUiStore.getState().sidebarVisible).toBe(true);
  });

  it('une préférence du bureau masquée reste masquée au retour', () => {
    localStorage.setItem('frirss_sidebarVisible', 'false');
    const { rerender } = renderHook(({ d }) => useDrawerOffDesktop(d), { initialProps: { d: false } });
    rerender({ d: true });
    expect(useUiStore.getState().sidebarVisible).toBe(false);
  });
});

describe('le tiroir ne touche pas la préférence du bureau', () => {
  beforeEach(() => {
    localStorage.setItem('frirss_sidebarVisible', 'true');
    useUiStore.setState({ sidebarVisible: true });
  });

  it('ouvrir puis fermer le tiroir sur téléphone, puis revenir au bureau : la barre latérale est toujours là', () => {
    // iPad qu'on tourne, fenêtre redimensionnée, disposition forcée : le tiroir
    // s'ouvre par `toggleSidebar` et se ferme par `setSidebarVisible(false)`.
    const { rerender } = renderHook(({ d }) => useDrawerOffDesktop(d), { initialProps: { d: false } });
    useUiStore.getState().toggleSidebar();
    expect(useUiStore.getState().sidebarVisible).toBe(true);
    useUiStore.getState().setSidebarVisible(false);
    expect(localStorage.getItem('frirss_sidebarVisible')).toBe('true');
    rerender({ d: true });
    expect(useUiStore.getState().sidebarVisible).toBe(true);
  });

  it('sur le bureau, masquer la barre latérale reste une préférence enregistrée', () => {
    renderHook(() => useDrawerOffDesktop(true));
    useUiStore.getState().toggleSidebar();
    expect(localStorage.getItem('frirss_sidebarVisible')).toBe('false');
    useUiStore.getState().setSidebarVisible(true);
    expect(localStorage.getItem('frirss_sidebarVisible')).toBe('true');
  });
});

