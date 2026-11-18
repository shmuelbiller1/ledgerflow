import React, { useState } from "react";
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
import { ScreenManual, RelatedArticle } from "./ScreenManual";

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
  const [lang, setLang] = useState(() => useUIStore.getState().language);
  // Reports have individual guides; Settings and the Ledger lenses share their screen’s Help button.
  const screenId = activeTab === "reports" ? entry.id : activeTab;
  const screenDoc = findScreenHelpDoc(screenId);
  const related = articlesForScreen(screenId).slice(0, 3);

  return createPortal(
    <div {...dialogProps} className="fixed inset-0 z-[180] bg-black/50 p-3 flex items-center justify-center">
      <div
        lang={lang} dir={lang === "he" ? "rtl" : "ltr"}
        className="w-full max-w-xl max-h-[85dvh] overflow-y-auto p-5 space-y-4 rounded-xl border bg-[var(--panel)] text-[var(--text)]"
      >
        <h2 id={titleId} className="text-xl font-semibold">
          {lang === "he" ? `עזרה: ${entry.labelHe}` : `Help for ${entry.label}`}
        </h2>
        {/* A-201: the screen's own description in Hebrew; the general page summary only when it has none */}
        <p>
          {lang === "he" ? entry.helpHe || screenDoc.summaryHe : entry.help}
        </p>
        <p className="text-sm text-[var(--muted)]">
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
              {lang === "he" ? "סגירת העזרה" : "Close help"}
            </button>
            <div className="inline-flex rounded border border-[var(--line)] overflow-hidden" role="group" aria-label={lang === "he" ? "שפת המדריך" : "Help language"}>
              <button
                type="button"
                lang="en" aria-pressed={lang === "en"}
                onClick={() => setLang("en")}
                className={`min-h-11 px-3 text-xs font-medium ${lang === "en" ? "bg-[var(--text)] text-[var(--bg)]" : "bg-[var(--surface)] text-[var(--text)]"}`}
              >
                English
              </button>
              <button
                type="button"
                lang="he" aria-pressed={lang === "he"}
                onClick={() => setLang("he")}
                className={`min-h-11 px-3 text-xs font-medium ${lang === "he" ? "bg-[var(--text)] text-[var(--bg)]" : "bg-[var(--surface)] text-[var(--text)]"}`}
              >
                עברית
              </button>
            </div>
          </div>

          <ScreenManual doc={screenDoc} screenId={screenId} lang={lang} />
          {/* Trial Balance is a Ledger lens, not a Reports route. Keep the parent Ledger guide too. */}
          {activeTab === "ledger" && <ScreenManual doc={findScreenHelpDoc("trial-balance")} screenId="trial-balance" lang={lang} />}
          {related.length > 0 && <div className="space-y-2 border-t border-[var(--line)] pt-3">
            <h3 className="text-sm font-semibold">{lang === "he" ? "מדריכים קשורים" : "Related how-to guides"}</h3>
            {related.map(article => <RelatedArticle key={article.id} article={article} lang={lang} />)}
          </div>}

          <div className="pt-1">
            <button
              type="button"
              className="min-h-11 px-4 border rounded"
              onClick={() => {
                onClose();
                useUIStore.getState().goToPage({ tab: "help" });
              }}
            >
              {lang === "he" ? "פתיחת מרכז העזרה" : "Open Help & Guide"}
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
    <div className="flex items-center justify-end gap-3 px-4 py-1 md:py-0.5 border-b border-[var(--line)] bg-[var(--surface)]">
      <span className="text-sm md:text-xs text-[var(--muted)]">{entry.label}</span>
      <button
        type="button"
        className="shrink-0 min-h-11 min-w-11 md:min-h-7 md:min-w-0 px-3 border rounded-lg md:text-xs"
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
