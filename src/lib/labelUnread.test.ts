import { describe, it, expect } from 'vitest';
import { keepLabelUnread, missingLabelUnread, afterLabelMembershipChange } from './labelUnread';

const V = 'user/-/label/Veille';
const R = 'user/-/label/Tech/Rust';
const labels = [{ id: V }, { id: R }];

describe('keepLabelUnread — un serveur d’avant FreshRSS 1.26 ne rend pas les étiquettes', () => {
  it('garde la valeur connue d’une étiquette absente de la réponse serveur', () => {
    const next = keepLabelUnread({ 'feed/1': 2 }, { [V]: 4, 'feed/1': 9 }, labels);
    expect(next).toEqual({ 'feed/1': 2, [V]: 4 });
  });

  it('prend la valeur du serveur quand il la donne', () => {
    const next = keepLabelUnread({ 'feed/1': 2, [V]: 1 }, { [V]: 4 }, labels);
    expect(next[V]).toBe(1);
  });

  it('ne ressuscite pas un flux disparu : seules les étiquettes sont gardées', () => {
    const next = keepLabelUnread({}, { 'feed/1': 9 }, labels);
    expect(next).toEqual({});
  });
});

describe('missingLabelUnread — ce qu’il reste à relever par identifiants', () => {
  it('liste les étiquettes sans compte connu', () => {
    expect(missingLabelUnread({ [V]: 0 }, labels).map((l) => l.id)).toEqual([R]);
  });
  it('rien quand toutes sont connues, même à zéro', () => {
    expect(missingLabelUnread({ [V]: 0, [R]: 0 }, labels)).toEqual([]);
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
