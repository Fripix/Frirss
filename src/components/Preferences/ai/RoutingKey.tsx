import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toggleLook } from '../../../lib/routingLook';
import { ChipIcon, PanelIcon, SparkleIcon, TranslateIcon, type ToggleState } from './RoutingControls';

/**
 * La clé de « Par flux et catégorie » : ce que chaque colonne fait, puis ce
 * que disent les trois aspects d'un interrupteur. Une vraie `<table>` (le nom
 * est un `<th scope="row">`, sans ligne d'en-tête : trois colonnes dont le
 * sens va de soi) — elle remplace, à toutes les largeurs, les deux phrases
 * d'aide et la légende à icônes de l'étroit.
 *
 * Les icônes sont des interrupteurs « réglé ici » en petit, dessinés par
 * `toggleLook` comme les vrais ; les échantillons d'état aussi. À 320 px les
 * trois colonnes tiennent (icône 32, nom sur une ligne, description qui passe
 * à la ligne sous elle-même). Les interrupteurs la désignent par
 * `aria-describedby` (`id`).
 */
const SQUARE = 'inline-flex items-center justify-center rounded-md flex-shrink-0';
/** Les icônes (16 px) rapetissent à 12 px dans l'échantillon de 20 px. */
const SAMPLE = `${SQUARE} [&_svg]:w-3 [&_svg]:h-3`;
/** Première ligne de 18 px décalée de 3 px : son milieu tombe sur celui de l'icône de 24 px. */
const FIRST_LINE = 'pt-[3px] leading-[18px]';

function Row({ icon, name, children }: { icon: ReactNode; name: string; children: string }) {
  return (
    <tr>
      <td className="w-8 align-top">{icon}</td>
      <th scope="row" className={`align-top text-left font-semibold whitespace-nowrap pr-3 text-[13px] ${FIRST_LINE}`} style={{ color: 'var(--list-title)' }}>
        {name}
      </th>
      <td className={`align-top text-xs ${FIRST_LINE}`} style={{ color: 'var(--list-summary)' }}>{children}</td>
    </tr>
  );
}

function ColumnIcon({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className={SQUARE} style={{ width: 24, height: 24, ...toggleLook('on') }}>{children}</span>;
}

function Sample({ state, label }: { state: ToggleState; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span aria-hidden="true" className={SAMPLE} style={{ width: 20, height: 20, ...toggleLook(state) }}><SparkleIcon /></span>
      {label}
    </span>
  );
}

export default function RoutingKey({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <div
      id={id} data-routing-key className="rounded-lg p-3 text-xs"
      style={{ border: '1px solid var(--panel-border)', background: 'var(--panel-header-bg)' }}
    >
      {/* Les lignes sont espacées de 8 px ; la marge négative reprend celui du haut et du bas, que l'espacement de tableau ajoute aux bords. */}
      <table className="w-full border-separate" style={{ borderSpacing: '0 8px', margin: '-8px 0' }}>
        <tbody>
          <Row icon={<ColumnIcon><SparkleIcon /></ColumnIcon>} name={t('ai.routing.autoSummary')}>{t('ai.routing.keySummary')}</Row>
          <Row icon={<ColumnIcon><TranslateIcon /></ColumnIcon>} name={t('ai.routing.autoTranslate')}>{t('ai.routing.keyTranslate')}</Row>
          <Row icon={<ColumnIcon><PanelIcon /></ColumnIcon>} name={t('ai.routing.keyPanelName')}>{t('ai.routing.keyPanel')}</Row>
          <Row
            icon={<span aria-hidden="true" className={SQUARE} style={{ width: 24, height: 24, color: 'var(--list-title)' }}><ChipIcon /></span>}
            name={t('ai.routing.providerColumn')}
          >
            {t('ai.routing.keyProvider')}
          </Row>
        </tbody>
      </table>
      <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--panel-border)' }}>
        <p data-routing-states className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[13px]" style={{ color: 'var(--list-title)' }}>
          <Sample state="on" label={t('ai.routing.keySet')} />
          <Sample state="inherited" label={t('ai.routing.keyInherited')} />
          <Sample state="off" label={t('ai.routing.keyOff')} />
        </p>
        <p className="mt-2" style={{ color: 'var(--list-summary)' }}>{t('ai.routing.keyPrecedence')}</p>
      </div>
    </div>
  );
}
