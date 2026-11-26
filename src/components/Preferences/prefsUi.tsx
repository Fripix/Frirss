import { useId, type ReactNode } from 'react';

/**
 * Briques communes du panneau Préférences.
 *
 * Trois niveaux de titre, et pas un de plus :
 * - `h2` : le nom de la section, posé par `Preferences` en tête de chaque page ;
 * - `PrefHeading` (`h3`) : une sous-partie. C'est elle que la navigation de
 *   gauche liste sous la section ouverte (attribut `data-pref-sub`), et vers
 *   laquelle un clic fait défiler. Une sous-partie qui n'est pas rendue (compte
 *   SSO sans mot de passe, bloc réservé à l'admin) disparaît donc d'elle-même
 *   de la navigation : la liste est lue dans la page, pas recopiée à côté ;
 * - `PrefGroupTitle` (`h4`) : un groupe à l'intérieur d'une sous-partie.
 *
 * Les anciens titres en capitales grises de 11 px étaient le texte le plus
 * petit et le plus pâle de la page : la hiérarchie se fait maintenant par la
 * taille, la graisse et l'espace au-dessus des titres.
 */

export function PrefHeading({ children, navLabel, action, tag, id }: {
  children: ReactNode;
  /** Libellé dans la navigation, quand le titre porte plus que son nom (un compteur). */
  navLabel?: string;
  /** Une action discrète alignée à droite du titre (« Tout réafficher »…). */
  action?: ReactNode;
  /** Une courte précision accolée au titre (« Sur ordinateur »). */
  tag?: string;
  id?: string;
}) {
  const heading = (
    <h3
      id={id}
      data-pref-sub=""
      data-pref-label={navLabel}
      tabIndex={-1}
      className="prefs-h3 flex items-baseline gap-2 min-w-0 outline-none"
    >
      <span className="min-w-0" data-pref-title="">{children}</span>
      {tag && <span className="prefs-tag">{tag}</span>}
    </h3>
  );
  if (!action) return heading;
  return (
    <div className="prefs-h3-row flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      {heading}
      <div className="min-w-0">{action}</div>
    </div>
  );
}

export function PrefGroupTitle({ children, id, className = '' }: { children: ReactNode; id?: string; className?: string }) {
  return (
    <h4 id={id} className={`prefs-h4 ${className}`}>
      {children}
    </h4>
  );
}

/** Le texte d'aide d'une sous-partie, sous son titre. */
export function PrefIntro({ children, id }: { children: ReactNode; id?: string }) {
  return <p id={id} className="prefs-intro">{children}</p>;
}

/**
 * Un bloc de réglages : un cadre, des lignes séparées par un filet. Les
 * réglages d'une même sous-partie se lisent ensemble ; l'œil n'a plus à
 * deviner où s'arrête un réglage et où commence le suivant.
 */
export function PrefCard({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`prefs-card ${className}`}>{children}</div>;
}

/**
 * Une ligne de réglage : libellé et aide à gauche, commande à droite. Avec
 * `stacked`, la commande passe sous le texte (contrôles segmentés, champs) :
 * à 320 px, trois choix côte à côte ne tiennent pas à droite d'un libellé.
 */
export function PrefRow({ label, hint, control, stacked, disabled, labelFor, hintId }: {
  label: ReactNode;
  hint?: ReactNode;
  control: ReactNode;
  stacked?: boolean;
  disabled?: boolean;
  /** Relie le libellé à un champ (`<label htmlFor>`). */
  labelFor?: string;
  hintId?: string;
}) {
  const Label = labelFor ? 'label' : 'span';
  const text = (
    <span className="min-w-0 flex-1" style={{ opacity: disabled ? 0.5 : 1 }}>
      <Label htmlFor={labelFor} className="prefs-label block">{label}</Label>
      {hint && <span id={hintId} className="prefs-hint block">{hint}</span>}
    </span>
  );
  if (stacked) {
    return (
      <div className="prefs-row select-none">
        {text}
        <div className="mt-2.5">{control}</div>
      </div>
    );
  }
  return (
    <div className="prefs-row flex items-start justify-between gap-4 select-none">
      {text}
      <span className="flex-shrink-0 mt-0.5">{control}</span>
    </div>
  );
}

/**
 * Choix exclusif en segments. Des boutons simples (rôle radio) : un clic
 * compte toujours, sans la double sélection d'un vrai groupe de radios.
 */
export function Segmented<T extends string>({ label, value, options, onChange, className = '' }: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  className?: string;
}) {
  const id = useId();
  return (
    <div
      id={id}
      className={`flex gap-1 p-0.5 rounded-lg ${className}`}
      role="radiogroup"
      aria-label={label}
      style={{ background: 'var(--panel-header-bg)', border: '1px solid var(--panel-border)' }}
    >
      {options.map((opt) => {
        const selected = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onChange(opt.value)}
            className="flex-1 px-3 py-1.5 text-[13px] font-medium rounded-md transition-colors min-w-0"
            style={{
              background: selected ? 'var(--accent)' : 'transparent',
              color: selected ? 'var(--on-accent)' : 'var(--list-title)',
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
