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
 * Les icônes sont des interrupteurs « réglé ici » en petit (20 px), dessinés
 * par `toggleLook` comme les vrais ; les échantillons d'état aussi. À 320 px
 * les trois colonnes tiennent (icône 28, nom sur une ligne, description qui
 * passe à la ligne sous elle-même). Les interrupteurs la désignent par
 * `aria-describedby` (`id`).
 */
const SQUARE = 'inline-flex items-center justify-center rounded-md flex-shrink-0';
/** Les icônes (16 px) rapetissent à 12 px dans l'échantillon de 20 px. */
const SAMPLE = `${SQUARE} [&_svg]:w-3 [&_svg]:h-3`;
/** Les icônes de colonne, comme les échantillons, à 12 px dans un carré de 20. */
const ICON = `${SQUARE} [&_svg]:w-3 [&_svg]:h-3`;
/**
 * Une ligne par colonne, séparée de la suivante par un filet : la clé se lit
 * comme un petit tableau, sans fond ni gros carrés qui lui donneraient plus de
 * poids que la matrice qu'elle explique (retour du propriétaire, 2026-10-22 :
 * « presque un peu trop envahissant », « des séparateurs entre les lignes »).
 * Cellules à 6 px de haut et de bas ; la première ligne de texte (16 px) a son
 * milieu sur celui de l'icône de 20 px.
 */
const CELL = 'py-1.5 align-top';
const FIRST_LINE = 'pt-[2px] leading-4';

function Row({ icon, name, children }: { icon: ReactNode; name: string; children: string }) {
  return (
    <tr className="[&+tr>*]:border-t" style={{ borderColor: 'var(--panel-border)' }}>
      <td className={`w-7 ${CELL}`} style={{ borderColor: 'inherit' }}>{icon}</td>
      <th scope="row" className={`${CELL} text-left font-semibold whitespace-nowrap pr-3`} style={{ color: 'var(--list-title)', borderColor: 'inherit' }}>
        <span className={`block ${FIRST_LINE}`}>{name}</span>
      </th>
      <td className={CELL} style={{ color: 'var(--list-summary)', borderColor: 'inherit' }}>
        <span className={`block ${FIRST_LINE}`}>{children}</span>
      </td>
    </tr>
  );
}

function ColumnIcon({ children }: { children: ReactNode }) {
  return <span aria-hidden="true" className={ICON} style={{ width: 20, height: 20, ...toggleLook('on') }}>{children}</span>;
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
      id={id} data-routing-key className="rounded-lg px-3 py-1.5 text-xs"
      style={{ border: '1px solid var(--panel-border)' }}
    >
      <table className="w-full border-collapse">
        <tbody>
          <Row icon={<ColumnIcon><SparkleIcon /></ColumnIcon>} name={t('ai.routing.autoSummary')}>{t('ai.routing.keySummary')}</Row>
          <Row icon={<ColumnIcon><TranslateIcon /></ColumnIcon>} name={t('ai.routing.autoTranslate')}>{t('ai.routing.keyTranslate')}</Row>
          <Row icon={<ColumnIcon><PanelIcon /></ColumnIcon>} name={t('ai.routing.keyPanelName')}>{t('ai.routing.keyPanel')}</Row>
          <Row
            icon={<span aria-hidden="true" className={ICON} style={{ width: 20, height: 20, color: 'var(--list-title)' }}><ChipIcon /></span>}
            name={t('ai.routing.providerColumn')}
          >
            {t('ai.routing.keyProvider')}
          </Row>
        </tbody>
      </table>
      <div className="py-2" style={{ borderTop: '1px solid var(--panel-border)' }}>
        <p data-routing-states className="flex flex-wrap items-center gap-x-4 gap-y-1.5" style={{ color: 'var(--list-title)' }}>
          <Sample state="on" label={t('ai.routing.keySet')} />
          <Sample state="inherited" label={t('ai.routing.keyInherited')} />
          <Sample state="off" label={t('ai.routing.keyOff')} />
        </p>
        <p className="mt-1.5" style={{ color: 'var(--list-summary)' }}>{t('ai.routing.keyPrecedence')}</p>
      </div>
    </div>
  );
}
