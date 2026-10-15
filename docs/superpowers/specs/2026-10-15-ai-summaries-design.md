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
