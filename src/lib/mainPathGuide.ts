/**
 * The main path, step by step (DA-06): for each step of the main path (docs/ROADMAP.md "The main
 * path"), what Help says: before you start, what you do, what LedgerFlow changes, what you see
 * afterwards, what it affects further on, what can fail, whether it can be undone, what belongs to
 * this workspace only, what happens by itself, and what still needs a person. The claims follow
 * docs/CAPABILITIES.md; where they would say more, the table is right. Shown in Help & Guide → Main path.
 */
import type { PinnedPage } from './pinnedPages';

import { BRAND_NAME } from '../config/brand';
export interface MainPathStep {
  id: string;
  title: string;
  /** where the step is done */
  page: PinnedPage;
  before: string;
  doIt: string;
  changes: string;
  afterwards: string;
  affects: string;
  canFail: string;
  undo: string;
  workspaceOnly: string;
  byItself: string;
  needsPerson: string;
}

export const MAIN_PATH_FIELDS: Array<{ key: keyof Omit<MainPathStep, 'id' | 'title' | 'page'>; label: string }> = [
  { key: 'before', label: 'Before you start' },
  { key: 'doIt', label: 'What you do' },
  { key: 'changes', label: `What ${BRAND_NAME} changes` },
  { key: 'afterwards', label: 'What you see afterwards' },
  { key: 'affects', label: 'What it affects further on' },
  { key: 'canFail', label: 'What can fail' },
  { key: 'undo', label: 'Can it be undone?' },
  { key: 'workspaceOnly', label: 'What belongs to this workspace only' },
  { key: 'byItself', label: 'What happens by itself' },
  { key: 'needsPerson', label: 'What still needs a person' },
];

export const MAIN_PATH: MainPathStep[] = [
  {
    id: 'books', title: '1. Create or open the books', page: { tab: 'dashboard' },
    before: 'Know the business’s currency and the first day of its financial year.',
    doIt: 'Open the workspace name at the top of the sidebar and choose New Workspace, or type to find and open an existing one.',
    changes: 'A new workspace is a separate set of books with you as its owner, its own currency, accounts, people and closed months.',
    afterwards: 'The Overview of that workspace; the sidebar shows its name.',
    affects: 'Everything you enter from now on belongs to the workspace that is open.',
    canFail: 'A workspace you are not a member of does not appear and cannot be opened.',
    undo: 'A workspace can be deleted by its owner; its data is kept for 30 days before it is purged.',
    workspaceOnly: 'Everything: accounts, contacts, entries, labels, people and their roles.',
    byItself: 'The workspace you open is remembered as recent, so it is first in the list next time.',
    needsPerson: 'Choosing the currency and the year start; inviting the others.',
  },
  {
    id: 'accounts', title: '2. Set up or import the accounts', page: { tab: 'ledger' },
    before: 'Have your chart of accounts, and each account’s balance on the day you start.',
    doIt: 'Add accounts in Ledger & Journal, or import a spreadsheet in Settings → Import Data. Type an opening balance as the account shows it: what a loan owes, what a bank holds.',
    changes: 'The accounts are added; an imported batch is marked so it can be undone.',
    afterwards: 'The accounts in the chart, with their opening balances.',
    affects: 'Every report, and which accounts documents post to.',
    canFail: 'A spreadsheet row with a problem stops the import; the preview lists every problem before anything is saved.',
    undo: 'An import is undone in one step while its accounts are unused; an account in use can be archived, not deleted.',
    workspaceOnly: 'The chart of accounts and its opening balances.',
    byItself: 'Accounts are recognised by their type (cash, receivable, income…) so documents find the right one.',
    needsPerson: 'Checking the opening balances agree with the old books.',
  },
  {
    id: 'contacts', title: '3. Add customers, vendors and items', page: { tab: 'settings', sub: 'import' },
    before: 'A list of customers, vendors and the items you sell, if any.',
    doIt: 'Add them as you go from an invoice or bill, or import them in Settings → Import Data.',
    changes: 'The records are saved; items can carry their stock and cost.',
    afterwards: 'Them in the lists, offered when you type on a document.',
    affects: 'Invoices, bills, payments, aging and stock.',
    canFail: 'A duplicate name or a missing required column is listed in the preview and nothing is saved.',
    undo: 'An import is undone while its records are unused; a contact can be deleted and restored.',
    workspaceOnly: 'Contacts and items.',
    byItself: 'Hebrew and English column names are both recognised.',
    needsPerson: 'Merging duplicates that differ only in spelling.',
  },
  {
    id: 'bank', title: '4. Connect or import the bank', page: { tab: 'banking' },
    before: 'Your bank login (for a connection) or a statement file (CSV, OFX, QBO, QIF or BAI2).',
    doIt: 'Connect the bank in Bank Connections, or import a statement on Reconcile.',
    changes: 'The statement lines are stored for this bank account; nothing is posted yet.',
    afterwards: 'The lines waiting on Reconcile.',
    affects: 'Reconciliation and the entries you make from the lines.',
    canFail: 'A bank connection needs the bank-feed service to be set up and can stop syncing; a line already imported is not imported twice.',
    undo: 'Imported lines are kept; an entry made from a line is corrected like any entry.',
    workspaceOnly: 'The bank lines and the connection.',
    byItself: 'A connected bank syncs new lines; bank rules can suggest an account for each line.',
    needsPerson: 'Checking the first import’s dates and currency.',
  },
  {
    id: 'money', title: '5. Enter money in and money out', page: { tab: 'sales' },
    before: 'The customer or vendor, the date and the lines.',
    doIt: 'Make an invoice in Sales or a bill in Purchases, or an entry in Transactions. Save it as a draft until it is final.',
    changes: 'A saved (not draft) document posts a balanced entry, checked by the server; selling a stock item also moves stock and books its cost.',
    afterwards: 'The document with its status; the entry in Transactions.',
    affects: 'Receivables or payables, the reports, aging and stock.',
    canFail: 'An entry that does not balance, a date in a closed month, or a required label that is missing is refused with the reason.',
    undo: 'A saved document is corrected or voided: the old entry is reversed in its own month while that month is open, otherwise today.',
    workspaceOnly: 'Documents and entries.',
    byItself: 'Numbering, tax per line, and the cost of goods sold for stock items.',
    needsPerson: 'Approving invoices where the workspace asks for approval.',
  },
  {
    id: 'classify', title: '6. Classify the activity and add labels', page: { tab: 'inbox' },
    before: 'Bank lines or entries without an account or label.',
    doIt: 'Work through To Review; choose the account, and labels (project, location, property…) on each line where needed.',
    changes: 'The line gets its account and labels; what you choose is learned for next time.',
    afterwards: 'Fewer items in To Review; reports by label include them.',
    affects: 'Reports by account and by label.',
    canFail: 'A label the workspace requires on an account is warned about, or refused if the rule says so.',
    undo: 'An account or label can be changed later (a closed month needs a correction instead).',
    workspaceOnly: 'Labels, rules and what was learned.',
    byItself: 'Bank rules and learned patterns suggest the account; Data Health lists entries missing a required label.',
    needsPerson: 'Confirming suggestions; deciding which labels are required.',
  },
  {
    id: 'payments', title: '7. Record payments', page: { tab: 'payments' },
    before: 'The payment, and the invoices or bills it pays.',
    doIt: 'Receive or pay in Payments and choose what it pays, or mark a document paid.',
    changes: 'The payment posts; the document’s amount due goes down.',
    afterwards: 'The document partly or fully paid; the payment on the bank side waiting to be matched.',
    affects: 'Aging, the customer or vendor balance, cash.',
    canFail: 'Paying more than is due, or allocating more than the payment, is refused.',
    undo: 'A payment can be voided; the documents become due again.',
    workspaceOnly: 'Payments and their allocations.',
    byItself: 'A deposit received earlier can be applied to the invoice.',
    needsPerson: 'Deciding what a payment pays when it is unclear.',
  },
  {
    id: 'reconcile', title: '8. Reconcile', page: { tab: 'reconciliation' },
    before: 'The statement’s closing balance and date.',
    doIt: 'On Reconcile, match each bank line to its entry (or create one), until the difference is zero.',
    changes: 'Matched entries are marked as cleared; the reconciliation is kept with its statement balance.',
    afterwards: 'No unmatched lines up to the statement date and a zero difference.',
    affects: 'The close checklist; a later change to a reconciled month is reported.',
    canFail: 'A difference that is not zero cannot be finished.',
    undo: 'Entries in a reconciled month can still be corrected while the month is open; the change is reported against the reconciliation.',
    workspaceOnly: 'Matches and reconciliations.',
    byItself: `${BRAND_NAME} suggests the best match for each line; it never matches without you.`,
    needsPerson: 'Confirming every match.',
  },
  {
    id: 'reports', title: '9. Read the reports', page: { tab: 'reports', sub: 'pnl' },
    before: 'The period you want.',
    doIt: 'Open Reports and choose the profit and loss, the balance sheet, the trial balance, aging or another report.',
    changes: 'Nothing: reports only read.',
    afterwards: 'Core statements use the full history on the server, with columns and comparisons you choose. Purchase trends can switch from vendor totals to item lines and CSV; item amounts keep each currency separate.',
    affects: 'Nothing changes; exports and the close package use the same figures.',
    canFail: 'If only part of the data is loaded on screen, the report says so. In item purchase trends, load full history before relying on the figures; a refused refresh retains the last result and says so.',
    undo: 'Nothing to undo.',
    workspaceOnly: 'The figures of this workspace (several companies side by side: Reports → Group Summary).',
    byItself: 'Drafts and voided entries are left out.',
    needsPerson: 'Reading them: a figure is not advice.',
  },
  {
    id: 'close', title: '10. Close the period', page: { tab: 'month-end-close' },
    before: 'The month’s bank accounts reconciled and its documents final.',
    doIt: 'On Month-End Close, go through the checklist, sign off what needs it, then close the month.',
    changes: 'Posting to the closed month is refused; a snapshot of every balance is kept.',
    afterwards: 'The month shown as closed; the close package to download.',
    affects: 'Corrections to that month go to the current one; a later change to it is reported against the snapshot.',
    canFail: 'Closing is refused while drafts are dated in the month (they would be stuck); they are listed. Open checklist items are shown, not enforced.',
    undo: 'An owner or accountant can reopen it; reopening is in the audit trail.',
    workspaceOnly: 'Closed months and their snapshots.',
    byItself: 'A reminder to close last month, if you turned it on.',
    needsPerson: 'Deciding the month is done.',
  },
  {
    id: 'backup', title: '11. Back up, and restore', page: { tab: 'settings', sub: 'export' },
    before: 'Owner rights.',
    doIt: 'In Settings → Backup & Export, download a backup; to restore, choose the file.',
    changes: 'A backup changes nothing. A restore replaces the workspace’s data with the backup’s.',
    afterwards: 'The backup file; after a restore, the books as they were then.',
    affects: 'A restore affects every screen and report.',
    canFail: 'A backup made before a month was closed is refused, so closed books are never replaced by an older state; a damaged file is refused.',
    undo: 'Take a backup just before restoring, so the restore itself can be undone.',
    workspaceOnly: 'The backup holds this workspace only.',
    byItself: 'The backup is checked when it is read back.',
    needsPerson: 'Keeping backups somewhere safe.',
  },
  {
    id: 'explain', title: '12. See where a number comes from', page: { tab: 'reports', sub: 'balance-sheet' },
    before: 'A report open.',
    doIt: 'Click an account or a figure on the profit and loss, the balance sheet, the trial balance, budget vs actual or aging.',
    changes: 'Nothing.',
    afterwards: 'Every line behind the figure from the full history, adding up to it, with its document, bank match and files; each opens its invoice, bill or entry.',
    affects: 'Nothing.',
    canFail: 'If the full history cannot be read, the lines this screen loaded are shown and said to be partial.',
    undo: 'Nothing to undo.',
    workspaceOnly: 'The lines of this workspace.',
    byItself: 'The total is checked against the figure clicked; a difference is said.',
    needsPerson: 'Deciding what to do about a figure.',
  },
];
