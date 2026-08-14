export type MarkAllAction = 'mark' | 'ask';

// Decide what a "Mark all as read" click should do:
//  - confirmation disabled           → mark immediately
//  - confirmation enabled, first tap  → ask (show the "Confirm?" state)
//  - confirmation enabled, confirming → mark
export function markAllReadAction(confirmEnabled: boolean, isConfirming: boolean): MarkAllAction {
  if (!confirmEnabled) return 'mark';
  return isConfirming ? 'mark' : 'ask';
}
