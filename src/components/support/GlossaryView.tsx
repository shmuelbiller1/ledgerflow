import { useMemo, useState } from 'react';
import { BookOpen, Search } from 'lucide-react';
import { EmptyState } from '../ui/EmptyState';
import { GLOSSARY_TERMS, searchGlossary, type GlossaryTerm } from '../../lib/accountingGlossary';

import { BRAND_NAME } from '../../config/brand';
/** C-97: one searchable, bilingual, read-only screen. Definitions never calculate tax or post data. */
export default function GlossaryView() {
  const [query, setQuery] = useState('');
  const matches = useMemo(() => searchGlossary(query), [query]);
  const groups = useMemo(() => {
    const byCategory = new Map<string, GlossaryTerm[]>();
    for (const term of matches) {
      const key = `${term.categoryEn}\u0000${term.categoryHe}`;
      const group = byCategory.get(key) || [];
      group.push(term);
      byCategory.set(key, group);
    }
    return [...byCategory.entries()].map(([key, terms]) => {
      const [categoryEn, categoryHe] = key.split('\u0000');
      return { key, categoryEn, categoryHe, terms };
    });
  }, [matches]);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 p-4 text-[var(--text)] sm:p-6" aria-labelledby="glossary-title">
      <header className="space-y-2">
        <h1 id="glossary-title" className="flex items-center gap-2 text-2xl font-bold">
          <BookOpen aria-hidden="true" className="h-6 w-6" /> Accounting glossary
        </h1>
        <p className="text-sm text-[var(--muted)]">
          Plain English and Hebrew explanations of the words used in {BRAND_NAME}. A definition is a
          learning aid: it does not decide a tax rule, change a report or post an entry.
        </p>
        <p lang="he" dir="rtl" className="text-sm text-[var(--muted)]">
          הסברים פשוטים בעברית ובאנגלית למונחים שבהם משתמשת המערכת. ההגדרה נועדה ללמידה בלבד ואינה קובעת כלל מס, משנה דוח או רושמת פקודה.
        </p>
      </header>
      <div className="relative">
        <label htmlFor="glossary-search" className="text-sm font-semibold">Search English or Hebrew</label>
        <div className="relative mt-1">
          <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-3 h-5 w-5 text-[var(--muted)]" />
          <input id="glossary-search" type="search" value={query} onChange={event => setQuery(event.target.value)}
            placeholder="Try “accrual”, “מלאי” or “tax”"
            className="min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--surface)] py-2 pl-10 pr-3 text-sm" />
        </div>
        <p role="status" className="mt-2 text-xs text-[var(--muted)]">
          {matches.length} of {GLOSSARY_TERMS.length} terms shown
        </p>
      </div>
      {matches.length === 0 ? (
        <EmptyState title="No glossary terms match your search"
          description="Try an English or Hebrew word from a report or document, or clear the search to see every term."
          actionLabel="Clear search" onAction={() => setQuery('')} />
      ) : groups.map(group => (
        <section key={group.key} aria-labelledby={`glossary-${group.key.replace(/\W+/g, '-')}`} className="space-y-3">
          <h2 id={`glossary-${group.key.replace(/\W+/g, '-')}`} className="border-b border-[var(--line)] pb-2 text-lg font-bold">
            <span lang="en">{group.categoryEn}</span>
            <span className="mx-2 text-[var(--muted)]" aria-hidden="true">·</span>
            <bdi lang="he" dir="rtl">{group.categoryHe}</bdi>
          </h2>
          <dl className="grid gap-3 sm:grid-cols-2">
            {group.terms.map(term => (
              <div key={term.id} className="min-w-0 rounded-xl border border-[var(--line)] bg-[var(--surface)] p-4">
                <dt className="font-bold">
                  <span lang="en">{term.titleEn}</span>
                  <span className="mx-2 text-[var(--muted)]" aria-hidden="true">·</span>
                  <bdi lang="he" dir="rtl">{term.titleHe}</bdi>
                </dt>
                <dd lang="en" className="mt-2 text-sm text-[var(--muted)]">{term.plainEn}</dd>
                <dd lang="he" dir="rtl" className="mt-1 text-sm text-[var(--muted)]">{term.plainHe}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </main>
  );
}
