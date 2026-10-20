import React, { useRef, useEffect } from 'react';
import { cn } from '../../lib/utils';
import { APP_TABS, isTabVisible } from '../../config/registry';
import { useAuthStore } from '../../stores/useAuthStore';
import { useUIStore } from '../../stores/useUIStore';

interface ModuleSubNavProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function ModuleSubNav({ activeTab, onTabChange }: ModuleSubNavProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  useAuthStore(s => s.user);
  useAuthStore(s => s.userProfile);
  const isOwner = useAuthStore(s => s.isAdmin);
  const isProMode = useUIStore(s => s.isProMode);
  const developerMode = useUIStore(s => s.developerMode);
  // BB-07: a module turned off leaves the menu
  const modules = useAuthStore(s => s.getCurrentWorkspace()?.modules);
  
  useEffect(() => {
    const strip = scrollRef.current;
    if (!strip) return;
    const revealActive = (behavior: ScrollBehavior) => {
      const activeElement = strip.querySelector<HTMLButtonElement>('[data-state="active"]');
      if (activeElement) {
        // scroll the strip only: scrollIntoView would also move the browser's Tab starting point
        // (keyboard users would skip "Skip to content") and could scroll the page
        strip.scrollTo?.({ left: activeElement.offsetLeft - strip.clientWidth / 2 + activeElement.clientWidth / 2, behavior });
      }
    };
    revealActive('smooth');
    // D-95: a phone turned sideways (or a resized window) keeps the current page in view
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => revealActive('auto'));
    observer.observe(strip);
    return () => observer.disconnect();
  }, [activeTab]);

  const currentTabDef = APP_TABS.find(t => t.id === activeTab);
  if (!currentTabDef || !currentTabDef.groupId) return null;
  
  const groupTabs = APP_TABS.filter(t => t.groupId === currentTabDef.groupId && isTabVisible(t, { isOwner, isProMode, developerMode, modules }));
  
  if (groupTabs.length <= 1) return null;

  return (
    <div className="bg-[var(--surface)] border-b border-[var(--line)] px-4 sm:px-6 z-20 shadow-2xs">
      <div 
        ref={scrollRef}
        data-testid="module-navigation"
        role="navigation"
        aria-label="Module pages"
        className="flex overflow-x-auto no-scrollbar items-center gap-1.5 py-2.5"
      >
        {groupTabs.map(tab => {
          const isActive = activeTab === tab.id;
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              data-state={isActive ? 'active' : 'inactive'}
              aria-current={isActive ? 'page' : undefined}
              onClick={() => onTabChange(tab.id)}
              className={cn(
                // D-78/D-95: whole labels (never shrunk into each other), 44px targets, visible focus
                "flex shrink-0 min-h-11 min-w-11 items-center gap-2 px-3.5 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-all cursor-pointer border focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--brass)]",
                isActive 
                  ? "bg-gradient-to-r from-[var(--brass)] via-[#e5be6b] to-[var(--brass)] text-black font-bold border-[var(--brass-line)] shadow-xs" 
                  : "bg-[var(--panel)]/80 text-[var(--muted)] border-[var(--line)] hover:text-[var(--text)] hover:border-[var(--brass-line)]/50 hover:bg-[var(--elevated)]"
              )}
            >
              {Icon && <Icon size={14} aria-hidden="true" className={isActive ? "text-black" : "text-[var(--brass)]"} />}
              <span>{tab.label.en}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

