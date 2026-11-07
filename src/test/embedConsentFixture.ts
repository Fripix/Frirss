// Un article à messages intégrés derrière un voile de consentement (V2-02).
// Structure relevée sur Numerama (2026-11-07) : chaque message vit dans une
// `figure.wp-block-embed`, sa citation (`blockquote.twitter-tweet`) dans
// `div.embed-container-content`, et le voile (`div.embed-consent-overlay`,
// ~1 000 caractères) est son FRÈRE. Textes et comptes inventés.

/** Texte du voile, tel que le lecteur ne doit jamais le voir. */
export const CONSENT_VEIL_MARKER = 'Ce contenu est bloqué';

const veil = `<div class="embed-consent-overlay is-dark" data-vendor="twitter" data-nosnippet>
  <div class="embed-consent-overlay-text">
    <p>${CONSENT_VEIL_MARKER} car vous n’avez pas accepté les cookies et autres traceurs. Ce contenu est fourni par Twitter.<br>
    Pour pouvoir le visualiser, vous devez accepter l’usage étant opéré par Twitter avec vos données qui pourront être utilisées pour les finalités suivantes : vous permettre de visualiser et de partager des contenus avec des médias sociaux, favoriser le développement et l’amélioration des produits de l’éditeur et de ses partenaires, vous afficher des publicités personnalisées par rapport à votre profil et activité, vous définir un profil publicitaire personnalisé, mesurer la performance des publicités et du contenu de ce site et mesurer l’audience de ce site <a href="#" class="js-privacy" target="_blank">(en savoir plus)</a></p>
    <p>En cliquant sur « J’accepte tout », vous consentez aux finalités susmentionnées pour l’ensemble des cookies et autres traceurs déposés par l’éditeur et <button type="button" class="js-open-vendors">ses partenaires</button>.</p>
    <p>Vous gardez la possibilité de retirer votre consentement à tout moment. Pour plus d’informations, nous vous invitons à prendre connaissance de notre <a href="https://example.com/politique-cookies">Politique cookies</a>.</p>
  </div>
  <div class="embed-consent-overlay-accept-button"><button>J’accepte tout</button></div>
  <p class="embed-consent-overlay-manage-choices"><button type="button" class="js-open-vendors">Gérer mes choix</button></p>
</div>`;

/** Les comptes des messages intégrés, dans l'ordre de la page. */
export const EMBEDDED_TWEETS = ['ocarina_fan', 'chef_de_quete'];

const tweet = (handle: string, id: string, text: string) => `<figure class="wp-block-embed is-type-rich is-provider-x wp-block-embed-x"><div class="wp-block-embed__wrapper">
<div class="is-provider-x"><div class="embed-container embed-container--with-overlay">
  <div class="embed-container-content">
    <blockquote class="twitter-tweet" data-width="500" data-dnt="true"><p lang="fr" dir="ltr">${text} <a href="https://t.co/${id}">pic.twitter.com/${id}</a></p>&mdash; Quelqu’un (@${handle}) <a href="https://x.com/${handle}/status/21180000000000${id.length}${handle.length}?ref_src=twsrc%5Etfw">5 novembre 2026</a></blockquote><script type="didomi/javascript" data-vendor="didomi:twitter" async src="https://platform.x.com/widgets.js" charset="utf-8"></script>
  </div>
  ${veil}
</div></div>
</div></figure>`;

const para = (i: number) => `<p>Paragraphe ${i} de l’article, qui raconte ce que les joueurs font déjà du nouveau jeu, avec des détails, des chiffres et des citations pour peser dans la balance.</p>`;

/** Un article de presse dont deux messages intégrés portent chacun leur voile. */
export function embeddedTweetsPageHtml(): string {
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Tout le monde joue déjà de l’ocarina</title></head>
<body><main><article class="post"><h1>Tout le monde joue déjà de l’ocarina</h1>
<div class="article-content">
${[1, 2, 3].map(para).join('\n')}
${tweet(EMBEDDED_TWEETS[0], 'AbCdEf1', 'Enfin la partition complète, jouée au micro.')}
${[4, 5].map(para).join('\n')}
${tweet(EMBEDDED_TWEETS[1], 'GhIjKl2', 'Plus besoin d’ocarina.')}
${[6, 7, 8].map(para).join('\n')}
</div></article></main></body></html>`;
}
