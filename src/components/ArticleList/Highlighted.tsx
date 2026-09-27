import { Fragment } from 'react';
import { highlight } from '../../lib/searchHighlight';

/**
 * Le texte d'une ligne, avec les termes de la recherche marqués.
 *
 * `<mark>` plutôt qu'un `<span>` stylé : c'est l'élément que le HTML réserve
 * exactement à ça, et les lecteurs d'écran l'annoncent. Hors recherche
 * (`terms` vide), le texte sort tel quel, sans nœud supplémentaire.
 */
export default function Highlighted({ text, terms }: { text: string; terms?: readonly string[] }) {
  if (!terms?.length) return <>{text}</>;
  return (
    <>
      {highlight(text, terms).map((segment, i) => (
        segment.hit
          ? <mark key={i} className="search-hit">{segment.text}</mark>
          : <Fragment key={i}>{segment.text}</Fragment>
      ))}
    </>
  );
}
