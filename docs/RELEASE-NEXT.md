# 1.9.2 — en préparation

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

- **Le port d'écoute du conteneur se règle** avec `FRIRSS_PORT` (80 par
  défaut). Utile quand le conteneur n'a pas de correspondance de ports :
  réseau « host », ou une IP à lui (`br0` d'Unraid, macvlan). Avec `-p`, rien
  ne change. Une valeur invalide arrête le conteneur avec un message dans
  `docker logs`. Issue #33.
- **La taille des vignettes de la liste se règle** : Préférences → Apparence →
  Tailles → Liste d'articles → Vignettes, de 56 à 160 px (80 par défaut,
  l'affichage d'avant). Elles se voient avec la densité Aperçu, dans la liste
  comme dans la vue côte à côte ; dans une liste étroite, une grande vignette
  s'arrête à 40 % de la ligne pour laisser la place au titre. Issue #34.

## Sous le capot

- **Une variable `PORT` ne casse plus l'API** : elle déplaçait le serveur Node
  interne hors du port 3001 où nginx l'attend. Le conteneur le fixe désormais.
