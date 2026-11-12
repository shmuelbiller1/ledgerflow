import type { LucideIcon } from 'lucide-react';
import { startTour } from "../../lib/productTour";
import React, { useState } from "react";
import { 
  BookOpen, 
  Search, 
  Layers, 
  RotateCcw, 
  DollarSign, 
  Building, 
  ShieldCheck, 
  TrendingUp, 
  Command, 
  ArrowRight,
  Sparkles,
  ChevronRight,
  LayoutGrid
} from "lucide-react";
import { motion } from "motion/react";
import { useUIStore } from "../../stores/useUIStore";
import ReleaseNotes from "./ReleaseNotes";
import AllScreensHelp from "./AllScreensHelp";
import MainPathGuide from "./MainPathGuide";
import GuestCountrySamplePicker from "./GuestCountrySamplePicker";
import FirstMonthOnboardingHub from "./FirstMonthOnboardingHub";
import AccessibilityAndLanguagePanel from "./AccessibilityAndLanguagePanel";
import { HOW_TO_ARTICLES, SCREEN_HELP_DOCS, searchHowToArticles } from "../../lib/helpCenterArticles";

import { BRAND_NAME } from '../../config/brand';
interface SectionDoc {
  id: string;
  title: string;
  icon: LucideIcon;
  category: string;
  summary: string;
  steps: string[];
  tips?: string[];
}

const GUIDE_SECTIONS: SectionDoc[] = [
  {
    id: "getting-started",
    title: "Getting Started & System Overview",
    icon: Sparkles,
    category: "Core Concepts",
    summary: `${BRAND_NAME} is double-entry bookkeeping for your business: every entry balances, and posted entries are corrected, never rewritten.`,
    steps: [
      "Navigate modules using the sidebar or press ⌘K (Ctrl+K) to open the Command Palette.",
      "Configure Chart of Accounts in the Account Register or Ledger views.",
      "Connect live bank accounts via Plaid in Bank Connections or import statement files (CSV/OFX/QBO)."
    ],
    tips: [
      "All transactions strictly enforce double-entry equilibrium: debits must equal credits.",
      "Amounts are always absolute, with direction determined by line item debits/credits."
    ]
  },
  {
    id: "sales-invoicing",
    title: "Sales & Customer Invoices",
    icon: DollarSign,
    category: "Money In",
    summary: "Create, send, track, and reconcile sales invoices with tax calculations and payment terms.",
    steps: [
      "Go to Sales and click \"New Invoice\".",
      "Select or type a customer name and set the invoice date and due date.",
      "Add line items with descriptions, quantities, unit prices, and revenue accounts.",
      "Toggle Tax Inclusive if prices already include sales tax, or enter a tax rate percentage.",
      "Click \"Preview PDF\" to generate and download an official formatted PDF document."
    ],
    tips: [
      "Draft invoices do not affect the general ledger until posted.",
      "Overdue invoices can be written off as Bad Debt Expense directly from the action menu."
    ]
  },
  {
    id: "purchases-bills",
    title: "Purchases & Vendor Bills",
    icon: Building,
    category: "Money Out",
    summary: "Record vendor bills, allocate expenses across cost centers, and manage accounts payable.",
    steps: [
      "Go to Purchases and click \"Record New Bill\".",
      "Select a vendor to auto-fill default expense categories.",
      "Add split line items for multi-category expense allocation.",
      "Attach receipts or drag-and-drop document files.",
      "Submit the bill to update Accounts Payable."
    ]
  },
  {
    id: "payments-allocation",
    title: "Payment Receipts & Bill Settlements",
    icon: RotateCcw,
    category: "Money In / Out",
    summary: "Process single or multi-invoice settlement payments with automated oldest-first allocation.",
    steps: [
      "From Sales or Purchases, click \"Receive Payment\" or \"Pay Vendor Bill\".",
      "Select the customer or vendor to automatically populate open documents.",
      "Enter the total settlement amount.",
      "Use \"Apply to oldest first\" or type an amount for each document.",
      "Confirm the deposit/payment cash account and submit."
    ]
  },
  {
    id: "banking-reconciliation",
    title: "Bank Feeds & Zero-Variance Reconciliation",
    icon: Layers,
    category: "Reconcile",
    summary: "Match imported bank lines against general ledger entries to ensure statement reconciliation.",
    steps: [
      "Open Bank Connections to sync transactions or upload statement CSVs.",
      "Review suggestions in the \"To Review\" inbox.",
      "Navigate to Reconciliation and enter your statement closing balance and date.",
      "Check off matching items until Difference reaches exactly $0.00.",
      "Finalize the reconciliation statement to seal the period."
    ]
  },
  {
    id: "period-close-reversals",
    title: "Month-End Close & \"Reverse & Correct\"",
    icon: ShieldCheck,
    category: "Integrity & Security",
    summary: "Lock fiscal periods to prevent retroactive tampering while preserving an auditable correction workflow.",
    steps: [
      "Open Month-End Close and complete the period checklist.",
      "Set the Lock Date to prevent direct edits to transactions on or prior to that date.",
      "If a locked entry requires adjustment, use the \"Reverse & Correct\" action.",
      "Specify the open-period Reversal Date and correction audit reason.",
      "Submit the balanced reversal and replacement entry in the current period."
    ]
  },
  {
    id: "reports-lenses",
    title: "Financial Statements & Intelligence Lenses",
    icon: TrendingUp,
    category: "Reports",
    summary: "Generate deterministic Balance Sheet, P&L, Cash Flow, Tax Liability, and Aging reports.",
    steps: [
      "Navigate to Reports to view real-time Profit & Loss and Balance Sheets.",
      "Filter by period, dimension, project, or cash vs. accrual basis.",
      "Inspect A/R and A/P Aging reports to monitor liquidity and past-due balances."
    ]
  },
  {
    id: "keyboard-shortcuts",
    title: "Keyboard Shortcuts & Power Navigation",
    icon: Command,
    category: "Productivity",
    summary: "Speed up your daily accounting workflows with keyboard shortcuts.",
    steps: [
      "⌘K or Ctrl+K — Open Coordinate Search & Command Palette",
      "? — Show every keyboard shortcut (also in the command palette: \"Keyboard shortcuts\")",
      "Esc — Close active modal, drilldown, or dialog",
      "⌘Enter or Ctrl+Enter — Submit and save active form / journal"
    ]
  },
  {
    id: "views-directory",
    title: "All Views & Modules Directory",
    icon: LayoutGrid,
    category: "Reference",
    summary: "Complete reference index of all 37 views and tools available across the platform.",
    steps: [
      "Credit Notes (credit-notes): Issue customer credit memos and record vendor credit notes.",
      "Estimates & Quotes (estimates): Draft quotes, track client acceptance, and convert directly to sales invoices.",
      "Statement View (statement): Generate formal customer billing statements and accounts receivable balance summaries.",
      "General Ledger (general-ledger): Deep, chronologically sorted account-by-account transaction logs with running balances.",
      "Tax Liability (tax-liability): Real-time sales tax and VAT reporting with tax-inclusive / exclusive breakdowns.",
      "Projects (projects): Assign revenue, costs, and billable hours to project dimension codes for job costing.",
      "Budgets (budgets): Establish department and account fiscal budgets and track real-time variance against actuals.",
      "Consolidation (consolidation): A view across entities. For your groups of companies side by side, in one currency, with what they owe each other taken out, use Reports → Group Summary; dealings between them are checked, not yet eliminated from sales (docs/CAPABILITIES.md).",
      "Time Machine (time-machine): Inspect the exact historical state of the entire financial ledger at any prior timestamp.",
      "Vault (vault): Secure, tamper-proof repository for invoices, bill receipts, tax forms, and compliance documents.",
      "Forecaster (forecaster): Monte Carlo cash flow simulation and runway projection engine.",
      "Ask your books (copilot): Natural language financial queries, pattern recognition, and ledger analysis.",
      "Account Register (register): Single-account checkbook register with inline transaction recording.",
      "Audit Trail (audit-trail): Immutable forensic log of every write, reversal, and user modification.",
      "API Platform (api-hub): Manage webhook endpoints, API tokens, and programmatic integrations."
    ],
    tips: [
      "Press ⌘K or Ctrl+K anytime to quickly jump to any of these views by typing its name."
    ]
  }
];

export default function HelpGuideView() {
  const [mode, setMode] = useState<"workflows" | "screens" | "main-path" | "how-to" | "first-month" | "accessibility">("workflows");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategory, setActiveCategory] = useState("All");
  const [selectedSection, setSelectedSection] = useState(GUIDE_SECTIONS[0]);
  const [howToLang, setHowToLang] = useState<"en" | "he">("en");
  const setActiveTab = useUIStore(state => state.setActiveTab);
  const goToPage = useUIStore(state => state.goToPage);
  const matchingHowTo = searchHowToArticles(searchQuery);

  const categories = ["All", ...Array.from(new Set(GUIDE_SECTIONS.map(s => s.category)))];

  const filteredSections = GUIDE_SECTIONS.filter(section => {
    const matchesCategory = activeCategory === "All" || section.category === activeCategory;
    const matchesQuery = searchQuery.trim() === "" || 
      section.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      section.summary.toLowerCase().includes(searchQuery.toLowerCase()) ||
      section.steps.some(st => st.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesCategory && matchesQuery;
  });

  return (
    <div className="flex-1 h-full flex flex-col bg-[var(--surface)] text-[var(--text)] overflow-hidden">
      <div className="p-6 md:p-8 border-b border-[var(--line)] bg-[var(--surface)] shrink-0">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-1">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-[var(--brass-soft)] border border-[var(--brass-line)] flex items-center justify-center text-[var(--brass)]">
                <BookOpen aria-hidden="true" size={20} />
              </div>
              <div>
                <h1 className="text-2xl font-black tracking-tight">Help & Operational Guide</h1>
                <p className="text-xs text-[var(--muted)] font-medium">Standard operating procedures, workflows, and core architectural concepts</p>
                <p className="text-xs text-[var(--muted)] font-medium">Something not working? <a href="/status" target="_blank" rel="noopener noreferrer" className="underline text-[var(--text)]">System status</a></p>
              </div>
            </div>
          </div>

          <div className="relative w-full md:w-80">
            <Search aria-hidden="true" className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--muted)]" size={16} />
            <input aria-label="Search guide and workflows"
              type="text"
              placeholder="Search guide & workflows (EN / עברית)..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 bg-[var(--panel)] border border-[var(--line)] rounded-xl text-sm font-medium outline-none focus:border-[var(--brass)] transition-colors placeholder:text-[var(--faint)]"
            />
          </div>
        </div>

        <ReleaseNotes />
        <button type="button" className="min-h-11 px-4 border rounded-lg mt-4" onClick={() => window.dispatchEvent(new Event('ledgerflow:feedback'))}>Send feedback</button>
        <div className="max-w-7xl mx-auto flex flex-wrap gap-2 mt-4">
          <button type="button" aria-pressed={mode === 'workflows'} className="min-h-11 px-4 border rounded-lg" onClick={() => setMode('workflows')}>Workflows</button>
          <button type="button" aria-pressed={mode === 'how-to'} className="min-h-11 px-4 border rounded-lg" onClick={() => setMode('how-to')}>How-to ({HOW_TO_ARTICLES.length} EN/HE)</button>
          <button type="button" aria-pressed={mode === 'first-month'} className="min-h-11 px-4 border rounded-lg" onClick={() => setMode('first-month')}>First month &amp; demo</button>
          <button type="button" aria-pressed={mode === 'screens'} className="min-h-11 px-4 border rounded-lg" onClick={() => setMode('screens')}>All screens</button>
          <button type="button" aria-pressed={mode === 'main-path'} className="min-h-11 px-4 border rounded-lg" onClick={() => setMode('main-path')}>Main path</button>
          <button type="button" aria-pressed={mode === 'accessibility'} className="min-h-11 px-4 border rounded-lg" onClick={() => setMode('accessibility')}>Accessibility &amp; language</button>
          <button type="button" className="min-h-11 px-4 border rounded-lg" onClick={startTour}>Take the tour</button>
        </div>

        {mode === 'workflows' && (
        <div className="max-w-7xl mx-auto flex items-center gap-2 mt-6 overflow-x-auto pb-1 custom-scrollbar">
          {categories.map(cat => (
            <button
              key={cat}
              onClick={() => setActiveCategory(cat)}
              className={"px-3.5 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors " + (
                activeCategory === cat
                  ? "bg-[var(--brass)] text-[var(--ink)] font-bold shadow-xs"
                  : "bg-[var(--panel)] text-[var(--muted)] hover:text-[var(--text)] border border-[var(--line)]"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto flex flex-col md:flex-row max-w-7xl mx-auto w-full">
        {mode === 'main-path' ? <MainPathGuide /> : mode === 'screens' ? <AllScreensHelp /> : mode === 'first-month' ? (
          <div className="w-full p-6 space-y-6">
            <GuestCountrySamplePicker />
            <FirstMonthOnboardingHub />
          </div>
        ) : mode === 'accessibility' ? (
          <div className="w-full p-6">
            <AccessibilityAndLanguagePanel onOpenSupport={() => setActiveTab("support")} />
          </div>
        ) : mode === 'how-to' ? (
          <section aria-labelledby="howto-library-heading" className="w-full p-6 space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 id="howto-library-heading" className="text-lg font-bold text-[var(--text)]">
                  {howToLang === 'he' ? '20 מדריכי הפעלה קצרים (עברית ואנגלית)' : '20 Step-by-Step How-To Articles (English & עברית)'}
                </h2>
                <p className="text-xs text-[var(--muted)]">
                  {matchingHowTo.length} of {HOW_TO_ARTICLES.length} articles · {SCREEN_HELP_DOCS.length} bilingual screen manuals
                </p>
              </div>
              <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden" role="group" aria-label="How-to article language">
                <button type="button" aria-pressed={howToLang === 'en'} onClick={() => setHowToLang('en')} className={`min-h-11 px-3 text-xs font-medium ${howToLang === 'en' ? 'bg-[var(--text)] text-[var(--bg)]' : 'bg-[var(--surface)] text-[var(--text)]'}`}>English</button>
                <button type="button" aria-pressed={howToLang === 'he'} onClick={() => setHowToLang('he')} className={`min-h-11 px-3 text-xs font-medium ${howToLang === 'he' ? 'bg-[var(--text)] text-[var(--bg)]' : 'bg-[var(--surface)] text-[var(--text)]'}`}>עברית</button>
              </div>
            </div>
            <div dir={howToLang === 'he' ? 'rtl' : 'ltr'} className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {matchingHowTo.map(article => (
                <article key={article.id} className="rounded-xl border border-[var(--line)] bg-[var(--panel)] p-4 flex flex-col justify-between gap-3">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                      <span className="font-semibold">{article.category}</span>
                      <span className="font-mono">{article.screenId}</span>
                    </div>
                    <h3 className="font-bold text-sm text-[var(--text)]">{howToLang === 'he' ? article.titleHe : article.titleEn}</h3>
                    <p className="text-xs text-[var(--muted)]">{howToLang === 'he' ? article.summaryHe : article.summaryEn}</p>
                    <ol className="list-decimal pl-5 space-y-1 text-xs text-[var(--text)]">
                      {(howToLang === 'he' ? article.stepsHe : article.stepsEn).map(st => <li key={st}>{st}</li>)}
                    </ol>
                  </div>
                  <button
                    type="button"
                    onClick={() => goToPage({ tab: article.target.tab, ...(article.target.sub ? { sub: article.target.sub } : {}) })}
                    className="btn-secondary min-h-11 px-3 rounded-lg text-xs font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    <span>{howToLang === 'he' ? 'פתיחת המסך המתאים' : 'Open screen'}</span>
                    <ArrowRight size={14} aria-hidden="true" />
                  </button>
                </article>
              ))}
            </div>
          </section>
        ) : <>
        <div className="w-full md:w-80 border-r border-[var(--line)] overflow-y-auto p-4 space-y-2 shrink-0 custom-scrollbar">
          {filteredSections.map(section => {
            const Icon = section.icon;
            const isSelected = selectedSection.id === section.id;
            return (
              <button
                key={section.id}
                onClick={() => setSelectedSection(section)}
                className={"w-full text-left p-3.5 rounded-xl border transition-all flex items-start gap-3 " + (
                  isSelected
                    ? "bg-[var(--brass-soft)] border-[var(--brass-line)] text-[var(--text)]"
                    : "bg-[var(--surface)] border-transparent hover:bg-[var(--panel)] hover:border-[var(--line)] text-[var(--muted)]"
                )}
              >
                <div className={"p-2 rounded-lg shrink-0 " + (isSelected ? "bg-[var(--brass)] text-[var(--ink)]" : "bg-[var(--panel)] text-[var(--muted)]")}>
                  <Icon size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] uppercase tracking-wider font-mono font-bold text-[var(--faint)]">{section.category}</span>
                    <ChevronRight aria-hidden="true" size={14} className={isSelected ? "text-[var(--brass)]" : "text-transparent"} />
                  </div>
                  <h2 className="text-sm font-bold truncate mt-0.5">{section.title}</h2>
                  <p className="text-xs text-[var(--muted)] line-clamp-1 mt-0.5">{section.summary}</p>
                </div>
              </button>
            );
          })}
        </div>

        <div className="flex-1 overflow-y-auto p-6 md:p-8 space-y-8 custom-scrollbar">
          <motion.div
            key={selectedSection.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.15 }}
            className="space-y-6 max-w-3xl"
          >
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-[var(--brass-soft)] border border-[var(--brass-line)] flex items-center justify-center text-[var(--brass)]">
                <selectedSection.icon size={24} />
              </div>
              <div>
                <span className="text-[11px] font-mono font-bold uppercase tracking-widest text-[var(--brass)]">{selectedSection.category}</span>
                <h2 className="text-2xl font-black tracking-tight">{selectedSection.title}</h2>
              </div>
            </div>

            <p className="text-sm text-[var(--muted)] leading-relaxed bg-[var(--panel)] p-4 rounded-xl border border-[var(--line)]">
              {selectedSection.summary}
            </p>

            <div className="space-y-4">
              <h3 className="text-xs font-mono font-bold uppercase tracking-wider text-[var(--faint)]">Step-by-Step Instructions</h3>
              <div className="space-y-3">
                {selectedSection.steps.map((step, idx) => (
                  <div key={step} className="flex items-start gap-3 p-3.5 bg-[var(--panel)] rounded-xl border border-[var(--line)]">
                    <span className="w-6 h-6 rounded-full bg-[var(--surface)] border border-[var(--line)] flex items-center justify-center text-xs font-mono font-bold shrink-0 text-[var(--brass)]">
                      {idx + 1}
                    </span>
                    <p className="text-sm font-medium leading-normal">{step}</p>
                  </div>
                ))}
              </div>
            </div>

            {selectedSection.tips && selectedSection.tips.length > 0 && (
              <div className="space-y-3 bg-[var(--brass-soft)] border border-[var(--brass-line)] p-4 rounded-xl">
                <div className="flex items-center gap-2 text-[var(--brass)] font-bold text-xs uppercase tracking-wider">
                  <Sparkles aria-hidden="true" size={14} />
                  <span>Important Operational Tips</span>
                </div>
                <ul className="space-y-1.5 pl-5 list-disc text-xs text-[var(--text)] leading-relaxed">
                  {selectedSection.tips.map((tip) => (
                    <li key={tip}>{tip}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="pt-6 border-t border-[var(--line)] flex items-center justify-between">
              <button
                onClick={() => setActiveTab("support")}
                className="inline-flex items-center gap-2 text-xs font-semibold text-[var(--muted)] hover:text-[var(--text)] transition-colors"
              >
                <span>Need more help? Open a Support Ticket</span>
                <ArrowRight aria-hidden="true" size={14} />
              </button>
            </div>
          </motion.div>
        </div>
        </>}
      </div>
    </div>
  );
}
