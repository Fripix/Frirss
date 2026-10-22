import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { AiProviderView } from '../../../api/backend';
import BottomSheet from '../../BottomSheet';
import Popover from '../../ReadingPane/Popover';
import { providerChoices } from '../../../lib/aiProviderChoices';

/**
 * Les contrôles d'une ligne de « Par flux et catégorie » : les trois
 * interrupteurs carrés et le bouton de fournisseur. Ils vivent dans la grille
 * du bloc (`RoutingBlock`), qui fixe la taille d'une cellule (`--cell` : 32 px
 * à la souris, 40 px au doigt).
 */

/**
 * La zone de toucher de 44 px au doigt : un pseudo-élément transparent de
 * 2 px de part et d'autre de la cellule de 40 px. À l'étroit (< 420 px de
 * conteneur), la cellule tombe à 32 px et `.ai-routing__hit` (`index.css`)
 * ré-étire la zone : 44 px de haut (6 px en haut et en bas), 36 de large. Il agrandit ce que le doigt
 * atteint sans agrandir ce qui se voit ni la ligne — même idiome que le
 * bouton « Résumer » compact d'`AiSummary`. À la souris, rien : les cellules
 * de 32 px sont proches, une zone élargie mordrait sur la voisine.
 * `min-h-0` : la règle globale `@media (pointer: coarse) button { min-height:
 * 40px }` (index.css) étirait les carrés de 32 px en 32×40 (mesuré à 320 px).
 */
const hitArea = "ai-routing__hit before:absolute before:-inset-0.5 before:content-['']";

/**
 * Trois états, pas deux : **on** (réglé ici, plein), **inherited** (allumé
 * par la catégorie ou le réglage global, sans valeur propre : contour
 * d'accent) et **off**. Une catégorie ne connaît que on / off.
 */
export type ToggleState = 'on' | 'inherited' | 'off';
export type ToggleKind = 'summary' | 'translate' | 'panel';

export function RoutingToggle({ kind, state, ariaLabel, title, describedBy, touch, onToggle }: {
  kind: ToggleKind; state: ToggleState; ariaLabel: string; title: string; describedBy: string; touch: boolean; onToggle: (on: boolean) => void;
}) {
  const on = state !== 'off';
  // Contour en ombre portée intérieure : passer de 1 à 1,5 px ne décale rien.
  const look = state === 'on'
    ? { background: 'var(--accent)', color: 'var(--on-accent)', boxShadow: 'none' }
    : state === 'inherited'
      ? { background: 'transparent', color: 'var(--accent)', boxShadow: 'inset 0 0 0 1.5px var(--accent)' }
      : { background: 'transparent', color: 'var(--list-summary)', boxShadow: 'inset 0 0 0 1px var(--panel-border)' };
  return (
    <button
      type="button" role="switch" aria-checked={on} data-state={state}
      aria-label={ariaLabel} aria-describedby={describedBy} title={title}
      // Le toucher écrit toujours une valeur propre, l'inverse de ce qui se voit.
      onClick={() => onToggle(!on)}
      className={`relative min-h-0 justify-self-center inline-flex items-center justify-center rounded-md cursor-pointer transition-colors ${touch ? hitArea : ''}`}
      style={{ width: 'var(--cell)', height: 'var(--cell)', ...look }}
    >
      {kind === 'summary' ? <SparkleIcon /> : kind === 'translate' ? <TranslateIcon /> : <PanelIcon />}
    </button>
  );
}

/**
 * Le fournisseur d'une ligne : un bouton compact qui ouvre la liste — en
 * popover sous le bouton à la souris, en feuille du bas au doigt, les deux
 * rendus par portail sous `<body>` (le tiroir mobile rognerait un `fixed`
 * rendu ici). Les choix suivent `providerChoices`, la règle des sélecteurs :
 * un fournisseur sans clé utilisable est listé mais inerte, un fournisseur
 * supprimé reste visible tant qu'il est choisi.
 *
 * Deux faces, et le CSS (`.ai-routing__wide` / `.ai-routing__narrow`, requête
 * de conteneur) en montre une : au large, la valeur en toutes lettres (« Par
 * défaut » en gris, un nom en couleur de titre) et un chevron ; à l'étroit,
 * une puce seule, marquée d'un point d'accent quand la ligne a son propre
 * fournisseur. Le nom accessible et le `title` disent toujours la ligne ET la
 * valeur, l'étiquette visible pouvant n'être qu'une icône.
 */
export function ProviderPicker({ menuLabel, providers, value, defaultLabel, touch, onPick }: {
  menuLabel: string; providers: AiProviderView[]; value: number | null; defaultLabel: string; touch: boolean;
  onPick: (value: number | null) => void;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const choices = providerChoices(providers, value, defaultLabel, t);
  const current = choices.find((c) => c.value === value) ?? choices[0];
  const name = t('ai.routing.labelValue', { label: menuLabel, value: current.label });
  const close = () => {
    setOpen(false);
    // Le focus revient d'où il est parti, choix fait ou non.
    ref.current?.focus();
  };
  const choose = (v: number | null) => {
    onPick(v);
    close();
  };

  const rowClass = `flex items-center gap-2 w-full text-left rounded-md ${touch ? 'sheet-row px-4 text-[15px]' : 'px-3 py-1.5 text-xs hover:bg-black/5'}`;
  // Comme `TranslateMenu` : des `menuitemradio` dans le popover, de simples
  // boutons (`aria-current`) dans la feuille, qui est une boîte de dialogue.
  // Un choix inerte est `aria-disabled` et non `disabled` : il reste
  // atteignable aux flèches du popover, qui sinon s'y bloqueraient.
  const rows = choices.map((c) => {
    const checked = c.value === value;
    return (
      <button
        key={c.value ?? ''} type="button" className={rowClass}
        style={{ color: 'var(--list-title)', opacity: c.disabled ? 0.5 : undefined, cursor: c.disabled ? 'default' : undefined }}
        role={touch ? undefined : 'menuitemradio'}
        aria-checked={touch ? undefined : checked}
        aria-current={touch && checked ? 'true' : undefined}
        aria-disabled={c.disabled || undefined}
        onClick={() => { if (!c.disabled) choose(c.value); }}
      >
        <span aria-hidden="true" className="w-3.5 flex-shrink-0">
          {checked && <svg className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
        </span>
        <span className="truncate">{c.label}</span>
      </button>
    );
  });

  return (
    <>
      <button
        ref={ref} type="button" aria-label={name} title={name}
        aria-haspopup={touch ? 'dialog' : 'menu'} aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`relative min-h-0 justify-self-end inline-flex items-center justify-center rounded-md text-xs cursor-pointer hover:bg-black/5 ${touch ? hitArea : ''}`}
        style={{ height: 'var(--cell)', minWidth: 'var(--cell)' }}
      >
        <span className="ai-routing__wide" style={{ color: value === null ? 'var(--list-summary)' : 'var(--list-title)' }}>
          <span className="truncate">{current.label}</span>
          <ChevronDown />
        </span>
        <span className="ai-routing__narrow" style={{ color: value === null ? 'var(--list-summary)' : 'var(--list-title)' }}>
          <ChipIcon />
          {value !== null && (
            <span data-override-dot className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full" style={{ background: 'var(--accent)' }} />
          )}
        </span>
      </button>
      {open && (touch
        ? <BottomSheet open onClose={close} title={menuLabel}>{rows}</BottomSheet>
        : createPortal(<Popover anchor={ref.current} onClose={close} label={menuLabel}>{rows}</Popover>, document.body))}
    </>
  );
}

/** L'étincelle du panneau « Résumé IA » (`AiSummary`), en 16 px. */
export function SparkleIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" /></svg>;
}

/** L'icône « Traduire » de la barre d'outils du volet de lecture. */
export function TranslateIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M10.5 21l5.25-11.25L21 21m-9-3h7.5M3 5.621a48.474 48.474 0 016-.371m0 0c1.12 0 2.233.038 3.334.114M9 5.25V3m3.334 2.364C11.176 10.658 7.69 15.08 3 17.502m9.334-12.138c.896.061 1.785.147 2.666.257m-4.589 8.495a18.023 18.023 0 01-3.827-5.802" /></svg>;
}

/** Une page coiffée d'un bandeau : le panneau « Résumé IA » posé en tête de l'article. */
export function PanelIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M5.25 3.75h13.5a1.5 1.5 0 011.5 1.5v13.5a1.5 1.5 0 01-1.5 1.5H5.25a1.5 1.5 0 01-1.5-1.5V5.25a1.5 1.5 0 011.5-1.5zM3.75 9.75h16.5M7.5 13.5h9M7.5 16.5h6" /></svg>;
}

/** Une puce : « le modèle qui répond », sans nommer de fournisseur. */
function ChipIcon() {
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.6} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" /></svg>;
}

function ChevronDown() {
  return <svg className="w-3 h-3 flex-shrink-0" fill="none" viewBox="0 0 16 16" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M4 6l4 4 4-4" /></svg>;
}
