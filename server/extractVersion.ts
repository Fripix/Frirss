/**
 * Version de l'extraction d'articles. À MONTER chaque fois que le résultat de
 * l'extraction change pour une même page (`server/extract.ts`, ou son repli
 * navigateur `src/utils/extractContent.ts`).
 *
 * Elle entre dans la clé du cache Redis des extraits (`extractKey`) : un
 * extrait gardé par l'algorithme précédent n'est plus relu, il expire avec
 * `CACHE_TTL`. Sans elle, l'avis tronqué d'avant L-04/A-1 restait servi
 * jusqu'à 24 h, et le navigateur le recopiait dans son propre cache (A-2).
 *
 * Même valeur que `src/lib/extractVersion.ts` (le cache du navigateur) : le
 * serveur et le client ne partagent pas de code, `server/test/cache.test.ts`
 * vérifie qu'elles ne divergent pas.
 *
 * 1 : jusqu'à la 1.8.x (implicite, absent des clés et des extraits).
 * 2 : 1.9.0 — seuil de Readability à 500 (L-04), seconde passe sur le
 *     conteneur principal (A-1).
 * 3 : 1.9.0 — blocs étrangers (pied, rail, formulaires, fil d'Ariane,
 *     commentaires, « Related », crédits) retirés avant toute passe (M-04) :
 *     les extraits v2 pollués sont refaits.
 * 4 : 1.9.0 — la seconde passe n'est retenue que si elle rend 1,5 fois plus
 *     de texte (N-1) : les extraits v3 qui portaient un encart produit ou une
 *     ligne promotionnelle (Numerama) sont refaits.
 * 5 : 1.9.0 (troisième round) — images paresseuses résolues et boutons
 *     d'agrandissement déballés (A1), nouvelles familles de blocs étrangers
 *     (A3 : publicités, affiliation, formulaire d'abonnement, repli CodePen,
 *     colonne `#secondary`) : les extraits v4 aux images en cadre blanc ou
 *     encombrés de ces blocs sont refaits.
 * 6 : 1.9.0 (troisième round, suite) — corps réparti en blocs cousins réuni
 *     avant Readability (Ars Technica : chapeau perdu, ou notice de l'auteur
 *     et compteur de commentaires ramassés) ; termes de taxonomie
 *     (`tag-*`, `category-*`) ignorés et billet jamais jugé « court » (un
 *     billet WordPress court étiqueté `pwa` ou `ads` sortait entier) ; seuls
 *     les boutons d'agrandissement déballés (les icônes entraient) : les
 *     extraits v5 sont refaits.
 * 7 : 1.9.0 (vérification du troisième round, R3V-01) — la réunion du corps
 *     réparti est tout ou rien par `<article>`, et jamais d'une cellule de
 *     tableau à l'autre : les extraits v6 de Clubic réduits à un morceau du
 *     milieu (chapeau, moitié du texte et images perdus) sont refaits.
 * 8 : 1.9.0 (quatrième round) — un bloc invisible pour Readability
 *     (`noscript`, `[hidden]`, `aria-hidden`, `display:none`…) n'entre plus
 *     dans la réunion du corps réparti (B-01 : extraits v7 vides ou doublés) ;
 *     intertitres, images légendées et contenus intégrés entre deux blocs ne
 *     coupent plus la réunion (A4-01 : Clubic réduit à son dernier bloc) ;
 *     une liste seule est remise dans son article (A4-02 : gros avis du
 *     CERT-FR réduits à leurs références) ; voile de consentement, encart
 *     payant et bouton « retour en haut » retirés (A4-03). Rien n'ayant été
 *     déployé entre ces correctifs, une seule montée.
 * 9 : 1.9.0 (relecture des correctifs du quatrième round) — document
 *     complété comme le ferait le navigateur (`<head>` jamais fermé, contenu
 *     hors de `<body>` : RX-01) ; règles du voile, du bouton « retour en
 *     haut » et de l'encart payant resserrées (RX-02 à RX-04) ; voile de
 *     consentement retiré APRÈS Readability (V2-02 : les extraits v8 de
 *     Numerama avaient perdu leurs tweets intégrés). Les extraits v8 servis
 *     à l'instance de développement sont refaits.
 */
export const EXTRACT_VERSION = 9;
