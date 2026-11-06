// server/ai/script.test.ts
import { describe, it, expect } from 'vitest';
import { textFitsLanguage, plausibleLang } from './script.js';

const PERSIAN = 'این مقاله دربارهٔ آینده‌ی هوش مصنوعی در ایران است و چند نکتهٔ مهم را بررسی می‌کند.';
const FRENCH = 'Cet article parle de l’avenir de l’intelligence artificielle et de ses enjeux.';

describe('textFitsLanguage', () => {
  it('refuses a Persian text as French, accepts it as Arabic-script language', () => {
    expect(textFitsLanguage(PERSIAN, 'fr')).toBe(false);
    expect(textFitsLanguage(PERSIAN, 'ar')).toBe(true);
    expect(textFitsLanguage(PERSIAN, 'fa')).toBe(true);
  });
  it('accepts a Latin text for Latin-script languages, refuses it for others', () => {
    expect(textFitsLanguage(FRENCH, 'fr')).toBe(true);
    expect(textFitsLanguage(FRENCH, 'en')).toBe(true);
    expect(textFitsLanguage(FRENCH, 'uk')).toBe(false);
    expect(textFitsLanguage(FRENCH, 'zh-Hans')).toBe(false);
    expect(textFitsLanguage(FRENCH, 'ar')).toBe(false);
  });
  it('knows the Asian scripts: Japanese mixes kanji and kana, Korean is Hangul, Chinese is Han', () => {
    expect(textFitsLanguage('今日は東京で新しい技術の発表がありました。', 'ja')).toBe(true);
    expect(textFitsLanguage('오늘 서울에서 새로운 기술이 발표되었습니다.', 'ko')).toBe(true);
    expect(textFitsLanguage('今天在北京发布了一项新技术。', 'zh-Hans')).toBe(true);
    expect(textFitsLanguage('今天在北京發布了一項新技術。', 'zh-Hant')).toBe(true);
    expect(textFitsLanguage('오늘 서울에서 새로운 기술이 발표되었습니다.', 'ja')).toBe(false);
    expect(textFitsLanguage('Сьогодні в Києві представили нову технологію.', 'uk')).toBe(true);
    expect(textFitsLanguage('Σήμερα παρουσιάστηκε μια νέα τεχνολογία.', 'el')).toBe(true);
    expect(textFitsLanguage('आज दिल्ली में एक नई तकनीक पेश की गई।', 'hi')).toBe(true);
    expect(textFitsLanguage('วันนี้มีการเปิดตัวเทคโนโลยีใหม่', 'th')).toBe(true);
  });
  it('judges the majority: a few foreign words do not change the verdict', () => {
    expect(textFitsLanguage(`iPhone, Apple, OpenAI : ${PERSIAN}`, 'fr')).toBe(false);
    expect(textFitsLanguage(`${FRENCH} (« سلام » veut dire bonjour)`, 'fr')).toBe(true);
  });
  it('ignores tags, attributes and entities: a link does not make a Persian segment Latin', () => {
    const seg = `<a href="https://example.com/a-very-long-latin-path-with-many-letters">${PERSIAN}</a>&nbsp;&amp;&hellip;`;
    expect(textFitsLanguage(seg, 'fr')).toBe(false);
  });
  it('cannot judge a text without letters, nor an unknown language: accepted', () => {
    expect(textFitsLanguage('12 345 — 67,8 %', 'fr')).toBe(true);
    expect(textFitsLanguage('', 'ar')).toBe(true);
    expect(textFitsLanguage(PERSIAN, 'not a tag!')).toBe(true);
    expect(textFitsLanguage(PERSIAN, 'qaa')).toBe(true);
  });
  it('accepts both scripts of a language written in two (Serbian), and an explicit script subtag', () => {
    expect(textFitsLanguage('Danas je u Beogradu predstavljena nova tehnologija.', 'sr')).toBe(true);
    expect(textFitsLanguage('Данас је у Београду представљена нова технологија.', 'sr')).toBe(true);
    expect(textFitsLanguage('Данас је у Београду представљена нова технологија.', 'sr-Latn')).toBe(false);
  });
  it('stays linear on a large hostile input', () => {
    const big = '<'.repeat(100_000) + 'a'.repeat(100_000) + '&'.repeat(50_000);
    const t0 = performance.now();
    textFitsLanguage(big, 'fr');
    expect(performance.now() - t0).toBeLessThan(500);
  });
});

describe('plausibleLang', () => {
  it('drops an announced language the text cannot be in, keeps a plausible one', () => {
    expect(plausibleLang('fr', PERSIAN)).toBeNull();
    expect(plausibleLang('fa', PERSIAN)).toBe('fa');
    expect(plausibleLang('fr', FRENCH)).toBe('fr');
    expect(plausibleLang(null, FRENCH)).toBeNull();
  });
});
