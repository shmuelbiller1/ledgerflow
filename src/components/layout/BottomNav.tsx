import React from "react";
import { Home, Inbox, BarChart3, Menu } from "lucide-react";
import QuickCreateMenu from "./QuickCreateMenu";
import { cn } from "../../lib/utils";
import { useUIStore } from "../../stores/useUIStore";

interface BottomNavProps {
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

/** Stable daily actions: these must not depend on the sidebar's changing group names. */
export default function BottomNav({ activeTab, onTabChange }: BottomNavProps) {
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);
  const actions = [
    {
      label: "Home",
      icon: Home,
      tab: "dashboard",
      run: () => onTabChange("dashboard"),
    },
    {
      label: "To review",
      icon: Inbox,
      tab: "inbox",
      run: () => onTabChange("inbox"),
    },
    {
      label: "Reports",
      icon: BarChart3,
      tab: "reports",
      run: () => onTabChange("reports"),
    },
    { label: "More", icon: Menu, run: () => setSidebarOpen(true) },
  ];

  return (
    <nav
      aria-label="Phone navigation"
      className="lg:hidden fixed bottom-0 inset-x-0 h-[calc(64px+env(safe-area-inset-bottom))] bg-[var(--surface)] border-t border-[var(--line)] flex items-center justify-around z-[45] px-2 pb-[env(safe-area-inset-bottom)]"
    >
      {actions.map(({ label, icon: Icon, tab, run }, index) => (
        <React.Fragment key={label}>
          {index === 2 && <QuickCreateMenu phone />}
          <button
            type="button"
            aria-label={label}
            aria-current={tab === activeTab ? "page" : undefined}
            onClick={run}
            className={cn(
              "flex flex-col items-center justify-center flex-1 min-w-[44px] h-16 gap-1 rounded-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-[var(--text)]",
              tab === activeTab
                ? "text-[var(--text)] font-semibold bg-[var(--brass-soft)] shadow-[inset_0_3px_0_var(--brass)]"
                : "text-[var(--muted)]",
            )}
          >
            <Icon
              aria-hidden="true"
              size={22}
              strokeWidth={tab === activeTab ? 2.5 : 2}
            />
            <span className="text-[11px]">{label}</span>
          </button>
        </React.Fragment>
      ))}
    </nav>
  );
}
