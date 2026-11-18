import { Pin, PinOff } from 'lucide-react';
import { toast } from 'sonner';
import { useUIStore } from '../../stores/useUIStore';
import { pageLabel } from '../../config/pageLabels';
import { currentPage, MAX_PINNED, pageKey } from '../../lib/pinnedPages';
import { isMacPlatform, shortcutLabel } from '../../config/shortcuts';
import { cn } from '../../lib/utils';

/** Pin or unpin the page being shown (header). Alt+P does the same. */
export function PinPageButton() {
  const activeTab = useUIStore(s => s.activeTab);
  const activeReportTab = useUIStore(s => s.activeReportTab);
  const activeSettingsTab = useUIStore(s => s.activeSettingsTab);
  const page = currentPage({ activeTab, activeReportTab, activeSettingsTab });
  const pinned = useUIStore(s => s.pinnedPages);
  const toggle = useUIStore(s => s.togglePinnedPage);
  const isPinned = pinned.some(p => pageKey(p) === pageKey(page));
  const mac = isMacPlatform();
  const onClick = () => {
    if (!isPinned && pinned.length >= MAX_PINNED) {
      toast.info(`Up to ${MAX_PINNED} pages can be pinned. Unpin one first.`);
      return;
    }
    toggle(page);
  };
  return (
    <button type="button" onClick={onClick} aria-pressed={isPinned}
      aria-label={isPinned ? 'Unpin this page' : 'Pin this page'}
      title={`${isPinned ? 'Unpin' : 'Pin'} this page (${shortcutLabel('alt+p', mac)})`}
      className={cn('p-2 rounded-lg transition-colors hover:bg-[var(--elevated)]', isPinned ? 'text-[var(--brass)]' : 'text-[var(--muted)] hover:text-[var(--text)]')}>
      {isPinned ? <PinOff aria-hidden="true" size={17} /> : <Pin aria-hidden="true" size={17} />}
    </button>
  );
}

/**
 * The pinned pages, under the header on every page (I-21): one click, or Alt+1 … Alt+9, away.
 * Nothing is shown until a page is pinned.
 */
export default function PinnedPagesBar() {
  const pinned = useUIStore(s => s.pinnedPages);
  const here = useUIStore(s => pageKey(currentPage(s)));
  const goToPage = useUIStore(s => s.goToPage);
  const toggle = useUIStore(s => s.togglePinnedPage);
  const language = useUIStore(s => s.language) || 'en';
  const mac = isMacPlatform();
  if (pinned.length === 0) return null;
  return (
    <nav aria-label="Pinned pages" className="flex items-center gap-1.5 px-4 sm:px-6 py-1.5 border-b border-[var(--line)] bg-[var(--surface)] overflow-x-auto">
      <Pin aria-hidden="true" size={12} className="text-[var(--brass)] shrink-0" />
      {pinned.map((page, i) => {
        const label = pageLabel(page, language);
        const active = pageKey(page) === here;
        return (
          <span key={pageKey(page)} className={cn('group inline-flex items-center rounded-md border text-xs shrink-0',
            active ? 'border-[var(--brass-line)] bg-[var(--brass-soft)] text-[var(--text)]' : 'border-[var(--line)] text-[var(--muted)] hover:text-[var(--text)]')}>
            <button type="button" onClick={() => goToPage(page)} aria-current={active ? 'page' : undefined}
              title={`${label} (${shortcutLabel(`alt+${i + 1}`, mac)})`} className="px-2 py-1 flex items-center gap-1.5">
              <kbd className="font-mono text-[10px] text-[var(--faint)]">{i + 1}</kbd>
              <span className="whitespace-nowrap">{label}</span>
            </button>
            <button type="button" onClick={() => toggle(page)} aria-label={`Unpin ${label}`} className="pe-1.5 ps-0.5 py-1 opacity-60 hover:opacity-100">
              <PinOff aria-hidden="true" size={11} />
            </button>
          </span>
        );
      })}
    </nav>
  );
}
