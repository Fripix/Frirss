# Gestion des serveurs FreshRSS dans Préférences — design

**Date** : 2026-08-26
**Statut** : approuvé (brainstorming)
**Origine** : élément de backlog ouvert le 2026-08-21, différé jusqu'après la
refonte du panneau Préférences — livrée en 1.4.2.

## Le constat

`ServerSwitcher` fait deux métiers dans un seul composant de 320 lignes :

| Métier | Fréquence | Geste | Atteignable au tactile ? |
|--------|-----------|-------|--------------------------|
| Basculer de serveur | fréquent | tap sur une pastille | oui |
| Ajouter un serveur | rare | bouton `+` | oui |
| Renommer / défaut / supprimer | rare | **clic droit** | **non** |

Deux défauts en découlent, et le second est plus grave que celui qui a motivé
l'entrée de backlog.

### 1. Tout disparaît avec la barre du haut

Le composant ne se monte que sous `{topbarVisible && …}`, dans les trois
branches de disposition de `App.tsx` (lignes 321, 359, 416). Or `topbarVisible`
est une préférence utilisateur à un clic (`uiStore.ts:204`). La masquer rend
inaccessibles non seulement la gestion, mais aussi **la bascule elle-même** :
un utilisateur à deux instances FreshRSS se retrouve enfermé sur l'active.

C'est la même cause racine que le bug Critique du 2026-08-21, où le drapeau de
rafraîchissement vivait dans ce composant et n'était donc jamais positionné
quand la barre était masquée. Le correctif d'alors a déplacé la source de
vérité dans `App.tsx` ; il n'a pas traité le fond.

### 2. Trois actions sur cinq sont inaccessibles au tactile

Renommer, définir par défaut et supprimer passent par `onContextMenu`.
L'événement `contextmenu` n'est pas émis par Safari iOS : dans la PWA
installée, ces trois actions n'existent tout simplement pas — barre visible ou
non. Le problème est donc plus large que celui inscrit au backlog.

### 3. Le jeton de rafraîchissement est lié à l'actif, implicitement

`FeedsTab` (211 lignes) ne configure que le jeton du serveur **actif**, sans
jamais le nommer à l'écran. Tant que rien d'autre n'y figure, l'ambiguïté est
supportable ; elle devient trompeuse dès qu'une liste de serveurs s'affiche
au-dessus.

## La cible

### Répartition des rôles

**Topbar (`ServerSwitcher`) — sélecteur pur**, ~320 → ~150 lignes.
Les pastilles conservent la bascule d'un tap. Le `+` et le clic droit
deviennent des **raccourcis** vers l'écran de gestion : ils n'exécutent plus
aucune action, ils y mènent. Aucune logique dupliquée.

- `+` → `openPreferences('feeds', 'addServer')`
- clic droit → menu à une entrée, « Gérer les serveurs… » →
  `openPreferences('feeds')`

**Préférences → Flux — l'écran de gestion**, seul endroit complet.
Une liste de serveurs, une entrée par serveur, plus un bouton d'ajout.

| Entrée repliée | Entrée dépliée |
|----------------|----------------|
| nom, hôte, utilisateur FreshRSS | renommer |
| badge « actif » | définir par défaut |
| badge « par défaut » | jeton de rafraîchissement + Test |
| chevron de dépliage | supprimer |

**Deux cibles par ligne, chacune de 44 pt.** Le corps de la ligne bascule sur
ce serveur ; le chevron, à droite, déplie les détails. C'est l'idiome des
réglages Wi-Fi d'iOS — la ligne fait l'action fréquente, un contrôle dédié
ouvre le détail — et il garde la bascule à un seul tap même quand la barre du
haut est masquée. Le chevron prend toute la hauteur de la ligne pour que sa
zone tactile ne dépende pas de la taille du glyphe.

Deux conséquences qui ne sont pas des options :

- **La bascule existe aussi dans la liste.** Sans elle, masquer la barre du
  haut continue d'enfermer l'utilisateur sur le serveur actif — le défaut n°1
  ne serait qu'à moitié corrigé.
- **L'entrée du serveur actif est dépliée d'office.** `RefreshBanner.tsx:75`
  pointe déjà sur la section `feeds` en promettant le champ jeton ; il doit
  l'y trouver sans repli à ouvrir.

**Connexion héritée.** Une connexion FreshRSS sans enregistrement en base
(première connexion, comptes anciens) apparaît en lecture seule et ne se
déplie pas — même traitement que la pastille synthétique actuelle.

### Découpage des fichiers

Le dossier suivi par git est `src/components/Preferences/`, **avec une
majuscule** ; macOS masque l'erreur, le CI Linux non.

```
src/lib/serverList.ts                                    logique pure
src/lib/serverList.test.ts
src/components/Preferences/servers/ServerList.tsx        liste + ajout, détient l'état
src/components/Preferences/servers/ServerRow.tsx         une entrée, repliée/dépliée
src/components/Preferences/servers/RefreshTokenField.tsx extrait de FeedsTab, paramétré par serverId
src/components/Preferences/servers/AddServerDialog.tsx   déplacé depuis ServerSwitcher/
```

`serverList.ts` extrait trois fonctions aujourd'hui enfouies dans
`ServerSwitcher`, pures et communes aux deux écrans :

- la fusion de la connexion héritée dans la liste affichable ;
- `hostnameOf(url)` — hôte abrégé, sans `www.`, tolérant aux URL malformées ;
- le choix du serveur de repli après suppression de l'actif.

`FeedsTab` se réduit à monter `<ServerList />`. `RefreshTokenField` **déplace**
la logique durement acquise de `FeedsTab` sans la réécrire :

- le drapeau `edited`, sans lequel un Save non touché efface un jeton valide
  (le backend traite `''` comme un effacement explicite) ;
- le Test qui éprouve la valeur **tapée** et non la stockée — corrigé le
  2026-08-21 après que l'utilisateur a trouvé le défaut en usage réel ;
- le garde de démontage pendant les 30 s de scrutation.

### Backend

Aucun changement. Les sept routes de `server/routes/servers.ts` sont déjà
adressées par `/:id`, jeton et actualisation compris : configurer le jeton d'un
serveur non actif fonctionne sans y basculer.

### Intention de deep-link

`openPreferences(tab, intent?)` ajoute `preferencesIntent` au `themeStore`,
consommé puis vidé au montage, déclenché par `preferencesOpenId` comme l'est
déjà l'onglet — sans quoi une réouverture relancerait le dialogue d'ajout.

### Erreurs

Les six gestionnaires actuels avalent leur échec (`catch { /* ignore */ }`) :
un renommage refusé ne produit rien à l'écran. Acceptable dans un menu
contextuel fugace, pas dans un écran de gestion. Chaque ligne affiche son
erreur. C'est le seul écart assumé au-delà du déplacement, et il porte sur du
code de toute façon touché.

## Garde-fou à adapter — et à éprouver

`settingsCoverage.test.ts` parcourt `fs.readdirSync(DIR)` **à plat**
(ligne 45). Déplacer le champ jeton dans `servers/` rendrait invisibles les
**7 clés `preferences.refresh.*`** du relevé, et le garde-fou virerait au rouge
sans que rien ne soit cassé.

Retoucher le relevé serait la mauvaise réponse. Le parcours devient
**récursif** : l'intention du garde-fou est « ces réglages restent atteignables
dans le panneau Préférences », et un sous-dossier du panneau reste le panneau.
La version récursive est strictement plus stricte que l'actuelle.

Conformément à `CLAUDE.md`, le garde-fou modifié doit **prouver qu'il sait
encore échouer** : introduire une dérive, le voir rougir, retirer la dérive.

## Tests

**D'abord `src/lib/serverList.test.ts`**, avant tout composant :

- fusion de la connexion héritée quand l'actif n'a pas d'enregistrement ;
- absence de doublon quand il en a un ;
- `hostnameOf()` sur URL valide, sur URL malformée, avec `www.` ;
- repli après suppression de l'actif : serveur par défaut, sinon premier
  restant, sinon aucun ;
- refus de supprimer le dernier serveur.

Valeurs fictives uniquement (`example.com`).

Puis : `settingsCoverage` vert par la récursion, `featuresDoc` vert, parité des
9 locales vérifiée.

## Trois facteurs de forme

Aucune action ne dépend du survol ni du clic droit — c'est l'objet même de
l'exercice. Lignes dépliables au tap, cibles de 44 pt, vérification sur
desktop, tablette et iPhone en PWA installée avant de déclarer terminé. Le
clic droit ne subsiste que comme raccourci desktop vers un écran atteignable
autrement.

## i18n

Réutilisées, déjà traduites dans les 9 locales : `servers.rename`,
`servers.setDefault`, `servers.delete`, `servers.confirmDelete`,
`servers.addTitle`, `servers.errorDuplicate`.

À créer dans les 9 locales : l'entrée « Gérer les serveurs… », les badges
« actif » et « par défaut », l'erreur générique d'action, et les libellés de
dépliage.

## Documentation

`docs/FEATURES.md:68` décrit ce piège comme connu :

> `ServerSwitcher` est **le seul** endroit permettant d'ajouter, renommer,
> supprimer ou changer de serveur, et il ne se monte que si la barre supérieure
> est visible.

Cette prose devient fausse le jour où la fonctionnalité atterrit. Elle est
réécrite **dans le même commit** — le garde-fou `featuresDoc.test.ts`
n'attrape pas les descriptions devenues fausses.

## Hors périmètre

- Le bloc `<details>` du jeton, quasi dupliqué entre `AddServerDialog` et
  `Login.tsx` : jugé le 2026-08-21 non extractible pour l'instant, les clés
  i18n étant partagées. Inchangé ici.
- Toute évolution du backend des serveurs.
- Le sort de la barre du haut elle-même : elle reste, en sélecteur.
