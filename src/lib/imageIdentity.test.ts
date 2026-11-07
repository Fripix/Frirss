import { describe, it, expect } from 'vitest';
import { imageIdentity } from './imageIdentity';

describe('imageIdentity — la même image à la taille près (REG-225, REG-227)', () => {
  it('ignore la taille demandée et sa signature sur une adresse d’image (structure Frandroid)', () => {
    const feed = 'https://img.example.com/images.example.com/uploads/2024/07/velo-1200x800.jpg?resize=1200,675&key=9c833cf8';
    const page = 'https://img.example.com/images.example.com/uploads/2024/07/velo.jpg?resize=1200&key=513fa488';
    expect(imageIdentity(feed)).toBe(imageIdentity(page));
  });

  it('ignore les recadrages et la qualité (structure The Verge)', () => {
    const a = 'https://platform.example.com/uploads/2026/07/PHOTO_A.jpg?quality=90&strip=all&crop=0%2C0%2C100%2C100&w=2400';
    const b = 'https://platform.example.com/uploads/2026/07/PHOTO_A.jpg?quality=90&strip=all&crop=10%2C0%2C80%2C100&w=1080';
    expect(imageIdentity(a)).toBe(imageIdentity(b));
  });

  it('une miniature de srcset est la même image que l’original', () => {
    expect(imageIdentity('https://example.com/a/photo-300x200.jpg')).toBe(imageIdentity('https://example.com/a/photo.jpg'));
    expect(imageIdentity('https://example.com/a/photo-scaled.jpg')).toBe(imageIdentity('https://example.com/a/photo.jpg'));
  });

  it('deux photos différentes restent différentes', () => {
    expect(imageIdentity('https://example.com/a/photo-1.jpg')).not.toBe(imageIdentity('https://example.com/a/photo-2.jpg'));
    expect(imageIdentity('https://example.com/a/photo.jpg')).not.toBe(imageIdentity('https://example.com/b/photo.jpg'));
    expect(imageIdentity('https://cdn1.example.com/photo.jpg')).not.toBe(imageIdentity('https://cdn2.example.com/photo.jpg'));
  });

  it('sans extension, la requête peut être l’identité : seuls les paramètres de taille sortent', () => {
    expect(imageIdentity('https://example.com/image.php?id=1&w=300')).not.toBe(imageIdentity('https://example.com/image.php?id=2&w=300'));
    expect(imageIdentity('https://example.com/image.php?id=1&w=300')).toBe(imageIdentity('https://example.com/image.php?id=1&w=1200'));
    expect(imageIdentity('https://example.com/_next/image?url=%2Fa.jpg&w=640&q=75')).not.toBe(imageIdentity('https://example.com/_next/image?url=%2Fb.jpg&w=640&q=75'));
  });

  it('relative, résolue contre la base ; en ligne ou illisible, aucune identité', () => {
    expect(imageIdentity('/a/photo-1024x576.jpg', 'https://example.com/article')).toBe(imageIdentity('https://example.com/a/photo.jpg'));
    expect(imageIdentity('data:image/gif;base64,R0lGOD')).toBeNull();
    expect(imageIdentity('')).toBeNull();
    expect(imageIdentity('pas une adresse')).toBeNull();
  });

  it('le schéma et le fragment ne comptent pas', () => {
    expect(imageIdentity('http://Example.com/a.jpg#x')).toBe(imageIdentity('https://example.com/a.jpg'));
  });
});
