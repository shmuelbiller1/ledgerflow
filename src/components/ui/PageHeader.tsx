import React from 'react';

/**
 * The one header every main screen uses (UX-8): a title, one plain sentence under it, and the
 * screen's own actions on the right (stacked under the title on phones).
 *
 *   <PageHeader icon={<TrendingUp … />} title="Sales" description="Invoices you send …">
 *     <button …>Add invoice</button>
 *   </PageHeader>
 */
export function PageHeader({ icon, title, description, children, className = '' }: {
  icon?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  /** actions shown on the right on desktop, under the title on phones */
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-col md:flex-row md:items-center justify-between gap-4 ${className}`}>
      <div className="min-w-0">
        <h1 className="text-2xl font-bold text-[var(--text)] tracking-tight flex items-center gap-2 leading-tight">
          {icon}
          <span className="min-w-0 break-words">{title}</span>
        </h1>
        {description && <p className="mt-1 text-sm text-[var(--muted)]">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 md:justify-end shrink-0">{children}</div>}
    </div>
  );
}

export default PageHeader;
