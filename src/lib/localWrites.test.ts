import { describe, it, expect } from 'vitest';
import { createLocalWrites, LOCAL_WRITE_TTL_MS } from './localWrites';
import type { Article } from '../types';

const row = (over: Partial<Article> = {}): Article => ({
  id: 'a1', title: 'T', summary: '', content: '', author: '', url: '', source: '', sourceId: 'feed/1',
  published: 0, read: false, starred: false, labels: [], tags: [], ...over,
});

const S = '7@1';

describe('createLocalWrites', () => {
  it('réapplique sur une réponse partie AVANT l’écriture', () => {
    const w = createLocalWrites();
    const since = w.mark();
    w.record(S, 'a1', 'read', true);
    expect(w.overlay(S, [row()], since)[0].read).toBe(true);
  });

  it('ne touche pas une réponse partie APRÈS une écriture réglée', () => {
    const w = createLocalWrites();
    w.record(S, 'a1', 'read', true);
    w.touch(S, 'a1', 'read');
    const since = w.mark();
    const rows = [row()];
    expect(w.overlay(S, rows, since)).toBe(rows);
  });

  it('une écriture en vol s’applique quel que soit le départ de la réponse', () => {
    const w = createLocalWrites();
    w.record(S, 'a1', 'read', true);
    const since = w.mark(); // partie après le geste, répondue avant sa confirmation
    expect(w.overlay(S, [row()], since)[0].read).toBe(true);
  });

  it('deux gestes en vol : la confirmation du premier laisse le second en vol', () => {
    const w = createLocalWrites();
    w.record(S, 'a1', 'read', true);
    w.record(S, 'a1', 'read', false);
    w.touch(S, 'a1', 'read');
    const since = w.mark();
    expect(w.overlay(S, [row({ read: true })], since)[0].read).toBe(false);
    w.touch(S, 'a1', 'read');
    const after = w.mark();
    const rows = [row({ read: true })];
    expect(w.overlay(S, rows, after)).toBe(rows);
  });

  it('un rollback termine le vol, et sa valeur ne vaut que pour les réponses déjà parties', () => {
    const w = createLocalWrites();
    const before = w.mark();
    w.record(S, 'a1', 'read', true);
    w.rollback(S, 'a1', 'read', false);
    expect(w.overlay(S, [row({ read: true })], before)[0].read).toBe(false);
    const after = w.mark();
    const rows = [row({ read: true })];
    expect(w.overlay(S, rows, after)).toBe(rows);
  });

  it('une écriture confirmée compte à sa confirmation : la réponse partie pendant le vol est recalée', () => {
    const w = createLocalWrites();
    w.record(S, 'a1', 'read', true); // en vol
    const since = w.mark();          // la lecture part, le serveur ne sait pas encore
    w.touch(S, 'a1', 'read');        // confirmé
    expect(w.overlay(S, [row()], since)[0].read).toBe(true);
  });

  it('la confirmation d’un ancien geste ne rétablit pas sa valeur', () => {
    const w = createLocalWrites();
    w.record(S, 'a1', 'read', true);
    w.record(S, 'a1', 'read', false);
    const since = w.mark();
    w.touch(S, 'a1', 'read');
    expect(w.overlay(S, [row({ read: true })], since)[0].read).toBe(false);
  });

  it('un rollback est une écriture comme une autre : la dernière valeur gagne', () => {
    const w = createLocalWrites();
    const since = w.mark();
    w.record(S, 'a1', 'starred', true);
    w.record(S, 'a1', 'starred', false); // refus du serveur
    expect(w.overlay(S, [row()], since)[0].starred).toBe(false);
  });

  it('recale les étiquettes une par une, sans toucher aux autres', () => {
    const w = createLocalWrites();
    const since = w.mark();
    w.record(S, 'a1', 'label:user/-/label/x', true);
    w.record(S, 'a1', 'label:user/-/label/y', false);
    const [r] = w.overlay(S, [row({ labels: ['user/-/label/y', 'user/-/label/z'] })], since);
    expect([...r.labels].sort()).toEqual(['user/-/label/x', 'user/-/label/z']);
  });

  it('un autre compte ou serveur n’est pas concerné : les numéros se recouvrent', () => {
    const w = createLocalWrites();
    const since = w.mark();
    w.record(S, 'a1', 'read', true);
    expect(w.overlay('7@2', [row()], since)[0].read).toBe(false);
  });

  it('ne recopie pas une ligne qui dit déjà la même chose', () => {
    const w = createLocalWrites();
    const since = w.mark();
    w.record(S, 'a1', 'read', true);
    const rows = [row({ read: true })];
    expect(w.overlay(S, rows, since)).toBe(rows);
  });

  it('rend la main sur les lignes recalées : `keep` à faux les écarte', () => {
    const w = createLocalWrites();
    const since = w.mark();
    w.record(S, 'a1', 'read', true);
    const rows = w.overlay(S, [row(), row({ id: 'a2' })], since, (r) => !r.read);
    expect(rows.map((r) => r.id)).toEqual(['a2']);
  });

  it('oublie ce qu’aucune réponse en vol ne peut plus contredire', () => {
    let now = 1_000;
    const w = createLocalWrites(() => now);
    const since = w.mark();
    w.record(S, 'a1', 'read', true);
    now += LOCAL_WRITE_TTL_MS + 1;
    w.record(S, 'a2', 'read', true); // l'écriture suivante fait le ménage
    expect(w.size()).toBe(1);
    expect(w.overlay(S, [row()], since)[0].read).toBe(false);
  });
});
