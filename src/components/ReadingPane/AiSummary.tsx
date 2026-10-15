import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { clampToViewport } from '../../lib/clampToViewport';
import BottomSheet from '../BottomSheet';
import { useUiStore } from '../../stores/uiStore';
import type { AiProviderView, AiSummaryResult } from '../../api/backend';

export interface AiSummaryProps {
  status: 'idle' | 'loading' | 'done' | 'error';
  result: AiSummaryResult | null;
  error: string | null;
  providers: AiProviderView[];
  onSummarize: (providerId?: number) => void;
  disabled?: boolean;
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
 * - le CORPS, sur toute la largeur de la colonne : le résumé, l'erreur, ou une
 *   ligne d'aide.
 *
 * Le repli est une mémoire GLOBALE et synchronisée (`aiPanelCollapsed`), pas
 * un état par article : qui replie le panneau le retrouve replié partout. Un
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
 */
export default function AiSummary({ status, result, error, providers, onSummarize, disabled }: AiSummaryProps) {
  const { t } = useTranslation();
  const touch = useBreakpoint() !== 'desktop';
  const uid = useId();
  const bodyId = `${uid}-body`;
  const collapsed = useUiStore((s) => s.aiPanelCollapsed);
  const setCollapsed = useUiStore((s) => s.setAiPanelCollapsed);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const available = providers.filter((p) => p.available);
  const loading = status === 'loading';
  // Le résumé reste affiché pendant une nouvelle demande (« Résumer avec… ») et
  // après un échec : il n'est remplacé que par un autre résumé.
  const done = status !== 'idle' && result ? result : null;
  const failed = status === 'error' && !!error;

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

  const summarize = () => {
    const ui = useUiStore.getState();
    if (ui.aiPanelCollapsed && !ui.aiPanelAutoExpanded) {
      ui.setAiPanelCollapsed(false);
      ui.markAiPanelAutoExpanded();
    }
    onSummarize(undefined);
  };

  // Les éléments du statut sont des segments séparés : chacun garde sa
  // couleur, et la ligne passe à la ligne au lieu de pousser l'action dehors.
  const statusParts = done
    ? [t('ai.by', { name: done.providerName }), done.fromCache ? t('ai.fromCache') : null, done.fellBackFrom ? t('ai.fellBack', { name: done.fellBackFrom }) : null].filter((x): x is string => !!x)
    : [t('ai.status.none')];

  const errorLine = failed && (
    <p role="alert" className="text-xs leading-snug" style={{ color: 'var(--danger)' }}>{error}</p>
  );

  const actionClass = `inline-flex items-center justify-center gap-1.5 rounded-md text-xs font-semibold whitespace-nowrap transition-opacity duration-150 disabled:cursor-default ${touch ? 'min-h-[44px] px-3.5' : 'h-8 px-3'}`;

  const action = done && available.length > 0 && !loading ? (
    <button
      ref={menuAnchor}
      type="button"
      onClick={() => setMenuOpen((o) => !o)}
      disabled={disabled}
      aria-haspopup={touch ? 'dialog' : 'menu'}
      aria-expanded={menuShown}
      className={`${actionClass} font-medium underline underline-offset-2 hover:opacity-80 disabled:opacity-50`}
      style={{ color: 'var(--reading-meta)' }}
    >
      {t('ai.withProvider')}
    </button>
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

  const menuItems = available.map((p) => (
    <button
      key={p.id}
      type="button"
      role={touch ? undefined : 'menuitem'}
      onClick={() => { setMenuOpen(false); onSummarize(p.id); }}
      className={`flex items-center w-full text-left rounded-md hover:bg-black/5 ${touch ? 'sheet-row px-4 text-[15px]' : 'px-3 py-1.5 text-xs'}`}
      style={{ color: 'var(--list-title)' }}
    >
      <span className="truncate">{p.name}</span>
    </button>
  ));

  return (
    <div className="ai-summary mb-5 rounded-lg" style={{ background: 'var(--ai-bg)', border: '1px solid var(--ai-border)' }}>
      {/* L'en-tête passe sur deux rangs quand la place manque (320 px) : l'action
          descend sous le titre, alignée à droite, au lieu d'écraser le statut. */}
      <div className="flex flex-wrap items-center justify-end gap-x-2 pr-2">
        <button
          type="button"
          onClick={() => setCollapsed(!collapsed)}
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          className={`flex grow basis-44 min-w-0 items-center gap-2.5 pl-3.5 pr-1 py-2 text-left rounded-lg cursor-pointer ${touch ? 'min-h-[44px]' : ''}`}
        >
          <Sparkle />
          <span className="flex-1 min-w-0">
            <span className="block text-[13px] font-semibold leading-tight" style={{ color: 'var(--reading-title)' }}>{t('ai.summarize')}</span>
            {/* Replié, une erreur prend la place du statut : sinon un échec ne laisserait aucune trace. */}
            {collapsed && failed ? null : (
              <span data-status className="block text-xs leading-snug mt-0.5 break-words">
                {statusParts.map((part, i) => (
                  <span key={i} style={{ color: 'var(--reading-meta)' }}>{i > 0 ? ', ' : ''}<span>{part}</span></span>
                ))}
              </span>
            )}
          </span>
          <svg data-chevron className={`w-4 h-4 flex-shrink-0 transition-transform duration-200 motion-reduce:transition-none ${collapsed ? '' : 'rotate-180'}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true" style={{ color: 'var(--reading-meta)' }}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
        </button>
        {action && <div className="py-1">{action}</div>}
      </div>

      {/* Aligné sur le titre (marge du bouton + étincelle + écart). */}
      {collapsed && failed && <div className="pl-[42px] pr-3.5 pb-2.5 -mt-1">{errorLine}</div>}

      {/* Région vivante toujours montée, même replié : une région insérée avec son
          contenu n'est pas annoncée de façon fiable. */}
      <div role="status" aria-live="polite">
        {!collapsed && (
          <div id={bodyId} className="px-4 pt-3 pb-3.5" style={{ borderTop: '1px solid var(--ai-border)' }}>
            {done ? (
              <section aria-label={t('ai.summaryTitle')}>
                {done.text.split(/\n{2,}/).map((p, i) => (
                  <p key={i} className="text-[15px] leading-[1.65] mb-2.5 last:mb-0 whitespace-pre-line" style={{ color: 'var(--reading-text)' }}>{p}</p>
                ))}
              </section>
            ) : loading ? (
              <div aria-hidden="true" className="space-y-2 py-1 animate-pulse motion-reduce:animate-none">
                {['100%', '92%', '64%'].map((w) => <div key={w} className="h-2.5 rounded-full" style={{ width: w, background: 'var(--ai-border)' }} />)}
              </div>
            ) : !failed ? (
              <p className="text-[13px] leading-snug" style={{ color: 'var(--reading-meta)' }}>{t('ai.hint')}</p>
            ) : null}
            {failed && <div className={done ? 'mt-2.5' : ''}>{errorLine}</div>}
          </div>
        )}
      </div>

      {menuShown && (touch
        ? <BottomSheet open onClose={closeMenu} title={t('ai.withProvider')}>{menuItems}</BottomSheet>
        : createPortal(<Popover anchor={menuAnchor.current} onClose={closeMenu}>{menuItems}</Popover>, document.body))}
    </div>
  );
}

/** Menu ancré sous son déclencheur, ramené dans la fenêtre, fermé par Échap, Tab, clic extérieur ou redimensionnement. */
function Popover({ anchor, onClose, children }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: 0, top: 0 });

  useLayoutEffect(() => {
    const menu = ref.current;
    if (!anchor || !menu) return;
    const r = anchor.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    // Aligné sur le bord droit du déclencheur : il vit à droite de l'en-tête.
    setPos(clampToViewport({
      x: r.right - m.width, y: r.bottom + 4, w: m.width, h: m.height,
      vw: window.innerWidth, vh: window.innerHeight,
    }));
    menu.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
  }, [anchor]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); return; }
      if (e.key === 'Tab') { onClose(); return; }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      const items = Array.from(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[next].focus();
    };
    document.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-[60]" onClick={onClose} aria-hidden="true" />
      <div
        ref={ref}
        role="menu"
        className="fixed z-[61] min-w-[180px] max-w-[min(280px,calc(100vw-16px))] rounded-lg p-1 shadow-xl"
        style={{ top: pos.top, left: pos.left, background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
      >
        {children}
      </div>
    </>
  );
}

function Spinner() {
  return <svg className="w-4 h-4 animate-spin motion-reduce:animate-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182" /></svg>;
}

function Sparkle() {
  return <svg className="w-[18px] h-[18px] flex-shrink-0" style={{ color: 'var(--accent)' }} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" /></svg>;
}
