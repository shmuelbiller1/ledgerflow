/**
 * Prompt 2, part 3 — **one way to act**: `runCommand` made the request; this is the half a screen uses.
 *
 * A screen names a command from the generated manifest (`src/lib/commands.generated.ts`), says where
 * the record lives, and gets back a run function plus what just happened: whether it is still saving,
 * the plain sentence to show if it was refused, and the next step the command itself offers.
 *
 * What it does *not* do: it does not compute money, decide a posting, or invent a next step. The
 * refusal text and its `next` sentence come from the manifest the server generated, so a screen can
 * never disagree with the server about why something was refused.
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { COMMAND_MANIFEST, type RegisteredCommandName } from '../lib/commands.generated';
import { runCommand, commandErrorMessage, ServerCommandError } from '../lib/runCommand';

/** The manifest entry for one command, narrowed so a mistyped name is a compile error. */
export type CommandEntry = (typeof COMMAND_MANIFEST)[number];

/** A step the command itself offers after it succeeds. */
export interface OfferedStep {
  /** a registered command name, so the caller can run it with `useCommand` */
  command: string;
  /** already a person's words, e.g. "Record a payment" */
  label: string;
}

export interface CommandRefusal {
  /** The server's code (INVALID_INPUT, CONFLICT, …), when it gave one. */
  code?: string;
  /** What to show the person: the command's own refusal sentence, or the server's words. */
  message: string;
  /** The next step the command offers for this refusal — the thing a dead end never tells you. */
  next?: string;
}

export interface UseCommandResult<T> {
  run: (input: Record<string, unknown>) => Promise<T | null>;
  /** True while the command is in flight; a second press does nothing. */
  saving: boolean;
  /** The last refusal, in the words the command itself offers. */
  refusal: CommandRefusal | null;
  /** The last success's answer, for a screen that wants to redraw from it. */
  result: T | null;
  reset: () => void;
  /** What this command usually leads to, as commands the caller can look up and run. */
  next: OfferedStep[];
}

/** Find the manifest entry, so `runPath` is never typed by hand and a bad name fails loudly. */
function entryFor(name: RegisteredCommandName | string): CommandEntry {
  const found = COMMAND_MANIFEST.find(command => command.name === name);
  if (!found) throw new Error(`"${name}" is not a registered command.`);
  return found as CommandEntry;
}

/**
 * The manifest's own sentence for a refusal code: "what it means, and what to do next". A screen that
 * shows only "That did not work" leaves the person stuck; this is where the alternative comes from.
 */
function refusalSentence(entry: CommandEntry, code: string | undefined): string | undefined {
  if (!code) return undefined;
  // the manifest carries them under `description.refusals`, the same list the server serves
  const refusals = (entry.description as { refusals?: ReadonlyArray<{ code?: string; when?: string; next?: string }> }).refusals;
  if (!Array.isArray(refusals)) return undefined;
  return refusals.find(refusal => refusal?.code === code)?.next;
}

export function useCommand<T = Record<string, unknown>>(name: RegisteredCommandName | string): UseCommandResult<T> {
  const entry = useMemo(() => entryFor(name), [name]);
  const [saving, setSaving] = useState(false);
  // A ref, not the state value: two presses in the same tick both read `saving === false` from the
  // closure and both send. The ref is set before the first await, so the second press sees it.
  const inFlight = useRef(false);
  const [refusal, setRefusal] = useState<CommandRefusal | null>(null);
  const [result, setResult] = useState<T | null>(null);

  const reset = useCallback(() => { setRefusal(null); setResult(null); }, []);

  const run = useCallback(async (input: Record<string, unknown>): Promise<T | null> => {
    // One press at a time: a double click on "Save & Close" must not send the command twice, and the
    // server's idempotency key would only protect the retry, not the second intent.
    if (inFlight.current) return null;
    inFlight.current = true;
    setSaving(true);
    setRefusal(null);
    try {
      const answer = await runCommand<T>({ path: entry.runPath, method: 'POST', body: { input } });
      setResult(answer);
      return answer;
    } catch (error) {
      const served = error instanceof ServerCommandError;
      // A failure that never reached the route is not the command refusing: the browser's own
      // "Failed to fetch" tells a person nothing about what to do, so it gets its own sentence.
      if (!served) {
        setRefusal({
          message: 'The app could not reach the server. Check the connection, then try again.',
          next: 'Nothing was saved. Try again once you are back online.',
        });
        return null;
      }
      const code = typeof (error.body as { code?: string } | undefined)?.code === 'string'
        ? (error.body as { code: string }).code
        : undefined;
      setRefusal({
        code,
        message: commandErrorMessage(error),
        // the command's own offered next step for this refusal code
        next: refusalSentence(entry, code),
      });
      return null;
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }, [entry]);

  // What this command usually leads to, as command names the caller can look up and run. Empty when
  // the command declares none — offering a step nobody declared would be inventing a workflow.
  const next: OfferedStep[] = useMemo(
    () => (((entry.description as { next?: Array<{ command: string; label: string }> }).next) || [])
      .map(step => ({ command: step.command, label: step.label })),
    [entry],
  );

  return { run, saving, refusal, result, reset, next };
}
