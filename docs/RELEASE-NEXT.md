# 1.10.1 — en préparation

Journal des changements du cycle en cours, tenu au fil de l'eau. Il alimente les
notes de la release GitHub et les corrections du README, puis se vide une fois
la release publiée.

> **À tenir à jour au moment du commit, pas à la fin du cycle.** Pour la 1.4.3,
> six correctifs manquaient à l'appel : le journal avait été rempli pour les
> gros morceaux et oublié pendant les finitions. Ils n'ont été retrouvés qu'en
> relisant les 57 commits. Contre-vérification utile avant de publier : differ
> `src/locales/en.json` contre le tag précédent — toute chaîne d'interface
> ajoutée ou modifiée doit correspondre à une entrée écrite ici.
>
> **Les commits sans chaîne d'interface échappent à cette contre-vérification.**
> Pour la 1.4.12, le menu du clic droit passé aux icônes et groupes, et le
> correctif de la feuille du bas sur iOS, manquaient tous deux au journal : ni
> l'un ni l'autre n'avait touché `en.json`. Relire aussi `git log`.

## Ajouté

- **Passer au flux suivant qui a des non-lus** (issue #35). Option « Après
  « Tout marquer comme lu », passer au suivant » (Préférences → Lecture →
  Marquer comme lu, désactivée par défaut) : vider un flux ouvre le flux
  suivant de la barre latérale qui a encore des non-lus, vider une catégorie
  ouvre la catégorie suivante, et s'il n'en reste aucun, la vue Non lus. Le
  même saut, sans rien marquer : touche `n` (réglable dans Clavier) et palette
  de commandes. L'ordre suivi est celui de la barre latérale, ordre personnel
  compris.

## Modifié

- **Préférences réorganisées et plus lisibles.** La colonne de gauche montre une
  icône par section ; un clic sur une section déplie ses sous-titres, un clic
  sur un sous-titre y fait défiler. « Général » est réparti en **Lecture**,
  **Clavier** et **Compte** ; les onglets Thème / Couleurs / Tailles /
  Identité d'Apparence deviennent des sous-parties d'une même page. Titres
  hiérarchisés, réglages groupés dans des blocs, texte d'un cran plus grand.
  Une section dépliée le reste quand on en ouvre une autre ; le réglage
  « Replier les autres sections » (Mise en page) rétablit le repli
  automatique. Le titre de chaque sous-partie est un bandeau qui reste collé en
  haut pendant qu'on la lit ; celle qu'on choisit dans la navigation est
  teintée de la couleur d'accent. Sur téléphone, la liste déplie aussi ses
  sous-titres, et « Retour » reste en haut de la page pendant le défilement.
  Chaînes ajoutées : `preferences.sections.reading` / `keyboard` / `account`,
  `preferences.reading.*`, `preferences.prefsNav.*`, `preferences.navShort.*`, `preferences.offline.prepareTitle`,
  `preferences.account.passwordTitle` ; retirées : `preferences.sections.general`,
  `preferences.general.title`, `preferences.account.title`,
  `preferences.offline.title`, `preferences.toolbars.everywhereTitle`.
