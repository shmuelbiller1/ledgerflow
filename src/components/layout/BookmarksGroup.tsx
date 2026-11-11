import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { APP_TABS, isTabVisible, REPORT_TABS_REGISTRY, SETTINGS_TABS_REGISTRY } from '../../config/registry';
import { pageLabel } from '../../config/pageLabels';
import { currentPage } from '../../lib/pinnedPages';
import { bookmarkKey, bookmarkStorageKey, MAX_BOOKMARKS, parseBookmarks, reorderBookmark, validBookmark } from '../../lib/bookmarks';
import type { Bookmark } from '../../lib/bookmarks';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
const registry = { tabs: APP_TABS.map(t => t.id), reports: REPORT_TABS_REGISTRY.map(t => t.id), settings: SETTINGS_TABS_REGISTRY.map(t => t.id) };
export default function BookmarksGroup({ expanded }: { expanded: boolean }) {
  const uid = useAuthStore(s => s.user?.uid || 'guest'), workspaceId = useAuthStore(s => s.currentWorkspaceId || 'none');
  return <ScopedBookmarks key={bookmarkStorageKey(uid, workspaceId)} uid={uid} workspaceId={workspaceId} expanded={expanded} />;
}
function ScopedBookmarks({ uid, workspaceId, expanded }: { uid: string; workspaceId: string; expanded: boolean }) {
  const storageKey = bookmarkStorageKey(uid, workspaceId);
  const [pages, setPages] = useState(() => { try { return parseBookmarks(localStorage.getItem(storageKey), registry); } catch { return []; } });
  const [error, setError] = useState(''), [notice, setNotice] = useState('');
  const activeTab = useUIStore(s => s.activeTab), activeReportTab = useUIStore(s => s.activeReportTab), activeSettingsTab = useUIStore(s => s.activeSettingsTab);
  const isAdmin = useAuthStore(s => s.isAdmin), developerMode = useUIStore(s => s.developerMode);
  const modules = useAuthStore(s => s.getCurrentWorkspace()?.modules);
  const page = validBookmark(currentPage({ activeTab, activeReportTab, activeSettingsTab }), registry);
  const starred = page && pages.some(p => bookmarkKey(p) === bookmarkKey(page));
  const current = () => (useAuthStore.getState().user?.uid || 'guest') === uid && (useAuthStore.getState().currentWorkspaceId || 'none') === workspaceId;
  const canOpen = (target: Bookmark) => { const tab = APP_TABS.find(t => t.id === target.tab); return Boolean(tab && isTabVisible(tab, { isOwner: isAdmin, isProMode: false, developerMode, modules, showAll: true })); };
  function save(next: Bookmark[]) {
    if (!current()) return;
    setPages(next); setError('');
    try { localStorage.setItem(storageKey, JSON.stringify({ version: 1, pages: next })); }
    catch { setError('Browser storage is unavailable. Bookmark changes last until this page reloads.'); }
  }
  function open(target: Bookmark) {
    if (!current() || !canOpen(target)) return;
    if (target.tab === 'reports' && target.sub) {
      const url = new URL(window.location.href);
      url.searchParams.set('report', target.sub);
      window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
    }
    const state = useUIStore.getState();
    state.goToPage(target);
    if (window.innerWidth < 1024 && state.isSidebarOpen) state.toggleSidebar();
  }
  function move(key: string, delta: -1 | 1, button: HTMLButtonElement, name: string) {
    if (!current()) return;
    save(reorderBookmark(pages, key, delta)); setNotice(`${name} moved ${delta === -1 ? 'up' : 'down'}`);
    requestAnimationFrame(() => {
      if (!current() || !button.isConnected) return;
      if (button.disabled) button.closest('li')?.querySelector<HTMLButtonElement>('button')?.focus();
      else button.focus();
    });
  }
  function toggle() {
    if (!page) return;
    if (starred) save(pages.filter(p => bookmarkKey(p) !== bookmarkKey(page)));
    else if (pages.length < MAX_BOOKMARKS) save([...pages, page]);
    else setError(`Up to ${MAX_BOOKMARKS} bookmarks. Remove one first.`);
  }
  const label = page ? pageLabel(page, 'en') : '';
  return <section aria-label="Bookmarks" className="min-w-0 space-y-1">
    {expanded && <h2 className="text-xs font-bold">Bookmarks</h2>}
    <button type="button" disabled={!page} aria-label={expanded ? `${starred ? 'Bookmarked' : 'Bookmark this page'}: ${label}` : `${starred ? 'Remove bookmark for' : 'Bookmark'} ${label}`} aria-pressed={Boolean(starred)} onClick={toggle} className="min-h-11 w-full flex items-center gap-2 rounded-lg border border-[var(--line)] px-1 text-[var(--text)]" title={label}><Star size={16} aria-hidden="true" fill={starred ? 'currentColor' : 'none'} />{expanded && <span className="text-xs truncate">{starred ? 'Bookmarked' : 'Bookmark this page'}</span>}</button>
    {expanded && pages.length === 0 && <p className="text-xs text-[var(--muted)]">Star a page to return here.</p>}
    {expanded && <ol className="space-y-1">{pages.filter(canOpen).map(page => { const key = bookmarkKey(page), name = pageLabel(page, 'en'), index = pages.findIndex(p => bookmarkKey(p) === key); return <li key={key} className="min-w-0">
      <button type="button" onClick={() => open(page)} className="min-h-11 w-full text-left text-xs break-words underline" aria-label={`Open bookmark ${name}`}>{name}</button>
      <div className="flex gap-1"><button type="button" disabled={index === 0} onClick={event => move(key, -1, event.currentTarget, name)} aria-label={`Move ${name} up`} className="min-h-11 min-w-11 border rounded">↑</button><button type="button" disabled={index === pages.length - 1} onClick={event => move(key, 1, event.currentTarget, name)} aria-label={`Move ${name} down`} className="min-h-11 min-w-11 border rounded">↓</button><button type="button" onClick={() => save(pages.filter(p => bookmarkKey(p) !== key))} aria-label={`Remove bookmark ${name}`} className="min-h-11 min-w-11 border rounded">×</button></div>
    </li>; })}</ol>}
    {error && <p role="alert" className="text-xs break-words">{error}</p>}<p role="status" className="sr-only">{notice}</p>
  </section>;
}
