import React, { Suspense } from 'react';
import { toast } from 'sonner';

interface LazyOverlayBoundaryProps {
  label: string;
  onDismiss?: () => void;
  onRetry?: () => void;
  children?: React.ReactNode;
}

interface LazyOverlayBoundaryState {
  hasError: boolean;
}

/**
 * Contains dynamic-import failures for non-route overlays (CommandPalette, ShortcutOverlay,
 * DiagnosticConsole, NotificationDrawer, LegalModal) so a chunk fetch failure never reaches
 * App's root FallbackBoundary or unmounts active workspace drafts.
 */
export class LazyOverlayBoundary extends React.Component<LazyOverlayBoundaryProps, LazyOverlayBoundaryState> {
  public state: LazyOverlayBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): LazyOverlayBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(): void {
    const { label, onDismiss, onRetry } = this.props;
    onDismiss?.();
    toast.error(`${label} could not load.`, {
      id: `lazy-overlay-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      description: 'Your open work is safe. Check your connection or try again.',
      ...(onRetry
        ? {
            action: {
              label: 'Retry',
              onClick: () => onRetry(),
            },
          }
        : {}),
    });
  }

  public render(): React.ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return <Suspense fallback={null}>{this.props.children}</Suspense>;
  }
}
