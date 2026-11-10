# 1.9.1 — en préparation

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

## Fonctionnalités

- **Les non-lus des étiquettes.** Préférences → Étiquettes propose deux
  réglages indépendants pour les étiquettes, comme pour Favoris et À lire plus
  tard : le total (l'ancien « Afficher le nombre d'articles », renommé) et le
  nombre de non-lus, avec la pastille des flux (désactivé par défaut). Les deux
  peuvent s'afficher ensemble ; un groupe additionne ses enfants. Le chiffre
  vient du relevé des compteurs que FriRSS fait déjà chaque minute, qui
  demande FreshRSS 1.26 ou plus : sur un serveur plus ancien rien ne
  s'affiche et Préférences → Étiquettes demande la mise à jour. Suite de
  l'issue #29.
- **Les compteurs par identifiants montent à 9999** (ils s'arrêtaient à 1000) :
  totaux et non-lus des étiquettes, de Favoris et d'À lire plus tard. Une
  étiquette de plus de mille articles affichait 1000.

## Sous le capot

- **Les totaux de Favoris et d'À lire plus tard ne sont plus relevés quand
  leur réglage est éteint** (deux réponses de 9999 identifiants par minute
  pour un chiffre invisible) ; les allumer relance le relevé tout de suite.
