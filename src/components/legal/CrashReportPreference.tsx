import React, { useId, useState, useSyncExternalStore } from 'react';
import { isOptionalTelemetryAllowed, setCookieConsent, subscribeCookieConsent } from '../../lib/cookieConsent';

/** A browser privacy preference; no workspace privilege is needed to change it. */
export default function CrashReportPreference() {
  const id = useId();
  const enabled = useSyncExternalStore(subscribeCookieConsent, isOptionalTelemetryAllowed, () => false);
  const [saveFailed, setSaveFailed] = useState(false);

  return (
    <section aria-labelledby={`${id}-title`} className="space-y-2 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4">
      <h3 id={`${id}-title`} className="text-base font-semibold">Crash reports</h3>
      <p id={`${id}-description`} className="text-sm text-[var(--muted)]">
        Send error details to help us fix problems. This choice applies to this browser, not your workspace.
        You can still attach diagnostics to a support ticket if automatic reports are off.
      </p>
      <label className="flex min-h-11 items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={enabled}
          aria-describedby={`${id}-description`}
          onChange={event => setSaveFailed(!setCookieConsent(event.currentTarget.checked ? 'all' : 'essential'))}
        />
        Send automatic crash reports
      </label>
      {saveFailed && <p role="alert" className="text-sm">Your browser couldn't save the choice. Automatic crash reports are off in this tab.</p>}
    </section>
  );
}
