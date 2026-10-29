import { Component, type ReactNode, type ErrorInfo } from 'react';
import i18n from '../i18n';

/**
 * Le texte du repli, dans la langue de l'interface. Par l'instance i18next et
 * non par un hook : la frontière est une classe, et elle doit tenir même si
 * l'erreur vient d'en dessous. Si la traduction elle-même échoue, le français
 * de référence reste.
 */
function say(key: string, fallback: string): string {
  try {
    const out = i18n.t(key);
    return out && out !== key ? out : fallback;
  } catch {
    return fallback;
  }
}

interface ErrorBoundaryProps {
  children: ReactNode;
}
interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

/**
 * Catches render-time errors anywhere in the tree and shows a recoverable
 * fallback instead of a blank white screen. Class component because error
 * boundaries have no hook equivalent.
 */
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[FriRSS] Uncaught error:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        role="alert"
        // La hauteur de la coque : voir `.screen-min-height` dans index.css.
        className="screen-min-height"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.5rem',
          background: 'var(--sidebar-bg, #201f1b)',
          color: 'var(--sidebar-text-active, #e0e0dc)',
          fontFamily: 'system-ui, sans-serif',
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 420 }}>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            {say('app.errorTitle', 'Une erreur est survenue')}
          </h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.8, marginBottom: '1.25rem' }}>
            {say('app.errorBody', 'L’application a rencontré un problème inattendu. Vous pouvez recharger la page.')}
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--accent, #4cd4a1)',
              color: 'var(--on-accent, #1c1c1a)',
              border: 'none',
              padding: '0.6rem 1.2rem',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {say('app.errorReload', 'Recharger')}
          </button>
        </div>
      </div>
    );
  }
}
