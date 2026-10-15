import { useState, useRef, useEffect, useLayoutEffect, useCallback, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useBreakpoint } from '../../hooks/useBreakpoint';
import { clampToViewport } from '../../lib/clampToViewport';
import BottomSheet from '../BottomSheet';
import type { AiProviderView, AiSummaryResult } from '../../api/backend';

export interface AiSummaryProps {
  status: 'idle' | 'loading' | 'done' | 'error';
  result: AiSummaryResult | null;
  error: string | null;
  providers: AiProviderView[];
  onSummarize: (providerId?: number) => void;
  onHide: () => void;
  disabled?: boolean;
}

/**
 * La pastille « Résumé IA » et le bloc qui s'ouvre dessous (spec §11).
 * Un seul emplacement sur les trois formats ; les actions rares (« Résumer
 * avec… ») n'apparaissent qu'une fois un résumé produit.
 *
 * Choix visuels :
 * - la pastille se distingue des autres boutons d'action par un seul trait —
 *   un contour accent, là où ses voisines n'ont ni bordure ni fond au repos ;
 *   le texte reste fin (pas de plein accent) pour ne pas crier. Ouverte, elle
 *   prend le même état « actif » que les voisines (verre accent), pas un
 *   aplat plus fort ;
 * - le bloc est une surface neutre (fond du panneau, filet) : aucune teinte, le
 *   texte est de la lecture et se lit comme tel, en corps 15 px / 1,65 sur une
 *   mesure bornée à 68 caractères ;
 * - le menu « Résumer avec… » est une action rare : texte discret, aligné à
 *   droite de l'en-tête ; il s'ouvre en popover (bureau) ou en feuille (tactile).
 */
export default function AiSummary({ status, result, error, providers, onSummarize, onHide, disabled }: AiSummaryProps) {
  const { t } = useTranslation();
  const touch = useBreakpoint() !== 'desktop';
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLButtonElement>(null);
  const available = providers.filter((p) => p.available);
  const done = status === 'done' && result ? result : null;
  const loading = status === 'loading';

  // Le menu n'existe que tant qu'un résumé est affiché : si le statut quitte
  // `done` (nouvelle demande, erreur), il ne doit pas rester ouvert ni rouvrir.
  const menuShown = menuOpen && !!done && available.length > 0;
  // Le drapeau lui-même est remis à zéro (ajustement d'état pendant le rendu) :
  // sans cela, le menu rouvrirait tout seul au retour de `done`.
  if (menuOpen && !menuShown) setMenuOpen(false);

  // Stable : le Popover s'abonne au clavier avec cette référence.
  const closeMenu = useCallback(() => {
    setMenuOpen(false);
    menuAnchor.current?.focus();
  }, []);

  const chip = (
    <button
      type="button"
      onClick={() => (done ? onHide() : onSummarize(undefined))}
      disabled={disabled || loading}
      title={t('ai.summarize')}
      aria-label={t('ai.summarize')}
      aria-pressed={!!done}
      aria-busy={loading}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold transition-colors duration-200 disabled:cursor-default ${touch ? 'min-h-[44px] px-4' : ''}`}
      style={{
        color: 'var(--accent)',
        background: done ? 'var(--accent-glow)' : 'transparent',
        border: `1.5px solid color-mix(in srgb, var(--accent) ${done ? 55 : 35}%, transparent)`,
        opacity: disabled && !loading ? 0.5 : 1,
      }}
    >
      {loading ? <Spinner /> : <Sparkle />}
      <span>{loading ? t('ai.summarizing') : t('ai.summarize')}</span>
    </button>
  );

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
    <div className="mb-4">
      <div className="flex flex-wrap items-center gap-2">{chip}</div>

      {status === 'error' && error && (
        <p role="alert" className="mt-2 text-xs leading-snug" style={{ color: 'var(--danger)' }}>{error}</p>
      )}

      {/* Région vivante toujours montée : une région insérée avec son contenu
          n'est pas annoncée de façon fiable. La pastille est désactivée pendant
          le chargement, c'est donc le seul retour que reçoit un lecteur d'écran. */}
      <div role="status" aria-live="polite">
        {done && (
          <section
            aria-label={t('ai.summaryTitle')}
            className="mt-3 rounded-lg px-4 py-3"
            style={{ background: 'var(--panel-bg)', border: '1px solid var(--panel-border)' }}
          >
            <header className="mb-2.5" style={{ color: 'var(--reading-meta)' }}>
              <div className="flex items-center gap-x-3 text-xs">
                <span className="font-medium">{t('ai.by', { name: done.providerName })}</span>
                {done.fromCache && <span className="opacity-80">{t('ai.fromCache')}</span>}
                {available.length > 0 && (
                  <button
                    ref={menuAnchor}
                    type="button"
                    onClick={() => setMenuOpen((o) => !o)}
                    aria-haspopup={touch ? 'dialog' : 'menu'}
                    aria-expanded={menuShown}
                    className={`ml-auto inline-flex items-center gap-1 rounded-md px-1.5 -mr-1.5 underline underline-offset-2 hover:opacity-80 ${touch ? 'min-h-[44px]' : 'py-0.5'}`}
                  >
                    {t('ai.withProvider')}
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                  </button>
                )}
              </div>
              {done.fellBackFrom && (
                <p className="mt-1 text-xs" style={{ color: 'var(--reading-meta)' }}>{t('ai.fellBack', { name: done.fellBackFrom })}</p>
              )}
            </header>
            <div className="max-w-[68ch]">
              {done.text.split(/\n{2,}/).map((p, i) => (
                <p key={i} className="text-[15px] leading-[1.65] mb-2.5 last:mb-0" style={{ color: 'var(--reading-text)' }}>{p}</p>
              ))}
            </div>
          </section>
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
  return <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5} aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.456 2.456L21.75 6l-1.035.259a3.375 3.375 0 00-2.456 2.456z" /></svg>;
}
