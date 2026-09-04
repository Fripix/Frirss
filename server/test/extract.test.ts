import { describe, it, expect } from 'vitest';
import { extractArticle, EXTRACT_MAX_PENDING, ExtractorBusyError, extractPending, withExtractSlot } from '../extract.js';

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
    //
    // La sonde doit être un attribut que DOMPurify RETIRE : une version
    // antérieure cherchait un `<p>zzz</p>`, qui survit aussi bien à un
    // assainissement — le test passait donc au vert contre une implémentation
    // assainissante, et ne gardait rien. `onclick`/`onerror` ne survivent que
    // sur le chemin non assaini.
    const evil = page
      .replace('<p>Un premier', '<p onclick="alert(1)">Un premier')
      .replace('</article>', '<img src="/img/a.jpg" onerror="alert(2)"></article>');
    const out = extractArticle('https://example.com/a', evil);
    expect(out!.content).toContain('onclick="alert(1)"');
    expect(out!.content).toContain('onerror="alert(2)"');
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

// ── La file d'analyse ────────────────────────────────────────────────
// `parseHTML` + `Readability` bloquent l'unique boucle d'événements qui sert
// toute l'instance (des dizaines de ms à ~1 s au plafond de 5 Mo), et cette
// charge est NEUVE : elle vivait sur chaque téléphone avant la 1.4.10. Le seul
// frein était le seau de cadence (600/min par compte), qui permet un ordre de
// grandeur de plus que ce que la boucle absorbe.
describe('withExtractSlot', () => {
  it('rend le résultat de l’analyse et libère la place', async () => {
    await expect(withExtractSlot(() => 'extrait')).resolves.toBe('extrait');
    expect(extractPending()).toBe(0);
  });

  // Le point de la file : un tour de boucle COMPLET entre deux analyses. Une
  // promesse déjà réglée ne rendrait la main qu'aux micro-tâches, et la boucle
  // enchaînerait N immobilisations sans traiter une seule entrée-sortie.
  it('rend la main à la boucle entre deux analyses', async () => {
    const order: string[] = [];
    const first = withExtractSlot(() => {
      order.push('analyse 1');
      setImmediate(() => order.push('boucle'));
    });
    const second = withExtractSlot(() => { order.push('analyse 2'); });

    await Promise.all([first, second]);

    expect(order).toEqual(['analyse 1', 'boucle', 'analyse 2']);
  });

  // Saturation : on refuse plutôt que d'accepter une file sans fond. Le client
  // se replie sur son propre extracteur — ce qu'il faisait avant la 1.4.10 —,
  // ce qui coûte une extraction locale et jamais la mémoire du serveur.
  it('refuse au-delà du plafond, sans casser la file', async () => {
    const started: number[] = [];
    const accepted: Promise<void>[] = [];
    for (let i = 0; i < EXTRACT_MAX_PENDING; i++) {
      accepted.push(withExtractSlot(() => { started.push(i); }));
    }
    expect(extractPending()).toBe(EXTRACT_MAX_PENDING);

    await expect(withExtractSlot(() => 'de trop')).rejects.toBeInstanceOf(ExtractorBusyError);

    await Promise.all(accepted);
    expect(started).toEqual([...Array(EXTRACT_MAX_PENDING).keys()]);   // premier arrivé, premier servi
    expect(extractPending()).toBe(0);
    // La file redevient disponible : un refus n'est pas un verrou.
    await expect(withExtractSlot(() => 'après')).resolves.toBe('après');
  });

  // Une analyse qui lève ne doit pas laisser une promesse rejetée en fin de
  // file : toutes les suivantes attendraient pour toujours.
  it('laisse la file avancer après une analyse en erreur', async () => {
    const boom = withExtractSlot(() => { throw new Error('analyse ratée'); });
    const next = withExtractSlot(() => 'suivant');

    await expect(boom).rejects.toThrow('analyse ratée');
    await expect(next).resolves.toBe('suivant');
    expect(extractPending()).toBe(0);
  });
});
