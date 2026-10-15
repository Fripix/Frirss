# 1.6.2 — en préparation

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

- **Résumés par IA** (discussion #22). Une pastille « Résumé IA » dans le volet
  de lecture envoie l'article au fournisseur que l'admin a déclaré (Claude, ou
  tout service compatible OpenAI dont Ollama) et affiche le résumé au-dessus de
  l'article. Éteint d'origine ; nouvelle section « IA » des Préférences avec le
  bloc admin « Fournisseurs » (interrupteur, fournisseurs, clé partagée, test de
  connexion, plafond quotidien). Repli automatique entre fournisseurs, cache
  des résumés, clés chiffrées, aucune dépendance nouvelle ; la sauvegarde
  chiffrée emporte les fournisseurs et leurs clés. Les clés personnelles, les
  réglages par flux et la traduction viennent ensuite.

## Corrections et améliorations

_(rien pour l'instant)_

## Sous le capot

_(rien pour l'instant)_

## Actions requises à la mise à jour

_(aucune)_

## Documentation

_(rien pour l'instant)_
