import type { ReactNode } from 'react';
import type { HowToArticle, ScreenHelpDoc } from '../../lib/helpCenterArticles';
import type { UiLanguage } from '../../lib/i18n/uiLanguage';

function Disclosure({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)] text-start">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold">{title}</summary>
      <div className="space-y-3 px-3 pb-3 text-sm">{children}</div>
    </details>
  );
}

function Steps({ items }: { items: readonly string[] }) {
  return <ol className="list-decimal space-y-1 ps-6">{items.map(step => <li key={step}>{step}</li>)}</ol>;
}

export function ScreenManual({ doc, screenId, lang }: { doc: ScreenHelpDoc; screenId: string; lang: UiLanguage }) {
  const he = lang === 'he';
  const title = he ? doc.titleHe : doc.titleEn;
  const picture = doc.illustration?.screenId === screenId ? doc.illustration : undefined;
  const src = `/help/${doc.slug}.webp`;
  return (
    <Disclosure title={he ? `מדריך: ${title}` : `Guide: ${title}`}>
      <p>{he ? doc.summaryHe : doc.summaryEn}</p>
      <h3 className="font-semibold">{he ? 'מה אפשר לעשות כאן?' : 'What can I do here?'}</h3>
      <Steps items={he ? doc.keyTasksHe : doc.keyTasksEn} />
      {picture && <figure>
        <img src={src} alt={he ? picture.altHe : picture.altEn} width="1012" height="530" loading="lazy"
          className="h-auto w-full rounded border border-[var(--line)]" />
        <figcaption className="text-xs text-[var(--muted)]">
          <a href={src} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center underline">
            {he ? 'הגדלת צילום המסך מהספרים לדוגמה (בלשונית חדשה)' : 'Enlarge sample screenshot (new tab)'}
          </a>
        </figcaption>
      </figure>}
    </Disclosure>
  );
}

export function RelatedArticle({ article, lang }: { article: HowToArticle; lang: UiLanguage }) {
  const he = lang === 'he';
  const note = he ? article.limitNoteHe : article.limitNoteEn;
  return (
    <Disclosure title={he ? article.titleHe : article.titleEn}>
      <p>{he ? article.summaryHe : article.summaryEn}</p>
      <Steps items={he ? article.stepsHe : article.stepsEn} />
      {note && <p className="text-[var(--muted)]">{note}</p>}
    </Disclosure>
  );
}
