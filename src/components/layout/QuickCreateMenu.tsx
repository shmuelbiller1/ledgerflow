import React, { useState } from "react";
import { createPortal } from "react-dom";
import {
  Plus,
  FileText,
  Users,
  UserCheck,
  Calculator,
  FileSpreadsheet,
  X,
} from "lucide-react";
import { useUIStore } from "../../stores/useUIStore";
import { useCurrentRole } from "../../hooks/useCurrentRole";
import { useDialog } from "../../hooks/useDialog";
import type { NewRecordType } from "../../lib/recordLinks";

const ACTIONS = [
  { type: "invoice", label: "Invoice", icon: FileText },
  { type: "customer", label: "Customer", icon: Users },
  { type: "bill", label: "Bill", icon: FileSpreadsheet },
  { type: "vendor", label: "Vendor", icon: UserCheck },
  { type: "journalEntry", label: "Journal entry", icon: Calculator },
] satisfies Array<{ type: NewRecordType; label: string; icon: typeof Plus }>;

export default function QuickCreateMenu({
  phone = false,
}: {
  phone?: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const openNewRecord = useUIStore((state) => state.openNewRecord);
  const canCreate = useCurrentRole() !== "viewer";
  const { dialogProps, titleId } = useDialog(() => setIsOpen(false), isOpen);

  return (
    <>
      <button
        type="button"
        aria-label="New"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        disabled={!canCreate}
        title={
          canCreate
            ? "Create a record"
            : "Creating records requires edit access"
        }
        onClick={() => setIsOpen(true)}
        className={
          phone
            ? "flex flex-1 min-w-[44px] h-16 flex-col items-center justify-center gap-1 rounded-lg text-[var(--text)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-4px]"
            : "hidden md:flex min-h-11 min-w-11 items-center justify-center rounded-lg text-sm font-semibold"
        }
      >
        <span
          className={
            phone
              ? "contents"
              : "inline-flex items-center gap-1.5 bg-slate-900 text-white dark:bg-white dark:text-black hover:opacity-90 px-3 py-1.5 rounded-lg shadow-sm"
          }
        >
          <Plus aria-hidden="true" size={phone ? 22 : 16} />
          <span className={phone ? "text-[11px]" : "hidden lg:inline"}>
            New
          </span>
        </span>
      </button>
      {isOpen &&
        createPortal(
          <div
            {...dialogProps}
            className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-4"
          >
            <div className="w-full max-w-sm rounded-2xl bg-[var(--surface)] text-[var(--text)] border border-[var(--line)] shadow-xl p-3">
              <div className="flex items-center justify-between gap-2 px-2">
                <h2 id={titleId} className="font-semibold">
                  Create new
                </h2>
                <button
                  type="button"
                  aria-label="Close create menu"
                  className="min-h-11 min-w-11 flex items-center justify-center"
                  onClick={() => setIsOpen(false)}
                >
                  <X aria-hidden="true" size={20} />
                </button>
              </div>
              {ACTIONS.map(({ type, label, icon: Icon }) => (
                <button
                  key={type}
                  type="button"
                  disabled={!canCreate}
                  onClick={() => {
                    setIsOpen(false);
                    openNewRecord(type);
                  }}
                  className="w-full min-h-11 flex items-center gap-3 px-3 py-2 text-sm hover:bg-[var(--ink)] rounded-xl text-left disabled:opacity-50"
                >
                  <Icon aria-hidden="true" size={18} />
                  {label}
                </button>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
