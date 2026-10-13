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
- **La visibilité par flux de FreshRSS est honorée.** Un flux réglé « afficher
  dans sa catégorie seulement » (ou dans sa propre vue seulement) ne paraît
  plus dans Tous les flux / Non lus, et son compte ne gonfle plus le badge.
  L'accueil charge le flux `org.freshrss/main` de FreshRSS 1.28+ au lieu de
  `reading-list` ; « Tout lu », « au-dessus / en dessous », la recherche et
  l'annulation visent ce même flux, donc un flux de catégorie n'est jamais
  marqué lu depuis l'accueil. Aucun réglage FriRSS : celui de FreshRSS fait
  foi. Un FreshRSS plus ancien ne change pas de comportement. Demandé dans la
  discussion #18.
- **Vue à l'ouverture.** Préférences → Général : *Dernière vue* (défaut, le
  comportement d'avant), *Tous les flux* ou *Non lus* — toujours cette vue au
  lancement et au rechargement, quoi qu'on ait consulté avant. Demandé dans
  la discussion #19.
- **Article complet par défaut.** Un réglage global dans Préférences → Général
  (désactivé d'origine), que chaque flux peut surcharger — *Par défaut / Oui /
  Non* — depuis son menu, à la place de l'ancienne case « Article complet
  auto ». Les flux déjà réglés gardent leur choix. Demandé dans la discussion
  #19 ; l'aide du réglage rappelle le coût : une extraction par article ouvert
  ou préparé hors-ligne.

## Corrections et améliorations

- **Le bandeau « Hors ligne » ne recouvre plus l'en-tête.** Fixé en haut de
  l'écran, il masquait sur Android la barre de la liste — titre, recherche,
  filtres — puisqu'aucune safe-area ne l'écartait (discussion #19, capture à
  l'appui ; mesuré à 320 px : l'en-tête entier dessous). Il occupe
  maintenant sa propre rangée sous la bande safe-area, dans les trois
  dispositions, et pousse l'en-tête vers le bas.
- **« Tout lu » dans la vue Non lus vide la liste.** Les lignes restaient
  affichées, passées lues, et il fallait tirer pour rafraîchir ou passer par
  le menu (discussion #19) ; le ✓ d'une seule ligne, lui, la retirait déjà.
  L'état « Tout est lu » s'affiche aussitôt ; le retour en arrière recharge
  la liste.
- **Android : le geste retour revient à la liste.** Depuis un article, le
  balayage depuis le bord gauche (ou le bouton Précédent) fermait l'app ; il
  ferme maintenant ce qui recouvre l'écran — l'article, le tiroir des flux,
  les Préférences — et ne quitte l'app qu'une fois tout refermé. Les
  balayages gauche/droite entre articles sont inchangés. Android seulement ;
  iOS et bureau ne changent pas. Demandé dans la discussion #19.
- **Android, app installée : la barre d'état ne fait plus « fenêtre de
  navigateur ».** Elle prenait la couleur de la barre des serveurs, sombre
  et masquée par défaut sur mobile — noire au-dessus d'un en-tête clair —
  puis l'accent en lecture (discussion #19). Elle prend maintenant la couleur
  de ce qui est juste dessous : l'en-tête de liste, le fond de l'article, ou
  la barre des serveurs si elle est affichée ; Chrome teinte la barre de
  navigation de même. Ce sont des couleurs du thème, déjà réglables. Une
  surface plus claire que ce que Chrome accepte en app installée (luminosité
  > 0,94, mesuré) est ramenée au plafond : `#fafafa` donne `#efefef`, presque
  blanc. iOS inchangé.

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
