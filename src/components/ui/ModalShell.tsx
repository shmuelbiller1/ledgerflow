/**
 * The shell every modal draws around its content: the dimmed backdrop that closes it on a click,
 * and the card that fades and rises in. The card's width, surface and rounding belong to the modal
 * (a statement import is wider than a confirmation), so they are passed in; the keyboard behaviour
 * comes from `useDialog`, whose props go straight onto the outer node.
 */
import React from 'react';
import { motion } from 'motion/react';
import type { useDialog } from '../../hooks/useDialog';

type DialogProps = ReturnType<typeof useDialog>['dialogProps'];

const BACKDROP = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } } as const;
const CARD = {
  initial: { opacity: 0, scale: 0.95, y: 20 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.95, y: 20 },
} as const;

export function ModalShell({ dialogProps, onClose, panelClassName, children, layer = 'z-[250]', backdropClassName }: {
  /** from `useDialog`: role, label, focus trap and Escape */
  dialogProps: DialogProps;
  onClose(): void;
  /** the card: `w-full max-w-…` plus its surface, rounding and padding */
  panelClassName: string;
  children: React.ReactNode;
  /** the stacking layer the modal opens on */
  layer?: string;
  backdropClassName?: string;
}) {
  // `useDialog` types the node as an element; here it is always the card's outer div
  const overlay = dialogProps as unknown as React.ComponentProps<'div'>;
  return (
    <div {...overlay} className={`fixed inset-0 ${layer} flex items-center justify-center p-4`}>
      <motion.div
        {...BACKDROP}
        onClick={onClose}
        className={backdropClassName || 'absolute inset-0 bg-zinc-900/60 backdrop-blur-md'}
      />
      <motion.div {...CARD} className={`relative ${panelClassName}`}>
        {children}
      </motion.div>
    </div>
  );
}
