import React from 'react';
import { MotionConfig } from 'motion/react';
import { useUIStore } from '../stores/useUIStore';

const mediaQuery = '(prefers-reduced-motion: reduce)';
function subscribeToSystemMotion(onChange: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {};
  const query = window.matchMedia(mediaQuery);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function systemMotionSnapshot() {
  return typeof window !== 'undefined' && !!window.matchMedia?.(mediaQuery).matches;
}
function serverMotionSnapshot() { return false; }

/** Respect both the OS preference and Settings → Accessibility, including opacity and springs. */
export function ReducedMotionProvider({ children }: { children: React.ReactNode }) {
  const systemReducedMotion = React.useSyncExternalStore(
    subscribeToSystemMotion, systemMotionSnapshot, serverMotionSnapshot,
  );
  const appReducedMotion = useUIStore(state => state.reduceMotion);
  const reduce = appReducedMotion || systemReducedMotion === true;
  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'never'} skipAnimations={reduce}>
      {children}
    </MotionConfig>
  );
}
