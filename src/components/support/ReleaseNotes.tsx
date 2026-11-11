import React, { useMemo, useState } from 'react';
import {
  CHANGELOG_TAGS,
  type ChangelogTag,
  filterChangelogReleases,
} from '../../lib/changelogEntries';

import { BRAND_NAME } from '../../config/brand';
export default function ReleaseNotes() {
  const [selectedTag, setSelectedTag] = useState<ChangelogTag | 'All'>('All');
  const releases = useMemo(() => filterChangelogReleases(selectedTag), [selectedTag]);

  return (
    <details className="max-w-7xl mx-auto mt-5 rounded-xl border border-[var(--line)] bg-[var(--panel)]">
      <summary className="cursor-pointer rounded-xl px-4 py-3 text-sm font-semibold text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--brass)]">
        What’s new
      </summary>
      <div className="max-h-96 overflow-y-auto border-t border-[var(--line)] p-4 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-bold text-[var(--text)]">Updates to {BRAND_NAME}</h2>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter updates by topic">
            {(['All', ...CHANGELOG_TAGS] as const).map(tag => (
              <button
                key={tag}
                type="button"
                aria-pressed={selectedTag === tag}
                onClick={() => setSelectedTag(tag)}
                className={`min-h-11 px-3 rounded-lg text-xs font-medium border ${
                  selectedTag === tag
                    ? 'bg-[var(--text)] text-[var(--bg)] border-[var(--text)]'
                    : 'bg-[var(--surface)] text-[var(--text)] border-[var(--line)]'
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </div>
        {releases.map(release => (
          <article key={release.id} className="space-y-2">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-xs font-semibold text-[var(--brass)]">{release.weekLabel}</span>
              <time dateTime={release.date} className="text-xs font-medium text-[var(--muted)]">
                {release.displayDate}
              </time>
            </div>
            <h3 className="text-sm font-semibold text-[var(--text)]">{release.title}</h3>
            <ul className="list-disc pl-5 space-y-2 text-sm leading-relaxed text-[var(--text)]">
              {release.items.map(item => (
                <li key={item.text}>
                  <span className="font-semibold text-xs mr-1.5">[{item.tag}]</span>
                  {item.text}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </details>
  );
}
