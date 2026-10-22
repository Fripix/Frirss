import { useLayoutEffect, type RefObject } from 'react';

/**
 * Replie les libellés de la barre d'action du volet de lecture EN MESURANT.
 *
 * Écrit `data-fold` sur l'élément, impérativement : `"0"` (tout tient), `"1"`
 * (libellés secondaires masqués : Étiquettes, Partager, Original), `"2"` (tous
 * masqués). On part de `"0"`, on mesure (`scrollWidth > clientWidth` = la barre
 * déborde), on passe à `"1"`, on mesure encore, et seulement si ça déborde
 * toujours on passe à `"2"`. Le CSS fait le reste (`index.css`).
 *
 * Jamais d'attribut posé par le JSX ni d'état : React n'écraserait pas la
 * valeur, et aucun rendu n'est déclenché — donc aucune boucle. La largeur de la
 * barre ne dépend pas de son contenu (pleine largeur, `overflow-x: auto`), la
 * mesure est stable. `deps` : tout ce qui change un libellé.
 */
export function useToolbarFold(ref: RefObject<HTMLElement | null>, deps: unknown[]): void {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const overflows = () => el.scrollWidth > el.clientWidth;
    const measure = () => {
      el.dataset.fold = '0';
      if (!overflows()) return;
      el.dataset.fold = '1';
      if (!overflows()) return;
      el.dataset.fold = '2';
    };
    measure();
    window.addEventListener('resize', measure);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, ...deps]);
}
