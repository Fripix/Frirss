# 1.8.1 — en préparation

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

_(rien pour l'instant)_

## Corrections et améliorations

- **La palette ne propose plus « Traduire » sur une traduction qui vient de
  s'afficher.** Pendant un court instant, avant le retrait de son écouteur, le
  volet répondait encore « oui ». C'était aussi un rouge possible en CI, de même
  forme que celui de « Résumer » corrigé en 1.8.0.

## Sous le capot

- **Un registre des régressions.** `docs/REGRESSIONS.md` recense les bugs passés, ce
  qui les protège, et la checklist manuelle d'avant release.
- **Plus de sortie en échec avec tous les tests verts.** `useReturnFocus` pouvait
  réveiller son minuteur après la destruction de jsdom (`document is not
  defined`).
