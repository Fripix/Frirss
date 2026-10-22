import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { toggleLook } from '../../../lib/routingLook';
import { ChipIcon, PanelIcon, SparkleIcon, SummaryTranslateIcon, TranslateIcon, type ToggleState } from './RoutingControls';

/**
 * La clé de « Par flux et catégorie », en deux parties dans un même cadre.
 *
 * 1. **Ce que fait chaque colonne** : une vraie `<table>` de cinq lignes
 *    (icône, nom en `<th scope="row">`, description), un filet entre les
 *    lignes. Les icônes y sont **neutres** — couleur de titre, sans fond ni
 *    contour — parce que la couleur a un sens dans la matrice : elle dit l'état.
 * 2. **Ce que montre chaque bouton** : une bande à part (fond d'en-tête de
 *    panneau, filet au-dessus), avec les trois états dans l'ordre du clic —
 *    Désactivé, Activé, Hérité — chacun avec son échantillon dessiné par
 *    `toggleLook`, le code même des interrupteurs (deux pour Hérité : cerclé
 *    vert, cerclé gris), puis la phrase du cycle et celle de priorité.
 *
 * Retour du propriétaire (2026-10-23) : mêler colonnes et états dans un seul
 * tableau de sept lignes n'était « pas du tout clair », et « Réglé ici » /
 * « Éteint » ne disaient rien. Trois colonnes en large, une colonne à 320 px
 * (requête de conteneur sur le cadre, qui vit hors de `.ai-routing`). Les
 * interrupteurs désignent le cadre par `aria-describedby` (`id`).
 */
const ICON = 'inline-flex items-center justify-center flex-shrink-0 [&_svg]:w-[15px] [&_svg]:h-[15px]';
/** Cellules à 8 px de haut et de bas ; la première ligne de texte (20 px) a son milieu sur celui de l'icône de 22 px. */
const CELL = 'py-2 align-top';
const FIRST_LINE = 'block pt-px leading-5';

function Row({ icon, name, first, children }: { icon: ReactNode; name: string; first?: boolean; children: string }) {
  const rule = first ? '' : 'border-t';
  const border = { borderColor: 'var(--panel-border)' };
  return (
    <tr>
      <td className={`w-8 ${CELL} ${rule}`} style={border}>
        <span aria-hidden="true" className={ICON} style={{ width: 22, height: 22, color: 'var(--list-title)' }}>{icon}</span>
      </td>
      <th scope="row" className={`w-28 ${CELL} ${rule} text-left font-semibold pr-3`} style={{ ...border, color: 'var(--list-title)' }}>
        <span className={FIRST_LINE}>{name}</span>
      </th>
      <td className={`${CELL} ${rule}`} style={{ ...border, color: 'var(--list-title)', opacity: 0.75 }}>
        <span className={FIRST_LINE}>{children}</span>
      </td>
    </tr>
  );
}

/** Un échantillon d'interrupteur, en petit (24 px). */
function Sample({ state }: { state: ToggleState }) {
  return (
    <span
      aria-hidden="true" data-sample
      className="inline-flex items-center justify-center rounded-md flex-shrink-0 [&_svg]:w-[13px] [&_svg]:h-[13px]"
      style={{ width: 24, height: 24, ...toggleLook(state) }}
    >
      <SparkleIcon />
    </span>
  );
}

/** Un état d'interrupteur : son ou ses échantillons, le nom, ce qu'il veut dire. */
function State({ state, samples, name, children }: { state: ToggleState; samples: ToggleState[]; name: string; children: string }) {
  return (
    <li data-routing-state={state} className="flex items-start gap-2.5 min-w-0">
      <span className="flex gap-1 flex-shrink-0">{samples.map((s) => <Sample key={s} state={s} />)}</span>
      <div className="min-w-0">
        <strong className="block font-semibold leading-6" style={{ color: 'var(--list-title)' }}>{name}</strong>
        <p className="leading-snug" style={{ color: 'var(--list-title)', opacity: 0.75 }}>{children}</p>
      </div>
    </li>
  );
}

export default function RoutingKey({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <div id={id} data-routing-key className="ai-routing__key rounded-lg overflow-hidden text-[13px]" style={{ border: '1px solid var(--panel-border)' }}>
      <div className="px-3">
        <table className="w-full border-collapse text-[13px]">
          <tbody>
            <Row first icon={<SparkleIcon />} name={t('ai.routing.autoSummary')}>{t('ai.routing.keySummary')}</Row>
            <Row icon={<TranslateIcon />} name={t('ai.routing.autoTranslate')}>{t('ai.routing.keyTranslate')}</Row>
            <Row icon={<SummaryTranslateIcon />} name={t('ai.routing.summaryTranslate')}>{t('ai.routing.keySummaryTranslate')}</Row>
            <Row icon={<PanelIcon />} name={t('ai.routing.keyPanelName')}>{t('ai.routing.keyPanel')}</Row>
            <Row icon={<ChipIcon />} name={t('ai.routing.providerColumn')}>{t('ai.routing.keyProvider')}</Row>
          </tbody>
        </table>
      </div>
      <div
        data-routing-states
        className="ai-routing__states px-3 pt-2.5 pb-3"
        style={{ background: 'var(--panel-header-bg)', borderTop: '1px solid var(--panel-border)' }}
      >
        <p data-routing-states-title className="text-xs font-semibold mb-2" style={{ color: 'var(--list-summary)' }}>
          {t('ai.routing.keyStatesTitle')}
        </p>
        <ul className="ai-routing__states-list">
          <State state="off" samples={['off']} name={t('ai.routing.keyOff')}>{t('ai.routing.keyOffText')}</State>
          <State state="on" samples={['on']} name={t('ai.routing.keySet')}>{t('ai.routing.keySetText')}</State>
          <State state="inherited" samples={['inherited', 'inheritedOff']} name={t('ai.routing.keyInherited')}>{t('ai.routing.keyInheritedText')}</State>
        </ul>
        <p className="text-xs mt-3 pt-2" style={{ color: 'var(--list-summary)', borderTop: '1px solid var(--panel-border)' }}>
          {t('ai.routing.keyCycle')}
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--list-summary)' }}>
          {t('ai.routing.keyPrecedence')}
        </p>
      </div>
    </div>
  );
}
