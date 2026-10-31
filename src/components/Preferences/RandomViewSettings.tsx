import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useUiStore } from '../../stores/uiStore';
import { normalizeRandomCount, type RandomWindowUnit } from '../../lib/randomDraw';

const INPUT_CLASS = 'w-20 px-2 py-1 rounded-md text-xs text-right';
const INPUT_STYLE = { border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)', color: 'var(--list-title)' };

/**
 * Les paramètres du bouton Aléatoire de la liste, communs à toutes les vues. Un
 * champ garde sa saisie en cours (`draft`) : vidé pour retaper un nombre, il
 * n'est pas regarni sous les doigts, et reprend la valeur retenue en sortant.
 */
export default function RandomViewSettings() {
  const { t } = useTranslation();
  const randomCount = useUiStore((s) => s.randomCount);
  const setRandomCount = useUiStore((s) => s.setRandomCount);
  const amount = useUiStore((s) => s.randomWindowAmount);
  const unit = useUiStore((s) => s.randomWindowUnit);
  const setRandomWindow = useUiStore((s) => s.setRandomWindow);
  const [countDraft, setCountDraft] = useState<string | null>(null);
  const [amountDraft, setAmountDraft] = useState<string | null>(null);
  const countId = useId();
  const amountId = useId();

  const changeCount = (value: string) => {
    setCountDraft(value);
    if (value !== '' && normalizeRandomCount(value) === Number(value)) setRandomCount(Number(value));
  };

  const changeAmount = (value: string) => {
    setAmountDraft(value);
    if (value === '') setRandomWindow(0, unit);
    else if (Number.isSafeInteger(Number(value)) && Number(value) > 0) setRandomWindow(Number(value), unit);
  };

  const units: { id: RandomWindowUnit; label: string }[] = [
    { id: 'hours', label: t('preferences.general.randomHours') },
    { id: 'days', label: t('preferences.general.randomDays') },
  ];

  return (
    <div className="select-none mt-4">
      <span className="text-xs block" style={{ color: 'var(--list-summary)' }}>
        {t('preferences.general.randomView')}
        <span className="block text-[11px] opacity-70 mt-0.5">{t('preferences.general.randomViewHint')}</span>
      </span>
      <div className="flex items-center justify-between gap-3 mt-2">
        <label htmlFor={countId} className="text-xs" style={{ color: 'var(--list-title)' }}>
          {t('preferences.general.randomCount')}
        </label>
        <input
          id={countId}
          type="number"
          inputMode="numeric"
          min={1}
          max={500}
          value={countDraft ?? String(randomCount)}
          onChange={(e) => changeCount(e.target.value)}
          onBlur={() => setCountDraft(null)}
          className={INPUT_CLASS}
          style={INPUT_STYLE}
        />
      </div>
      <div className="flex items-center justify-between flex-wrap gap-x-3 gap-y-1.5 mt-2">
        <label htmlFor={amountId} className="text-xs" style={{ color: 'var(--list-title)' }}>
          {t('preferences.general.randomWindow')}
        </label>
        <div className="flex items-center gap-1.5">
          <input
            id={amountId}
            type="number"
            inputMode="numeric"
            min={1}
            placeholder={t('preferences.general.randomWindowAll')}
            value={amountDraft ?? (amount ? String(amount) : '')}
            onChange={(e) => changeAmount(e.target.value)}
            onBlur={() => setAmountDraft(null)}
            className={INPUT_CLASS}
            style={INPUT_STYLE}
          />
          <div
            className="flex gap-1 p-0.5 rounded-lg"
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
                  onClick={() => setRandomWindow(amount, opt.id)}
                  className="px-2.5 py-1 text-xs font-medium rounded-md transition-colors"
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
    </div>
  );
}
