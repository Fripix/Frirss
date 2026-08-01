import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadLanguage, resolveInitialLanguage } from './i18n';
import App from './App';
import ErrorBoundary from './components/ErrorBoundary';
import './styles/index.css';

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>
  );
}

// Preload the initial language (saved choice, else browser language; a no-op
// for FR) so the UI never flashes fallback strings before its chunk arrives.
loadLanguage(resolveInitialLanguage()).finally(render);
