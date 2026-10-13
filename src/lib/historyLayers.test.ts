import { describe, it, expect, beforeEach } from 'vitest';
import { HistoryLayers, isAndroid, type Layer } from './historyLayers';

// Discussion #19, point 3 : sur Android, le geste retour natif fermait l'app
// au lieu de revenir de l'article à la liste, parce qu'ouvrir un article
// n'inscrivait rien dans l'historique. Chaque surface qui recouvre l'écran
// pousse une entrée ; un retour (geste ou navigateur) ferme la couche du
// dessus. Fermer depuis l'app retire l'entrée sans fermer autre chose.

describe('isAndroid', () => {
  it('reconnaît Chrome Android et rien d’autre', () => {
    expect(isAndroid('Mozilla/5.0 (Linux; Android 17; sdk_gphone64_x86_64) AppleWebKit/537.36 Chrome/145.0 Mobile Safari/537.36')).toBe(true);
    expect(isAndroid('Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 Version/27.0 Mobile/15E148 Safari/604.1')).toBe(false);
    expect(isAndroid('Mozilla/5.0 (Macintosh; Intel Mac OS X 15_0) AppleWebKit/605.1.15 Safari/605.1.15')).toBe(false);
  });
});

function harness() {
  const log: string[] = [];
  const closed: Layer[] = [];
  const h = new HistoryLayers({
    push: (layer) => log.push(`push:${layer}`),
    back: () => log.push('back'),
    close: (layer) => closed.push(layer),
  });
  return { h, log, closed };
}

describe('HistoryLayers', () => {
  let t: ReturnType<typeof harness>;
  beforeEach(() => { t = harness(); });

  it('pousse une entrée quand une couche s’ouvre, pas quand elle change de contenu', () => {
    t.h.sync({ article: true, drawer: false, prefs: false });
    t.h.sync({ article: true, drawer: false, prefs: false }); // article suivant : même couche
    expect(t.log).toEqual(['push:article']);
  });

  it('un retour ferme la couche du dessus — les préférences avant le tiroir, le tiroir avant l’article', () => {
    t.h.sync({ article: true, drawer: false, prefs: false });
    t.h.sync({ article: true, drawer: true, prefs: false });
    t.h.sync({ article: true, drawer: true, prefs: true });
    expect(t.log).toEqual(['push:article', 'push:drawer', 'push:prefs']);
    t.h.onPop(); expect(t.closed).toEqual(['prefs']);
    t.h.sync({ article: true, drawer: true, prefs: false });
    t.h.onPop(); expect(t.closed).toEqual(['prefs', 'drawer']);
    t.h.sync({ article: true, drawer: false, prefs: false });
    t.h.onPop(); expect(t.closed).toEqual(['prefs', 'drawer', 'article']);
    expect(t.log).toEqual(['push:article', 'push:drawer', 'push:prefs']); // aucun back synthétique
  });

  it('un retour sans couche ouverte ne ferme rien (le navigateur quitte, comme toute app)', () => {
    t.h.onPop();
    expect(t.closed).toEqual([]);
  });

  it('fermer depuis l’app retire l’entrée (back synthétique) et ce pop-là ne ferme pas la couche suivante', () => {
    t.h.sync({ article: true, drawer: false, prefs: false });
    t.h.sync({ article: true, drawer: false, prefs: true });
    // la croix des préférences
    t.h.sync({ article: true, drawer: false, prefs: false });
    expect(t.log).toEqual(['push:article', 'push:prefs', 'back']);
    t.h.onPop(); // le popstate provoqué par ce back
    expect(t.closed).toEqual([]); // l'article reste ouvert
    t.h.onPop(); // un vrai geste retour, maintenant
    expect(t.closed).toEqual(['article']);
  });

  it('ne fait jamais plus de back qu’il n’a poussé', () => {
    t.h.sync({ article: false, drawer: false, prefs: false });
    expect(t.log).toEqual([]);
    t.h.sync({ article: true, drawer: false, prefs: false });
    t.h.onPop(); // retour natif : l'app ferme l'article en réponse…
    t.h.sync({ article: false, drawer: false, prefs: false }); // …ce qui ne doit pas déclencher un back de plus
    expect(t.log).toEqual(['push:article']);
  });
});
