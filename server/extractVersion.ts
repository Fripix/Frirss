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
 * 10 : 1.9.0 — rien n'est retiré d'un `<pre>` ni d'un `<code>`, et un
 *     contrôle posé dans du code (`<button>` Twoslash) devient son texte
 *     (REG-219 : un exemple entier perdu sur le blog de Node.js, un
 *     identifiant du code dès la 1.8.0) : les extraits v9 sont refaits.
 * 11 : 1.9.0 — garde de non-perte : ce que la page lue intacte garde dans le
 *     conteneur de l'article, avant le corps (chapeau, image et légende
 *     d'en-tête — The Verge, Ars Technica, blog de Google : REG-220), ou
 *     après lui quand le résultat est sous le seuil (REG-221), est remis ; et
 *     le sommaire de l'article n'est plus retiré (REG-222) : les extraits v10
 *     sont refaits.
 * 12 : 1.9.0 — deux exemplaires d'un même bloc qui se suivent n'en font plus
 *     qu'un (chapeau et photo d'en-tête de The Verge, une fois par mise en
 *     page : REG-225 ; légende de la visionneuse d'Ars Technica : REG-226) ;
 *     la garde de non-perte ne remet jamais ce que la page masque, ni une
 *     image que le résultat montre déjà à une autre taille : les extraits v11
 *     sont refaits.
 * 13 : 1.9.0 — la garde de non-perte ne relit plus la page intacte (le
 *     témoin) : la page vérifie Readability. Ce que le conteneur de l'article
 *     porte et que le résultat ne lit pas y est remis, sur preuve (JSON-LD,
 *     description), dans l'en-tête, dans un trou du corps, dans la suite de
 *     même gabarit (REG-229 à REG-231 : le corps entier des billets de
 *     Docker, les chapeaux de The Verge, la suite des dossiers de Clubic) ;
 *     un encadré dans le fil du texte n'est plus retiré (REG-232) ; une vidéo
 *     paresseuse prend son adresse (REG-233) : les extraits v12 sont refaits.
 * 14 : 1.9.0 — les médias de l'article : la question d'un `<details>` revient
 *     avec sa réponse (REG-239), une `<picture>` sans `<img>` prend celle de
 *     son `<noscript>` (REG-240), une vidéo intégrée derrière un voile prend
 *     son `data-src` (REG-241), un élément personnalisé montre la vidéo ou la
 *     citation de ses attributs (REG-242), un aperçu flou prend sa plus grande
 *     variante (REG-243), l'image d'en-tête dans un lien d'agrandissement
 *     revient (REG-244) : les extraits v13 sont refaits.
 * 15 : 1.9.0 — les photos et légendes d'un dossier rangées entre deux blocs
 *     de la suite du corps reviennent, et la légende d'une photo remise
 *     revient avec elle, même un crédit répété (REG-246) ; le logo du bouton
 *     « source préférée » de Google ne passe plus dans l'article (REG-247) :
 *     les extraits v14 sont refaits.
 */
export const EXTRACT_VERSION = 15;
