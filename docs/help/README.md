# LedgerFlow Bilingual Screen Guides (`EN` / `עברית`)

Each guide explains one main screen area in plain **English** and **Hebrew (`עברית`)**, and is linked directly from that screen's contextual **? Help** button (the manual opens in place, without losing your work).

- [Overview & Dashboard · סקירה כללית](overview.md)
- [Transactions & General Ledger · תנועות יומן והספר הראשי](transactions.md)
- [Sales, Invoices & Customers · מכירות, חשבוניות ולקוחות](sales.md)
- [Purchases, Bills & Suppliers · רכש, חשבוניות ספקים ומלאי](purchases.md)
- [Banking & Statement Imports · בנקאות וייבוא דפי חשבון](banking.md)
- [Bank Reconciliation · התאמות בנקים](reconciliation.md)
- [Financial Statements & Reports · דוחות כספיים וניתוחים](reports.md)
- [Profit and loss · רווח והפסד](pnl.md)
- [Balance sheet · מאזן](balance-sheet.md)
- [Trial balance · מאזן בוחן](trial-balance.md)
- [Israel VAT report · דוח מע״מ בישראל](israel-vat-report.md)
- [Budgets, Projects & Forecasting · תקציבים, פרויקטים ותחזית תזרים](planning.md)
- [Data Health, Period Close & Audit Trail · תקינות נתונים, סגירת תקופה ונתיב ביקורת](forensics.md)
- [Workspace Settings, Security & Backups · הגדרות מערכת, הרשאות וגיבויים](settings.md)
- [Tasks, Time Tracking, Help & Support · משימות, שעות עבודה, עזרה ותמיכה](tasks-and-time.md)
- [Inventory & Fixed Assets · מלאי ורכוש קבוע](inventory-and-assets.md)
- [Tax Manager & Sales Tax Liability · ניהול מס וחבות מס מכירות](taxes.md)
- [Payments, Credits, Loans & Petty Cash · תשלומים, זיכויים, הלוואות וקופה קטנה](cash-and-credit.md)
- [Copilot, Insights, Documents & System Screens · עוזר AI, תובנות, מסמכים ומסכי מערכת](system-and-data.md)

See also: [Accessibility Statement · הצהרת נגישות](../ACCESSIBILITY.md) and [What Works Today (`docs/CAPABILITIES.md`)](../CAPABILITIES.md).

The ten illustrated guides use the same screenshot in both languages: an English, light-theme sample company, not real customer records. The screenshots live in `public/help/` so they also ship with the app. To find the trial balance, open **Ledger & Journal → Accountant Lens → Trial Balance**; its guide is available from Ledger’s Help button. When a screen changes, update its screenshot, both language sections and the matching entry in [`illustratedGuides.json`](../../src/lib/help/illustratedGuides.json) together. The [coverage test](../../src/tests/help-pages-coverage.test.ts) checks the text and assets; the [browser test](../../e2e/illustrated-screen-help.spec.ts) opens them from the actual screens.
