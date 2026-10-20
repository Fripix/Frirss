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
 */
export default function TranslateMenu({ open, anchor, touch, title, onClose, ...rest }: TranslateMenuProps) {
  if (!open) return null;
  // Le contenu est remonté à chaque ouverture : le filtre repart vide.
  const body = <MenuSections touch={touch} {...rest} />;
  return touch
    ? <BottomSheet open onClose={onClose} title={title}>{body}</BottomSheet>
    : createPortal(<Popover anchor={anchor} onClose={onClose}>{body}</Popover>, document.body);
}

function MenuSections({ touch, languages, providers, current, onPick }: Omit<TranslateMenuProps, 'open' | 'anchor' | 'title' | 'onClose'>) {
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

  const row = (key: string, label: string, checked: boolean, pick: () => void) => (
    <button key={key} type="button" role={touch ? undefined : 'menuitem'} onClick={pick} className={rowClass} style={{ color: 'var(--list-title)' }}>
      <span aria-hidden="true" className="w-3.5 flex-shrink-0">
        {checked && <svg data-check className="w-3.5 h-3.5" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>}
      </span>
      <span className="truncate">{label}</span>
    </button>
  );

  return (
    <>
      <div role="group" aria-labelledby={`${uid}-to`}>
        <p id={`${uid}-to`} className={headingClass} style={headingStyle}>{t('ai.translateTo')}</p>
        {languages.length > FILTER_FROM && (
          <div className={touch ? 'px-4 pb-1.5' : 'px-2 pb-1'}>
            <input
              type="search" value={filter} onChange={(e) => setFilter(e.target.value)} autoComplete="off" spellCheck={false}
              aria-label={t('ai.translation.filter')} placeholder={t('ai.translation.filter')}
              // 16 px sur tactile : en dessous, iOS zoome la page à la saisie.
              className={`w-full rounded-md px-2.5 ${touch ? 'min-h-[44px] text-[16px]' : 'h-7 text-xs'}`}
              style={{ background: 'var(--panel-header-bg)', border: '1px solid var(--panel-border)', color: 'var(--list-title)' }}
            />
          </div>
        )}
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
    </>
  );
}
