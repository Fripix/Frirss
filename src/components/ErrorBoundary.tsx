import { Component, type ReactNode, type ErrorInfo } from 'react';

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
        style={{
          minHeight: '100vh',
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
            Une erreur est survenue
          </h1>
          <p style={{ fontSize: '0.875rem', opacity: 0.8, marginBottom: '1.25rem' }}>
            L'application a rencontré un problème inattendu. Vous pouvez recharger la page.
          </p>
          <button
            onClick={() => window.location.reload()}
            style={{
              background: 'var(--accent, #4cd4a1)',
              color: '#fff',
              border: 'none',
              padding: '0.6rem 1.2rem',
              borderRadius: 8,
              fontSize: '0.875rem',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Recharger
          </button>
        </div>
      </div>
    );
  }
}
