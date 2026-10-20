# Résumés et traductions par IA — spec de conception

Date : 2026-10-15. Cycle visé : **1.7.0** (mineure, derrière un interrupteur
admin éteint par défaut). Branche de travail : `ai-summaries`, partie de `dev`
après la 1.6.1 ; le tag `v1.6.1` est le point de retour si la fonctionnalité
est abandonnée. Origine : discussion GitHub #22 (alasdair64).

## 1. Intention et critères de réussite

**Ce que ça fait.** Un lecteur ouvre un article et demande un résumé produit
par un modèle de langage, puis, s'il le souhaite, une traduction du résumé ou
de l'article. Le propriétaire de l'instance décide quels fournisseurs existent
et qui paie ; chaque utilisateur règle ses préférences dans ses limites.

**Ce que ça ne doit pas faire.** Changer l'identité de FriRSS, qui reste un
client FreshRSS. Tant que l'admin n'a pas allumé la fonctionnalité, **rien
n'apparaît** : pas une icône, pas un réglage, pas une ligne de menu.

**Critères de réussite, posés par le propriétaire :**

1. L'interface reste **claire, lisible et agréable** (« friendly user »). Une
   rangée de pastilles au-dessus du contenu, aucune icône nouvelle dans la
   barre d'outils ni dans les lignes de la liste, les actions rares cachées
   jusqu'au besoin, des états qui disent ce qui se passe.
2. **Aucune dépense sans un clic**, à la seule exception du résumé automatique,
   que l'utilisateur active lui-même après un avertissement.
3. **Deux adaptateurs, jamais plus.** Ajouter un fournisseur ne demande aucun
   code.
4. **Zéro dépendance nouvelle** dans l'image : les appels sortants passent par
   le client HTTP gardé existant.
5. Vérifié sur les trois formats, à 320 px pour le téléphone.

## 2. Non-objectifs (décidés, à ne pas rouvrir sans information nouvelle)

- **Pas de page d'accueil d'articles « importants »** notés par IA en arrière-
  plan : c'est un autre produit, au coût permanent.
- **Pas de troisième adaptateur.** Un fournisseur sans point d'accès compatible
  OpenAI passe par OpenRouter.
- **Pas de flux de texte (streaming)** : un résumé fait quelques paragraphes,
  l'attente se montre par un état « en cours ».
- **Pas de comparaison côte à côte** de plusieurs résumés : « Résumer avec… »
  remplace le résumé affiché, l'ancien reste en cache.
- **Pas d'assignation par flux distincte pour la traduction** : un fournisseur
  par flux ou catégorie vaut pour les deux opérations.
- **Pas de réglage de longueur** en première version.

## 3. Fournisseurs et adaptateurs

Un fournisseur est un enregistrement administré : `id`, `nom affiché`, `type`
(`anthropic` | `openai`), `baseUrl`, `model`, `clé admin` (optionnelle,
chiffrée), `partagée` (la clé admin sert-elle à tous), `ordre`. Les deux
adaptateurs vivent dans `server/ai/providers/` :

| Type | Point d'accès | Couvre |
|---|---|---|
| `anthropic` | `POST {baseUrl}/v1/messages`, en-têtes `x-api-key`, `anthropic-version` | Claude |
| `openai` | `POST {baseUrl}/v1/chat/completions`, en-tête `Authorization: Bearer` | OpenAI, Ollama, LM Studio, Mistral, Groq, DeepSeek, Grok, OpenRouter |

Gemini n'est **pas** couvert en direct : sa couche compatible vit sous
`/v1beta/openai/…`, inatteignable avec `{baseUrl}/v1/…`. Il passe par
OpenRouter. L'URL de base est normalisée à l'enregistrement (barres finales,
puis un `/v1` final retirés).

Les deux reçoivent la même entrée (consigne système, texte, langue cible
éventuelle, plafond de sortie) et rendent la même sortie (`text`, `model`,
`inputTokens`, `outputTokens`, `durationMs`). Les appels passent par
`fetchUpstream` (`server/routes/proxy.ts`) avec `trustedHosts: [hôte du
fournisseur]`, le mécanisme livré en 1.6.1 pour l'émetteur OIDC : l'URL est
fixée par l'admin, jamais par un utilisateur, donc un hôte privé (Ollama sur le
réseau local) est atteignable sans toucher à `PROXY_INTERNAL_HOSTS`, et une
redirection vers un autre hôte interne reste refusée. Délai : 60 s par appel
(un article long sur un modèle local peut dépasser les 30 s du proxy).

Appels bruts, **sans SDK** : chaque API est un `POST` JSON. L'adaptateur
Anthropic envoie `max_tokens`, `system`, `messages` ; pas de `thinking` ni
d'`effort` explicites, les valeurs par défaut du modèle suffisent pour un
résumé. L'adaptateur OpenAI envoie `messages` avec un rôle `system`, **sans**
`max_tokens` (refusé par les modèles de raisonnement d'OpenAI, qui attendent
`max_completion_tokens` ; Ollama l'honorerait mais reçoit le même corps, par
simplicité). Les erreurs HTTP sont classées en trois familles, parce que le
repli en dépend : `auth` (401/403), `quota` (429, 402), `technical` (réseau,
délai, 5xx, réponse non JSON). Un refus de contenu (réponse 200 dont le modèle
décline) est `refused` et ne déclenche **jamais** de repli.

## 4. Consignes au modèle

Une seule consigne système par opération, en anglais, versionnée dans
`server/ai/prompts.ts` (la version fait partie de la clé de cache, voir §9).

**Résumé.** Fidèle, dans **la langue de l'article**, d'une longueur visée
d'environ **{ratio} % de l'article** (réglage utilisateur, §10 ; 20 % par
défaut), plus long seulement si le contenu l'exige, jamais moins de trois
phrases, **sans plafond de mots** (consigne version 3, `summarySystem(ratio)` ;
le ratio fait aussi partie de la clé de cache) ; en
paragraphes, en puces seulement si l'article est lui-même une liste ; sans
introduction du type « cet article parle de ». La réponse commence par une
ligne `lang: <code BCP 47>` donnant la langue détectée de l'article, que le
serveur retire du texte et stocke : elle décide si « Traduire » a un sens.

**Traduction.** Vers la langue cible, fidèle, sans résumé ni commentaire, en
conservant la structure. Pour l'article entier (§7), le texte arrive découpé
en segments numérotés que le modèle rend dans le même ordre, sans en fusionner.

## 5. Modèle de données

Quatre tables nouvelles, migrations additives comme toujours (`columnExists`,
`CREATE TABLE IF NOT EXISTS`, `server/db.ts`).

```
ai_providers   id, name, type, base_url, model, admin_key (chiffrée, nullable),
               shared (0/1), position, created_at
ai_user_keys   user_id, provider_id, key (chiffrée)   — PK (user_id, provider_id)
ai_usage       user_id, day, count                     — PK (user_id, day), voir §9
ai_cache       key, text, lang, created_at             — sans Redis seulement, voir §9
```

Réglages globaux dans `settings` (même table que l'OIDC) :
`ai_enabled` (`'true'`/`'false'`, défaut `'false'`), `ai_user_keys_allowed`
(`'true'`/`'false'`, défaut `'false'`), `ai_default_provider` (id),
`ai_daily_cap` (entier, défaut `50`, `0` = illimité).

Les préférences utilisateur restent dans `preferences` (synchronisées, en
clair, **jamais une clé**) : `ai.preferredProvider`, `ai.translationProvider`
(`'same'` ou id), `ai.translationLanguage` (`'ui'` ou code), `ai.fallback`
(bool, défaut `true`), `ai.autoSummary` (bool, défaut `false`),
`ai.autoTranslate` (bool, défaut `false`), et dans `feedSettings`
(`src/stores/uiStore.ts`) un champ `aiProvider` par flux ; les catégories,
qui n'ont pas de surcharge aujourd'hui, reçoivent `ai.categoryProviders`
(objet `nom de catégorie → id`).

Chiffrement : `encrypt()` / `decrypt()` de `server/crypto.ts`, la clé de
chiffrement de l'instance, comme les jetons FreshRSS. Une clé n'est **jamais
renvoyée** par l'API : les réponses portent `hasKey: true/false`. La sauvegarde
chiffrée de l'instance (`server/backup.ts`) emporte les deux tables.

## 6. API serveur

Toutes sous JWT FriRSS ; les routes admin derrière `requireAdmin`.

| Méthode | Route | Rôle |
|---|---|---|
| GET | `/api/ai/config` | Ce que le client a le droit de savoir : `enabled`, liste des fournisseurs **sans clés** (`id`, `name`, `type`, `hasAdminKey`, `shared`, `hasUserKey`), `userKeysAllowed`, `dailyCap`, usage du jour |
| POST | `/api/ai/summary` | `{ articleId, url, title, content, provider? , force? }` → `{ text, lang, provider, model, fromCache, fellBackFrom? }` |
| POST | `/api/ai/translate` | `{ articleId, scope: 'summary' \| 'article', targetLang, provider? , text? }` → `{ text \| segments, provider, fromCache, fellBackFrom? }` |
| PUT | `/api/ai/keys/:providerId` | Enregistre ou efface la clé personnelle (si `ai_user_keys_allowed`) |
| GET/PUT/POST/DELETE | `/api/admin/ai/providers[/:id]` | CRUD des fournisseurs, réordonnancement |
| PUT | `/api/admin/ai/settings` | `ai_enabled`, `ai_user_keys_allowed`, `ai_default_provider`, `ai_daily_cap` |
| POST | `/api/admin/ai/providers/:id/test` | Appel d'essai (« Dis bonjour ») pour valider URL, modèle et clé |

Le texte de l'article est envoyé par le client (il l'a déjà : contenu RSS ou
article complet extrait par `/api/extract`), **borné à 200 Ko**. Le serveur ne
refait pas l'extraction : un seul chemin, celui qui existe.

**Résolution du fournisseur** (`server/ai/resolve.ts`, pure et testée) :
`force` (menu « Résumer avec… ») → `feedSettings[feed].aiProvider` →
`ai.categoryProviders[catégorie]` → `ai.preferredProvider` →
`ai_default_provider`. Pour la traduction, `ai.translationProvider` s'insère
après le forçage et avant les assignations par flux quand il n'est pas
`'same'`. Un fournisseur assigné puis supprimé par l'admin est ignoré
(étage suivant), et le panneau le signale.

**Clé utilisée** : clé personnelle si elle existe, sinon clé admin si
`shared`, sinon le fournisseur est **indisponible pour cet utilisateur**
(grisé dans le panneau, sauté par le repli). Un fournisseur de type `openai`
sans clé du tout (Ollama) est disponible pour tous.

**Repli** (`ai.fallback`) : sur erreur `auth`, `quota` ou `technical`
seulement, dans l'ordre `position` des fournisseurs, en sautant ceux qui sont
indisponibles, jamais sur `refused`, jamais plus d'un tour. La réponse porte
`fellBackFrom` pour que l'interface dise « Claude indisponible, résumé par
Ollama ».

## 7. Traduction

Deux étapes, dans l'ordre, même cycle :

- **A. Le résumé.** Bouton « Traduire » dans l'en-tête du résumé, visible
  seulement si `lang` détectée ≠ langue cible. Un appel, cache par article +
  fournisseur + langue cible.
- **B. L'article entier.** Pastille « Traduire l'article » à côté des deux
  autres. Le serveur prend le HTML nettoyé (contenu RSS passé par le
  sanitiseur, ou article extrait), découpe les nœuds texte de niveau bloc
  (`p`, `li`, `h1-h6`, `blockquote`, `figcaption`, `td`) en segments numérotés,
  les envoie par lots de ~3 000 mots, réinjecte les traductions aux mêmes
  nœuds. Images, liens, structure : intacts. L'article traduit remplace
  l'original, une pastille « Texte source » revient en arrière. Un article
  vaut cinq à quinze résumés : avertissement de coût au premier usage, et il
  compte dans le plafond. Si B n'est pas prête pour la 1.7.0, elle sort en
  1.7.1 ; A ne dépend de rien d'elle.

**Langue cible** : `ai.translationLanguage`, `'ui'` par défaut (la langue de
l'interface i18next). **Forçage ponctuel** « Traduire en… » pour un article.
**Fournisseur** : `ai.translationProvider`, forçage « Traduire avec… ».

**Liste des langues proposées, figée par le propriétaire** (codes BCP 47,
`src/lib/aiLanguages.ts`, gardée par un test qui échoue si un code hors liste
apparaît) :

`fr en de es it nl pl pt uk zh-Hans zh-Hant sv da nb fi cs ro hu el ca ja ko ar tr hi id vi th`

Vingt-huit entrées, le chinois en deux. **Ni russe ni hébreu**, par décision.
Les noms affichés viennent d'`Intl.DisplayNames` dans la langue de
l'interface : aucune clé i18n pour les noms de langues.

## 8. Résumé et traduction automatiques

`ai.autoSummary` (et `ai.autoTranslate` à l'étape B), **désactivés par
défaut**. À l'activation, une boîte de confirmation porte ce texte (validé) :

> Chaque résumé automatique est un appel à votre fournisseur d'IA. Selon le
> fournisseur et votre abonnement, il peut vous être facturé. Un modèle local
> comme Ollama ne coûte rien.

Quand c'est actif, l'ouverture d'un article déclenche le résumé comme le
réglage « article complet par défaut » déclenche l'extraction, avec les mêmes
gardes : jamais hors ligne, jamais pendant la préparation hors-ligne, une seule
requête en vol par article, annulée si l'article change avant la réponse. Une
surcharge par flux viendra si elle est demandée ; pas en première version.
*(Demandée le 2026-10-20 : voir §17.)*

## 9. Plafond, cache, hors ligne

**Plafond quotidien** (`ai_daily_cap`, défaut 50, 0 = illimité) : nombre
d'appels par utilisateur et par jour civil (fuseau du serveur), résumés et
traductions confondus, **compté seulement quand la clé admin paie**. Avec sa
propre clé, l'utilisateur dépense son argent : pas de plafond. Dépassé : 429
avec `{ error: 'ai_daily_cap', cap, resetAt }` (`resetAt` : ISO du prochain
minuit local du serveur), et le panneau affiche « 50 sur 50
aujourd'hui ». Compteur dans une table `ai_usage (user_id, day, count)`.

**Cache** : clé `article id + opération + fournisseur + modèle + langue cible +
version de consigne + hash du titre et du texte`, valeur le texte et `lang`. Redis quand `REDIS_URL` est là
(`server/cache.ts`, TTL 30 jours), sinon une table SQLite `ai_cache` avec
purge au-delà de 10 000 entrées. Un résumé payé n'est jamais repayé, y compris
depuis un autre appareil ; « Résumer avec… » un fournisseur déjà en cache est
instantané et gratuit.

**Hors ligne** : les pastilles sont désactivées (même traitement que
« Article complet »), un résumé déjà reçu reste affiché, et le résumé peut
faire partie de la préparation hors-ligne **seulement** si `ai.autoSummary`
est actif, puisqu'il coûte.

**Le seau `FRIRSS_PROXY_RATE_LIMIT`** compte aussi ces appels : ils passent
par `fetchUpstream`. Un résumé par article ouvert ne s'en approche pas.

## 10. Section « IA » (Préférences)

Nouvelle section **« IA »** dans `SECTIONS`
(`src/components/Preferences/Preferences.tsx`), nommée d'un mot comme les
autres (Général, Apparence, Disposition, Étiquettes, Flux, Hors ligne), et qui
regroupe **résumés et traductions** : ils partagent fournisseurs, clés, repli,
plafond et cache, les séparer obligerait à choisir le fournisseur à deux
endroits. Rendue **seulement si `ai_enabled`** côté serveur ; l'admin la voit
toujours, pour pouvoir allumer. Rien de l'IA ne s'ajoute à la section
Administration. Fichier `src/components/Preferences/AiTab.tsx`.

Blocs, dans cet ordre, nommés par l'usage :

**« Résumés »** (tout utilisateur, admin compris, en tête de la section ; pour
un non-admin, la ligne d'introduction y sert d'aide) :
- **Longueur du résumé** — *livré* : curseur de 5 à 50 % de l'article, pas de
  5, défaut 20 %, valeur affichée formatée par la langue, aide « Longueur visée
  du résumé par rapport à l'article. Jamais moins de trois phrases. » Préférence
  synchronisée `aiSummaryRatio`, envoyée avec chaque demande (`ratio`).
- Fournisseur préféré (liste des disponibles ; un fournisseur sans clé
  accessible est grisé avec « clé requise »).
- Repli automatique (interrupteur, aide : « si votre fournisseur échoue, le
  suivant de la liste prend le relais »).
- Résumé automatique à l'ouverture (interrupteur, avec la confirmation de §8).

**« Traduction »** :
- Langue cible (« Langue de l'interface » ou une des 28).
- Fournisseur (« Même que le résumé » ou un fournisseur).
- Traduction automatique à l'ouverture (étape B, même confirmation).

**« Par flux et catégorie »** : une liste reprenant l'arborescence de la
barre latérale, chaque ligne avec un sélecteur « Par défaut / fournisseur ».
Réutilise `CategoryList.tsx` et le moule des surcharges existantes.

**« Mes clés »** (si `ai_user_keys_allowed`) : une ligne par fournisseur,
champ masqué, « Enregistrer » / « Effacer », état « clé enregistrée ». Une clé
saisie n'est jamais réaffichée. L'usage du jour s'affiche ici quand un
plafond s'applique.

Les éléments ci-dessus autres que la longueur restent à livrer (plan 2).

**« Fournisseurs »** (admin seul, en dernier) :
- Interrupteur général « Activer les résumés IA » (éteint par défaut).
- Liste ordonnée, réordonnable comme les catégories : nom, type, URL de base,
  modèle, clé admin (masquée, « enregistrée » / « aucune »), « Partager la clé
  avec les utilisateurs », bouton « Tester ».
- Fournisseur par défaut.
- Sous un pli « Avancé » : « Les utilisateurs peuvent saisir leur propre clé »,
  plafond quotidien.

Le panneau tient dans le gabarit existant (en-tête, navigation de sections,
bouton de réinitialisation par onglet). Tous les champs ont un libellé lié,
cibles tactiles de 44 pt, navigation clavier dans les sélecteurs.

## 11. Volet de lecture

> **Révisé le 2026-10-16** (décision du propriétaire) : la rangée de pastilles
> et le bloc qui s'ouvrait dessous ont été remplacés par un **panneau
> repliable**. La surface neutre prévue à l'origine est devenue une **teinte
> réglable** : le résumé est du texte de la machine, il doit se distinguer de
> l'article d'un coup d'œil.

**Panneau « Résumé IA »** au-dessus du contenu, sur toute la largeur de la
colonne de lecture, identique sur les trois formats
(`src/components/ReadingPane/AiSummary.tsx`). Surface teintée réglable : deux
couleurs de thème, `ai-bg` et `ai-border` (voile de l'accent, défini dans
chaque préréglage, dérivé pour un thème enregistré avant leur arrivée).

**En-tête, toujours visible.** À gauche, un seul bouton (`aria-expanded`) qui
replie ou déplie : étincelle, titre « Résumé IA », statut en petit (« Pas
encore résumé », « Résumé par X », « depuis le cache », « X indisponible »),
chevron. À droite, **hors du bouton** : « Résumer » tant qu'il n'y a pas de
résumé (désactivé avec un indicateur qui tourne et « Résumé en cours… » pendant la demande,
désactivé hors ligne), puis « Résumer avec… » (menu des fournisseurs
disponibles, popover en portail sur ordinateur, `BottomSheet` sur tablette et
smartphone). À 320 px, l'action passe sous le titre plutôt que d'écraser le
statut ; cibles de 44 pt sur les formats tactiles.

**Corps, déplié.** Le résumé (pas de mesure bornée), ou l'erreur
(`role="alert"`, une phrase et ce qu'il faut faire), ou une ligne d'aide
« Cliquez sur « Résumer » pour obtenir un résumé de cet article. ». Replié, le
corps reste monté, caché et vide (cible d'`aria-controls`). Une région
`aria-live="polite"` invisible et toujours montée n'annonce que l'arrivée d'un
résumé (« Résumé par X ») ; ni le corps ni l'alerte d'erreur n'y sont.

**Repli.** Mémoire globale et synchronisée (`aiPanelCollapsed`), pas par
article. Un résumé qui arrive replié ne rouvre pas le panneau (le statut le
dit) ; seul le tout premier « Résumer » lancé replié le déplie, une fois par
appareil. Remplace l'action « Masquer » prévue à l'origine.

**Pas encore livré** : les actions de traduction (étape B) dans l'en-tête, et
l'appui long qui ouvrirait « Résumer avec… » avant qu'un résumé existe.

**Clavier** : un raccourci « Résumé IA » dans la palette de commandes et la
table des raccourcis, dans la famille de « Article complet ».

## 12. i18n

Nouvelle famille `ai` dans les dix locales (`fr` source, parité vérifiée par
le script du `CLAUDE.md`), plus la clé `preferences.sections.ai` (« IA ») et celles de la
palette. Les noms de langues sont hors i18n (§7). Balayer aussi `title`,
`aria-label`, `placeholder` : la parité ne voit que la structure.

## 13. Tests

- **Purs** (`src/lib/*.test.ts`, `server/ai/*.test.ts`, test-first) :
  résolution du fournisseur (les cinq étages, fournisseur supprimé, clé
  indisponible), classification des erreurs et règle de repli (jamais sur
  `refused`, un seul tour, saut des indisponibles), clé de cache, plafond
  (compte seulement sur clé admin, remise à zéro au jour suivant), découpage et
  réinjection des segments (étape B), liste des langues (garde-fou : aucun code
  hors liste, `ru` et `he` absents).
- **Adaptateurs** : `fetch` simulé, vérifie le corps envoyé à chaque type,
  l'en-tête d'authentification, `trustedHosts` = hôte du fournisseur, le
  retrait de la ligne `lang:`.
- **Routes** (`server/test/api.test.ts`) : rien n'est atteignable quand
  `ai_enabled` est faux ; une clé n'est jamais renvoyée ; `PUT /api/ai/keys`
  refusé quand `ai_user_keys_allowed` est faux ; routes admin refusées à un
  utilisateur.
- **Composants** (jsdom) : la section n'existe pas quand c'est éteint ; la
  pastille et ses états ; le menu « Résumer avec… » ne liste que les
  disponibles ; la confirmation de coût apparaît à l'activation.
- **Garde-fous existants** : `featuresDoc.test.ts` exigera les nouvelles
  routes, variables et la famille `ai` dans `docs/FEATURES.md` ;
  `settingsCoverage.test.ts` reste vert (aucun réglage retiré).
- **Banc local** avant tout test sur `frirss-dev` : un faux fournisseur
  compatible OpenAI sur `127.0.0.1` (une trentaine de lignes, comme le faux
  émetteur OIDC de la 1.6.1) pour dérouler résumé, repli, plafond et cache
  sans dépenser un centime.

## 14. Documentation à livrer dans les mêmes commits

`docs/FEATURES.md` (nouvelle famille « Résumés et traductions par IA » : ce
que ça fait, où ça vit, réglages, pièges, et la règle « deux adaptateurs »
écrite noir sur blanc), `SECURITY.md` (clés chiffrées, URL admin de confiance
pour la garde, ce qu'un admin compromis pourrait faire), README (section
courte, variables d'environnement s'il y en a — aucune n'est prévue : tout est
dans l'interface admin), `docs/RELEASE-NEXT.md`.

## 15. Découpage

1. **Socle serveur** : tables, chiffrement des clés, adaptateurs, résolution,
   repli, plafond, cache, routes. Testé au banc local.
2. **Panneau admin** : fournisseurs, test de connexion, interrupteur.
3. **Volet** : pastille, bloc résumé, menus, états, raccourci.
4. **Panneau utilisateur** : préféré, repli, par flux et catégorie, clés
   personnelles, usage.
5. **Résumé automatique** et sa confirmation.
6. **Traduction A** (résumé), puis **B** (article).
7. Doc, dix locales, trois formats à 320 px, revue, tests sur `frirss-dev`.

Chaque étape se montre au propriétaire sur `frirss-dev` avant la suivante :
c'est son usage réel qui attrape ce que les tests ne voient pas.

## 16. Retour arrière

Tant que la branche n'est pas fusionnée : la supprimer. Après fusion : la
fonctionnalité tient dans `server/ai/`, quatre tables, un onglet, un bloc du
volet et une famille i18n ; éteinte par l'admin, elle est invisible. Le tag
`v1.6.1` reste l'état de référence d'avant.

## 17. Révision traduction — 2026-10-20 (plan 3)

> Cette section **remplace** §7, le volet traduction de §8, le bloc
> « Traduction » de §10 et la mention « pas encore livré » de §11. Validée en
> conversation le 2026-10-20 ; décisions nouvelles du propriétaire : la
> **traduction automatique par flux ou catégorie** entre en première version,
> et le **repli entre fournisseurs joue aussi sur un forçage** (« Traduire
> avec X » comme « Résumer avec X »), toujours avec la mention « X indisponible ».

### 17.1 Ce que l'utilisateur voit

**Deux actions, deux endroits, même mécanique.**

- **Le résumé.** Dans l'en-tête du panneau « Résumé IA », à côté de « Résumer
  avec… », une action **« Traduire »** apparaît quand un résumé est affiché et
  que sa langue détectée (`lang`, §4) diffère de la langue cible. Elle traduit
  le résumé **en place** ; le statut devient « Résumé par X, traduit en
  français par Y » et l'action devient **« Texte source »**, qui rend le
  résumé d'origine sans appel. Un résumé replié se traduit sans se déplier.
- **L'article.** Dans la barre d'outils de l'article, à côté de « Article
  complet », un bouton **« Traduire l'article »** (icône de traduction, même
  gabarit `BarBtn`). Il traduit le corps affiché (contenu RSS passé par le
  sanitiseur, ou article extrait) : l'article traduit **remplace** l'original,
  images, liens, titres et structure intacts ; le bouton devient **« Texte
  source »** et bascule sans appel. Le titre de l'article est traduit avec le
  corps (segment 0).
- **Forçage ponctuel.** Chacun des deux boutons est **scindé** : la partie
  principale fait l'action avec la langue et le fournisseur réglés ; un petit
  chevron ouvre le menu **« Traduire en… »** (liste des 28 langues, la cible
  en tête, filtrable à la frappe) et **« Traduire avec… »** (fournisseurs
  disponibles, comme « Résumer avec… »). Popover en portail sur ordinateur,
  `BottomSheet` sur tactile ; cibles de 44 pt. Un forçage ne change pas les
  réglages.
- **Repli.** Si le fournisseur échoue (forcé ou non), le suivant répond et le
  statut dit « X indisponible » — règle de §6, inchangée, décision du
  propriétaire du 2026-10-20.
- **Hors ligne.** Les deux actions sont désactivées ; une traduction déjà
  affichée reste affichée.

**Sur tactile**, le bouton de la barre n'a pas de chevron : un appui =
l'action par défaut, un **appui long** ouvre le menu, et les deux entrées
« Traduire en… » / « Traduire avec… » figurent aussi dans le **menu contextuel
de l'article** (le « … » existant), qui est le chemin visible sans appui long.
Pour le résumé, le chevron du panneau reste sur les trois formats (il tient à
320 px à côté de « Résumer avec… », qui passe déjà sous le titre).

**Statut et erreurs de l'article.** Une **ligne de notice** au-dessus du corps
de l'article, même gabarit que l'avis d'extraction, présente sur les **trois
formats** : « Traduit en français par Y », « Traduit en français par Y,
X indisponible », « Traduit en partie (3 lots sur 4) », « Lot 2 sur 4… »
pendant l'attente, et les erreurs (`role="alert"`). Une traduction
automatique affiche les mêmes mentions : une bascule vers un fournisseur
payant doit se voir, même sans clic (§1).

### 17.2 Réglages (section « IA » des Préférences)

Bloc **« Traduction »**, placé **sous « Résumés »** et au-dessus de « Par flux
et catégorie » :

- **Langue cible** : sélecteur « Langue de l'interface » (défaut) ou l'une des
  28 langues de §7, noms via `Intl.DisplayNames` dans la langue de l'interface
  (aucune clé i18n pour les noms de langues). Préférence synchronisée
  `aiTranslationLanguage` (`'ui'` ou code BCP 47 de la liste ; toute autre
  valeur revient à `'ui'`).
- **Fournisseur** : « Même que le résumé » (défaut) ou un fournisseur ;
  `aiTranslationProvider` (`null` = même que le résumé, sinon id). Les
  fournisseurs sans clé accessible sont grisés « clé requise » (composant
  `ProviderOptions` existant).

Bloc **« Par flux et catégorie »** (existant) : chaque ligne, catégorie comme
flux, gagne à côté du sélecteur de fournisseur un **interrupteur « Traduire »**
(libellé accessible « Traduire automatiquement les articles de {{name}} »).
Allumé, chaque article de ce flux (ou de cette catégorie, sauf réglage
contraire du flux) est traduit **à l'ouverture**, comme le résumé automatique :
même délai d'une seconde, mêmes gardes (en ligne, IA utilisable, une seule
demande par article, annulée si l'article change avant). Préférences :
`feedSettings[flux].aiAutoTranslate?: boolean` (synchronisé, `''` retire) et
`aiCategoryAutoTranslate: Record<nom, true>`. Priorité : réglage du flux
(vrai **ou faux explicite**) > catégorie ; un flux dans plusieurs catégories
est traduit dès qu'**une** l'est. L'interrupteur d'un flux affiche sa valeur
**effective** (héritée de la catégorie s'il n'a rien en propre) ; le toucher
écrit toujours une valeur propre (`true` ou `false`), de sorte qu'éteindre
un flux sous une catégorie allumée tient. « Hérité » n'est pas une valeur
visible : la ligne de catégorie suffit à le dire. Le compteur de la ligne de
catégorie dit « N flux réglés » dès qu'un flux porte un fournisseur ou une
valeur propre de traduction.

**Avertissement de coût**, à la **première activation** d'un interrupteur
« Traduire » par ce compte — **une fois par compte**, préférence synchronisée
`aiAutoTranslateConfirmed` (booléen, remis à faux à la déconnexion et absent
des préférences d'un autre compte comme `aiAutoSummary`) :

> Traduire un article entier coûte cinq à quinze fois un résumé, et chaque
> article de ce flux sera traduit à l'ouverture. Selon le fournisseur et votre
> abonnement, cela peut vous être facturé. Un modèle local comme Ollama ne
> coûte rien.

Boutons « Activer » / « Annuler » ; « Annuler » laisse l'interrupteur éteint.
Pas d'interrupteur global « tout traduire » : il traduirait aussi les flux
déjà dans la langue cible.

**Il n'y a pas de traduction automatique du résumé** : un résumé automatique
dans un flux marqué « Traduire » est produit, puis l'article est traduit ; le
résumé se traduit sur demande. (Un flux marqué « Traduire » a rarement besoin
des deux.)

### 17.3 Mécanique

**Langue source et « déjà dans la bonne langue ».** La consigne de traduction
(§4) demande au modèle de répondre d'abord `lang: <code>` (langue source), puis
le texte traduit ; si la source **est déjà** la langue cible, le modèle répond
`lang: <code>` puis la ligne `same`. Le serveur renvoie alors `{ same: true,
lang }` sans texte : le client ne remplace rien et, pour une traduction
automatique, n'affiche rien. Ce coût (entrée seule) évite de traduire un flux
français vers le français. Pour le résumé, la langue détectée au résumé
suffit : le bouton « Traduire » n'apparaît pas si elle est la cible.

**Découpage côté client.** Le client découpe le corps affiché avec le DOM du
navigateur : les éléments de bloc porteurs de texte (`p`, `li`, `h1`–`h6`,
`blockquote`, `figcaption`, `td`, `th`, `dt`, `dd`, `pre` exclu) deviennent des
segments numérotés, leur **HTML interne** (liens et mises en forme en ligne
conservés) ; le titre est le segment 0. Le serveur reçoit `segments: string[]`
et renvoie `segments: string[]` de même longueur ; le client réinjecte chaque
segment dans son élément d'origine, **après le sanitiseur** (le modèle peut
renvoyer n'importe quoi). Un segment vide ou sans lettre n'est pas envoyé. Les
blocs non texte (images, vidéos, code) ne bougent pas.

**Lots.** Le **client** découpe les segments en lots d'environ **1 200 mots**
(la sortie d'un lot reste sous ~2 000 jetons, loin des 4 096 de `maxTokens`
et de l'échéance de 50 s ; la traduction passe `maxTokens: 8192` à
Anthropic). **Une requête HTTP = un lot = un appel fournisseur.** Format
strict `<s n="12">…</s>` en entrée comme en sortie ; un segment absent ou en
trop invalide le lot, **rejoué une fois** dans la même requête si l'échéance
le permet, sinon erreur `technical` « segments » et le client peut relancer.
Les lots partent **en série** depuis le client (`batch: n` sur `m`, la
notice dit « Lot 2 sur 4… ») ; chaque lot a sa **propre entrée de cache** (clé
: article + scope + langue + fournisseur + modèle + hash des segments du lot)
et sa propre unité de plafond, de sorte qu'une relance après un échec au lot 3
ne repaie pas les lots 1 et 2. Le fournisseur est résolu à chaque lot avec les
mêmes entrées, donc le même en temps normal ; si un lot bascule, la notice le
dit (« X indisponible ») et nomme le fournisseur du dernier lot. Tant qu'un
lot manque, rien n'est remplacé : la traduction s'affiche **entière ou pas du
tout** ; « Traduit en partie » ne concerne que la coupe à 200 Ko.

**Route.** `POST /api/ai/translate` `{ articleId, scope: 'summary' | 'article',
targetLang, provider?, feedProvider?, categoryProvider?, preferredProvider?,
translationProvider?, fallback?, segments }` → `{ segments, lang, same?,
providerId, providerName, model, fromCache, fellBackFrom? }`. Bornes : 512
caractères d'`articleId`, **200 Ko** de segments au total (le client coupe au
dernier segment entier sous la borne et le dit dans le statut : « traduit en
partie »), 400 `invalid_body` sinon ; `targetLang` hors liste → 400
`invalid_lang`. Résolution du fournisseur : forçage > `translationProvider`
(réglage, si non `null`) > flux > catégorie > préféré > défaut admin > premier
disponible — la même fonction que le résumé, avec l'étage `translation`
inséré après le forçage (§6). Repli : règle de §6, forçage compris. Plafond :
**un appel = une unité**, réservé avant chaque lot, remboursé si le lot
échoue ; un article de quatre lots compte quatre. Cache : clé
`articleId + op:'translate' + scope + targetLang + providerId + model + hash
du contenu` ; un article traduit vaut une entrée par (langue, fournisseur).
Délai : même échéance globale de **50 s par requête HTTP**, donc par lot.

**Le corps change.** Une traduction est liée au corps qu'elle a traduit (hash).
Si ce corps change — « Article complet » basculé, extrait RSS remplacé par
l'article extrait —, la vue revient au **texte source** et le bouton redevient
« Traduire l'article » ; rien n'est retraduit sans clic, sauf traduction
automatique, qui **attend que l'extraction ait abouti ou échoué** (comme le
résumé automatique) avant de partir : l'extrait d'un flux à extraction
automatique n'est jamais payé pour rien. « Résumer avec… » ne touche pas à la
traduction de l'article.

**Chinois et variantes.** `'ui'` avec une interface `zh` vise `zh-Hans`.
Deux langues sont « les mêmes » quand leur sous-étiquette principale est la
même (`zh`, `zh-CN`, `zh-Hans` ⇔ `zh-Hans`), sauf `zh-Hant` qui reste
distinct de `zh-Hans` quand les deux sont connus ; `src/lib/aiLanguages.ts`
porte cette comparaison, testée.

**Erreurs** : mêmes codes et mêmes messages que le résumé (`aiErrorKey`),
plus `invalid_lang` → « Langue non proposée » et « segments » → « Le
fournisseur n'a pas rendu une traduction exploitable. Réessayez. ».

### 17.4 Données

Préférences synchronisées nouvelles (`uiStore`, à plat comme les existantes) :
`aiTranslationLanguage`, `aiTranslationProvider`, `aiCategoryAutoTranslate`,
`aiAutoTranslateConfirmed`, et `FeedSetting.aiAutoTranslate` (`true` / `false`
explicites). Rien côté
serveur : pas de table, pas de réglage admin nouveau. `src/lib/aiLanguages.ts`
porte la liste des 28 codes, gardée par un test qui échoue si un code hors
liste apparaît dans le code ou les locales.

### 17.5 Tests et vérification

- Serveur : découpage en lots, format strict et rejeu, `same`, bornes,
  résolution avec l'étage `translation`, plafond par lot, cache par
  (scope, langue, fournisseur), repli sur forçage.
- Client : découpage DOM (segments, titre, blocs exclus, réinjection après
  sanitiseur, liens conservés), bouton scindé et menus, « Texte source »,
  statut, automatique par flux/catégorie (priorité flux > catégorie, délai,
  annulation, confirmation une fois), interrupteurs dans la vue d'ensemble.
- Trois formats à 320 px : bouton scindé dans la barre d'outils, menus,
  interrupteurs dans « Par flux et catégorie ».
- Sur `frirss-dev` : un article anglais traduit avec Ollama, un flux marqué
  « Traduire », un forçage vers un fournisseur en panne qui replie, puis le
  **test complet de la fonction résumé** (demande du propriétaire) avant
  toute fusion.
