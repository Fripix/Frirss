// Ce que le volet de lecture montre à la place de l'article, et quand.
import { describe, it, expect, vi } from 'vitest';
import { extractWorthShowing, hasRenderableContent, readingBodyKind, showsSkeleton, showsReadingTime } from './readingBody';

const RSS = '<p>Le début de l’article, tel que le flux le livre.</p>';
const FULL = '<p>Le texte complet, extrait de la page.</p>';

describe('hasRenderableContent', () => {
  it('reconnaît du texte', () => {
    expect(hasRenderableContent(RSS)).toBe(true);
  });
  it('reconnaît une image seule — un article illustré n’est pas vide', () => {
    expect(hasRenderableContent('<p><img src="https://example.com/a.jpg"></p>')).toBe(true);
  });
  it('écarte le vide, le blanc et les paragraphes creux', () => {
    expect(hasRenderableContent(null)).toBe(false);
    expect(hasRenderableContent('')).toBe(false);
    expect(hasRenderableContent('   \n ')).toBe(false);
    expect(hasRenderableContent('<p>&nbsp;</p><p><br></p>')).toBe(false);
    expect(hasRenderableContent('<div class="x"></div>')).toBe(false);
  });
});

describe('readingBodyKind', () => {
  it('montre l’extraction dès qu’elle existe', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: FULL, autoExtract: true })).toBe('extract');
  });

  it('montre le FLUX pendant que l’extraction se prépare — c’est le point', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: null, autoExtract: true })).toBe('rss');
  });

  it('ne garde le squelette que s’il n’y a vraiment rien à montrer', () => {
    expect(readingBodyKind({ rssHtml: '', extractedHtml: null, autoExtract: true })).toBe('skeleton');
    expect(readingBodyKind({ rssHtml: '<p>&nbsp;</p>', extractedHtml: null, autoExtract: true })).toBe('skeleton');
  });

  it('sans extraction automatique, un article vide reste vide — rien n’arrive', () => {
    expect(readingBodyKind({ rssHtml: '', extractedHtml: null, autoExtract: false })).toBe('rss');
  });

  it('une extraction vide ne remplace pas le flux', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: '  ', autoExtract: true })).toBe('rss');
  });

  it('une extraction vide sur un article vide laisse le squelette', () => {
    expect(readingBodyKind({ rssHtml: '', extractedHtml: '', autoExtract: true })).toBe('skeleton');
  });

  // L-04 : sur un avis du CERT-FR, l'« article complet » ne gardait que la
  // section « Solutions » quand le flux portait tout le texte — une perte
  // silencieuse. Un extrait qui n'a même pas la moitié du texte du flux n'est
  // pas l'article complet : le flux reste.
  it('garde le flux quand l’extrait a moins de la moitié de son texte', () => {
    const longRss = `<p>${'Le flux livre ici tout le texte de l’avis. '.repeat(20)}</p>`;
    expect(readingBodyKind({ rssHtml: longRss, extractedHtml: '<h2>Solutions</h2><p>Voir l’éditeur.</p>', autoExtract: true })).toBe('rss');
  });

  // Relecture 1.9.0 : la garde ne vaut que pour l'extraction automatique. Une
  // demande explicite du lecteur (« Article complet ») montre l'extrait, même
  // court : sinon rien ne changeait à l'écran et le bouton passait à « Contenu RSS ».
  it('montre l’extrait court quand le lecteur l’a demandé', () => {
    const longRss = `<p>${'Le flux livre ici tout le texte de l’avis. '.repeat(20)}</p>`;
    expect(readingBodyKind({ rssHtml: longRss, extractedHtml: '<h2>Solutions</h2><p>Voir l’éditeur.</p>', autoExtract: false, forced: true })).toBe('extract');
  });

  it('même demandé, un extrait vide ne remplace pas le flux', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: '  ', autoExtract: false, forced: true })).toBe('rss');
  });

  it('prend l’extrait dès qu’il pèse au moins la moitié du flux', () => {
    expect(readingBodyKind({ rssHtml: RSS, extractedHtml: FULL, autoExtract: true })).toBe('extract');
  });
});

describe('extractWorthShowing', () => {
  it('compte le texte, pas le balisage', () => {
    const rss = '<p>un deux trois quatre</p>';
    const heavy = `<div class="${'x'.repeat(500)}"><p>un</p></div>`;
    expect(extractWorthShowing(rss, heavy)).toBe(false);
  });

  it('un extrait sans flux à comparer est toujours bon, s’il n’est pas vide', () => {
    expect(extractWorthShowing('', FULL)).toBe(true);
    expect(extractWorthShowing(null, '<p>&nbsp;</p>')).toBe(false);
  });
});

// A2 (campagne 1.9.0, troisième round) : sur un billet très court, l'extrait
// était l'habillage du site (colonne, « Sponsor me »), plus long que le flux —
// la garde de la moitié laissait passer. Un extrait qui ne reprend presque
// rien du texte du flux n'est pas l'article : le flux reste.
describe('extractWorthShowing — l’extrait doit contenir le texte du flux (A2)', () => {
  const feed = '<p>Corrige un défaut qui touchait le site de démonstration : la liste des modèles disponibles n’était pas restreinte à ceux que la configuration autorise, et le greffon les proposait tous, même ceux qu’aucune clé ne permettait d’utiliser. <a href="https://example.com/notes">Notes de version</a></p>';
  const chrome = '<p>Ceci est une brève publiée le quatre novembre.</p><p>Lettre mensuelle</p><p>Soutenez-moi pour dix francs par mois et recevez chaque mois un résumé choisi des nouveautés les plus importantes, avec moins de courriels.</p><p>Payez-moi pour en recevoir moins !</p>';

  it('n’affiche pas automatiquement un extrait qui ne reprend presque rien du flux', () => {
    expect(extractWorthShowing(feed, chrome)).toBe(false);
    expect(readingBodyKind({ rssHtml: feed, extractedHtml: chrome, autoExtract: true })).toBe('rss');
  });

  it('le montre quand le lecteur l’a demandé', () => {
    expect(readingBodyKind({ rssHtml: feed, extractedHtml: chrome, autoExtract: false, forced: true })).toBe('extract');
  });

  it('garde un extrait qui contient le texte du flux, même entouré d’autre chose', () => {
    expect(extractWorthShowing(feed, `<h1>Version 0.1</h1>${feed}${chrome}`)).toBe(true);
  });

  it('garde un extrait qui n’a qu’une partie du texte du flux', () => {
    // Ars Technica : le chapeau du flux manque à l'extrait, qui porte la suite.
    const lead = '<p>Les élus ont demandé au patron du fabricant de puces de venir expliquer devant une commission comment ses clients du nuage accèdent à des informations sensibles. Les présidents des trois commissions ont écrit cette semaine pour fixer une audition à huis clos le dix-huit novembre.</p>';
    const rest = '<p>Les clients du nuage régional reçoivent des informations ordinaires, ont répondu les porte-parole. Les élus veulent comprendre les protocoles de sécurité du fabricant et les inspections menées sur place. La commission rappelle les soupçons de contrebande de puces qui pèsent sur un partenaire.</p>'.repeat(2);
    expect(extractWorthShowing(lead, rest)).toBe(true);
  });

  it('ne juge pas un flux trop court, ni un flux fait de liens (agrégateur)', () => {
    expect(extractWorthShowing('<p>Une brève de quelques mots.</p>', chrome)).toBe(true);
    const aggregator = '<p>Article URL: <a href="https://example.com/2026/11/une-longue-adresse-d-article-avec-beaucoup-de-mots-dedans-pour-depasser-largement-le-compte-minimal">https://example.com/2026/11/une-longue-adresse-d-article-avec-beaucoup-de-mots-dedans-pour-depasser-largement-le-compte-minimal</a></p><p>Comments URL: <a href="https://news.example.com/item?id=4242">https://news.example.com/item?id=4242</a></p><p>Points: 12</p><p># Comments: 3</p>';
    expect(extractWorthShowing(aggregator, chrome)).toBe(true);
  });

  it('lit les entités du flux comme les lettres de l’extrait', () => {
    const accented = 'évènement désespéré réécrire éléphant téléphone écrémé bébé épée fée thé café été élève étoile écrire énergie émission épisode équipe établi étage étude évaluer général intérêt déçu';
    const encoded = `<p>${accented.replace(/é/g, '&eacute;').replace(/è/g, '&#232;').replace(/ç/g, '&#xe7;').replace(/ê/g, '&ecirc;')}</p>`;
    expect(extractWorthShowing(encoded, `<p>${accented}.</p>`)).toBe(true);
  });
});

// Relecture du troisième round : la garde A2 comptait des « mots » séparés
// par des blancs. En chinois, japonais ou thaï, un mot est alors une
// proposition entière, et deux rédactions du même article n'en partagent
// aucune ; un flux d'une autre langue que la page n'en partage pas non plus.
describe('extractWorthShowing — écritures sans espaces et autres langues (A2)', () => {
  const zhFeed = '<p>苹果公司周二举行发布会，正式推出新一代智能手机，新机型采用更大的屏幕，处理器性能更强，电池续航时间明显延长，摄像头也全面升级，夜间拍摄效果更好，机身更轻更薄，提供五种颜色，起售价与上一代相同。公司表示，新手机将于下周五上市，首批覆盖中国、美国和欧洲，消费者本周起可在官网预订，部分门店将延长营业时间。分析人士认为，新产品有助于提振销量，但市场竞争依然激烈，多家厂商也将推出新机，价格战可能加剧，投资者对此反应平淡，苹果股价当天小幅下跌。</p>';
  const zhPage = '<p>据报道，苹果公司于周二召开发布会，推出了新一代智能手机。新机型配备了更大的屏幕，处理器的性能也更强，电池的续航时间有明显延长，摄像头同样全面升级，夜间的拍摄效果更好。机身变得更轻更薄，共提供五种颜色，起售价和上一代保持相同。</p><p>苹果公司表示，新手机将在下周五正式上市，首批市场覆盖中国、美国以及欧洲，消费者从本周起就可以在<a href="/tag/web">官网</a>预订，部分门店还将延长营业时间。</p><p>多位分析人士认为，这款新产品有助于提振销量，不过市场的竞争依然激烈，另有多家厂商也将陆续推出新机，价格战可能会进一步加剧。投资者对此反应平淡，苹果的股价当天小幅下跌。</p>';
  const zhChrome = '<p>首页</p><p>关于我们</p><p>联系我们</p><p>订阅我们的新闻邮件，每周获取最新的科技资讯和独家评论，第一时间了解行业动态。</p><p>版权所有，某某科技网保留所有权利。未经许可，不得转载、摘编或以其他方式使用本站任何内容，违者必究。</p><p>隐私政策，使用条款，广告合作，加入我们，意见反馈，网站地图。</p><p>热门标签：人工智能，电动汽车，云计算，区块链，元宇宙，芯片，机器人。</p>';
  const jaFeed = '<p>東京都は二十日、都内の交通渋滞を減らすため、新しい政策を発表した。来年四月から、平日の朝と夕方に、都心へ乗り入れる車に、料金を課す。料金は一回千円で、電気自動車は半額となり、障害者の車は対象外とする。集めた資金は、バスや地下鉄の運行本数を増やし、駅のバリアフリー化を進め、自転車道の整備にも使う。都の担当者は、渋滞による損失は大きく、早急な対策が必要だと述べた。一方、商店街からは、客足が減るとの懸念が出ており、都は説明会を開く予定だ。</p>';
  const jaPage = '<p>東京都は二十日の記者会見で、都内の交通渋滞を緩和するための新たな政策を発表した。都によると、来年四月から平日の朝と夕方の時間帯に、都心部へ乗り入れる車両に対して料金を課すという。料金は一回あたり千円で、電気自動車については半額、障害者が利用する車は対象外となる。</p><p>徴収した資金は、バスや地下鉄の運行本数の増加、駅のバリアフリー化、自転車道の整備などに充てられる。都の担当者は、渋滞による経済的な損失は大きく、早急な対策が欠かせないと説明した。一方で地元の商店街からは客足の減少を懸念する声も上がっており、都は近く説明会を開く方針だ。</p>';
  const thFeed = '<p>กรมอุตุนิยมวิทยาประกาศเตือนประชาชน ในภาคเหนือ ให้ระวังฝนตกหนัก และน้ำป่าไหลหลาก ตลอดสัปดาห์นี้ โดยเฉพาะจังหวัดเชียงใหม่ เชียงราย น่าน และแพร่ ประชาชนควรติดตามข่าวสาร อย่างใกล้ชิด และเตรียมพร้อม อพยพไปยังที่ปลอดภัย หากระดับน้ำสูงขึ้น เจ้าหน้าที่ได้จัดเตรียม ศูนย์พักพิงชั่วคราว ไว้หลายแห่ง พร้อมอาหาร และน้ำดื่ม สำหรับผู้ประสบภัย โรงเรียนบางแห่ง ได้ประกาศหยุดเรียน เป็นการชั่วคราว</p>';
  const thPage = '<p>กรมอุตุนิยมวิทยาได้ออกประกาศเตือนประชาชนที่อาศัยอยู่ในภาคเหนือให้ระมัดระวังฝนตกหนักถึงหนักมากและน้ำป่าไหลหลากตลอดช่วงสัปดาห์นี้ โดยเฉพาะในพื้นที่จังหวัดเชียงใหม่ เชียงราย น่านและแพร่</p><p>ทางการแนะนำให้ประชาชนติดตามข่าวสารอย่างใกล้ชิดและเตรียมพร้อมอพยพไปยังที่ปลอดภัยทันทีหากระดับน้ำสูงขึ้น เจ้าหน้าที่ได้จัดเตรียมศูนย์พักพิงชั่วคราวไว้หลายแห่งพร้อมอาหารและน้ำดื่มสำหรับผู้ประสบภัย ขณะที่โรงเรียนบางแห่งได้ประกาศหยุดเรียนเป็นการชั่วคราวแล้ว</p>';

  it('compare des paires de caractères en chinois : une autre rédaction du même article est montrée', () => {
    expect(extractWorthShowing(zhFeed, zhPage)).toBe(true);
  });
  it('en japonais aussi', () => {
    expect(extractWorthShowing(jaFeed, jaPage)).toBe(true);
  });
  it('en thaï aussi', () => {
    expect(extractWorthShowing(thFeed, thPage)).toBe(true);
  });
  it('n’affiche toujours pas l’habillage d’un site chinois', () => {
    expect(extractWorthShowing(zhFeed, zhChrome)).toBe(false);
  });

  const enFeed = '<p>The Tokyo metropolitan government announced on Tuesday a new congestion charge for cars entering the city centre during weekday rush hours, starting next April, with the revenue going to more frequent buses and subway trains across the capital, officials said.</p>';
  const frPage = '<p>Le gouvernement métropolitain de Tokyo a annoncé mardi une nouvelle taxe sur les voitures qui entrent dans le centre de la ville aux heures de pointe en semaine. Elle sera prélevée à partir du mois d’avril prochain.</p><p>Les recettes serviront à augmenter la fréquence des autobus et des rames de métro dans toute la capitale, selon les responsables, qui chiffrent les pertes dues aux embouteillages à plusieurs milliards par an.</p><p>Les commerçants du centre craignent une baisse de leur clientèle, tandis que les associations de riverains saluent une mesure attendue depuis des années.</p>';

  it('montre l’extrait d’une autre langue, nettement plus long que le flux (une traduction, pas un habillage)', () => {
    expect(extractWorthShowing(enFeed, frPage)).toBe(true);
    expect(extractWorthShowing(enFeed, jaPage.repeat(3))).toBe(true);
  });
  it('mais pas un extrait d’une autre langue à peine plus long que le flux', () => {
    const frChrome = '<p>Abonnez-vous à notre lettre d’information pour recevoir chaque semaine les meilleurs articles de la rédaction, des conseils pratiques et des offres réservées aux membres.</p><p>Suivez-nous sur les réseaux sociaux.</p>';
    expect(extractWorthShowing(enFeed, frChrome)).toBe(false);
  });
  it('ni l’habillage de même langue, même long', () => {
    const enChrome = '<p>Subscribe to our newsletter to receive the best stories from the newsroom every week, practical advice and offers reserved for members.</p><p>Follow us on social media. Read our privacy policy and our terms of use. Advertise with us. Join our team.</p>'.repeat(3);
    expect(extractWorthShowing(enFeed, enChrome)).toBe(false);
  });
});

// Relecture du troisième round : le volet pose la même question plusieurs
// fois par rendu (squelette, durée de lecture, avis), et chaque pas de la
// barre de progression re-rend le volet. La réponse est gardée pour les
// derniers couples flux / extrait.
describe('extractWorthShowing — une même question n’est mesurée qu’une fois', () => {
  it('le même couple flux / extrait ne relit pas les textes', () => {
    const feed = `<p>${Array.from({ length: 30 }, (_, i) => `mot${i}x`).join(' ')}</p>`;
    const extract = `<p>${Array.from({ length: 60 }, (_, i) => `mot${i}x`).join(' ')}</p>`;
    const normalize = vi.spyOn(String.prototype, 'normalize');
    try {
      expect(extractWorthShowing(feed, extract)).toBe(true);
      const first = normalize.mock.calls.length;
      expect(first).toBeGreaterThan(0);
      expect(extractWorthShowing(feed, extract)).toBe(true);
      expect(readingBodyKind({ rssHtml: feed, extractedHtml: extract, autoExtract: true })).toBe('extract');
      expect(normalize.mock.calls.length).toBe(first);
    } finally {
      normalize.mockRestore();
    }
  });
});

describe('extractWorthShowing — toutes les entités nommées sont décodées', () => {
  it('&oslash;, &szlig;, &aelig;, &lstrok;, &zdot;, les lettres grecques… comptent comme leurs lettres', () => {
    const words = ['størst', 'søndag', 'køben', 'grøn', 'straße', 'größe', 'fußball', 'gießen', 'kæmpe', 'læser', 'nærmer', 'mæglere', 'łódka', 'małe', 'wieś', 'żaba', 'mężczyzna', 'źródło', 'ŧest', 'ođgovor', 'ŋgoma', 'αλφα', 'βήτα', 'γάμμα', 'œuvre', 'þorn'];
    const encoded = words.join(' ')
      .replace(/ø/g, '&oslash;').replace(/ß/g, '&szlig;').replace(/æ/g, '&aelig;').replace(/ł/g, '&lstrok;')
      .replace(/ż/g, '&zdot;').replace(/ę/g, '&eogon;').replace(/ź/g, '&zacute;').replace(/ś/g, '&sacute;').replace(/ó/g, '&oacute;')
      .replace(/ŧ/g, '&tstrok;').replace(/đ/g, '&dstrok;').replace(/ŋ/g, '&eng;').replace(/œ/g, '&oelig;').replace(/þ/g, '&thorn;')
      .replace(/α/g, '&alpha;').replace(/λ/g, '&lambda;').replace(/φ/g, '&phi;').replace(/β/g, '&beta;').replace(/ή/g, '&#x3ae;')
      .replace(/τ/g, '&tau;').replace(/γ/g, '&gamma;').replace(/ά/g, '&#940;').replace(/μ/g, '&mu;');
    expect(encoded).not.toMatch(/[øßæłżęźśóŧđŋœþαλφβτγμ]/);
    expect(extractWorthShowing(`<p>${encoded}</p>`, `<p>${words.join(' ')}.</p>`)).toBe(true);
  });
});

describe('showsSkeleton / showsReadingTime', () => {
  it('le squelette et la pastille de durée sont exclusifs', () => {
    const waiting = { rssHtml: '', extractedHtml: null, autoExtract: true };
    expect(showsSkeleton(waiting)).toBe(true);
    expect(showsReadingTime(waiting)).toBe(false);
  });

  it('la durée s’affiche dès qu’il y a du texte, extraction ou non', () => {
    const rssOnly = { rssHtml: RSS, extractedHtml: null, autoExtract: true };
    expect(showsSkeleton(rssOnly)).toBe(false);
    expect(showsReadingTime(rssOnly)).toBe(true);
  });
});
