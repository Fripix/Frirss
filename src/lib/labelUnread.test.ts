import { describe, it, expect } from 'vitest';
import { labelUnreadFromServer, afterLabelMembershipChange } from './labelUnread';

const V = 'user/-/label/Veille';
const R = 'user/-/label/Tech/Rust';
const labels = [{ id: V }, { id: R }];

describe('labelUnreadFromServer — FreshRSS liste les étiquettes dans unread-count depuis la 1.26', () => {
  it('vrai dès qu’une étiquette figure dans la réponse serveur', () => {
    expect(labelUnreadFromServer(new Set(['feed/1', V]), labels)).toBe(true);
  });
  it('faux quand des étiquettes existent et qu’aucune n’y figure (serveur < 1.26)', () => {
    expect(labelUnreadFromServer(new Set(['feed/1', 'user/-/label/Catégorie']), labels)).toBe(false);
  });
  it('inconnu (null) tant qu’aucune étiquette n’est connue', () => {
    expect(labelUnreadFromServer(new Set(['feed/1']), [])).toBeNull();
  });
});

describe('afterLabelMembershipChange — poser ou retirer une étiquette', () => {
  it('compte un non-lu qui entre, décompte un non-lu qui sort', () => {
    expect(afterLabelMembershipChange({ [V]: 4 }, { read: false }, V, true)[V]).toBe(5);
    expect(afterLabelMembershipChange({ [V]: 4 }, { read: false }, V, false)[V]).toBe(3);
  });
  it('un article lu ne change rien, et le même objet est rendu', () => {
    const counts = { [V]: 4 };
    expect(afterLabelMembershipChange(counts, { read: true }, V, true)).toBe(counts);
  });
  it('ne descend pas sous zéro et crée la clé au besoin', () => {
    expect(afterLabelMembershipChange({}, { read: false }, V, false)[V]).toBe(0);
    expect(afterLabelMembershipChange({}, { read: false }, V, true)[V]).toBe(1);
  });
});

