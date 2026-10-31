import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { normalizeRandomCount, type RandomWindowUnit } from '../../lib/randomDraw';

const INPUT_CLASS = 'w-20 flex-shrink-0 px-2 py-1.5 rounded-lg text-sm text-right';
const INPUT_STYLE = { border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)', color: 'var(--list-title)' };

/**
 * Une saisie gardée jusqu'à la sortie du champ. À chaque frappe, « 501 » laissait
 * 50 en route, et un champ vidé pour retaper un nombre était regarni sous les
 * doigts. `bad` : `type="number"` rend une valeur vide pour « e » ou « - », qu'il
 * ne faut pas prendre pour un champ vidé. Fermer le panneau ne perd pas la saisie.
 */
function useDraft(commit: (value: string) => void) {
  const [draft, setDraft] = useState<string | null>(null);
  const pending = useRef<{ value: string; bad: boolean } | null>(null);
  const latestCommit = useRef(commit);
  useEffect(() => { latestCommit.current = commit; });

  const flush = () => {
    const entry = pending.current;
    pending.current = null;
    if (entry && !entry.bad) latestCommit.current(entry.value);
  };
  useEffect(() => flush, []);

  return {
    draft,
    onChange: (el: HTMLInputElement) => {
      pending.current = { value: el.value, bad: el.validity.badInput };
      setDraft(el.value);
    },
    onBlur: (el: HTMLInputElement) => {
      // Lu ici : depuis un champ vide, « e » n'émet aucun `onChange`, la valeur
      // restant vide. React compare à `node.value` et n'écrirait rien, et Chrome
      // ignore `''` sur un champ qui vaut déjà `''` : passer par une vraie valeur.
      if (el.validity.badInput) {
        pending.current = null;
        el.value = '0';
        el.value = '';
      }
      flush();
      setDraft(null);
    },
  };
}

/** Les paramètres du bouton Aléatoire de la liste, communs à toutes les vues. */
export default function RandomViewSettings() {
  const { t } = useTranslation();
  const randomCount = useUiStore((s) => s.randomCount);
  const setRandomCount = useUiStore((s) => s.setRandomCount);
  const amount = useUiStore((s) => s.randomWindowAmount);
  const unit = useUiStore((s) => s.randomWindowUnit);
  const setRandomWindow = useUiStore((s) => s.setRandomWindow);
  const countId = useId();
  const amountId = useId();

  const count = useDraft((value) => {
    if (value !== '' && normalizeRandomCount(value) === Number(value)) setRandomCount(Number(value));
  });
  const age = useDraft((value) => {
    const n = Number(value);
    if (Number.isSafeInteger(n) && n >= 0) setRandomWindow(n, useUiStore.getState().randomWindowUnit);
  });

  const units: { id: RandomWindowUnit; label: string }[] = [
    { id: 'hours', label: t('preferences.general.randomHours') },
    { id: 'days', label: t('preferences.general.randomDays') },
  ];

  return (
    <>
      <div className="flex items-start justify-between gap-4 select-none mt-4">
        <span className="text-xs" style={{ color: 'var(--list-summary)' }}>
          <label htmlFor={countId}>{t('preferences.general.randomCount')}</label>
          <span id={`${countId}-hint`} className="block text-[11px] opacity-70 mt-0.5">{t('preferences.general.randomCountHint')}</span>
        </span>
        <input
          id={countId}
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          aria-describedby={`${countId}-hint`}
          value={count.draft ?? String(randomCount)}
          onChange={(e) => count.onChange(e.target)}
          onBlur={(e) => count.onBlur(e.target)}
          className={INPUT_CLASS}
          style={INPUT_STYLE}
        />
      </div>
      <div className="select-none mt-4">
        <span className="text-xs block" style={{ color: 'var(--list-summary)' }}>
          <label htmlFor={amountId}>{t('preferences.general.randomWindow')}</label>
          <span id={`${amountId}-hint`} className="block text-[11px] opacity-70 mt-0.5">{t('preferences.general.randomWindowHint')}</span>
        </span>
        <div className="flex items-center gap-2 mt-2">
          <input
            id={amountId}
            type="number"
            inputMode="numeric"
            min={0}
            aria-describedby={`${amountId}-hint`}
            placeholder={t('preferences.general.randomWindowAll')}
            value={age.draft ?? (amount ? String(amount) : '')}
            onChange={(e) => age.onChange(e.target)}
            onBlur={(e) => age.onBlur(e.target)}
            className={INPUT_CLASS}
            style={INPUT_STYLE}
          />
          <div
            className="flex-1 flex gap-1 p-0.5 rounded-lg"
            role="radiogroup"
            aria-label={t('preferences.general.randomWindowUnit')}
            style={{ background: 'var(--panel-header-bg)', border: '1px solid var(--panel-border)' }}
          >
            {units.map((opt) => {
              const selected = unit === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  onClick={() => setRandomWindow(useUiStore.getState().randomWindowAmount, opt.id)}
                  className="flex-1 px-3 py-1.5 text-sm font-medium rounded-md transition-colors"
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
        </div>
      </div>
    </>
  );
}
