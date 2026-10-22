import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toggleLook } from '../../../lib/routingLook';
import { ChipIcon, PanelIcon, SparkleIcon, TranslateIcon, type ToggleState } from './RoutingControls';

/**
 * La clé de « Par flux et catégorie » : un seul tableau de sept lignes — ce
 * que fait chaque colonne (quatre), puis ce que dit chaque aspect d'un
 * interrupteur (trois) — et la phrase de priorité dessous. Une vraie `<table>`
 * (le nom est un `<th scope="row">`, sans ligne d'en-tête : trois colonnes
 * dont le sens va de soi) ; elle remplace, à toutes les largeurs, les deux
 * phrases d'aide et la légende à icônes de l'étroit.
 *
 * Lisible sans peser (retours du propriétaire, 2026-10-22 : un fond teinté
 * était « presque un peu trop envahissant », puis la version sans fond, en
 * 12 px gris, « moins claire / visible / lisible ») : cadre au filet, sans
 * fond ; texte 13 px ; noms en gras couleur de titre dans une colonne fixe
 * (`w-28`, les descriptions s'alignent) ; descriptions couleur de titre à
 * 75 %, plus foncées que le gris des résumés ; un filet entre les lignes,
 * double entre les colonnes et les états. Les icônes (22 px) et les
 * échantillons passent par `toggleLook`, le code même des interrupteurs : la
 * clé ne peut pas dériver de ce qu'elle explique. Les interrupteurs la
 * désignent par `aria-describedby` (`id`).
 *
 * À 320 px (≈ 279 px de conteneur, 253 dans le cadre) : icône 32, nom 112,
 * reste ≈ 109 px pour la description, qui passe à la ligne sous elle-même ;
 * un nom long (« Налаштовано тут ») passe à la ligne dans sa colonne plutôt
 * que de l'élargir.
 */
const SQUARE = 'inline-flex items-center justify-center rounded-md flex-shrink-0';
const ICON_SIZE = { width: 22, height: 22 };
/** Cellules à 8 px de haut et de bas ; la première ligne de texte (20 px) a son milieu sur celui de l'icône de 22 px. */
const CELL = 'py-2 align-top';
const FIRST_LINE = 'block pt-px leading-5';

type Rule = 'none' | 'thin' | 'thick';
const RULE: Record<Rule, string> = { none: '', thin: 'border-t', thick: 'border-t-2' };

function Row({ icon, name, rule, children }: { icon: ReactNode; name: string; rule: Rule; children: string }) {
  const border = { borderColor: 'var(--panel-border)' };
  return (
    <tr>
      <td className={`w-8 ${CELL} ${RULE[rule]}`} style={border}>{icon}</td>
      <th scope="row" className={`w-28 ${CELL} ${RULE[rule]} text-left font-semibold pr-3`} style={{ ...border, color: 'var(--list-title)' }}>
        <span className={FIRST_LINE}>{name}</span>
      </th>
      <td className={`${CELL} ${RULE[rule]}`} style={{ ...border, color: 'var(--list-title)', opacity: 0.75 }}>
        <span className={FIRST_LINE}>{children}</span>
      </td>
    </tr>
  );
}

/** Une icône de colonne, ou l'échantillon d'un état : un interrupteur en petit, icône à 13 px. */
function Square({ state, children }: { state: ToggleState; children: ReactNode }) {
  return (
    <span aria-hidden="true" className={`${SQUARE} [&_svg]:w-[13px] [&_svg]:h-[13px]`} style={{ ...ICON_SIZE, ...toggleLook(state) }}>
      {children}
    </span>
  );
}

export default function RoutingKey({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <div id={id} data-routing-key className="rounded-lg px-3" style={{ border: '1px solid var(--panel-border)' }}>
      <table className="w-full border-collapse text-[13px]">
        <tbody>
          <Row rule="none" icon={<Square state="on"><SparkleIcon /></Square>} name={t('ai.routing.autoSummary')}>{t('ai.routing.keySummary')}</Row>
          <Row rule="thin" icon={<Square state="on"><TranslateIcon /></Square>} name={t('ai.routing.autoTranslate')}>{t('ai.routing.keyTranslate')}</Row>
          <Row rule="thin" icon={<Square state="on"><PanelIcon /></Square>} name={t('ai.routing.keyPanelName')}>{t('ai.routing.keyPanel')}</Row>
          <Row
            rule="thin"
            icon={<span aria-hidden="true" className={`${SQUARE} [&_svg]:w-[13px] [&_svg]:h-[13px]`} style={{ ...ICON_SIZE, color: 'var(--list-title)' }}><ChipIcon /></span>}
            name={t('ai.routing.providerColumn')}
          >
            {t('ai.routing.keyProvider')}
          </Row>
          <Row rule="thick" icon={<Square state="on"><SparkleIcon /></Square>} name={t('ai.routing.keySet')}>{t('ai.routing.keySetText')}</Row>
          <Row rule="thin" icon={<Square state="inherited"><SparkleIcon /></Square>} name={t('ai.routing.keyInherited')}>{t('ai.routing.keyInheritedText')}</Row>
          <Row rule="thin" icon={<Square state="off"><SparkleIcon /></Square>} name={t('ai.routing.keyOff')}>{t('ai.routing.keyOffText')}</Row>
        </tbody>
      </table>
      <p className="text-xs py-2" style={{ color: 'var(--list-summary)', borderTop: '1px solid var(--panel-border)' }}>
        {t('ai.routing.keyPrecedence')}
      </p>
    </div>
  );
}
