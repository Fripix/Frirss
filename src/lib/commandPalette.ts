/**
 * Palette de commandes — la recherche et le classement, sans DOM.
 *
 * L'application a de quoi la nourrir depuis longtemps : dix raccourcis, une
 * recherche à périmètre, les flux, les catégories, les étiquettes, les
 * serveurs, les sections de préférences. Il manquait l'entrée unique. Avec
 * soixante-et-onze flux, atteindre le bon demandait de dérouler la barre
 * latérale et de lire.
 */

// Casse et accents repliés (« securite » atteint « Sécurité ») : la même
// fonction que la recherche, pas une copie.
import { normalizeForSearch } from './searchMatch';
export { normalizeForSearch };

export interface Command {
  id: string;
  label: string;
  /** Famille affichée en tête de groupe. */
  group: string;
  /** Précision à droite (nom du flux parent, compte de non-lus…). */
  hint?: string;
  run: () => void;
}


/**
 * Score d'une correspondance, `null` si le texte ne contient pas la requête.
 *
 * Un début de libellé vaut mieux qu'un début de mot, qui vaut mieux qu'une
 * occurrence au milieu : c'est ce qui fait remonter « Tech FR » avant
 * « Vieux Tech » quand on tape « tech ».
 */
export function matchScore(query: string, label: string): number | null {
  const q = normalizeForSearch(query.trim());
  if (!q) return 0;
  const text = normalizeForSearch(label);
  const at = text.indexOf(q);
  if (at < 0) return null;
  if (at === 0) return 1000;
  if (text[at - 1] === ' ' || text[at - 1] === '/') return 500;
  return 100 - Math.min(at, 99);
}

/**
 * Filtre et classe. Le tri est **stable** : à score égal l'ordre d'origine est
 * conservé, sinon la liste sauterait sous le doigt à chaque frappe.
 */
export function rankCommands(commands: Command[], query: string, limit = 40): Command[] {
  return commands
    .map((command, index) => ({ command, index, score: matchScore(query, command.label) }))
    .filter((entry): entry is { command: Command; index: number; score: number } => entry.score !== null)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .slice(0, limit)
    .map((entry) => entry.command);
}

/**
 * L'id HTML d'une option, cible de `aria-activedescendant`. Les ids de
 * commandes portent des blancs et des barres (`label:user/-/label/Mon
 * étiquette`, `feed:feed/12`) : un id HTML n'admet aucun blanc, et un tel id
 * ne se vise pas proprement par un sélecteur. Chaque caractère hors
 * `[A-Za-z0-9:.-]` devient `_<code hexadécimal>_` — le `_` compris, ce qui
 * garde la correspondance injective : deux commandes n'ont jamais le même id.
 */
export function paletteOptionId(commandId: string): string {
  return `palette-${commandId.replace(/[^A-Za-z0-9:.-]/gu, (ch) => `_${ch.codePointAt(0)!.toString(16)}_`)}`;
}
