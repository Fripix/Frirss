// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { nestedInteractive } from './nestedInteractive';

function dom(html: string): HTMLElement {
  const root = document.createElement('div');
  root.innerHTML = html;
  return root;
}

describe('nestedInteractive', () => {
  it('signale un role="button" qui contient un vrai bouton', () => {
    const root = dom('<div role="button" tabindex="0" id="row">x<button>★</button></div>');
    expect(nestedInteractive(root).map((e) => e.id)).toEqual(['row']);
  });

  it('signale aussi un lien hors tabulation (tabindex="-1") : il reste focalisable', () => {
    const root = dom('<div role="button" tabindex="0" id="row"><a href="https://example.com" tabindex="-1">t</a></div>');
    expect(nestedInteractive(root).map((e) => e.id)).toEqual(['row']);
  });

  it('signale un <button> natif qui contient un lien', () => {
    const root = dom('<button id="b"><a href="https://example.com">t</a></button>');
    expect(nestedInteractive(root).map((e) => e.id)).toEqual(['b']);
  });

  it('accepte un role="button" qui ne contient que du texte et des éléments inertes', () => {
    const root = dom('<div role="button" tabindex="0"><span>titre</span><a>sans href</a></div>');
    expect(nestedInteractive(root)).toEqual([]);
  });

  it('accepte un conteneur dont le rôle admet des contrôles (article, group)', () => {
    const root = dom('<div role="article" tabindex="0"><a href="https://example.com" tabindex="-1">t</a><button>★</button></div>');
    expect(nestedInteractive(root)).toEqual([]);
  });

  it('regarde la racine elle-même', () => {
    const root = dom('');
    root.setAttribute('role', 'button');
    root.innerHTML = '<input>';
    expect(nestedInteractive(root)).toEqual([root]);
  });
});
