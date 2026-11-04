# Tester FriRSS

Ce fichier décrit comment FriRSS est testé avant une release. Il complète `docs/REGRESSIONS.md`, qui garde la mémoire des bugs corrigés.

**Objectif :** zéro bug bloquant ou majeur connu à la release, aucun bug corrigé qui revient, et de moins en moins de bugs découverts après une release. Aucune méthode ne garantit un logiciel sans bug.

## Qui teste quoi

| Outil | Environnement | Ce qu'il cherche |
|---|---|---|
| Revue de code | Le code modifié | Sécurité, cas rares, erreurs invisibles à l'écran |
| Banc Playwright | Pile jetable isolée, données figées | Pannes, hors-ligne, actions destructrices, mobile, accessibilité, régressions |
| Navigateur distant | Instance de test, vrais flux | Vrais articles, extraction, images, rendu, usage réel |
| Humain | iPhone, iPad, Safari, fournisseur OIDC réel | Ce qu'aucun automate ne remplace |

## Déroulé d'une campagne

Une campagne porte sur une version candidate figée. Toute modification après son début lui appartient et sera revérifiée.

1. **Revue :** code modifié depuis la dernière release, puis revue de sécurité. Les passages suspects deviennent des cibles de test.
2. **Chasse :** trois tours autonomes, sans correction entre les tours. Chaque tour choisit ses zones et ses angles selon la carte de couverture.
3. **Liste unique :** anomalies et remarques de revue, reproduites, dédoublonnées et triées par gravité.
4. **Décision :** le mainteneur choisit ce qui est corrigé.
5. **Corrections :** en un lot, chacune avec un test qui échoue d'abord, une revue, et une ligne dans `docs/REGRESSIONS.md`.
6. **Vérification :** contrôle de chaque correction par le testeur, puis un tour ciblé sur ce qu'elles ont touché.
7. **Rodage :** usage quotidien de la pré-release pendant quelques jours, puis checklist manuelle de `docs/REGRESSIONS.md`.

**Celui qui teste ne corrige pas**, et l'auteur d'un correctif ne valide pas son propre correctif.

**Sortie :** la vérification ne trouve aucun nouveau bug bloquant ou majeur, toutes les zones ont été vues, les tests automatisés sont verts, et la checklist manuelle est faite. Sinon, nouveau lot, avec trois cycles au maximum. Au-delà, le mainteneur décide.

**Après la release :** chaque bug trouvé en usage réel entre au registre, avec ce qui aurait dû le voir.

## Gravité

| Niveau | Définition | Effet |
|---|---|---|
| Bloquant | Perte de données, faille de sécurité, application inutilisable | Bloque la release |
| Majeur | Une fonction importante donne un résultat faux, sans contournement simple | Bloque la release |
| Mineur | Gênant, avec un contournement | Décidé par le mainteneur |
| Idée | Amélioration, pas un défaut | Jamais bloquant |

## Format d'une anomalie

- **Titre :** le symptôme, tel qu'un utilisateur le dirait.
- **Gravité et zone.**
- **Version testée :** commit ou image exacte.
- **Reproduction :** étapes numérotées, depuis un état connu.
- **Attendu et obtenu.**
- **Preuve :** capture, journal ou réponse réseau.
- **Cause probable :** fichier et ligne, si elle est établie. Sinon, écrire « inconnue ».
- **État :** à reproduire, confirmée, écartée, corrigée, vérifiée.

Une anomalie non reproduite n'entre pas dans la liste. Une fausse alerte reste notée, avec son explication.

## Carte des zones

Chaque campagne doit voir chaque zone au moins une fois. Les zones suivent `docs/FEATURES.md`.

| Zone | Exemples |
|---|---|
| Comptes et connexion | Inscription, OIDC, sessions, changement de mot de passe |
| Serveurs FreshRSS | Ajout, jetons, plusieurs serveurs, erreurs |
| Navigation et mise en page | Barre latérale, disposition, largeurs |
| Liste d'articles | Filtres, tri, recherche, scroll, marquage, plages |
| Volet de lecture | Contenus, extraction, vidéos, traduction, résumé |
| Abonnements | Ajout, doublons, déplacement, suppression |
| Étiquettes et sauvegardés | Création, hiérarchie, favoris, à lire plus tard |
| Relève des flux | Rafraîchissement, compteurs, nouveaux articles |
| Hors-ligne et PWA | Préparation, file d'attente, service worker, mises à jour |
| Accessibilité | Clavier, lecteur d'écran, contraste, zoom |
| Apparence et thèmes | Thèmes, tailles, identité |
| Préférences | Synchronisation, onglets multiples, réinitialisation |
| Administration | Réglages, utilisateurs, IA |
| Serveur et sécurité | API, proxy, limites, en-têtes, jetons |
| Sauvegarde et restauration | Export, import, versions |
| Palette, messages et langues | Raccourcis, toasts, dix langues |

## Angles de test

Le testeur choisit les angles à chaque tour, en partant de ce qui a changé, de ce qui reste peu couvert et de là où les derniers bugs sont apparus :

- utilisateur nouveau, lecteur quotidien, administrateur ;
- séquences avec état, actions rapides, retours en arrière, plusieurs onglets ;
- réseau coupé, lent ou instable, réponses d'erreur, session expirée ;
- données extrêmes : très long, vide, HTML, langues de droite à gauche, gros volumes ;
- mobile, tablette, clavier seul, lecteur d'écran, thèmes sombres ;
- autour de chaque bug trouvé, car les bugs viennent souvent par familles.
