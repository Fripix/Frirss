# Refonte du panneau Préférences — design

**Date** : 2026-08-21
**Statut** : approuvé (brainstorming + maquette validée)
**Origine** : demande de l'utilisateur — « ça devient n'importe quoi », et la
largeur du panneau est devenue absurde.

## Le constat, mesuré

`Preferences.tsx` fait **3 012 lignes** et porte neuf sujets sans rapport.
Trois défauts se superposent.

### 1. La largeur n'est pas un choix

Ligne 299 : `width: 'fit-content'`. Le panneau épouse la largeur naturelle de sa
barre d'onglets, et la zone de contenu est explicitement neutralisée
(`w-0 min-w-full`) pour ne pas peser sur elle.

**Chaque onglet ajouté élargit donc le panneau.** L'onglet « Relève », livré le
2026-08-21, l'a élargi. Le suivant l'élargira encore. C'est un mécanisme, pas un
accident.

### 2. Les onglets sont déséquilibrés

| Onglet | Contenu | Poids |
|--------|---------|-------|
| Général | 2 réglages | 53 lignes |
| Étiquettes | gestion **et** couleurs, mêlées | 658 lignes |
| Admin | comptes, SSO, mode d'auth, break-glass | 620 lignes |
| Apparence | **langue**, nom, logo | 292 lignes |
| Hors-ligne | préparation, budget d'images | 206 lignes |
| Raccourcis | raccourcis clavier | 191 lignes |
| Couleurs / Tailles / Thèmes / Relève | — | — |

### 3. Le classement ne suit pas le modèle mental

- La **langue** est rangée dans « Apparence ». Ce n'est pas un réglage
  d'apparence, et personne ne l'y cherche.
- Le **thème** est éclaté sur trois onglets — Couleurs, Tailles, Thèmes — alors
  que c'est un seul sujet.
- Les **raccourcis** occupent une entrée de navigation pour un seul écran.
- L'**administration** partage la même barre que les préférences personnelles,
  alors que son public et sa fréquence d'usage sont différents.

## La nouvelle structure

Cinq sections, plus l'administration détachée. Regroupées par **ce que
l'utilisateur est en train de changer**, pas par type technique de réglage.

| Section | Contenu | Provenance |
|---------|---------|-----------|
| **Général** | langue · comportement de lecture · raccourcis clavier | Général + Apparence (langue) + Raccourcis |
| **Apparence** | sous-sections : Thème · Couleurs · Tailles · Identité | Couleurs + Tailles + Thèmes + Apparence (nom, logo) |
| **Étiquettes** | gestion et couleurs réunies | Étiquettes |
| **Flux** | relève des flux (jeton maître) | Relève |
| **Hors-ligne** | préparation, budget d'images | Hors-ligne |
| **Administration** | comptes, authentification, SSO | Admin |

L'administration reste **dans ce panneau** — décision de l'utilisateur du
2026-08-21 — mais en bas de la navigation, après un séparateur, et visible aux
seuls administrateurs comme aujourd'hui.

## La mise en page

**Navigation verticale à gauche.** C'est ce qui découple la largeur du nombre de
sections : ajouter une section ne coûte plus un pixel.

- Largeur du panneau : **680 px** (navigation 178, contenu le reste).
- Plancher et plafond conservés : `minWidth: min(92vw, 460px)`, `maxWidth: 92vw`.
- `width: 'fit-content'` **disparaît**. C'est le cœur du correctif.
- Sous 768 px, la navigation repasse au-dessus du contenu et le panneau occupe
  la largeur disponible.

## L'aperçu en direct, et son couplage avec l'existant

### Ce qui existe déjà et qu'on ne remplace pas

`COLOR_HIGHLIGHT_MAP` associe chaque couleur à un sélecteur CSS sur la **vraie
interface**. Au survol, l'app assombrit l'écran et encadre jusqu'à 6 éléments
réels. **Ce mécanisme est conservé tel quel.**

Ses deux angles morts, mesurés :

- **8 couleurs sur 36 n'ont aucun sélecteur** (`null`), dont `accent` et
  `accent-dark` avec le commentaire *« too many elements, skip »*. Les deux
  couleurs les plus structurantes du thème sont celles qu'on ne peut pas montrer.
- Le mécanisme exige que l'élément soit **visible derrière le panneau** : rien à
  encadrer si aucun article n'est ouvert, si la barre supérieure est masquée, ou
  sur mobile où le panneau couvre tout.

### Ce qu'on ajoute

Une **miniature de FriRSS** en tête de la section Apparence — barre latérale,
liste, volet de lecture — qui se recompose à chaque changement de couleur ou de
taille, et dans laquelle la zone survolée est **cerclée et nommée**.

Le même événement de survol alimente les deux : l'encadrement réel *et*
l'aperçu. Les deux répondent à des questions différentes — *où* s'applique cette
couleur, et *de quoi* ça aura l'air.

**Règle de conception** : ne rien éteindre. Une première version assombrissait
l'aperçu à 22 % autour de la zone visée ; l'utilisateur l'a jugée illisible, et
il avait raison — on perd le contexte au moment où on en a besoin. Un anneau net
plus une étiquette suffisent.

### Couverture honnête

Sur les 36 couleurs : **28** sont encadrables sur l'interface réelle, **14**
auront une zone dans l'aperçu, **6** n'ont ni l'un ni l'autre — séparateurs,
bordures, barres de défilement, fond d'alerte. Trop diffuses pour être
désignées.

**L'interface doit l'avouer** plutôt que de faire semblant : au survol d'une de
ces six, la légende dit que ni l'aperçu ni l'interface réelle ne peuvent la
montrer. Le réglage fonctionne ; c'est la démonstration qui n'est pas possible.

## Le sélecteur de langue

Aujourd'hui : drapeau + code sur deux caractères, le nom complet uniquement en
`title`/`aria-label`. Invisible au toucher.

Désormais : grille de trois colonnes, **drapeau conservé comme repère visuel**
et **nom de la langue écrit dans cette langue** (Français, Deutsch, Українська).
Le drapeau reste un raccourci de reconnaissance, pas le seul porteur de sens.

## Garantie de non-régression — la partie non négociable

L'exigence de l'utilisateur : **aucun réglage ne doit disparaître.** Une
relecture ne peut pas le garantir sur 3 012 lignes réparties en sept fichiers.

### Le garde-fou

Un relevé des clés de traduction référencées par le panneau **avant** la refonte
sert de référence, et un test échoue si l'une d'elles n'est plus référencée
après.

Relevé au 2026-08-21, sur `Preferences.tsx` + `RefreshTab.tsx` :

| Origine | Nombre |
|---------|--------|
| Clés statiques `t('…')` | 168 |
| Clés dynamiques dépliées (`colorKeys`, `fontKeys`, `shortcuts`, `tabs`, `colorSections`, `fontSections`) | 88 |
| Présentes dans les deux ensembles | 14 |
| **Union — total référencé** | **242** |

Les deux lignes ne s'additionnent pas : 14 clés du groupe `shortcuts` sont à la
fois écrites en dur et atteintes par dépliage. C'est l'**union** qui fait foi.

Détail par domaine : admin 58, colorKeys 36, shortcuts 26, offline 25, labels 22,
branding 19, themes 11, tabs 10, fontKeys 7, refresh 7, colorSections 6,
general 5, fontSections 3, colors 2, fonts 1, plus title / resetAll /
resetAllTooltip / confirm.

**Exemption explicite : `preferences.tabs.*` (10 clés).** Ce sont les libellés de
navigation, et la refonte les restructure délibérément — dix deviennent six. Le
garde-fou porte donc sur **232 clés**, et la spec assume ce retrait-là, seul et
documenté.

### Ce que ce garde-fou n'attrape pas

À dire clairement, parce qu'un test vert ne vaut pas quitus :

- un réglage **présent mais inatteignable** — clé toujours référencée dans un
  écran qu'aucune navigation n'atteint plus ;
- un réglage **présent mais cassé** — le libellé s'affiche, l'action ne fait
  plus rien.

Le test est complété par une **revue écran par écran** avant livraison, section
par section, en cochant les réglages listés ci-dessus.

## Découpage des fichiers

Les 3 012 lignes ne sont pas le problème en soi : le problème est qu'un fichier
porte neuf sujets. La refonte les sort naturellement.

| Fichier | Rôle |
|---------|------|
| `Preferences.tsx` | coque, navigation, largeur, survol/aperçu partagés |
| `GeneralTab.tsx` | langue, lecture, raccourcis |
| `AppearanceTab.tsx` | thème, couleurs, tailles, identité + aperçu |
| `LabelsTab.tsx` | étiquettes et leurs couleurs |
| `FeedsTab.tsx` | relève (reprend `RefreshTab.tsx`) |
| `OfflineTab.tsx` | hors-ligne |
| `AdminTab.tsx` | comptes, authentification |

## i18n

Les seules chaînes nouvelles sont les **six libellés de section**, leurs
**quatre sous-sections d'Apparence**, et les **légendes de l'aperçu**. Toutes
dans les 9 locales, parité vérifiée. Les libellés d'onglets retirés
(`preferences.tabs.*`) sont supprimés des 9 locales dans le même commit.

## Hors périmètre

- **Gestion des serveurs FreshRSS dans « Flux ».** Reporté après la refonte,
  décision de l'utilisateur du 2026-08-21. Le besoin est réel — `ServerSwitcher`
  est aujourd'hui le seul accès, et il ne se monte que si la barre supérieure est
  visible — mais c'est un chantier distinct.
- **Refonte du contenu des réglages eux-mêmes.** On déplace et on regroupe ; on
  ne redessine pas chaque contrôle.

## Vérification

1. Gates du dépôt, garde-fou de fuite, parité des 9 locales.
2. Le test de non-régression des 232 clés passe.
3. Revue écran par écran des six sections, en cochant les réglages du relevé.
4. Contrôle de largeur : le panneau mesure la même chose avec une section de plus
   qu'avec une de moins — c'est le défaut d'origine, il doit être mort.
5. Contrôle du couplage : survoler une couleur encadre l'élément réel **et**
   cercle la zone dans l'aperçu ; une des six couleurs non représentables affiche
   la mention correspondante.
6. Contrôle mobile : sous 768 px, navigation au-dessus, aucun débordement
   horizontal.
