import { describe, it, expect } from 'vitest';
import {
  rowActionSlots, normalizeRowActions, ROW_ACTION_ORDER, DEFAULT_ROW_ACTIONS,
} from './rowActions';

const all = DEFAULT_ROW_ACTIONS;
const withUrl = { url: 'https://example.com/a' };
const noUrl = { url: '' };
const kinds = (article: { url?: string | null }, s = all) =>
  rowActionSlots(article, s).map((x) => x.kind);

describe("ordre des icônes", () => {
  it("est le même partout : étoile, à lire plus tard, ouvrir, marquer lu", () => {
    expect(ROW_ACTION_ORDER).toEqual(['star', 'readLater', 'openSource', 'markRead']);
  });

  it("rend les quatre dans cet ordre quand tout est actif", () => {
    expect(kinds(withUrl)).toEqual(['star', 'readLater', 'openSource', 'markRead']);
  });
});

describe("article sans URL source", () => {
  it("RÉSERVE l'emplacement au lieu de le retirer", () => {
    // Sans réservation, le ✓ remonterait d'un cran sur ces lignes-là et
    // cesserait de tomber au même endroit d'une ligne à l'autre.
    expect(kinds(noUrl)).toEqual(['star', 'readLater', 'openSource', 'markRead']);
    const slot = rowActionSlots(noUrl, all).find((s) => s.kind === 'openSource');
    expect(slot!.available).toBe(false);
  });

  it("traite une URL absente ou blanche comme absente", () => {
    for (const url of ['', '   ', null, undefined]) {
      const slot = rowActionSlots({ url }, all).find((s) => s.kind === 'openSource');
      expect(slot!.available).toBe(false);
    }
  });

  it("laisse les trois autres disponibles", () => {
    const slots = rowActionSlots(noUrl, all).filter((s) => s.kind !== 'openSource');
    expect(slots.every((s) => s.available)).toBe(true);
  });
});

describe("réglages de visibilité", () => {
  it("RETIRE l'emplacement d'une icône masquée", () => {
    expect(kinds(withUrl, { ...all, openSource: false }))
      .toEqual(['star', 'readLater', 'markRead']);
  });

  it("le réglage l'emporte sur l'absence d'URL", () => {
    // Les deux causes se présentent : le réglage gagne, l'emplacement
    // disparaît. Le réservé n'existe que pour absorber une variation d'une
    // ligne à l'autre ; masquée partout, il n'y a plus rien à absorber.
    expect(kinds(noUrl, { ...all, openSource: false }))
      .toEqual(['star', 'readLater', 'markRead']);
  });

  it("permet de tout masquer", () => {
    expect(rowActionSlots(withUrl, {
      star: false, readLater: false, openSource: false, markRead: false,
    })).toEqual([]);
  });
});

describe("normalizeRowActions", () => {
  it("complète une valeur partielle avec les défauts", () => {
    // Un réglage synchronisé depuis un appareil resté sur une version
    // antérieure ne connaît pas les clés ajoutées depuis : sans complétion,
    // `settings[kind]` vaudrait `undefined`, donc faux, et l'icône
    // disparaîtrait sans que personne l'ait demandé.
    expect(normalizeRowActions({ star: false })).toEqual({
      star: false, readLater: true, openSource: true, markRead: true,
    });
  });

  it("rend les défauts sur une valeur inutilisable", () => {
    for (const v of [null, undefined, 'oui', 42, []]) {
      expect(normalizeRowActions(v)).toEqual(DEFAULT_ROW_ACTIONS);
    }
  });

  it("ignore les clés inconnues", () => {
    expect(normalizeRowActions({ star: true, licorne: true })).toEqual(DEFAULT_ROW_ACTIONS);
  });
});
