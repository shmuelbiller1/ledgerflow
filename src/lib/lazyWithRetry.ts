import React from 'react';

/**
 * Loads an overlay component dynamically on mount, caching the resolved component
 * on success while leaving failures uncached so reopening or clicking Retry
 * performs a fresh dynamic import instead of getting stuck in a rejected state.
 */
export function createRetryableLazy<P extends object>(
  factory: () => Promise<{ default: React.ComponentType<P> }>
): React.ComponentType<P> {
  let resolved: React.ComponentType<P> | null = null;
  let pending: Promise<React.ComponentType<P>> | null = null;

  const RetryableLazy: React.FC<P> = (props: P) => {
    const [, setTick] = React.useState(0);
    const [loadError, setLoadError] = React.useState<unknown>(null);

    if (loadError !== null) {
      throw loadError;
    }

    React.useEffect(() => {
      if (resolved) return;
      let active = true;
      pending ??= factory()
        .then((mod) => {
          resolved = mod.default;
          pending = null;
          return mod.default;
        })
        .catch((err: unknown) => {
          pending = null;
          throw err;
        });

      void pending.then(
        () => {
          if (active) setTick((n) => n + 1);
        },
        (err: unknown) => {
          if (active) setLoadError(err ?? new Error('Overlay failed to load'));
        }
      );

      return () => {
        active = false;
      };
    }, []);

    return resolved ? React.createElement(resolved, props) : null;
  };

  RetryableLazy.displayName = 'RetryableLazy';
  return RetryableLazy;
}
