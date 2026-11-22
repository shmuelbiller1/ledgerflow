import './lib/guestNetworkBootstrap';
import React from 'react';
import ReactDOM from 'react-dom/client';
import { ReducedMotionProvider } from './components/ReducedMotionProvider';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { initGlobalErrorTracking } from './lib/errorTracker';
import { initPWAUpdateManager } from './lib/pwaUpdateManager';
import { FallbackBoundary } from './components/FallbackBoundary';
import { reloadForNewVersionUnlessUnsaved } from './lib/chunkReload';
import { applyRobotsDirective } from './lib/privacyRobots';

// AF6-20261120-02: a token in the path (/i/, /c/, /e/, /invite/) is a credential — those pages are
// set to noindex before anything renders, so a link forwarded into a public place is not indexed.
applyRobotsDirective(window.location.pathname);
initGlobalErrorTracking();
initPWAUpdateManager(registerSW);
// Vite reports a screen file that could not be loaded (usually a new version went live): reload once,
// unless there is unsaved work on screen (then the screen's own error message shows and the work stays)
window.addEventListener('vite:preloadError', event => { if (reloadForNewVersionUnlessUnsaved()) event.preventDefault(); });

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
