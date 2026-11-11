import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReducedMotionProvider } from './components/ReducedMotionProvider';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { initGlobalErrorTracking } from './lib/errorTracker';
import { initPWAUpdateManager } from './lib/pwaUpdateManager';
import { FallbackBoundary } from './components/FallbackBoundary';
import { reloadOnceForNewVersion } from './lib/chunkReload';

initGlobalErrorTracking();
initPWAUpdateManager(registerSW);
// Vite reports a screen file that could not be loaded (usually a new version went live): reload once
window.addEventListener('vite:preloadError', event => { if (reloadOnceForNewVersion()) event.preventDefault(); });

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* A-265: OS and in-app preferences also skip opacity/spring animations. */}
    <ReducedMotionProvider>
      <FallbackBoundary>
        <App />
      </FallbackBoundary>
    </ReducedMotionProvider>
  </React.StrictMode>
);
