import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { loadLanguage } from './i18n';
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

// Preload the saved language (a no-op for FR) so the UI never flashes
// fallback strings before the active locale chunk arrives.
loadLanguage(localStorage.getItem('frirss_language') || 'fr').finally(render);
