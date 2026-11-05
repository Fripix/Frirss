/**
 * Page de test SYNTHÉTIQUE qui reproduit la STRUCTURE d'un avis de sécurité
 * dont Readability ne garde qu'un fragment (A-1, campagne 1.9.0) — sans son
 * texte : tout est inventé.
 *
 * Ce qui fait échouer Readability, et qu'il faut donc garder tel quel :
 * - un `<article>` unique, découpé en trois `<section>` sœurs ;
 * - la première porte un tableau de métadonnées (les `<td>` pèsent dans le
 *   score) et finit par gagner ;
 * - la deuxième porte le vrai corps, mais en listes courtes, et se termine par
 *   une longue liste de références où chaque entrée est un libellé plus un
 *   lien dont le texte est l'URL : la densité de liens la fait écarter.
 *
 * Résultat avant correctif : ~20 % du texte de l'`<article>`.
 *
 * Partagée par les tests de la route serveur et ceux du repli navigateur, qui
 * doivent juger la même page.
 */

/** Phrase repérable dans le corps (deuxième section) — absente du fragment. */
export const ADVISORY_BODY_MARKER = 'Le composant Exemplaire traite mal';

export function advisoryPageHtml(): string {
  const refs = Array.from({ length: 9 }, (_, i) => `
          <li><p>Référence d’exemple EX-2026-${1000 + i}</p>
            <a class="fr-link" href="https://vendor.example.com/advisories/kb/article?number=EX-2026-${1000 + i}&amp;lang=fr">https://vendor.example.com/advisories/kb/article?number=EX-2026-${1000 + i}&amp;lang=fr</a></li>`).join('');
  return `<!doctype html><html lang="fr"><head><title>Avis d’exemple</title></head><body>
<header><nav><ul><li><a href="/">Accueil</a></li><li><a href="/avis/">Avis</a></li><li><a href="/alertes/">Alertes</a></li></ul></nav></header>
<main id="main-content">
  <div class="fr-notice"><p>Ce site d’exemple change de présentation, merci de votre patience.</p></div>
  <div class="content"><article class="article">
    <section class="fr-mb-4w">
      <div class="fr-grid-row"><span>Avis d’exemple</span> <a href="feed.json">Json</a></div>
      <p class="fr-text--lg">Objet : Multiples vulnérabilités dans le produit Exemplaire</p>
      <div class="fr-mt-4w">
        <h2 class="fr-h2">Gestion du document</h2>
        <div class="meta-table"><table><tbody>
          <tr><th>Référence</th><td>EXEMPLE-2026-AVI-0001</td></tr>
          <tr><th>Titre</th><td>Multiples vulnérabilités dans le produit Exemplaire</td></tr>
          <tr><th>Date de la première version</th><td>04 novembre 2026</td></tr>
          <tr><th>Date de la dernière version</th><td>04 novembre 2026</td></tr>
          <tr><th>Source(s)</th><td>Bulletin de sécurité Exemplaire EX-2026-1000 du 03 novembre 2026<br>Bulletin de sécurité Exemplaire EX-2026-1001 du 03 novembre 2026</td></tr>
        </tbody></table></div>
      </div>
      <div class="fr-mb-5w"><p>Une gestion de version détaillée se trouve à la fin de ce document.</p></div>
    </section>
    <section>
      <div class="fr-grid-row"><div class="fr-col-12">
        <h2 class="fr-h2">Risques</h2>
        <ul class="fr-list"><li>Exécution de code arbitraire à distance</li><li>Élévation de privilèges</li></ul>
        <h2 class="fr-h2">Systèmes affectés</h2>
        <ul class="fr-list">
          <li>Exemplaire Passerelle sans le correctif de sécurité 2605.1</li>
          <li>Exemplaire Console versions antérieures à 2609 pour les déploiements locaux</li>
          <li>Exemplaire Console LTSR sans le correctif de sécurité publié le 3 novembre</li>
        </ul>
        <div><h2 class="fr-h2">Résumé</h2>
          <p>${ADVISORY_BODY_MARKER} certaines requêtes. Elles permettent à un attaquant de provoquer une exécution de code arbitraire à distance et une élévation de privilèges.</p></div>
        <div class="publication-content"><h2 id="solutions">Solutions</h2>
          <p>Se référer au bulletin de sécurité de l’éditeur pour l’obtention des correctifs.</p></div>
        <h2 class="fr-h2">Documentation</h2>
        <ul class="fr-list documentation-links">${refs}
        </ul>
      </div></div>
    </section>
    <section class="fr-mt-6w">
      <h2 class="fr-h2">Gestion détaillée du document</h2>
      <div class="fr-table"><table><thead><tr><th>Date</th><th>Description</th></tr></thead>
        <tbody><tr><td>04 novembre 2026</td><td>Version initiale</td></tr></tbody></table></div>
    </section>
  </article></div>
</main>
<footer><p>Site d’exemple — mentions légales — accessibilité — plan du site.</p></footer>
</body></html>`;
}
