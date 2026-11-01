import React from 'react';
import ReactDOM from 'react-dom/client';
import { MotionConfig } from 'motion/react';
import App from './App';
import './index.css';
import { registerSW } from 'virtual:pwa-register';
import { initGlobalErrorTracking } from './lib/errorTracker';
import { initPWAUpdateManager } from './lib/pwaUpdateManager';
import { FallbackBoundary } from './components/FallbackBoundary';

initGlobalErrorTracking();
initPWAUpdateManager(registerSW);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {/* E-28: animations follow the system "reduce motion" setting */}
    <MotionConfig reducedMotion="user">
      <FallbackBoundary>
        <App />
      </FallbackBoundary>
    </MotionConfig>
  </React.StrictMode>
);
