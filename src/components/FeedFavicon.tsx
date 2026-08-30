import { useState, useEffect } from 'react';
import { getFavicon, setFavicon, blobToDataUrl } from '../lib/faviconCache';
import { readableTextOn } from '../lib/readableText';
import client from '../api/client';

/**
 * Favicon d'un flux, avec repli sur une pastille-lettre colorée.
 *
 * Vivait dans `Sidebar.tsx` et n'y servait qu'elle. La liste d'articles
 * affichait la source en majuscules de 10 px : repérer « les articles du
 * Register » dans une vue Tous les flux demandait de lire au lieu de
 * reconnaître. Le cache, le repli et les deux stratégies de chargement
 * existaient déjà — il n'y avait qu'à les sortir d'ici.
 *
 * `size` est en pixels : 14 dans la barre latérale (densité d'origine), 16
 * dans la liste, où la ligne est plus haute.
 */
/**
 * Couleur stable tirée du titre. Rendue en hexadécimal et non en `hsl()` :
 * `readableTextOn()` ne lit que l'hexadécimal, et une couleur qu'elle ne sait
 * pas lire retombe sur le blanc — ce qui marchait par chance ici, la
 * luminosité étant fixée à 42 %. Autant que ce soit vrai plutôt que chanceux.
 */
function getLetterAvatarColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return hslToHex(hue, 0.5, 0.42);
}

function hslToHex(h: number, s: number, l: number): string {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const hex = (n: number) => Math.round(f(n) * 255).toString(16).padStart(2, '0');
  return `#${hex(0)}${hex(8)}${hex(4)}`;
}

export function LetterAvatar({ title, size = 14 }: { title?: string; size?: number }) {
  const letter = (title || '?')[0].toUpperCase();
  const color = getLetterAvatarColor(title || '');
  return (
    <div
      className="rounded flex-shrink-0 flex items-center justify-center font-bold leading-none"
      style={{
        width: size,
        height: size,
        fontSize: Math.max(7, Math.round(size * 0.5)),
        background: color,
        color: readableTextOn(color),
      }}
    >
      {letter}
    </div>
  );
}

export default function FeedFavicon({ iconUrl, title, size = 14 }: { iconUrl?: string; title?: string; size?: number }) {
  // Seed synchronously from the persistent cache → the icon paints on the
  // first frame after a reload, with no flash and no re-fetch.
  const [src, setSrc] = useState<string | null>(() => getFavicon(iconUrl));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!iconUrl) {
      setFailed(true);
      return;
    }

    // Already resolved (this session or a previous one).
    const cached = getFavicon(iconUrl);
    if (cached) {
      setSrc(cached);
      setFailed(false);
      return;
    }

    let cancelled = false;

    // Strategy 1: fetch through the authenticated client (proxy + auth), then
    // persist as a data URL so it survives reloads.
    client
      .get<Blob>(iconUrl, { responseType: 'blob' })
      .then(async (response) => {
        // Check that we got an image (not an HTML error page)
        if (response.data.type && response.data.type.startsWith('image')) {
          const dataUrl = await blobToDataUrl(response.data);
          if (cancelled) return;
          setFavicon(iconUrl, dataUrl);
          setSrc(dataUrl);
        } else {
          throw new Error('Not an image');
        }
      })
      .catch(() => {
        if (cancelled) return;
        // Strategy 2: load the image directly (works if the server allows
        // unauthenticated access); the plain URL is cacheable as-is.
        const img = new Image();
        img.onload = () => {
          if (cancelled) return;
          setFavicon(iconUrl, iconUrl);
          setSrc(iconUrl);
        };
        img.onerror = () => {
          if (cancelled) return;
          console.warn('[FriRSS] Favicon failed to load:', iconUrl);
          setFailed(true);
        };
        img.src = iconUrl;
      });

    return () => { cancelled = true; };
  }, [iconUrl]);

  if (failed || !iconUrl || !src) {
    return <LetterAvatar title={title} size={size} />;
  }

  return (
    <img
      src={src}
      alt=""
      className="rounded flex-shrink-0"
      style={{ width: size, height: size }}
      onError={() => setFailed(true)}
    />
  );
}
