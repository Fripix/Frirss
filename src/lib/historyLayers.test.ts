import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryLayers, isAndroid, type Layer } from './historyLayers';

// Discussion #19, point 3 : sur Android, le geste retour natif fermait l'app
// au lieu de revenir de l'article à la liste, parce qu'ouvrir un article
// n'inscrivait rien dans l'historique. Chaque surface qui recouvre l'écran
// pousse une entrée ; un retour (geste ou navigateur) ferme la couche du
// dessus. Fermer depuis l'app retire l'entrée sans fermer autre chose.
//
// M-08 (1.9.0) : seules les trois couches fixes (article, tiroir,
// Préférences) poussaient une entrée. Feuilles du bas, confirmations et menus
// contextuels n'en poussaient pas : le retour fermait l'app (menu d'article,
// Options, « Tout lu ? »), l'article sous la feuille « More », ou le tiroir en
// laissant le menu d'un flux à l'écran.

describe('isAndroid', () => {
  it('reconnaît Chrome Android et rien d’autre', () => {
    expect(isAndroid('Mozilla/5.0 (Linux; Android 17; sdk_gphone64_x86_64) AppleWebKit/537.36 Chrome/145.0 Mobile Safari/537.36')).toBe(true);
    expect(isAndroid('Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isAndroid('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15')).toBe(false);
  });
});

/**
 * Un historique de navigateur simulé : une pile d'entrées (chacune porte la
 * profondeur que l'app y a écrite), un index courant, des traversées
 * asynchrones (`go` ne livre son `popstate` qu'à `deliver()`), et un retour
 * de l'utilisateur (`userBack()`) qui recule d'une entrée.
 */
function harness(base = 0) {
  const log: string[] = [];
  const closed: string[] = [];
  const queue: (() => void)[] = [];
  // Les entrées d'avant (un rechargement sur une entrée poussée) existent aussi.
  const entries: number[] = Array.from({ length: base + 1 }, (_, i) => i);
  let index = base;
  let pending: number | null = null;
  const h = new HistoryLayers({
    push: (depth) => {
      log.push(`push:${depth}`);
      entries.splice(index + 1, entries.length, depth);
      index++;
    },
    go: (delta) => {
      log.push(`go:${delta}`);
      pending = Math.max(0, index + delta);
    },
    close: (layer) => { closed.push(layer); },
    schedule: (fn) => { queue.push(fn); },
  }, base);
  const tick = () => { while (queue.length) queue.shift()!(); };
  return {
    h, log, closed,
    tick,
    /** Livre le `popstate` d'une traversée demandée par l'app. */
    deliver: () => {
      if (pending === null) throw new Error('aucune traversée en cours');
      index = pending; pending = null;
      h.onPop(entries[index]); tick();
    },
    /** Le geste retour d'Android. */
    userBack: () => {
      if (index === 0) { log.push('quitte'); return; }
      index--;
      h.onPop(entries[index]); tick();
    },
    /** Une surface flottante, telle que la branche `useBackLayer`. */
    overlay: (name: string, refuse = false) => h.openOverlay(() => {
      closed.push(name);
      return refuse ? false : undefined;
    }),
    get index() { return index; },
  };
}

const none: Record<Layer, boolean> = { article: false, drawer: false, prefs: false };

describe('HistoryLayers', () => {
  let t: ReturnType<typeof harness>;
  beforeEach(() => { t = harness(); });

  it('pousse une entrée quand une couche s’ouvre, pas quand elle change de contenu', () => {
    t.h.sync({ ...none, article: true }); t.tick();
    t.h.sync({ ...none, article: true }); t.tick(); // article suivant : même couche
    expect(t.log).toEqual(['push:1']);
  });

  it('un retour ferme la couche du dessus — les préférences avant le tiroir, le tiroir avant l’article', () => {
    t.h.sync({ ...none, article: true }); t.tick();
    t.h.sync({ article: true, drawer: true, prefs: false }); t.tick();
    t.h.sync({ article: true, drawer: true, prefs: true }); t.tick();
    expect(t.log).toEqual(['push:1', 'push:2', 'push:3']);
    t.userBack(); expect(t.closed).toEqual(['prefs']);
    t.h.sync({ article: true, drawer: true, prefs: false }); t.tick();
    t.userBack(); expect(t.closed).toEqual(['prefs', 'drawer']);
    t.h.sync({ ...none, article: true }); t.tick();
    t.userBack(); expect(t.closed).toEqual(['prefs', 'drawer', 'article']);
    t.h.sync(none); t.tick();
    expect(t.log).toEqual(['push:1', 'push:2', 'push:3']); // aucun retour synthétique
  });

  it('un retour sans couche ouverte ne ferme rien (le navigateur quitte, comme toute app)', () => {
    t.userBack();
    expect(t.closed).toEqual([]);
    expect(t.log).toEqual(['quitte']);
  });

  it('fermer depuis l’app retire l’entrée (back synthétique) et ce pop-là ne ferme pas la couche suivante', () => {
    t.h.sync({ ...none, article: true }); t.tick();
    t.h.sync({ ...none, article: true, prefs: true }); t.tick();
    // la croix des préférences
    t.h.sync({ ...none, article: true }); t.tick();
    expect(t.log).toEqual(['push:1', 'push:2', 'go:-1']);
    t.deliver(); // le popstate provoqué par ce retour
    expect(t.closed).toEqual([]); // l'article reste ouvert
    t.userBack(); // un vrai geste retour, maintenant
    expect(t.closed).toEqual(['article']);
  });

  it('ne fait jamais plus de back qu’il n’a poussé', () => {
    t.h.sync(none); t.tick();
    expect(t.log).toEqual([]);
    t.h.sync({ ...none, article: true }); t.tick();
    t.userBack(); // retour natif : l'app ferme l'article en réponse…
    t.h.sync(none); t.tick(); // …ce qui ne doit pas déclencher un back de plus
    expect(t.log).toEqual(['push:1']);
  });
});

describe('HistoryLayers — surfaces flottantes (M-08)', () => {
  let t: ReturnType<typeof harness>;
  beforeEach(() => { t = harness(); });

  it('la feuille « More » d’un article : le retour ferme la feuille seule, l’article reste ouvert', () => {
    t.h.sync({ ...none, article: true }); t.tick();
    t.overlay('more'); t.tick();
    expect(t.log).toEqual(['push:1', 'push:2']);
    t.userBack();
    expect(t.closed).toEqual(['more']);
    t.userBack();
    expect(t.closed).toEqual(['more', 'article']);
  });

  it('le menu d’un flux dans le tiroir : le retour ferme le menu, pas le tiroir', () => {
    t.h.sync({ ...none, drawer: true }); t.tick();
    t.overlay('feedMenu'); t.tick();
    t.userBack();
    expect(t.closed).toEqual(['feedMenu']);
  });

  it('une feuille ouverte sur la liste : le retour la ferme au lieu de quitter l’app', () => {
    t.overlay('options'); t.tick();
    t.userBack();
    expect(t.closed).toEqual(['options']);
    expect(t.log).not.toContain('quitte');
  });

  it('une surface au-dessus des Préférences se ferme avant elles', () => {
    t.h.sync({ ...none, prefs: true }); t.tick();
    t.overlay('confirm'); t.tick();
    t.userBack();
    expect(t.closed).toEqual(['confirm']);
  });

  it('deux surfaces empilées se ferment une par une, la dernière ouverte d’abord', () => {
    t.overlay('sheet'); t.tick();
    t.overlay('confirm'); t.tick();
    t.userBack(); expect(t.closed).toEqual(['confirm']);
    t.userBack(); expect(t.closed).toEqual(['confirm', 'sheet']);
  });

  it('fermée au doigt ou par Échap : un seul retour synthétique, dont le popstate ne ferme rien', () => {
    t.h.sync({ ...none, article: true }); t.tick();
    const sheet = t.overlay('more'); t.tick();
    t.h.closeOverlay(sheet); t.tick();
    expect(t.log).toEqual(['push:1', 'push:2', 'go:-1']);
    t.deliver();
    expect(t.closed).toEqual([]);
    t.userBack();
    expect(t.closed).toEqual(['article']);
  });

  it('une surface fermée après un vrai retour ne déclenche pas de retour en plus', () => {
    const sheet = t.overlay('sheet'); t.tick();
    t.userBack();
    t.h.closeOverlay(sheet); t.tick(); // le composant se démonte en réponse
    expect(t.log).toEqual(['push:1']);
  });

  it('une entrée de feuille qui ouvre une confirmation : aucune écriture d’historique, et le retour ferme la confirmation', () => {
    const sheet = t.overlay('sheet'); t.tick();
    t.h.closeOverlay(sheet);
    t.overlay('confirm'); t.tick(); // même rendu
    expect(t.log).toEqual(['push:1']);
    t.userBack();
    expect(t.closed).toEqual(['confirm']);
  });

  it('une surface fermée par navigation avec l’article : un seul retour de deux entrées', () => {
    t.h.sync({ ...none, article: true }); t.tick();
    const sheet = t.overlay('more'); t.tick();
    t.h.closeOverlay(sheet);
    t.h.sync(none); t.tick();
    expect(t.log).toEqual(['push:1', 'push:2', 'go:-2']);
    t.deliver();
    expect(t.closed).toEqual([]);
    expect(t.index).toBe(0);
  });

  it('ouvrir, fermer et rouvrir dans le même rendu (StrictMode) ne pousse qu’une entrée', () => {
    const a = t.overlay('sheet');
    t.h.closeOverlay(a);
    t.overlay('sheet');
    t.tick();
    expect(t.log).toEqual(['push:1']);
  });

  it('une surface qui refuse de se fermer (confirmation au travail) reprend son entrée', () => {
    t.overlay('confirm', true); t.tick();
    t.userBack();
    expect(t.closed).toEqual(['confirm']);
    expect(t.log).toEqual(['push:1', 'push:1']);
    t.userBack(); // elle refuse encore, l'app ne quitte toujours pas
    expect(t.log).not.toContain('quitte');
  });

  it('une ouverture pendant un retour synthétique attend son popstate avant de pousser', () => {
    const sheet = t.overlay('sheet'); t.tick();
    t.h.closeOverlay(sheet); t.tick();
    t.overlay('confirm'); t.tick();
    expect(t.log).toEqual(['push:1', 'go:-1']); // rien poussé sous la traversée en cours
    t.deliver();
    expect(t.log).toEqual(['push:1', 'go:-1', 'push:1']);
    t.userBack();
    expect(t.closed).toEqual(['confirm']);
  });

  it('après un rechargement sur une entrée poussée, les profondeurs repartent de cette entrée', () => {
    t = harness(2);
    t.overlay('sheet'); t.tick();
    expect(t.log).toEqual(['push:3']);
    t.userBack();
    expect(t.closed).toEqual(['sheet']);
    t.userBack(); // une entrée d'avant le rechargement : rien à fermer
    expect(t.closed).toEqual(['sheet']);
  });
});
