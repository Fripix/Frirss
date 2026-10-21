import { useState, useRef, useCallback, useId } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import BottomSheet from '../BottomSheet';
import Popover from './Popover';
import TranslateMenu from './TranslateMenu';
import { useUiStore } from '../../stores/uiStore';
import { expandOnFirstSummary } from './aiPanelExpand';
import { AI_LANGUAGES, languageName, sameLanguage, type AiLanguage } from '../../lib/aiLanguages';
import type { AiProviderView, AiSummaryResult } from '../../api/backend';

const ALL_LANGUAGES = [...AI_LANGUAGES];

export interface AiSummaryProps {
  status: 'idle' | 'loading' | 'done' | 'error';
  result: AiSummaryResult | null;
  error: string | null;
  providers: AiProviderView[];
  /** `regenerate` : « Régénérer », le serveur ignore son cache et le remplace. */
  onSummarize: (providerId?: number, opts?: { regenerate?: boolean }) => void;
  disabled?: boolean;
  /** La traduction du résumé affiché ; `providerId` sert à cocher le fournisseur dans le menu. */
  translation: { status: 'idle' | 'loading' | 'done' | 'error'; text: string | null; lang: AiLanguage | null; providerId?: number; providerName?: string; fellBackFrom?: string; error: string | null };
  onTranslate: (choice?: { lang?: AiLanguage; providerId?: number; regenerate?: boolean }) => void;
  onShowSource: () => void;
  /** Langue cible par défaut (réglage, ou langue de l'interface). */
  targetLang: AiLanguage;
}

/**
 * Le panneau « Résumé IA » (spec §11), en tête de la colonne de lecture, sur
 * les trois formats.
 *
 * Structure :
 * - un EN-TÊTE toujours visible, dont toute la partie gauche est un seul
 *   bouton (titre, statut, chevron) qui replie ou déplie le panneau ;
 * - à droite, HORS de ce bouton, l'action : « Résumer » tant qu'il n'y a rien,
 *   puis « Résumer avec… » (popover sur bureau, feuille sur tactile) ;
 * - le CORPS, sur toute la largeur de la colonne : le résumé, les barres
 *   d'attente d'une demande, ou l'erreur.
 *
 * Tant qu'il n'y a RIEN à montrer (`empty` : ni résumé, ni demande en cours,
 * ni erreur), le panneau se réduit à l'en-tête : étincelle, titre, « Pas encore
 * résumé » et l'action à droite. Pas de corps (l'ancienne ligne d'aide a été
 * retirée), pas de chevron, et la partie gauche est un `div` du même gabarit,
 * pas un bouton — il n'y aurait rien à replier. Dès qu'une demande part, qu'un
 * résumé arrive ou qu'une erreur s'affiche, le panneau redevient ce qui suit.
 *
 * Le repli est une mémoire GLOBALE et synchronisée (`aiPanelCollapsed`), pas
 * un état par article : qui replie le panneau le retrouve replié partout (dès
 * qu'il a quelque chose à replier). Un
 * résumé qui arrive panneau replié ne le rouvre pas — le statut dit « Résumé
 * par X ». Seule exception, une fois par appareil : le tout premier « Résumer »
 * lancé panneau replié le déplie, sinon on demanderait un résumé sans jamais
 * le voir.
 *
 * Choix visuels :
 * - la surface est une teinte de l'accent, réglable (`--ai-bg`, `--ai-border`) :
 *   c'est le seul trait qui distingue le texte de la machine de celui de
 *   l'article, tout le reste du panneau reste sobre ;
 * - l'en-tête est sur deux lignes (titre, puis statut en petit) : à 320 px,
 *   une seule ligne aurait réduit le statut à trois lettres. Le statut passe
 *   à la ligne plutôt que d'être tronqué : « X indisponible » doit se lire ;
 * - un seul chevron, celui du repli : « Résumer avec… » n'en porte pas, ses
 *   points de suspension disent déjà qu'un choix suit ;
 * - « Résumer » est la seule action pleine (fond accent) ; « Résumer avec… »
 *   est rare, donc discrète.
 *
 * Traduction du résumé : un bouton scindé, cerclé du filet du panneau —
 * « Traduire » (vers la langue cible) et un chevron qui ouvre « Traduire en… »
 * / « Traduire avec… ». Il n'apparaît que si le résumé n'est pas déjà dans la
 * langue cible. Traduit, le corps montre la traduction, le statut ajoute
 * « traduit en X par Y », et « Traduire » devient « Texte source ». Comme le
 * résumé, une traduction qui arrive panneau replié ne le rouvre pas.
 *
 * « Régénérer » (dernier du menu « Résumer avec… ») et « Retraduire » (dernier
 * du menu de traduction, seulement quand une traduction est affichée)
 * relancent ce qui est affiché — même fournisseur, même langue — en ignorant
 * le cache du serveur, qu'ils remplacent : un appel payé, une unité du
 * plafond, toujours sur un clic. Ce sont des `menuitem` : des actions, pas
 * des choix.
 */
export default function AiSummary({ status, result, error, providers, onSummarize, disabled, translation, onTranslate, onShowSource, targetLang }: AiSummaryProps) {
  const { t, i18n } = useTranslation();
  const touch = useBreakpoint() !== 'desktop';
  const uid = useId();
  const bodyId = `${uid}-body`;
  const collapsed = useUiStore((s) => s.aiPanelCollapsed);
  const setCollapsed = useUiStore((s) => s.setAiPanelCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const [translateMenuOpen, setTranslateMenuOpen] = useState(false);
  const translateAnchor = useRef<HTMLButtonElement>(null);
  const available = providers.filter((p) => p.available);
  const loading = status === 'loading';
  // Le résumé reste affiché pendant une nouvelle demande (« Résumer avec… ») et
  // après un échec : il n'est remplacé que par un autre résumé.
  const done = status !== 'idle' && result ? result : null;
  const failed = status === 'error' && !!error;
  // Une traduction tenue reste à l'écran pendant « Retraduire » (statut
  // `loading`) et après son échec (`error`, l'alerte s'y ajoute) : le volet ne
  // garde le texte que dans ce cas, une traduction ordinaire repart de rien.
  const translated = translation.status !== 'idle' && translation.text !== null && translation.lang !== null
    ? { ...translation, text: translation.text, lang: translation.lang }
    : null;
  const translating = translation.status === 'loading';
  const translateFailed = translation.status === 'error' && !!translation.error;
  // « Texte source » reste atteignable même si la langue cible a changé entre-temps.
  const translatable = !!done && !loading && available.length > 0 && (!!translated || !sameLanguage(done.lang, targetLang));
  const translateMenuShown = translateMenuOpen && translatable && !translating;
  if (translateMenuOpen && !translateMenuShown) setTranslateMenuOpen(false);
  // Une seule alerte à la fois : celle du résumé prime.
  const alertText = failed ? error : translateFailed ? translation.error : null;
  // Rien à montrer : ni résumé, ni demande en cours, ni erreur. Le panneau se
  // réduit alors à son en-tête — pas de corps, pas de chevron, pas de bouton de
  // repli (il n'y aurait rien à replier).
  const empty = !done && !loading && !alertText;

  // « Régénérer » / « Retraduire » relancent chez le fournisseur qui a écrit ce
  // qui est affiché : s'il n'est plus disponible, la résolution du serveur en
  // choisirait un autre (peut-être payant) sans que rien le dise. Pas d'entrée.
  const canRegenerate = !!done && available.some((p) => p.id === done.providerId);
  const canRetranslate = !!translated && available.some((p) => p.id === translated.providerId);

  // Le menu n'existe que tant qu'un résumé est affiché et qu'aucune demande ne
  // tourne : si le statut change, il ne doit pas rester ouvert ni rouvrir.
  const menuShown = menuOpen && !!done && !loading && available.length > 0;
  // Le drapeau lui-même est remis à zéro (ajustement d'état pendant le rendu) :
  // sans cela, le menu rouvrirait tout seul au retour de `done`.
  if (menuOpen && !menuShown) setMenuOpen(false);

  // Stable : le Popover s'abonne au clavier avec cette référence.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuAnchor.current?.focus();
  }, []);
  const closeTranslateMenu = useCallback(() => {
    setTranslateMenuOpen(false);
    translateAnchor.current?.focus();
  }, []);

  const summarize = () => {
    expandOnFirstSummary();
    onSummarize(undefined);
  };

  // Les éléments du statut sont des segments séparés : chacun garde sa
  // couleur, et la ligne passe à la ligne au lieu de pousser l'action dehors.
  const translatedBy = translated ? t('ai.translatedBy', { lang: languageName(translated.lang, i18n.language), name: translated.providerName }) : null;
  const statusParts = done
    ? [
      t('ai.by', { name: done.providerName }), done.fromCache ? t('ai.fromCache') : null, done.fellBackFrom ? t('ai.fellBack', { name: done.fellBackFrom }) : null,
      // Replié, c'est la seule trace d'une traduction en cours ou arrivée.
      translating ? t('ai.translating') : translatedBy,
      translated?.fellBackFrom ? t('ai.fellBack', { name: translated.fellBackFrom }) : null,
    ].filter((x): x is string => !!x)
    // Pendant une demande, « Pas encore résumé » contredirait le bouton qui
    // dit « Résumé en cours… » — et, replié, ce statut est tout ce qu'on voit.
    : [t(loading ? 'ai.summarizing' : 'ai.status.none')];

  const announce = done ? [t('ai.by', { name: done.providerName }), done.fromCache ? t('ai.fromCache') : null, translatedBy].filter(Boolean).join(', ') : '';

  const errorLine = alertText && (
    <p role="alert" className="text-xs leading-snug" style={{ color: 'var(--danger)' }}>{alertText}</p>
  );

  const actionClass = `inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-opacity duration-150 disabled:cursor-default ${touch ? 'min-h-[44px] px-3.5' : 'h-8 px-3'}`;

  const withProvider = done && available.length > 0 && !loading ? (
    <button
      ref={menuAnchor}
      type="button"
      onClick={() => { setTranslateMenuOpen(false); setMenuOpen((o) => !o); }}
      disabled={disabled}
      aria-haspopup={touch ? 'dialog' : 'menu'}
      aria-expanded={menuShown}
      className={`${actionClass} font-medium underline underline-offset-2 hover:opacity-80 disabled:opacity-50`}
      style={{ color: 'var(--reading-meta)' }}
    >
      {t('ai.withProvider')}
    </button>
  ) : null;

  // Bouton scindé : deux boutons accolés, chacun avec son propre anneau de
  // focus (pas d'`overflow-hidden` qui le rognerait).
  const splitBorder = '1px solid var(--ai-border)';
  const translate = translatable ? (
    <div className="inline-flex">
      <button
        type="button"
        onClick={translated ? onShowSource : () => onTranslate(undefined)}
        disabled={translating || (disabled && !translated)}
        aria-busy={translating}
        className={`${actionClass} rounded-r-none hover:opacity-80 disabled:opacity-50`}
        style={{ color: 'var(--reading-title)', border: splitBorder }}
      >
        {translating && <Spinner />}
        <span>{translating ? t('ai.translating') : translated ? t('ai.showSource') : t('ai.translate')}</span>
      </button>
      <button
        ref={translateAnchor}
        type="button"
        onClick={() => { setMenuOpen(false); setTranslateMenuOpen((o) => !o); }}
        disabled={translating || disabled}
        aria-label={t('ai.translateMenu')}
        aria-haspopup={touch ? 'dialog' : 'menu'}
        aria-expanded={translateMenuShown}
        className={`inline-flex items-center justify-center rounded-md rounded-l-none hover:opacity-80 disabled:opacity-50 disabled:cursor-default ${touch ? 'min-h-[44px] min-w-[44px]' : 'h-8 w-7'}`}
        style={{ color: 'var(--reading-meta)', border: splitBorder, borderLeft: 'none' }}
      >
        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
      </button>
    </div>
  ) : null;

  const action = done && !loading ? (
    withProvider || translate ? <>{withProvider}{translate}</> : null
  ) : !done || loading ? (
    <button
      type="button"
      onClick={summarize}
      disabled={disabled || loading}
      aria-busy={loading}
      className={`${actionClass} hover:opacity-90`}
      style={{ background: 'var(--accent)', color: 'var(--on-accent)', opacity: disabled && !loading ? 0.5 : 1 }}
    >
      {loading && <Spinner />}
      <span>{loading ? t('ai.summarizing') : t('ai.summarizeAction')}</span>
    </button>
  ) : null;

  const menuRowClass = `flex items-center w-full text-left rounded-md hover:bg-black/5 ${touch ? 'sheet-row px-4 text-[15px]' : 'px-3 py-1.5 text-xs'}`;
  const menuItems = (
    <>
      {available.map((p) => (
        <button
          key={p.id}
          type="button"
          role={touch ? undefined : 'menuitem'}
          onClick={() => { setMenuOpen(false); onSummarize(p.id); }}
          className={menuRowClass}
          style={{ color: 'var(--list-title)' }}
        >
          <span className="truncate">{p.name}</span>
        </button>
      ))}
      {/* Le menu n'existe qu'avec un résumé affiché : « Régénérer » le relance
          chez le fournisseur qui l'a écrit, sans le cache du serveur. */}
      {done && canRegenerate && (
        <div className="mt-1 pt-1" style={{ borderTop: '1px solid var(--panel-border)' }}>
          <button
            type="button"
            role={touch ? undefined : 'menuitem'}
            onClick={() => { setMenuOpen(false); onSummarize(done.providerId, { regenerate: true }); }}
            className={menuRowClass}
            style={{ color: 'var(--list-title)' }}
          >
            <span className="truncate">{t('ai.regenerate')}</span>
          </button>
        </div>
      )}
    </>
  );

  return (
    <div className="ai-summary mb-5 rounded-lg" style={{ background: 'var(--ai-bg)', border: '1px solid var(--ai-border)' }}>
      {/* L'en-tête passe sur deux rangs quand la place manque (320 px) : l'action
          descend sous le titre, alignée à droite, au lieu d'écraser le statut. */}
      <div className="flex flex-wrap items-center justify-end gap-x-2 pr-2">
        <HeaderLead
          toggle={empty ? null : { onClick: () => setCollapsed(!collapsed), expanded: !collapsed, controls: bodyId }}
          className={`flex grow basis-44 min-w-0 items-center gap-2.5 pl-3.5 pr-1 py-2 text-left rounded-lg ${empty ? '' : 'cursor-pointer'} ${touch ? 'min-h-[44px]' : ''}`}
        >
          <Sparkle />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold leading-tight" style={{ color: 'var(--reading-title)' }}>{t('ai.summarize')}</span>
            {/* Replié, une erreur prend la place du statut : sinon un échec ne laisserait aucune trace. */}
            {collapsed && alertText ? null : (
              <span data-status className="block text-xs leading-snug mt-0.5 break-words">
                {statusParts.map((part, i) => (
                  <span key={i} style={{ color: 'var(--reading-meta)' }}>{i > 0 ? ', ' : ''}<span>{part}</span></span>
                ))}
              </span>
            )}
          </span>
          {!empty && <svg data-chevron className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 motion-reduce:transition-none ${collapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true" style={{ color: 'var(--reading-meta)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>}
        </HeaderLead>
        {action && <div className="py-1 flex flex-wrap items-center justify-end gap-1.5">{action}</div>}
      </div>

      {/* Aligné sur le titre (marge du bouton + étincelle + écart). */}
      {collapsed && alertText && <div className="pl-[42px] pr-3.5 pb-2.5 -mt-1">{errorLine}</div>}

      {/* Le corps reste monté (caché, vide) quand le panneau est replié :
          `aria-controls` ne doit jamais pointer dans le vide. */}
      {!empty && <div id={bodyId} hidden={collapsed} className="px-4 pt-3 pb-3.5" style={{ borderTop: '1px solid var(--ai-border)' }}>
        {!collapsed && (
          <>
            {done ? (
              <section aria-label={t('ai.summaryTitle')}>
                {(translated ? translated.text : done.text).split(/\n{2,}/).map((p, i) => (
                  <p key={i} className="text-[15px] leading-[1.65] mb-2.5 last:mb-0 whitespace-pre-line" style={{ color: 'var(--reading-text)' }}>{p}</p>
                ))}
              </section>
            ) : loading ? (
              <div aria-hidden="true" className="space-y-2 py-1 animate-pulse motion-reduce:animate-none">
                {['100%', '92%', '64%'].map((w) => <div key={w} className="h-2.5 rounded-full" style={{ width: w, background: 'var(--ai-border)' }} />)}
              </div>
            ) : null}
            {alertText && <div className={done ? 'mt-2.5' : ''}>{errorLine}</div>}
          </>
        )}
      </div>}

      {/* Région vivante : une ligne invisible qui n'annonce QUE l'arrivée d'un
          résumé (« Résumé par X, depuis le cache »), panneau replié compris.
          Le corps n'y est pas : déplier ou replier n'annoncerait sinon tout le
          texte. Toujours montée — une région insérée avec son contenu n'est
          pas annoncée de façon fiable — et jamais parente de l'alerte d'erreur. */}
      <div role="status" aria-live="polite" className="sr-only">{done ? announce : ''}</div>

      {menuShown && (touch
        ? <BottomSheet open onClose={closeMenu} title={t('ai.withProvider')}>{menuItems}</BottomSheet>
        : createPortal(<Popover anchor={menuAnchor.current} onClose={closeMenu}>{menuItems}</Popover>, document.body))}

      <TranslateMenu
        open={translateMenuShown} anchor={translateAnchor.current} touch={touch} title={t('ai.translateMenu')}
        languages={ALL_LANGUAGES} providers={providers}
        current={{ lang: translated?.lang ?? targetLang, providerId: translated?.providerId ?? null }}
        onPick={(choice) => { closeTranslateMenu(); onTranslate(choice); }}
        onRetranslate={translated && canRetranslate ? () => { closeTranslateMenu(); onTranslate({ lang: translated.lang, providerId: translated.providerId, regenerate: true }); } : undefined}
        onClose={closeTranslateMenu}
      />
    </div>
  );
}

/** La partie gauche de l'en-tête : un bouton de repli, ou — panneau vide, rien
 *  à replier — un simple `div` du même gabarit. */
function HeaderLead({ toggle, className, children }: { toggle: { onClick: () => void; expanded: boolean; controls: string } | null; className: string; children: React.ReactNode }) {
  return toggle
    ? <button type="button" onClick={toggle.onClick} aria-expanded={toggle.expanded} aria-controls={toggle.controls} className={className}>{children}</button>
    : <div className={className}>{children}</div>;
}

function Spinner() {
  return <svg className="w-4 h-4 animate-spin motion-reduce:animate-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>;
}

function Sparkle() {
  return <svg className="w-[18px] h-[18px] flex-shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" /></svg>;
}
