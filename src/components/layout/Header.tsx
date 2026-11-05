// Keep translations reachable for the structural module guard.
import { t as _t } from '../../locales/i18n';
import React from 'react';
import { Menu, Search, Sun, Moon, Compass, ShieldCheck, HelpCircle, Bell, Users } from 'lucide-react';
import QuickCreateMenu from './QuickCreateMenu';
import { PinPageButton } from './PinnedPagesBar';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';
import { unreadCount, useNotificationStore } from '../../stores/useNotificationStore';
import { useNotificationFeed } from '../../hooks/useNotificationFeed';
import { useCollaborators } from '../../hooks/useCollaborators';
import { createRetryableLazy } from '../../lib/lazyWithRetry';
import { LazyOverlayBoundary } from '../ui/LazyOverlayBoundary';

const NotificationDrawer = createRetryableLazy(() => import('./NotificationDrawer'));

import { useRecentRecordTracking } from '../../hooks/useRecentRecordTracking';
import { useCurrentRole } from '../../hooks/useCurrentRole';

interface HeaderProps {
  onLogout?: () => void;
  onLoginPrompt?: () => void;
}

/** Workspace top navigation bar with search, quick create, theme toggle, and notifications. */
const Header = React.memo(function Header({ onLogout, onLoginPrompt }: HeaderProps) {
  const user = useAuthStore(state => state.user);
  const currentWorkspaceId = useAuthStore(state => state.currentWorkspaceId);
  const workspaces = useAuthStore(state => state.workspaces);
  const setSidebarOpen = useUIStore(s => s.setSidebarOpen);
  const setCommandPaletteOpen = useUIStore(s => s.setCommandPaletteOpen);
  const theme = useUIStore(s => s.theme);
  const setTheme = useUIStore(s => s.setTheme);
  const currentRole = useCurrentRole();
  const collaborators = useCollaborators();

  const isDrawerOpen = useNotificationStore(s => s.isDrawerOpen);
  const setDrawerOpen = useNotificationStore(s => s.setDrawerOpen);
  const unread = useNotificationStore(s => unreadCount(s.notifications));
  useNotificationFeed();
  useRecentRecordTracking();
  
  const isDark = theme === 'dark' || (theme === 'system' && typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const toggleTheme = () => {
    const nextTheme = isDark ? 'light' : 'dark';
    setTheme(nextTheme);
    if (typeof document !== 'undefined') {
      if (nextTheme === 'light') {
        document.documentElement.classList.add('light');
      } else {
        document.documentElement.classList.remove('light');
      }
    }
  };

  const currentWorkspace = workspaces.find(w => w.id === currentWorkspaceId);


  useUIStore(s => s.language);
  const isAdmin = useAuthStore(state => state.isAdmin);
  const developerMode = useUIStore(state => state.developerMode);
  const setActiveTab = useUIStore(state => state.setActiveTab);

  return (
    <header className="h-16 bg-[var(--surface)] border-b border-[var(--line)] flex items-center justify-between px-4 sm:px-6 shrink-0 relative z-30 text-[var(--text)]">
      <div className="flex items-center gap-3 flex-1">
        <button aria-label="Open navigation menu"
          onClick={() => setSidebarOpen(true)}
          className="lg:hidden p-2 -ml-2 text-[var(--muted)] hover:text-[var(--text)] transition-colors"
        >
          <Menu aria-hidden="true" size={20} />
        </button>
        
        <div className="hidden lg:flex items-center gap-2 font-mono text-[12px] text-[var(--muted)]">
          <Compass aria-hidden="true" size={15} className="text-[var(--brass)]" />
          <span className="text-[var(--text)] font-semibold">{currentWorkspace?.name || 'Main Ledger'}</span>
          <span className="text-[var(--faint)]">·</span>
          <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
            currentRole === 'owner' ? 'bg-indigo-500/10 text-indigo-500 border border-indigo-500/20' :
            currentRole === 'accountant' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
            currentRole === 'bookkeeper' ? 'bg-amber-500/10 text-amber-500 border border-amber-500/20' :
            'bg-slate-500/10 text-slate-700 dark:text-slate-400 border border-slate-500/20'
          }`} title={`Your current role in this workspace is ${currentRole}`}>
            {currentRole}
          </span>
          {collaborators.length > 0 && (
            <div className="flex items-center gap-1.5 ml-2 pl-2 border-l border-[var(--line)]">
              <Users aria-hidden="true" size={13} className="text-[var(--brass)]" />
              <div className="flex -space-x-1.5">
                {collaborators.slice(0, 3).map(c => (
                  <div 
                    key={c.id} 
                    className="w-5 h-5 rounded-full text-[9px] font-bold flex items-center justify-center text-white ring-1 ring-white" 
                    style={{ backgroundColor: c.color }}
                    title={`${c.name} (${c.email})`}
                  >
                    {c.name.charAt(0).toUpperCase()}
                  </div>
                ))}
              </div>
              <span className="text-[11px] font-mono text-[var(--muted)]">{collaborators.length} active</span>
            </div>
          )}
        </div>
      </div>

      {/* Coordinate Search Command Bar */}
      <div className="flex items-center gap-4 flex-1 justify-center max-w-xl w-full hidden md:flex">
        <button 
          onClick={() => setCommandPaletteOpen(true)}
          className="w-full flex items-center gap-2.5 bg-[var(--panel)] hover:bg-[var(--elevated)] text-[var(--muted)] px-3.5 py-2 rounded-lg text-[13px] border border-[var(--line)] shadow-sm transition-all group"
        >
          <Search aria-hidden="true" size={15} className="text-[var(--faint)] group-hover:text-[var(--brass)] transition-colors" />
          <span className="font-mono text-[12px] text-[var(--faint)] truncate">
            world:realestate property:homes/* amount:&gt;1000
          </span>
          <div className="ml-auto flex items-center gap-1 shrink-0">
            <kbd className="px-1.5 py-0.5 text-[10px] bg-[var(--surface)] border border-[var(--line)] rounded font-mono text-[var(--faint)]">⌘K</kbd>
          </div>
        </button>
      </div>

      <div className="flex items-center gap-3 flex-1 justify-end">
        {/* Help & Guide Button */}
        <button
          onClick={() => setActiveTab('help' as unknown as string)}
          className="p-2 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] rounded-lg transition-colors"
          title="Open Help & Operational Guide"
          aria-label="Open Help & Operational Guide"
        >
          <HelpCircle aria-hidden="true" size={17} />
        </button>

        {/* Notification Bell */}
        <button
          onClick={() => setDrawerOpen(true)}
          className="p-2 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] rounded-lg transition-colors relative cursor-pointer"
          title="Open Notifications"
          aria-label={unread > 0 ? `Open Notifications (${unread} unread)` : 'Open Notifications'}
        >
          <Bell aria-hidden="true" size={17} />
          {unread > 0 && (
            <span className="absolute top-1 right-1 px-1.5 py-0.5 text-[10px] font-bold bg-indigo-600 text-white rounded-full leading-none" aria-hidden="true">
              {unread > 9 ? '9+' : unread}
            </span>
          )}
        </button>

        <PinPageButton />

        {/* Theme Toggle */}
        <button
          onClick={toggleTheme}
          className="p-2 text-[var(--muted)] hover:text-[var(--text)] hover:bg-[var(--elevated)] rounded-lg transition-colors"
          title="Toggle light/dark map view"
         aria-label="Toggle light/dark map view">
          {isDark ? <Sun aria-hidden="true" size={17} /> : <Moon aria-hidden="true" size={17} />}
        </button>

        <QuickCreateMenu />

        {user ? (
          <div className="flex items-center gap-2">
            {isAdmin && developerMode && (
              <button
                onClick={() => setActiveTab('system-command-center' as unknown as string)}
                title="Open Admin Control Panel"
                className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-mono font-bold text-[var(--brass)] bg-[var(--brass-soft)] hover:bg-[var(--brass)] hover:text-black border border-[var(--brass-line)] rounded-md transition-colors cursor-pointer"
              >
                <ShieldCheck aria-hidden="true" size={12} />
                <span>ADMIN PANEL</span>
              </button>
            )}
            <button
              type="button"

              onClick={onLogout}
              title={`Logged in as ${user.email}${isAdmin ? ' (Administrator)' : ''}. Click to Log Out.`}
              className="h-8 w-8 rounded-full bg-[var(--brass-soft)] border border-[var(--brass-line)] flex items-center justify-center text-[var(--brass)] text-[11px] font-mono font-bold cursor-pointer hover:bg-[var(--brass)] hover:text-black transition-colors"
            >
              {user.email?.[0]?.toUpperCase() || 'S'}
            </button>
          </div>
        ) : (
          <button
            onClick={onLoginPrompt || onLogout}
            className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 text-[11px] font-mono font-medium text-amber-800 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-md hover:bg-amber-500/20 transition-all"
            title="Currently in Guest Mode. Click to sign in.">
            <span>Guest</span>{' '}
            <span className="text-[10px] text-amber-900 dark:text-amber-300 underline font-semibold">Sign In</span>
          </button>
        )}
      </div>
      {isDrawerOpen && (
        <LazyOverlayBoundary
          label="Notifications"
          onDismiss={() => setDrawerOpen(false)}
          onRetry={() => setDrawerOpen(true)}
        >
          <NotificationDrawer />
        </LazyOverlayBoundary>
      )}
    </header>
  );
});

export default Header;

