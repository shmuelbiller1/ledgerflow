import { toast } from 'sonner';

/**
 * Starts work the screen does not wait for (a click handler, an effect). A failure the work did not handle itself is
 * shown and logged instead of vanishing as an unhandled rejection (Sonar S9383).
 */
export function inBackground(work: PromiseLike<unknown> | undefined, failure = 'That did not go through. Please try again.'): void {
  if (!work) return;
  Promise.resolve(work).catch((error: unknown) => {
    console.error('[inBackground]', error);
    toast.error(failure);
  });
}
