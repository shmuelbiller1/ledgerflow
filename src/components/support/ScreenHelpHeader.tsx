import React, { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useUIStore } from "../../stores/useUIStore";
import { useDialog } from "../../hooks/useDialog";
import {
  currentScreenHelp,
  type ScreenHelpEntry,
} from "../../lib/screenHelpIndex";
import {
  articlesForScreen,
  findScreenHelpDoc,
} from "../../lib/helpCenterArticles";

export function ScreenHelpDialog({
  entry,
  activeTab = "dashboard",
  onClose,
}: {
  entry: ScreenHelpEntry;
  activeTab?: string;
  onClose: () => void;
}) {
  const { dialogProps, titleId } = useDialog(onClose);
  const [lang, setLang] = useState<"en" | "he">("en");
  const screenDoc = useMemo(() => findScreenHelpDoc(activeTab), [activeTab]);
  const related = useMemo(() => articlesForScreen(activeTab).slice(0, 3), [activeTab]);

  return createPortal(
    <div {...dialogProps} className="fixed inset-0 z-[180] bg-black/50 p-3 flex items-center justify-center">
      <div
        className="w-full max-w-xl max-h-[85dvh] overflow-y-auto p-5 space-y-4 rounded-xl border bg-[var(--panel)] text-[var(--text)]"
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {lang === "he" ? `עזרה: ${entry.labelHe}` : `Help for ${entry.label}`}
        </h2>
        {/* A-201: the screen's own description in Hebrew; the general page summary only when it has none */}
        <p dir={lang === "he" ? "rtl" : "ltr"} lang={lang}>
          {lang === "he" ? entry.helpHe || screenDoc.summaryHe : entry.help}
        </p>
        <p className="text-sm text-[var(--muted)]" dir={lang === "he" ? "rtl" : "ltr"}>
          {lang === "he"
            ? "אפשר לערוך נתונים משויכים במגירה הצדית שבה היא מוצעת. השתמשו בכפתור ההצמדה בכותרת כדי לשמור דף בהישג יד במעבר למסך אחר."
            : "Related metadata can be edited in the shared side drawer where offered. Use the existing header pin control to keep a page handy while visiting another screen."}
        </p>

        {/* Close help MUST stay first interactive element and Open Help & Guide MUST stay last for focus wrap */}
        <div className="space-y-3 pt-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <button
              type="button"
              className="min-h-11 px-4 border rounded"
              onClick={onClose}
            >
              Close help
            </button>
            <div className="inline-flex rounded border border-[var(--line)] overflow-hidden" role="group" aria-label="Help language">
              <button
                type="button"
                aria-pressed={lang === "en"}
                onClick={() => setLang("en")}
                className={`min-h-11 px-3 text-xs font-medium ${lang === "en" ? "bg-[var(--text)] text-[var(--bg)]" : "bg-[var(--surface)] text-[var(--text)]"}`}
              >
                English
              </button>
              <button
                type="button"
                aria-pressed={lang === "he"}
                onClick={() => setLang("he")}
                className={`min-h-11 px-3 text-xs font-medium ${lang === "he" ? "bg-[var(--text)] text-[var(--bg)]" : "bg-[var(--surface)] text-[var(--text)]"}`}
              >
                עברית
              </button>
            </div>
          </div>

          <div className="space-y-1.5 border-t border-[var(--line)] pt-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {lang === "he" ? "מדריכים קשורים" : `Related how-to guides (${screenDoc.docPath})`}
            </div>
            {related.map(article => (
              <button
                key={article.id}
                type="button"
                dir={lang === "he" ? "rtl" : "ltr"}
                onClick={() => {
                  onClose();
                  useUIStore.getState().goToPage({ tab: "help" });
                }}
                className="w-full text-left min-h-11 px-3 py-2 border border-[var(--line)] rounded-lg bg-[var(--surface)] text-xs font-medium"
              >
                <bdi>{lang === "he" ? article.titleHe : article.titleEn}</bdi>
              </button>
            ))}
          </div>

          <div className="pt-1">
            <button
              type="button"
              className="min-h-11 px-4 border rounded"
              onClick={() => {
                onClose();
                useUIStore.getState().goToPage({ tab: "help" });
              }}
            >
              Open Help &amp; Guide
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function HelpControl({
  entry,
  activeTab,
}: {
  entry: ScreenHelpEntry;
  activeTab: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-end gap-3 px-4 py-1 border-b border-[var(--line)] bg-[var(--surface)]">
      <span className="text-sm text-[var(--muted)]">{entry.label}</span>
      <button
        type="button"
        className="shrink-0 min-h-11 min-w-11 px-3 border rounded-lg"
        aria-label={`Help for ${entry.label}`}
        onClick={() => setOpen(true)}
      >
        ? Help
      </button>
      {open && (
        <ScreenHelpDialog
          entry={entry}
          activeTab={activeTab}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

export default function ScreenHelpHeader({ activeTab }: { activeTab: string }) {
  const report = useUIStore((state) => state.activeReportTab),
    setting = useUIStore((state) => state.activeSettingsTab),
    intelligence = useUIStore((state) => state.activeIntelChannel);
  const entry = currentScreenHelp(activeTab, report, setting, intelligence);
  return entry ? (
    <HelpControl key={entry.key} entry={entry} activeTab={activeTab} />
  ) : null;
}
