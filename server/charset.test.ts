import { describe, it, expect } from 'vitest';
import { sniffCharset, decodeBody } from './charset.js';

const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, 'latin1'));

describe('sniffCharset', () => {
  // En-tête réel de developpez.com : une virgule à la place du point-virgule.
  it('lit un charset derrière une virgule (en-tête mal formé mais courant)', () => {
    expect(sniffCharset('text/html, charset=iso-8859-1', latin1('<html>'))).toBe('windows-1252');
  });

  it('accepte guillemets, casse et séparateur point-virgule', () => {
    expect(sniffCharset('text/html; Charset="UTF-8"', latin1('<html>'))).toBe('utf-8');
  });

  it("lit <meta charset> quand l'en-tête n'en dit rien", () => {
    const head = latin1('<html><head><meta charset=iso-8859-15></head>');
    expect(sniffCharset('text/html', head)).toBe('iso-8859-15');
  });

  it('lit <meta http-equiv="content-type">', () => {
    const head = latin1('<meta http-equiv="Content-Type" content="text/html; charset=ISO-8859-2">');
    expect(sniffCharset(undefined, head)).toBe('iso-8859-2');
  });

  it("l'en-tête l'emporte sur la balise meta", () => {
    const head = latin1('<meta charset="iso-8859-15">');
    expect(sniffCharset('text/html; charset=utf-8', head)).toBe('utf-8');
  });

  it('une page sans déclaration reste en UTF-8', () => {
    expect(sniffCharset('text/html', new TextEncoder().encode('<p>é</p>'))).toBe('utf-8');
    expect(sniffCharset(undefined, new Uint8Array())).toBe('utf-8');
  });

  it("un BOM UTF-8 l'emporte sur tout", () => {
    const head = Uint8Array.from([0xef, 0xbb, 0xbf, ...Buffer.from('<p>')]);
    expect(sniffCharset('text/html; charset=iso-8859-1', head)).toBe('utf-8');
  });

  it('un libellé inconnu retombe sur utf-8', () => {
    expect(sniffCharset('text/html; charset=klingon', latin1('<html>'))).toBe('utf-8');
  });

  it('ne cherche la balise meta que dans les 2 048 premiers octets', () => {
    const head = latin1(' '.repeat(3000) + '<meta charset="iso-8859-15">');
    expect(sniffCharset('text/html', head)).toBe('utf-8');
  });
});

describe('decodeBody', () => {
  it('décode windows-1252 : 0xE9 donne é', () => {
    expect(decodeBody(Uint8Array.from([0xe9]), 'text/html; charset=windows-1252')).toBe('é');
  });

  it("décode une page latin-1 annoncée par l'en-tête mal formé, sans U+FFFD", () => {
    const out = decodeBody(latin1('<p>a rapporté</p>'), 'text/html, charset=iso-8859-1');
    expect(out).toBe('<p>a rapporté</p>');
    expect(out).not.toContain('�');
  });

  it('décode iso-8859-15 (euro en 0xA4)', () => {
    expect(decodeBody(latin1('<meta charset=iso-8859-15>\xa4'), 'text/html')).toContain('€');
  });

  it("laisse une page UTF-8 intacte et n'avale pas le BOM", () => {
    const bytes = Uint8Array.from([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('é')]);
    expect(decodeBody(bytes, undefined)).toBe('é');
  });
});
