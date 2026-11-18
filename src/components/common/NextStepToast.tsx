import { toast } from 'sonner';
import type { SavedStep } from '../../lib/nextSteps';

/**
 * The toast after a save: what happened, and the two or three things a person does next — as buttons, not a
 * sentence they have to translate into a hunt through the menu.
 *
 * Sonner's `action` holds one button, and a saved document has more than one next step ("Send it", "Record a
 * payment", "New invoice"), so this draws the toast itself. Each button is a real `<button>`: reachable by Tab,
 * named by its own text, and it closes the toast before it runs, so a slow screen cannot leave a stale offer on
 * screen while the next one opens.
 */
export function showSavedToast(message: string, steps: SavedStep[], run: (action: SavedStep['action']) => void): string | number {
  return toast.custom(id => (
    <div
      role="status"
      aria-label={message}
      className="flex w-full flex-col gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 shadow-lg"
    >
      <p className="text-sm font-medium">{message}</p>
      {steps.length ? (
        <div className="flex flex-wrap gap-2">
          {steps.map(step => (
            <button
              key={step.action}
              type="button"
              className="rounded-md border border-[var(--border)] px-2 py-1 text-sm font-medium hover:bg-[var(--surface-muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
              onClick={() => {
                toast.dismiss(id);
                run(step.action);
              }}
            >
              {step.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  ), { duration: 8000 });
}
