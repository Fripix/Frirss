import { useId, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import BottomSheet from '../BottomSheet';
import Popover from './Popover';
import { languageName, type AiLanguage } from '../../lib/aiLanguages';
import type { AiProviderView } from '../../api/backend';

/** Au-delà, la liste des langues reçoit un champ de filtre (même seuil que la liste des modèles). */
const FILTER_FROM = 12;

export interface TranslateMenuProps {
  open: boolean;
  anchor: HTMLElement | null;
  touch: boolean;
  title: string;
  languages: AiLanguage[];
  providers: AiProviderView[];
  current: { lang: AiLanguage; providerId: number | null };
  onPick: (choice: { lang?: AiLanguage; providerId?: number }) => void;
  onClose: () => void;
  /**
   * « Retraduire » : présent seulement quand une traduction est affichée (le
   * volet ne le passe qu'alors). Relance la traduction courante — même
   * langue, même fournisseur — sans cache : un appel payé, une unité.
   */
  onRetranslate?: () => void;
}

/**
 * Le menu du chevron de « Traduire » : deux sections, « Traduire en… » (la
 * langue courante en tête, puis les autres par nom dans la langue de
 * l'interface, filtrables) et « Traduire avec… » (les fournisseurs
 * disponibles). Popover en portail sur le format ordinateur, feuille du bas
 * sur tablette et smartphone — exactement comme « Résumer avec… ».
 *
 * Chaque choix est indépendant : une langue rend `{ lang }`, un fournisseur
 * `{ providerId }` ; c'est le volet qui complète l'autre moitié.
 *
 * « Retraduire » (`onRetranslate`) vient après les deux sections, séparé d'un
 * filet : c'est une action, pas un choix — un `menuitem`, jamais coché. En
 * dernier, il laisse le filtre collé à la liste des langues et le premier
 * élément focalisé inchangé.
 */
export default function TranslateMenu(props: TranslateMenuProps) {
  // Le contenu est remonté à chaque ouverture : le filtre repart vide.
  return props.open ? <OpenMenu {...props} /> : null;
}

function OpenMenu({ anchor, touch, title, languages, providers, current, onPick, onClose, onRetranslate }: TranslateMenuProps) {
  const { t, i18n } = useTranslation();
  const uid = useId();
  const [filter, setFilter] = useState('');
  const ui = i18n.language;

  const named = languages.map((code) => ({ code, name: languageName(code, ui) }));
  const head = named.filter((l) => l.code === current.lang);
  const others = named.filter((l) => l.code !== current.lang).sort((a, b) => a.name.localeCompare(b.name, ui));
  const needle = filter.trim().toLocaleLowerCase(ui);
  const shown = [...head, ...others].filter((l) => !needle || l.name.toLocaleLowerCase(ui).includes(needle) || l.code.toLowerCase().includes(needle));
  const available = providers.filter((p) => p.available);

  const rowClass = `flex items-center gap-2 w-full text-left rounded-md hover:bg-black/5 ${touch ? 'sheet-row px-4 text-[15px]' : 'px-3 py-1.5 text-xs'}`;
  const headingClass = `font-semibold ${touch ? 'px-4 pt-2 pb-1 text-xs' : 'px-3 pt-1.5 pb-1 text-[11px]'}`;
  const headingStyle = { color: 'var(--list-summary)' };

  // Bureau : des `menuitemradio` cochés par `aria-checked` (une radio par
  // section). Tactile : de simples boutons dans une feuille, `aria-current`
  // pour le choix en cours. La coche visible reste décorative.
  const row = (key: string, label: string, checked: boolean, pick: () => void) => (
    <button
      key={key} type="button" onClick={pick} className={rowClass} style={{ color: 'var(--list-title)' }}
      role={touch ? undefined : 'menuitemradio'}
      aria-checked={touch ? undefined : checked}
      aria-current={touch && checked ? 'true' : undefined}
    >
      <span aria-hidden="true" className="w-3.5 flex-shrink-0">
        {checked && <svg data-check className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );

  // Hors du `role="menu"` : un champ de saisie n'en est pas un enfant permis.
  const filterField = languages.length > FILTER_FROM ? (
    <div className={touch ? 'px-4 pt-1 pb-1.5' : 'px-2 pt-1 pb-1'}>
      <input
        type="search" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" spellCheck={false}
        aria-label={t('ai.translation.filter')} placeholder={t('ai.translation.filter')}
        // 16 px sur tactile : en dessous, iOS zoome la page à la saisie.
        className={`w-full rounded-md px-2.5 ${touch ? 'min-h-[44px] text-[16px]' : 'h-7 text-xs'}`}
        style={{ background: 'var(--panel-header-bg)', border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
      />
    </div>
  ) : null;

  const sections = (
    <>
      <div role="group" aria-labelledby={`${uid}-to`}>
        <p id={`${uid}-to`} className={headingClass} style={headingStyle}>{t('ai.translateTo')}</p>
        {/* Liste bornée : « Traduire avec… » reste en vue sous les 28 langues. */}
        <div className={`overflow-y-auto ${touch ? 'max-h-[40vh]' : 'max-h-60'}`}>
          {shown.map((l) => row(l.code, l.name, l.code === current.lang, () => onPick({ lang: l.code })))}
        </div>
      </div>
      {available.length > 0 && (
        <div role="group" aria-labelledby={`${uid}-with`} className="mt-1 pt-1" style={{ borderTop: '1px solid var(--panel-border)' }}>
          <p id={`${uid}-with`} className={headingClass} style={headingStyle}>{t('ai.translateWith')}</p>
          {available.map((p) => row(String(p.id), p.name, p.id === current.providerId, () => onPick({ providerId: p.id })))}
        </div>
      )}
      {onRetranslate && (
        <div className="mt-1 pt-1" style={{ borderTop: '1px solid var(--panel-border)' }}>
          <button type="button" onClick={onRetranslate} className={rowClass} style={{ color: 'var(--list-title)' }} role={touch ? undefined : 'menuitem'}>
            {/* Même colonne que la coche des choix : les libellés restent alignés. */}
            <span aria-hidden="true" className="w-3.5 flex-shrink-0" />
            <span className="truncate">{t('ai.retranslate')}</span>
          </button>
        </div>
      )}
    </>
  );

  return touch
    ? <BottomSheet open onClose={onClose} title={title}>{filterField}{sections}</BottomSheet>
    : createPortal(<Popover anchor={anchor} onClose={onClose} header={filterField} label={title}>{sections}</Popover>, document.body);
}
