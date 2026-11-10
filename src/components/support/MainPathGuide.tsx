import React from 'react';
import { useUIStore } from '../../stores/useUIStore';
import { MAIN_PATH, MAIN_PATH_FIELDS } from '../../lib/mainPathGuide';

import { BRAND_NAME } from '../../config/brand';
/**
 * Help & Guide → Main path (DA-06): one page per step of the main path, each with the same ten
 * questions answered (src/lib/mainPathGuide.ts) and a button to the screen where it is done.
 */
export default function MainPathGuide() {
  const goToPage = useUIStore(s => s.goToPage);
  return (
    <div className="max-w-4xl mx-auto space-y-6 p-6">
      <p className="text-sm text-[var(--muted)]">The twelve steps of keeping the books, in order. Each says what you do, what {BRAND_NAME} changes, and what still needs you. What works today, with its limits: Help → What&apos;s new and <code>docs/CAPABILITIES.md</code>.</p>
      <nav aria-label="Main path steps">
        <ol className="flex flex-wrap gap-2 text-xs">
          {MAIN_PATH.map(step => <li key={step.id}><a href={`#main-path-${step.id}`} className="underline">{step.title}</a></li>)}
        </ol>
      </nav>
      {MAIN_PATH.map(step => (
        <section key={step.id} id={`main-path-${step.id}`} aria-labelledby={`main-path-${step.id}-title`} className="rounded-xl border border-[var(--line)] bg-[var(--surface)] p-5 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id={`main-path-${step.id}-title`} className="text-lg font-bold text-[var(--text)]">{step.title}</h2>
            <button type="button" onClick={() => goToPage(step.page)} className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold">
              Open this screen<span className="sr-only"> for {step.title}</span>
            </button>
          </div>
          <dl className="grid gap-x-4 gap-y-2 sm:grid-cols-[14rem_1fr] text-sm">
            {MAIN_PATH_FIELDS.map(f => (
              <React.Fragment key={f.key}>
                <dt className="font-semibold text-[var(--muted)]">{f.label}</dt>
                <dd className="text-[var(--text)]">{step[f.key]}</dd>
              </React.Fragment>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
