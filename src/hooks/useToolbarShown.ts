import { useCallback } from 'react';
import { useBreakpoint } from './useBreakpoint';
import { useUiStore } from '../stores/uiStore';
import type { ToolbarToggleId } from '../lib/toolbarItems';

/**
 * `shown(id)` : faut-il afficher cet élément de barre ?
 *
 * Les réglages de Préférences → Mise en page ne valent que pour le format
 * desktop (`useBreakpoint`, format forcé compris). Ailleurs, la palette
 * n'existe pas : tout reste affiché, quel que soit le réglage.
 */
export function useToolbarShown(): (id: ToolbarToggleId) => boolean {
  const desktop = useBreakpoint() === 'desktop';
  const visibility = useUiStore((s) => s.toolbarVisibility);
  return useCallback((id: ToolbarToggleId) => !desktop || visibility[id], [desktop, visibility]);
}
