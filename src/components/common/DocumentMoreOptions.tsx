import React, { useState } from "react";
import { useAuthStore } from "../../stores/useAuthStore";

interface Props {
  kind: "invoice" | "bill";
  documentKey: string;
  hasValues: boolean;
  children: React.ReactNode;
}

function savedChoice(key: string): boolean {
  try {
    return localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function Options({
  preferenceKey,
  hasValues,
  children,
}: Omit<Props, "kind" | "documentKey"> & { preferenceKey: string }) {
  const [state, setState] = useState(() => ({
    hasValues,
    expanded: hasValues || savedChoice(preferenceKey),
  }));
  if (state.hasValues !== hasValues) {
    // A customer/default or pre-filled document can bring optional values in after mounting.
    setState({ hasValues, expanded: hasValues || state.expanded });
  }
  return (
    <details
      open={state.expanded}
      onToggle={(event) => {
        const expanded = event.currentTarget.open;
        setState((previous) =>
          previous.expanded === expanded ? previous : { ...previous, expanded },
        );
      }}
      onInvalidCapture={(event) => {
        // Reveal before native validation tries to focus an invalid field in the closed section.
        event.currentTarget.open = true;
        setState((previous) => ({ ...previous, expanded: true }));
      }}
      className="rounded-xl border border-[var(--line)] bg-[var(--surface)]"
    >
      <summary
        className="min-h-11 cursor-pointer px-4 py-3 text-sm font-semibold text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--text)] rounded-xl"
        onClick={(event) => {
          event.preventDefault();
          const expanded = !state.expanded;
          setState((previous) => ({ ...previous, expanded }));
          // Save display preference only, never the document, and never another person's choice.
          try {
            localStorage.setItem(preferenceKey, String(expanded));
          } catch {
            /* Storage is optional. */
          }
        }}
      >
        More options
      </summary>
      <div className="space-y-6 border-t border-[var(--line)] p-4">
        {children}
      </div>
    </details>
  );
}

/** Every field stays mounted; collapsing changes presentation, not the saved document. */
export default function DocumentMoreOptions({
  kind,
  documentKey,
  ...props
}: Props) {
  const person = useAuthStore((s) => s.user?.uid || "guest");
  const preferenceKey = `lf_document_more_options:${encodeURIComponent(person)}:${kind}`;
  return (
    <Options
      key={`${preferenceKey}:${documentKey}`}
      preferenceKey={preferenceKey}
      {...props}
    />
  );
}
