import { forwardRef, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

interface Props {
  value: string;
  /** La vue que la recherche fouille, annoncée dans le champ. */
  scope: string;
  mobile: boolean;
  onChange: (value: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

/**
 * La barre de recherche : un champ, la loupe qui l'envoie, la croix qui ferme.
 *
 * ⚠️ **La loupe est un vrai `type="submit"`**, pas un décor. Le formulaire n'en
 * avait aucun : la recherche ne partait alors que par la *soumission implicite*
 * du navigateur, qui se déclenche sur l'événement `keypress` d'Entrée. Tout ce
 * qui n'émet pas ce `keypress` rendait la recherche inatteignable — le
 * pilotage du navigateur de test (constaté le 2026-09-26, aucune recherche
 * possible depuis Oya), et le vieux piège du clavier iOS dont le « Go » ne
 * soumet pas un formulaire sans bouton d'envoi. Un bouton, et la soumission
 * ne dépend plus d'un chemin implicite.
 *
 * Il est posé **après le champ dans le DOM** et remonté à gauche par
 * positionnement : dans l'autre ordre, la tabulation atteindrait l'envoi avant
 * la saisie.
 */
const SearchBar = forwardRef<HTMLInputElement, Props>(function SearchBar(
  { value, scope, mobile, onChange, onSubmit, onClose }, ref,
) {
  const { t } = useTranslation();

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    onSubmit();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="px-3 py-1.5 flex items-center gap-1.5"
      style={{ borderTop: '1px solid var(--panel-border)' }}
    >
      <div className="flex-1 relative">
        <input
          ref={ref}
          data-search-input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={t('articleList.searchIn', { scope })}
          className="w-full text-xs pl-8 pr-3 py-1.5 rounded-lg border outline-none transition-colors"
          style={{
            borderColor: 'var(--panel-border)',
            color: 'var(--list-title)',
            background: 'var(--panel-bg)',
            // iOS zooms into inputs whose font is < 16px → force 16px on mobile.
            fontSize: mobile ? '16px' : undefined,
          }}
          onFocus={(e) => e.target.style.borderColor = 'var(--accent)'}
          onBlur={(e) => e.target.style.borderColor = 'var(--panel-border)'}
          onKeyDown={(e) => e.key === 'Escape' && onClose()}
        />
        <button
          type="submit"
          className="search-submit"
          style={{ color: 'var(--list-summary)' }}
          title={t('articleList.search')}
          aria-label={t('articleList.search')}
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
          </svg>
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        className="p-1.5 rounded-lg transition-colors hover:bg-black/5"
        style={{ color: 'var(--list-summary)' }}
        title={t('articleList.closeSearch')}
        aria-label={t('articleList.closeSearch')}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </form>
  );
});

export default SearchBar;
