import type { CSSProperties, ReactNode } from 'react';
import { useUiStore } from '../stores/uiStore';

/**
 * Le contenu principal de l'app (liste et volet de lecture), sur les trois
 * formats : un seul `main`, qui porte le titre de la page.
 *
 * Avant la 1.9.0, `main` n'entourait que le volet de lecture — absent en
 * tablette, au téléphone, en 2 colonnes et en grille tant qu'aucun article
 * n'était ouvert — et le seul `h1` était le nom de l'app dans la barre
 * latérale, inerte dans le tiroir fermé. Le titre est réservé aux lecteurs
 * d'écran (`sr-only`, en position absolue : il ne compte pas dans la mise en
 * page flex) ; le nom visible de la barre latérale n'est plus un titre, pour
 * ne pas l'annoncer deux fois.
 */
export default function AppMain({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  const appTitle = useUiStore((s) => s.appTitle);
  return (
    <main className={className} style={style}>
      <h1 className="sr-only">{appTitle}</h1>
      {children}
    </main>
  );
}
