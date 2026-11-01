import { toast } from 'sonner';

/**
 * Starts work the screen does not wait for (a click handler, an effect). A failure the work did not handle itself is
 * shown and logged instead of vanishing as an unhandled rejection (Sonar S9383).
 */
/** Marks an error whose message the user has already been shown (handleFirestoreError), so it is not shown twice. */
export function markReported<T extends Error>(error: T): T {
  Object.defineProperty(error, 'reportedToUser', { value: true });
  return error;
}
const alreadyReported = (error: unknown) => !!(error && typeof error === 'object' && (error as { reportedToUser?: boolean }).reportedToUser);

export function inBackground(work: PromiseLike<unknown> | undefined, failure = 'That did not go through. Please try again.'): void {
  if (!work) return;
  Promise.resolve(work).catch((error: unknown) => {
    console.error('[inBackground]', error);
    if (!alreadyReported(error)) toast.error(failure);
  });
}
