import React from 'react';
import { MotionConfig, useReducedMotion } from 'motion/react';
import { useUIStore } from '../stores/useUIStore';

/** Respect both the OS preference and Settings → Accessibility, including opacity and springs. */
export function ReducedMotionProvider({ children }: { children: React.ReactNode }) {
  const systemReducedMotion = useReducedMotion();
  const appReducedMotion = useUIStore(state => state.reduceMotion);
  const reduce = appReducedMotion || systemReducedMotion === true;
  return (
    <MotionConfig reducedMotion={reduce ? 'always' : 'never'} skipAnimations={reduce}>
      {children}
    </MotionConfig>
  );
}
