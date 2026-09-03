import { describe, it, expect } from 'vitest';
import { extractArticle } from '../extract.js';

const page = `<!doctype html><html><head><title>Titre de la page</title></head>
<body><article><h1>Un vrai titre</h1>
<p>Un premier paragraphe suffisamment long pour que Readability le retienne comme corps de l'article, avec assez de mots pour dépasser son seuil.</p>
<p>Un second paragraphe, lui aussi assez fourni pour peser dans la balance du score de lisibilité calculé par Readability.</p>
</article></body></html>`;

describe('extractArticle', () => {
  it('rend le corps de l’article', () => {
    const out = extractArticle('https://example.com/a', page);
    expect(out).not.toBeNull();
    expect(out!.content).toContain('premier paragraphe');
    // Readability garde le <title> de la page quand le <h1> ne partage aucun
    // mot avec lui — c'est son comportement, pas un défaut. On l'assert tel
    // quel plutôt qu'approximativement : un changement de règle en amont doit
    // se voir.
    expect(out!.title).toBe('Titre de la page');
  });

  it('N’assainit PAS — c’est le client qui le fait', () => {
    // Décision du 2026-09-04. `createDOMPurify` sur la fenêtre de `linkedom`
    // ne filtre rien (il manque `NodeFilter`, DOMPurify passe en mode
    // « environnement non supporté » et rend l'entrée telle quelle, sans
    // erreur). Assainir ici aurait donné un filet auquel on croit et qui ne
    // retient rien. Le client applique `sanitizeExtracted()` à la réception,
    // comme il le fait déjà pour sa propre extraction.
    const evil = page.replace('</article>', '<p>zzz</p></article>');
    const out = extractArticle('https://example.com/a', evil);
    expect(out!.content).toContain('zzz');
  });

  it('résout les URL relatives contre l’URL de l’article', () => {
    // Sans <base>, une image en chemin relatif serait irrécupérable pour le
    // navigateur, qui reçoit le HTML sans savoir d'où il vient.
    const withImg = page.replace('</article>', '<img src="/img/a.jpg"></article>');
    const out = extractArticle('https://example.com/dir/a', withImg);
    expect(out!.content).toContain('https://example.com/img/a.jpg');
  });

  it('rend null quand la page n’a pas d’article lisible', () => {
    const out = extractArticle('https://example.com/a', '<html><body></body></html>');
    expect(out).toBeNull();
  });
});
