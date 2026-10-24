/**
 * A-138: the Israeli bank and branch code table.
 *
 * Every payment in Israel names its bank by the Bank of Israel's two-character identification
 * code (the "bank code"): it is the first part of an Israeli IBAN and the bank number on a
 * cheque, a Masav file and a bank statement. The branch that follows it is three digits. This
 * table holds the codes a bookkeeper can meet today, each read from the Bank of Israel's own
 * lists on 2026-10-23:
 *
 * - the supervised banking corporations and foreign banks (BOI "Supervised Banking Corporations
 *   and Merchant Acquirers": the reporting symbol is the bank code followed by 001);
 * - the other account-holding codes in use in the payment systems (BOI Appendix A, the 2019
 *   "List of identification codes", page updated 22 September 2023) and the nonbank payment
 *   service providers the Bank of Israel allocated codes to after 2019 (its allocation notices);
 * - one retired code, Union Bank (13), kept so an old statement still reads: it merged into
 *   Mizrahi Tefahot in 2022.
 *
 * Appendix A also names Palestinian-Authority-area and older bank codes; they are not copied
 * here, so a code this table does not know is "not in the table", never a guess — the BOI list
 * governs. Branch *names and addresses* change as branches open and close, so they are not
 * copied either: the Bank of Israel publishes the live branch list, and this file carries the
 * branch code's shape and where it sits in the IBAN instead.
 *
 * The Bank of Israel announced on 13 January 2026 that identification codes expand from two
 * digits to three, in use from January 2027; a two-digit code is its three-digit form with the
 * leading zero dropped, so lookups accept both. Status is 'calculation' throughout: a reference
 * table for reading and checking account details, never a payment decision.
 */
import { ibanProblem } from './banking/ibanCountrySpecs';

export type IsraeliBankKind =
  | 'bank' | 'foreign bank' | 'bank group brand' | 'postal bank'
  | 'clearing' | 'central bank' | 'payment service provider' | 'retired';

export interface IsraeliBankSource {
  authority: string;
  url: string;
  /** the day the row was read from the authority's page (YYYY-MM-DD) */
  retrieved: string;
  status?: 'calculation';
}

export interface IsraeliBankRow {
  /** the Bank of Israel identification code, always two digits ('10', '03') */
  code: string;
  name: string;
  /** the bank's own Hebrew name, where it has one */
  nameHe?: string;
  kind: IsraeliBankKind;
  source: IsraeliBankSource;
  note?: string;
}

const CHECKED = '2026-10-23';
const BOI = 'Bank of Israel';
const BOI_SUPERVISED: IsraeliBankSource = {
  authority: BOI,
  url: 'https://www.boi.org.il/en/economic-roles/supervision-and-regulation/list_supervised/',
  retrieved: CHECKED, status: 'calculation',
};
const BOI_APPENDIX_A: IsraeliBankSource = {
  authority: BOI,
  url: 'https://www.boi.org.il/en/communication-and-publications/press-releases/allocation-of-identification-codes-for-all-payments-service-providers-in-the-various-payment-systems/',
  retrieved: CHECKED, status: 'calculation',
};
const BOI_ALLOCATIONS: IsraeliBankSource = {
  authority: BOI,
  url: 'https://www.boi.org.il/en/communication-and-publications/press-releases/allocation-of-an-identification-codes-to-nonbank-payment-service-providers-okoora-trade-flow-ltd-and-gama-management-and-settlement-ltd/',
  retrieved: CHECKED, status: 'calculation',
};

/** The live BOI branch list — branch names and addresses are read there, never copied here. */
export const BOI_BRANCH_LIST_URL = 'https://www.boi.org.il/en/information-and-service-to-the-public/bank-branches/';

export const ISRAELI_BANK_CODES: IsraeliBankRow[] = [
  // Supervised banks (BOI supervised list; the reporting symbol is the code followed by 001).
  { code: '03', name: 'Bank Esh Israel Ltd.', nameHe: 'בנק אש ישראל', kind: 'bank', source: BOI_SUPERVISED, note: 'Code allocated by the Bank of Israel in 2022 (the code Appendix A had marked to be vacated)' },
  { code: '04', name: 'Bank Yahav for Government Employees Ltd.', nameHe: 'בנק יהב', kind: 'bank', source: BOI_SUPERVISED },
  { code: '10', name: 'Bank Leumi Le-Israel Ltd.', nameHe: 'בנק לאומי', kind: 'bank', source: BOI_SUPERVISED },
  { code: '11', name: 'Israel Discount Bank Ltd.', nameHe: 'בנק דיסקונט', kind: 'bank', source: BOI_SUPERVISED },
  { code: '12', name: 'Bank Hapoalim Ltd.', nameHe: 'בנק הפועלים', kind: 'bank', source: BOI_SUPERVISED },
  { code: '17', name: 'Mercantile Discount Bank Ltd.', nameHe: 'בנק מרכנתיל דיסקונט', kind: 'bank', source: BOI_SUPERVISED },
  { code: '18', name: 'One Zero Digital Bank Ltd.', nameHe: 'וואן זירו הבנק הדיגיטלי', kind: 'bank', source: BOI_SUPERVISED, note: 'Code allocated after Appendix A (which had marked 18 to be vacated)' },
  { code: '20', name: 'Mizrahi Tefahot Bank Ltd.', nameHe: 'בנק מזרחי טפחות', kind: 'bank', source: BOI_SUPERVISED },
  { code: '31', name: 'The First International Bank of Israel Ltd.', nameHe: 'הבנק הבינלאומי הראשון', kind: 'bank', source: BOI_SUPERVISED },
  { code: '46', name: 'Bank Massad Ltd.', nameHe: 'בנק מסד', kind: 'bank', source: BOI_SUPERVISED },
  { code: '54', name: 'Bank of Jerusalem', nameHe: 'בנק ירושלים', kind: 'bank', source: BOI_SUPERVISED },
  // Foreign banks with an Israeli branch (same BOI list).
  { code: '22', name: 'Citibank N.A', kind: 'foreign bank', source: BOI_SUPERVISED },
  { code: '23', name: 'HSBC Bank plc', kind: 'foreign bank', source: BOI_SUPERVISED },
  { code: '27', name: 'Barclays plc', kind: 'foreign bank', source: BOI_SUPERVISED, note: 'Code allocated after Appendix A (which had marked 27 to be vacated)' },
  { code: '39', name: 'State Bank of India', kind: 'foreign bank', source: BOI_SUPERVISED },
  // Banking-group brands that hold customer accounts under their own code (Appendix A).
  { code: '14', name: 'Bank Otsar Hahayal Ltd.', nameHe: 'בנק אוצר החייל', kind: 'bank group brand', source: BOI_APPENDIX_A, note: 'First International group; customer accounts keep bank code 14' },
  { code: '26', name: 'U-Bank Ltd.', nameHe: 'יו-בנק', kind: 'bank group brand', source: BOI_APPENDIX_A, note: 'First International group; customer accounts keep bank code 26' },
  { code: '34', name: 'Arab-Israeli Bank Ltd.', nameHe: 'הבנק הערבי הישראלי', kind: 'bank group brand', source: BOI_APPENDIX_A, note: 'Leumi group; customer accounts keep bank code 34' },
  { code: '52', name: 'Poalei Agudat Yisrael Bank Ltd.', nameHe: 'בנק פועלי אגודת ישראל', kind: 'bank group brand', source: BOI_APPENDIX_A, note: 'First International group; customer accounts keep bank code 52' },
  // Postal bank, clearing houses and the central bank (Appendix A; Masav also on the supervised list).
  { code: '09', name: 'Postal Bank Company Ltd.', nameHe: 'בנק הדואר', kind: 'postal bank', source: BOI_APPENDIX_A, note: 'Supervised by the Ministry of Communications, so it is not on the Banking Supervision list' },
  { code: '50', name: 'Bank Clearing Center Ltd. (Masav)', nameHe: 'מס״ב', kind: 'clearing', source: BOI_SUPERVISED, note: 'The automated clearing house; its code appears on Masav files, not on customer accounts' },
  { code: '59', name: 'Automatic Bank Services Ltd. (Shva)', nameHe: 'שב״א', kind: 'clearing', source: BOI_APPENDIX_A, note: 'Card clearing; its code appears in the payment systems, not on customer accounts' },
  { code: '99', name: 'Bank of Israel', nameHe: 'בנק ישראל', kind: 'central bank', source: BOI_APPENDIX_A },
  // Nonbank payment service providers, credit union and acquirers allocated a BOI code (BOI allocation notices).
  { code: '01', name: 'Isracard Ltd.', nameHe: 'ישראכרט', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Card acquirer and payment service provider identification code; not a bank' },
  { code: '02', name: 'Cal — Israel Credit Cards Ltd.', nameHe: 'כאל (כרטיסי אשראי לישראל)', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Card acquirer and payment service provider identification code; not a bank' },
  { code: '06', name: 'Max It Finance Ltd.', nameHe: 'מקס איט פיננסים', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Card acquirer and payment service provider identification code; not a bank' },
  { code: '15', name: 'Ofek Credit Union Cooperative Society Ltd.', nameHe: 'אופק אגודה שיתופית לניהול הון', kind: 'bank', source: BOI_ALLOCATIONS, note: 'Supervised credit union allocated a Bank of Israel identification code' },
  { code: '21', name: 'Neema (Shva / FinTech)', nameHe: 'נאמה', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Nonbank payment service provider allocated a code under the 2019 framework; not a bank' },
  { code: '35', name: 'Meshulam Payment Solutions Ltd. (Grow by Meshulam)', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Allocated 2023; not a bank — it cannot take deposits like one' },
  { code: '47', name: 'Global Remit — Currency Services Ltd.', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Allocated 2023; not a bank' },
  { code: '58', name: 'Rewire (Remitly Israel)', nameHe: 'ריווייר', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Nonbank payment service provider allocated a code under the 2019 framework; not a bank' },
  { code: '60', name: 'Cardcom Settlements Ltd.', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Allocated 2022; not a bank' },
  { code: '61', name: 'Tranzila Ltd.', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Allocated 2022; not a bank' },
  { code: '75', name: 'Rapyd Financial Network (1996) Ltd.', nameHe: 'רפיד פיננשל נטוורק', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Nonbank payment service provider allocated a code under the 2019 framework; not a bank' },
  { code: '78', name: 'Revolut Ltd.', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Allocated 2024; an international nonbank payment service provider, not an Israeli bank' },
  { code: '79', name: 'Monox Payment Services Ltd.', nameHe: 'מונוקס שירותי תשלום', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Nonbank payment service provider allocated a code under the 2019 framework; not a bank' },
  { code: '85', name: 'Upay Payment Services Ltd.', nameHe: 'יופיי שירותי תשלום', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Nonbank payment service provider allocated a code under the 2019 framework; not a bank' },
  { code: '86', name: 'A.T.M.S Matrix Ltd.', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Allocated 2023; not a bank' },
  { code: '92', name: 'Okoora Trade Flow Ltd.', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Allocated 2025; not a bank' },
  { code: '94', name: 'Gama Management and Clearing Ltd.', kind: 'payment service provider', source: BOI_ALLOCATIONS, note: 'Allocated 2025; not a bank' },
  // Retired.
  { code: '13', name: 'Union Bank of Israel Ltd.', nameHe: 'בנק איגוד', kind: 'retired', source: BOI_APPENDIX_A, note: 'Merged into Mizrahi Tefahot Bank (20) in 2022; accounts moved there. Kept so old statements still read — do not pay new money to a code-13 account' },
];

const BY_CODE = new Map(ISRAELI_BANK_CODES.map(row => [row.code, row]));

/** A bank code as the table holds it: two digits ('3', '03' and the coming '003' all read as '03'), or '' when it is not 1–3 digits. */
export function normaliseBankCode(value: string | number): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  if (!digits || digits.length > 3) return '';
  return digits.padStart(2, '0').slice(-2);
}

/** The bank behind a code, or null when the table does not know it (never a guess). */
export function bankByCode(value: string | number): IsraeliBankRow | null {
  return BY_CODE.get(normaliseBankCode(value)) || null;
}

/** Why this is not an Israeli branch code, or null: a branch code is three digits (001–999). */
export function branchCodeProblem(value: string): string | null {
  const branch = String(value ?? '').trim();
  if (!/^\d{1,3}$/.test(branch)) return `Branch code "${branch}" is not 1 to 3 digits — an Israeli branch code is three digits, like 678 (a shorter one is written with a leading zero in an IBAN)`;
  if (branch.padStart(3, '0') === '000') return 'Branch code 000 is not a branch — check the number on the cheque or statement';
  return null;
}

/** The branch code as an IBAN carries it: three digits. */
export function normaliseBranchCode(value: string): string {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits ? digits.padStart(3, '0') : '';
}

export interface IsraeliIbanParts {
  /** two digits, as the table holds it */
  bankCode: string;
  /** three digits */
  branchCode: string;
  /** 13 digits, as the IBAN carries it (leading zeros included) */
  accountNumber: string;
  bank: IsraeliBankRow | null;
  /** why the IBAN cannot be read this way, or null */
  problem: string | null;
}

/**
 * An Israeli IBAN read the way the banks write it: IL, two check digits, then bank (3 digits,
 * the bank code with a leading zero), branch (3) and account (13) — 23 characters in all. The
 * check digits are verified by the shared IBAN check; the bank is named only when the table
 * knows the code.
 */
export function parseIsraeliIban(value: string): IsraeliIbanParts {
  const iban = String(value ?? '').replace(/[\s-]/g, '').toUpperCase();
  const empty = { bankCode: '', branchCode: '', accountNumber: '', bank: null };
  if (!iban.startsWith('IL')) return { ...empty, problem: 'Not an Israeli IBAN — it does not start with IL' };
  const problem = ibanProblem(iban);
  if (problem) return { ...empty, problem };
  const bban = iban.slice(4);
  if (!/^\d{19}$/.test(bban)) return { ...empty, problem: 'An Israeli IBAN is IL, two check digits and 19 digits: bank (3), branch (3) and account (13)' };
  const bankCode = normaliseBankCode(bban.slice(0, 3));
  return {
    bankCode,
    branchCode: bban.slice(3, 6),
    accountNumber: bban.slice(6),
    bank: bankByCode(bankCode),
    problem: null,
  };
}

export interface IsraeliAccountCheck {
  bank: IsraeliBankRow | null;
  /** every problem found, in plain words; empty when the details read cleanly */
  problems: string[];
}

/**
 * Bank, branch and account as they are typed off a cheque or an invoice: the bank is named from
 * the table, the branch must be three digits and the account digits only (up to the 13 an IBAN
 * carries). Each bank also has its own account check-digit rule, which only the bank can verify —
 * a clean read here means the details are well formed, not that the account exists.
 */
export function describeIsraeliBankAccount(input: { bankCode: string; branchCode: string; accountNumber: string }): IsraeliAccountCheck {
  const problems: string[] = [];
  const code = normaliseBankCode(input.bankCode);
  const bank = bankByCode(input.bankCode);
  if (!code) problems.push(`Bank code "${String(input.bankCode ?? '').trim()}" is not digits — the Bank of Israel identification code is two digits, like 12 for Bank Hapoalim`);
  else if (!bank) problems.push(`Bank code ${code} is not in the table — check the Bank of Israel's list of identification codes before using it`);
  else if (bank.kind === 'retired') problems.push(`Bank code ${code} is ${bank.name}, which no longer holds accounts — ${bank.note}`);
  const branchProblem = branchCodeProblem(input.branchCode);
  if (branchProblem) problems.push(branchProblem);
  const account = String(input.accountNumber ?? '').trim().replace(/[\s-]/g, '');
  if (!/^\d+$/.test(account)) problems.push('The account number is digits only — take out any letters and keep the number as the bank prints it');
  else if (account.length > 13) problems.push(`The account number has ${account.length} digits; an Israeli IBAN carries at most 13 — check it against the cheque or statement`);
  return { bank, problems };
}

/** Rows whose code, English name or Hebrew name matches the typed text; an empty text is the whole table. */
export function searchIsraeliBanks(text: string): IsraeliBankRow[] {
  const needle = String(text ?? '').trim().toLowerCase();
  if (!needle) return [...ISRAELI_BANK_CODES];
  return ISRAELI_BANK_CODES.filter(row =>
    row.code === normaliseBankCode(needle)
    || row.name.toLowerCase().includes(needle)
    || (row.nameHe || '').includes(needle));
}

export const ISRAELI_BANK_CODES_CSV_HEADERS = ['Bank code', 'Bank', 'Name (Hebrew)', 'Kind', 'Note', 'Source', 'Source read'] as const;

export function israeliBankCodesCsvRows(rows: IsraeliBankRow[]): string[][] {
  return rows.map(row => [
    row.code, row.name, row.nameHe || '', row.kind, row.note || '',
    `${row.source.authority}, ${row.source.url}`, row.source.retrieved,
  ]);
}

/** The one-line source note the screen prints under the table. */
export function israeliBankCodesSourceText(): string {
  return `Read from the ${BOI}'s supervised banking corporations list and its list of identification codes (Appendix A, with the later allocation notices) on ${CHECKED}. Codes expand to three digits from January 2027 (a leading zero: 10 becomes 010); both forms are accepted here. Branch names and addresses change as branches open and close, so they are read from the Bank of Israel's live branch list, not copied here.`;
}
