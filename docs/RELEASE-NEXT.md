# 1.5.1 — en préparation

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

- **Ordre des articles : plus anciens d'abord.** Réglage global dans
  Préférences → Général (synchronisé), surchargeable par flux depuis le menu
  contextuel du flux, sous le sélecteur de disposition — même moule que la
  disposition par flux. C'est FreshRSS qui livre la liste dans l'autre sens
  (`r=o`), page par page : un tri local n'aurait réordonné que les pages déjà
  reçues. Les deux sens ne partagent ni cache mémoire, ni liste hors-ligne, ni
  cache serveur. « Marquer au-dessus / en dessous » suit l'ordre affiché : en
  liste inversée, « au-dessus » désigne bien les plus anciens. Demandé dans
  l'issue #20.

## Corrections et améliorations

_(rien pour l'instant)_

## Sous le capot

- **Trois dépendances de production montées pour vider le panneau Docker Scout.**
  L'image `1.5.0` publiée affichait 17 vulnérabilités (1 critique, 9 hautes,
  5 moyennes, 2 basses), dont 14 venaient de `node_modules` et non de l'image de
  base — un renversement par rapport aux cycles précédents, où les paquets
  Alpine portaient presque tout. `proxy-addr` 2.0.7 → 2.0.8 corrige la critique
  (CVE-2026-90711, score 9.1) : une IP cliente pouvait être usurpée via un
  sous-réseau de confiance IPv6-mappé-IPv4, et c'est cette IP que `trust proxy`
  détermine puis que le plafond de requêtes du proxy prend pour clé. `axios`
  1.19.0 → 1.20.0 solde douze avis (7 hautes, 5 moyennes) et `dompurify`
  3.4.13 → 3.4.16 deux XSS DOM en mode `IN_PLACE`.
- **Le lockfile était la cause, pas `package.json`.** Les intervalles déclarés
  autorisaient déjà les versions corrigées ; `package-lock.json` épinglait les
  anciennes, et la CI construit depuis lui. Un `npm update` des trois paquets a
  donc suffi, sans toucher aux dépendances déclarées. Au passage, la version du
  projet inscrite dans le lockfile, restée à 1.4.10, redevient exacte.
- **Les deux CVE Alpine se règlent par la reconstruction seule** : `zlib`
  1.3.2-r0 → 1.3.2-r1 (CVE-2026-85091) et `pcre2` 10.48-r0 → 10.49-r0
  (CVE-2026-103111) sont déjà publiées dans 3.24, et `apk upgrade` les ramasse
  en tête de l'étape de production.

## Actions requises à la mise à jour

_(aucune)_

## Documentation

_(rien pour l'instant)_
