/**
 * Lightweight bilingual screen-help index used by `ScreenHelpHeader` so the workspace shell
 * and PWA precache do not bundle the full 20-article step-by-step Help Center corpus
 * (`src/lib/helpCenterArticles.ts`) before a user opens Help & Guide.
 * 1-to-1 parity with `helpCenterArticles.ts` is enforced by `stage6-footprint-optimization.test.ts`.
 */
export interface ScreenHelpDocSummary {
  slug: string;
  screenIds: readonly string[];
  docPath: string;
  summaryHe: string;
}

export interface HowToArticleTitle {
  id: string;
  screenId: string;
  titleEn: string;
  titleHe: string;
}

export const SCREEN_HELP_DOC_SUMMARIES: readonly ScreenHelpDocSummary[] = [
  {
    "slug": "overview",
    "screenIds": [
      "dashboard",
      "overview",
      "practice",
      "help",
      "glossary",
      "support",
      "accept-invite"
    ],
    "docPath": "docs/help/overview.md",
    "summaryHe": "מעקב אחר יתרות מזומן, חובות לקוחות וספקים, רווח תקופתי ומשימות פתוחות לטיפול."
  },
  {
    "slug": "transactions",
    "screenIds": [
      "transactions",
      "journal-entries",
      "general-ledger",
      "register",
      "ledger",
      "recurring",
      "query-builder",
      "time-machine"
    ],
    "docPath": "docs/help/transactions.md",
    "summaryHe": "צפייה, סינון ורישום פקודות יומן כפולות ומאוזנות בכל חשבונות החברה."
  },
  {
    "slug": "sales",
    "screenIds": [
      "sales",
      "estimates",
      "customers"
    ],
    "docPath": "docs/help/sales.md",
    "summaryHe": "הפקת הצעות מחיר וחשבוניות, קליטת תקבולים וזיכויים מלקוחות ושליחת דוחות מצב חשבון."
  },
  {
    "slug": "purchases",
    "screenIds": [
      "purchases",
      "purchase-orders",
      "vendors"
    ],
    "docPath": "docs/help/purchases.md",
    "summaryHe": "קליטת חשבוניות ספקים, ניהול הזמנות רכש ופריטי מלאי וביצוע סבבי תשלום לספקים."
  },
  {
    "slug": "banking",
    "screenIds": [
      "banking",
      "bank-connections",
      "inbox"
    ],
    "docPath": "docs/help/banking.md",
    "summaryHe": "טעינה ובדיקה מוקדמת של דפי בנק בפורמט CSV, OFX ו-QFX וניהול תנועות קופה ובנק."
  },
  {
    "slug": "reconciliation",
    "screenIds": [
      "reconciliation"
    ],
    "docPath": "docs/help/reconciliation.md",
    "summaryHe": "התאמת שורות דף הבנק מול פקודות היומן בספרים עד לאיפוס ההפרש."
  },
  {
    "slug": "reports",
    "screenIds": [
      "reports",
      "customer-cohorts",
      "asset-register",
      "one-sided-transfers",
      "budget-actual",
      "pnl",
      "balance-sheet",
      "group-summary",
      "ask-books",
      "cash-flow",
      "party-linked-trial-balance",
      "import-acceptance",
      "sales-trends",
      "purchase-trends",
      "sales-payment-summary",
      "deferred-revenue-waterfall",
      "exchange-rates-used",
      "open-advances",
      "financial-ratios",
      "vendor-withholding",
      "customer-tax-certificates",
      "vendor-tax-records",
      "discount-mismatch",
      "registration-threshold-watch",
      "use-tax-review",
      "purchases-from-abroad",
      "expense-policy-check",
      "cycle-count",
      "vendor-scorecard",
      "vendor-price-history",
      "three-way-match",
      "customer-lifetime-value",
      "subscription-plans",
      "gross-profit-by-customer",
      "inactive-items",
      "account-balances-as-of",
      "payment-period-by-invoice-date",
      "customer-period-summary",
      "supplier-period-summary",
      "customer-balance-summary",
      "vendor-balance-summary",
      "contact-balance-summary",
      "transactions-by-customer",
      "transactions-by-vendor",
      "transactions-by-reference",
      "sales-by-item",
      "inventory-valuation",
      "goods-not-billed",
      "bank-clearance",
      "depreciation-ledger",
      "item-register",
      "stock-aging",
      "slow-moving-stock",
      "profitability-by",
      "commissions",
      "backorders",
      "form-856",
      "inventory-details",
      "stock-sources-uses",
      "expiring-lots",
      "stock-transfers",
      "kit-assembly",
      "stock-value-by-location-lot",
      "journal-sheet",
      "expense-by-category",
      "income-by-source",
      "top-expenses-income",
      "monthly-averages",
      "by-label",
      "balance-sheet-by-label",
      "tag-breakdown",
      "ar-aging",
      "ap-aging",
      "statement",
      "accountant-export-pack",
      "rule-pack-coverage",
      "customer-credit-limits",
      "aged-receivables-by-rep",
      "gross-margin-by-item-group",
      "top-customers-vendors",
      "inventory-turnover",
      "expense-by-employee",
      "time-by-project",
      "bank-holidays",
      "israeli-bank-codes",
      "gsa-per-diem",
      "milestone-billing",
      "reorder-suggestions",
      "dunning-letters",
      "expense-receipt-checklist",
      "duplicate-contact-review",
      "purchase-price-variance",
      "sales-by-territory",
      "record-retention-review",
      "duplicate-bill-review",
      "document-number-gaps",
      "cash-forecast-13-week",
      "vendor-1099-readiness",
      "golden-tax-fixtures",
      "us-quarter-journey",
      "il-month-journey",
      "record-notes",
      "serial-lot-lookup",
      "landed-cost-preview",
      "delivery-notes",
      "customer-quotes",
      "sales-tax-holidays",
      "quote-versions",
      "blanket-orders",
      "mileage-rates",
      "israel-self-employment-ni",
      "israel-advance-tax",
      "banking-validation",
      "us-nexus-watch",
      "tax-code-suggestions",
      "entity-filings",
      "israeli-document-types",
      "us-1099-preview",
      "us-filing-calendar",
      "data-quality-checks",
      "sample-year-benchmark",
      "vendor-quotes-compare",
      "customer-item-codes",
      "shipping-methods",
      "bill-retention",
      "aged-inventory-by-lot",
      "work-orders",
      "il-annual-party-summary"
    ],
    "docPath": "docs/help/reports.md",
    "summaryHe": "הפקת דוח רווח והפסד, מאזן, מאזן בוחן, כרטסות, דוחות מס לחישוב וחבילות דוחות להדפסה."
  },
  {
    "slug": "planning",
    "screenIds": [
      "planning",
      "budgets",
      "projects",
      "forecaster"
    ],
    "docPath": "docs/help/planning.md",
    "summaryHe": "הגדרת תקציבים לחשבונות, מעקב רווחיות לפי פרויקט ובדיקת תחזית תזרים ל-13 שבועות."
  },
  {
    "slug": "forensics",
    "screenIds": [
      "forensics",
      "audit-trail",
      "data-health",
      "month-end-close",
      "consolidation",
      "audit",
      "fiscal-periods",
      "intercompany",
      "client-queries",
      "accountant-queue"
    ],
    "docPath": "docs/help/forensics.md",
    "summaryHe": "בדיקת שלמות הספרים, צפייה ביומן הביקורת, ניהול ניירות עבודה ונעילת חודשים סגורים."
  },
  {
    "slug": "settings",
    "screenIds": [
      "settings",
      "api-hub",
      "rules",
      "dimensions",
      "tax-profiles",
      "appearance",
      "team",
      "billing",
      "templates",
      "security",
      "rule",
      "developer",
      "import",
      "emails",
      "branding",
      "branding-profiles",
      "numbering",
      "defaults",
      "schedule",
      "incoming-events",
      "tags",
      "scheduled-reports",
      "alerts",
      "modules",
      "groups",
      "split-rules",
      "price-lists",
      "price-list-import",
      "custom-fields",
      "sales-reps",
      "stages",
      "currencies",
      "export",
      "shortcuts"
    ],
    "docPath": "docs/help/settings.md",
    "summaryHe": "ניהול הרשאות צוות, מודולים אופציונליים, פרופילי מס, עיצוב ושפה, קיצורי מקלדת וגיבויי JSON."
  },
  {
    "slug": "tasks-and-time",
    "screenIds": [
      "tasks",
      "time",
      "payroll"
    ],
    "docPath": "docs/help/tasks-and-time.md",
    "summaryHe": "ניהול משימות ושעות לחיוב, חיפוש במדריכי עזרה בעברית ובאנגלית וניהול פניות משוב."
  },
  {
    "slug": "inventory-and-assets",
    "screenIds": [
      "inventory",
      "assets"
    ],
    "docPath": "docs/help/inventory-and-assets.md",
    "summaryHe": "ניהול פריטי מלאי וכמויות במסך המלאי, וניהול פחת ציוד במרשם הרכוש הקבוע."
  },
  {
    "slug": "taxes",
    "screenIds": [
      "taxes",
      "tax-liability"
    ],
    "docPath": "docs/help/taxes.md",
    "summaryHe": "בחירת שיעורי המס שקיבלתם מרואה החשבון, צפייה במס שנגבה ושולם בתקופה ופתיחת דוחות המס באזור הדוחות."
  },
  {
    "slug": "cash-and-credit",
    "screenIds": [
      "payments",
      "credit-notes",
      "loans",
      "petty-cash"
    ],
    "docPath": "docs/help/cash-and-credit.md",
    "summaryHe": "רישום תקבולים ותשלומים, יישום זיכויים וניהול הלוואות וקופת מזומן קטנה בנפרד מפעילות עסקית רגילה."
  },
  {
    "slug": "system-and-data",
    "screenIds": [
      "copilot",
      "ask",
      "magic",
      "architecture",
      "vault",
      "system-command-center",
      "intelligence",
      "charts",
      "pricing",
      "forensics_1",
      "forensics_2"
    ],
    "docPath": "docs/help/system-and-data.md",
    "summaryHe": "שאילת שאלות על הספרים שלכם, צפייה בניתוחים ויזואליים ובדיקות חריגות, שמירת מסמכים בכספת ובדיקת תוכנית המנוי ומסכי המערכת."
  }
];

export const HOW_TO_ARTICLE_TITLES: readonly HowToArticleTitle[] = [
  {
    "id": "howto-01-setup-books",
    "screenId": "dashboard",
    "titleEn": "Set up your company details and chart template",
    "titleHe": "הגדרת פרטי העסק ובחירת תבנית חשבונות"
  },
  {
    "id": "howto-02-opening-balances",
    "screenId": "transactions",
    "titleEn": "Enter balanced opening balances safely",
    "titleHe": "רישום יתרות פתיחה מאוזנות"
  },
  {
    "id": "howto-03-first-invoice",
    "screenId": "sales",
    "titleEn": "Create and send a customer invoice",
    "titleHe": "הפקה ושליחה של חשבונית ללקוח"
  },
  {
    "id": "howto-04-receive-payment",
    "screenId": "sales",
    "titleEn": "Record full or partial customer payments",
    "titleHe": "קליטת תקבול מלא או חלקי מלקוח"
  },
  {
    "id": "howto-05-quotes-to-orders",
    "screenId": "sales",
    "titleEn": "Track quotes, deposits, and partial invoicing",
    "titleHe": "מעקב הצעות מחיר, מקדמות וחשבוניות חלקיות"
  },
  {
    "id": "howto-06-customer-portal",
    "screenId": "sales",
    "titleEn": "Share the read-only customer invoice portal",
    "titleHe": "שיתוף פורטל חשבוניות לקריאה ללקוח"
  },
  {
    "id": "howto-07-vendor-bills",
    "screenId": "purchases",
    "titleEn": "Record supplier bills and attach documents",
    "titleHe": "רישום חשבונית ספק וצירוף מסמך מקור"
  },
  {
    "id": "howto-08-payment-run-withholding",
    "screenId": "purchases",
    "titleEn": "Pay vendor bills and review Israeli withholding",
    "titleHe": "תשלום לספקים ובדיקת ניכוי מס במקור (856)"
  },
  {
    "id": "howto-09-import-csv-ofx",
    "screenId": "banking",
    "titleEn": "Import CSV, OFX, or QFX bank statements safely",
    "titleHe": "ייבוא מבוקר של דפי בנק בפורמט CSV, OFX או QFX"
  },
  {
    "id": "howto-10-reconcile-statement",
    "screenId": "reconciliation",
    "titleEn": "Reconcile a bank account to a zero difference",
    "titleHe": "התאמת חשבון בנק להפרש אפס"
  },
  {
    "id": "howto-11-labels-dimensions",
    "screenId": "reports",
    "titleEn": "Tag lines with labels (property, project, location)",
    "titleHe": "שימוש בתגיות (נכס, פרויקט, סניף) ודוח רווחיות לתגית"
  },
  {
    "id": "howto-12-pnl-balance-sheet-cash-accrual",
    "screenId": "reports",
    "titleEn": "Compare P&L and Balance Sheet on accrual or cash basis",
    "titleHe": "השוואת רווח והפסד ומאזן על בסיס מצטבר או מזומן"
  },
  {
    "id": "howto-13-israel-month-vat",
    "screenId": "reports",
    "titleEn": "Review an Israeli VAT month and PCN874 draft",
    "titleHe": "בדיקת חודש מע״מ בישראל וטיוטת PCN874"
  },
  {
    "id": "howto-14-us-quarter-sales-tax-1099",
    "screenId": "reports",
    "titleEn": "Review a US quarter: state sales tax and 1099 readiness",
    "titleHe": "בדיקת רבעון בארה״ב: מס מכירות מדינתי והיערכות ל-1099"
  },
  {
    "id": "howto-15-month-end-close-reopen",
    "screenId": "forensics",
    "titleEn": "Close a month with workpapers or reopen with audit reason",
    "titleHe": "סגירת חודש עם ניירות עבודה ופתיחה מחדש מתועדת"
  },
  {
    "id": "howto-16-backup-restore",
    "screenId": "settings",
    "titleEn": "Export and verify a full JSON backup before changes",
    "titleHe": "ייצוא ואימות גיבוי JSON מלא לפני שינויים"
  },
  {
    "id": "howto-17-group-consolidation",
    "screenId": "reports",
    "titleEn": "Consolidate multiple books in Group Summary and export CSV",
    "titleHe": "איחוד מספר מערכות ספרים בדוח קבוצה וייצוא ל-CSV"
  },
  {
    "id": "howto-18-inline-edit-shortcuts-pins",
    "screenId": "settings",
    "titleEn": "Edit fields in place, pin pages, and use keyboard shortcuts",
    "titleHe": "עריכה ישירה במקום, נעיצת מסכים וקיצורי מקלדת"
  },
  {
    "id": "howto-19-print-light-report-packs",
    "screenId": "reports",
    "titleEn": "Print clean light-mode PDFs and client report packs",
    "titleHe": "הדפסת דוחות וחבילות PDF על רקע בהיר גם במצב כהה"
  },
  {
    "id": "howto-20-demo-books-and-reset",
    "screenId": "help",
    "titleEn": "Try Israel or US sample books and reset demo data safely",
    "titleHe": "התנסות בחברת דמו (ישראל או ארה״ב) ואיפוס נתוני בדיקה"
  }
];

/** Resolves the summary doc metadata for the active workspace screen. */
export function findScreenHelpDocSummary(activeTab: string): ScreenHelpDocSummary {
  return (
    SCREEN_HELP_DOC_SUMMARIES.find((doc) => doc.screenIds.includes(activeTab)) ||
    SCREEN_HELP_DOC_SUMMARIES[0]
  );
}

/** Resolves the related how-to article titles for the active workspace screen. */
export function articleTitlesForScreen(activeTab: string): HowToArticleTitle[] {
  const direct = HOW_TO_ARTICLE_TITLES.filter((article) => article.screenId === activeTab);
  return direct.length > 0 ? direct : HOW_TO_ARTICLE_TITLES.slice(0, 3);
}
