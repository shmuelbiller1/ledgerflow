import React, { Suspense } from 'react';
import { toast } from 'sonner';
import { reportClientError } from '../../lib/errorTracker';

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
 * Checks whether a caught overlay exception originated from a failed dynamic chunk fetch
 * rather than an in-component runtime bug.
 */
function isChunkLoadFailure(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return /Failed to fetch dynamically imported module|Importing a module script failed|ChunkLoadError|Overlay failed to load|error loading dynamically imported module/i.test(
    message
  );
}

/**
 * Contains dynamic-import and render failures for non-route overlays (CommandPalette,
 * ShortcutOverlay, DiagnosticConsole, NotificationDrawer, LegalModal) so an overlay error
 * never reaches App's root FallbackBoundary or unmounts active workspace drafts.
 */
export class LazyOverlayBoundary extends React.Component<LazyOverlayBoundaryProps, LazyOverlayBoundaryState> {
  public state: LazyOverlayBoundaryState = { hasError: false };

  /** Marks the boundary as failed so the broken overlay unmounts cleanly. */
  public static getDerivedStateFromError(): LazyOverlayBoundaryState {
    return { hasError: true };
  }

  /** Reports the error to telemetry, dismisses the closed overlay, and surfaces an appropriate toast. */
  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    const { label, onDismiss, onRetry } = this.props;
    console.error(`[LazyOverlayBoundary] ${label} failed:`, error, errorInfo);
    void reportClientError(error, {
      severity: 'warning',
      componentStack: errorInfo.componentStack || undefined,
    }).catch(() => {});

    onDismiss?.();
    const loadFailure = isChunkLoadFailure(error);
    toast.error(loadFailure ? `${label} could not load.` : `${label} encountered an unexpected error and closed.`, {
      id: `lazy-overlay-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      description: loadFailure
        ? 'Your open work is safe. Check your connection or try again.'
        : 'Your open work is safe.',
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

  /** Renders the overlay inside Suspense until an error occurs. */
  public render(): React.ReactNode {
    if (this.state.hasError) {
      return null;
    }
    return <Suspense fallback={null}>{this.props.children}</Suspense>;
  }
}
