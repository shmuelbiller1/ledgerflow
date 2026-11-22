/**
 * Documents in the customer's language (P-11): the printed words on a PDF (its title, the labels,
 * the totals, the page numbers) in English or Hebrew. The workspace chooses its documents' language
 * (Settings → Branding, `branding.language`) and a customer can have their own (`documentLanguage`
 * in the customer's `metadata`). A customer can also have their own terms printed on their documents
 * in place of the workspace's (P-12, `documentTerms` in their `metadata`). What people typed (names, lines, terms, footer) prints as typed;
 * amounts and dates print the same in both.
 */
export const DOCUMENT_LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'he', label: 'עברית (Hebrew)' },
] as const;
export type DocumentLanguage = typeof DOCUMENT_LANGUAGES[number]['value'];

const isLanguage = (v: unknown): v is DocumentLanguage => DOCUMENT_LANGUAGES.some(l => l.value === v);

/** The contact's own language, else the workspace's, else English. */
export function documentLanguage(branding: { language?: unknown } | null | undefined, contact?: { metadata?: unknown } | null): DocumentLanguage {
  const own = (contact?.metadata as { documentLanguage?: unknown } | undefined)?.documentLanguage;
  if (isLanguage(own)) return own;
  return isLanguage(branding?.language) ? branding.language : 'en';
}

export const MAX_CONTACT_TERMS = 2000;

/** The contact's own terms for their documents (P-12), or undefined to print the workspace's. */
export function contactTerms(contact?: { metadata?: unknown } | null): string | undefined {
  const own = (contact?.metadata as { documentTerms?: unknown } | undefined)?.documentTerms;
  return typeof own === 'string' && own.trim() ? own.trim().slice(0, MAX_CONTACT_TERMS) : undefined;
}

export type DocumentKind = 'invoice' | 'estimate' | 'creditNote' | 'payment' | 'statement' | 'purchaseOrder' | 'bill' | 'vendorCredit';

export interface DocumentWords {
  titles: Record<DocumentKind | 'saleReceipt' | 'salesOrder', string>;
  recipient: Record<DocumentKind, string>;
  number: string; date: string; signedBy: string; validUntil: string; deliverBy: string; due: string; terms: string; yourReference: string; period: string;
  paymentTerms: (code: string) => string | undefined;
  subtotal: string; discount: string; tax: string; included: string; total: string; balance: string; deposit: string; amountDue: string;
  description: string; quantity: string; amount: string; item: string; client: string;
  scanToPay: string; termsHeading: string;
  page: (n: number, of: number) => string;
  watermark: Record<'DRAFT' | 'VOID' | 'PAID', string>;
  /** IL-2: Israeli documents say whether this print is the original or a copy */
  copyMark: Record<'original' | 'copy', string>;
  /** IL-6 */
  allocationNumber: string;
  /** #890 (J-6): the seller's VAT registration printed under its address */
  vatNumber: string;
}

const NET = /^net_(\d{1,3})$/;

export const DOCUMENT_WORDS: Record<DocumentLanguage, DocumentWords> = {
  en: {
    titles: {
      invoice: 'INVOICE', estimate: 'ESTIMATE', creditNote: 'CREDIT NOTE', payment: 'PAYMENT RECEIPT', statement: 'STATEMENT',
      purchaseOrder: 'PURCHASE ORDER', bill: 'BILL', vendorCredit: 'VENDOR CREDIT', saleReceipt: 'SALES RECEIPT', salesOrder: 'SALES ORDER',
    },
    recipient: {
      invoice: 'BILLED TO', estimate: 'PREPARED FOR', creditNote: 'CREDITED TO', payment: 'RECEIVED FROM', statement: 'STATEMENT FOR',
      purchaseOrder: 'ORDERED FROM', bill: 'FROM VENDOR', vendorCredit: 'FROM VENDOR',
    },
    number: 'Number', date: 'Date', signedBy: 'Signed by', validUntil: 'Valid until', deliverBy: 'Deliver by', due: 'Due', terms: 'Terms', yourReference: 'Your reference', period: 'Period',
    paymentTerms: code => (code === 'due_on_receipt' ? 'Due on receipt' : NET.test(code) ? `Net ${code.match(NET)![1]}` : undefined),
    subtotal: 'Subtotal', discount: 'Discount', tax: 'Tax', included: 'incl.', total: 'TOTAL', balance: 'BALANCE', deposit: 'Deposit received', amountDue: 'AMOUNT DUE',
    description: 'DESCRIPTION', quantity: 'QTY', amount: 'AMOUNT', item: 'Item', client: 'Valued Client',
    scanToPay: 'Scan to view and pay', termsHeading: 'Terms',
    page: (n, of) => `Page ${n} of ${of}`,
    watermark: { DRAFT: 'DRAFT', VOID: 'VOID', PAID: 'PAID' },
    copyMark: { original: 'ORIGINAL', copy: 'TRUE COPY' },
    allocationNumber: 'Allocation number',
    vatNumber: 'VAT No.',
  },
  he: {
    titles: {
      invoice: 'חשבונית', estimate: 'הצעת מחיר', creditNote: 'הודעת זיכוי', payment: 'קבלה', statement: 'דף חשבון',
      purchaseOrder: 'הזמנת רכש', bill: 'חשבון ספק', vendorCredit: 'זיכוי ספק', saleReceipt: 'חשבונית קבלה', salesOrder: 'הזמנת מכירה',
    },
    recipient: {
      invoice: 'לכבוד', estimate: 'עבור', creditNote: 'זיכוי עבור', payment: 'התקבל מאת', statement: 'דף חשבון עבור',
      purchaseOrder: 'הוזמן מאת', bill: 'מהספק', vendorCredit: 'מהספק',
    },
    number: 'מספר', date: 'תאריך', signedBy: 'נחתם על ידי', validUntil: 'בתוקף עד', deliverBy: 'מועד אספקה', due: 'לתשלום עד', terms: 'תנאי תשלום', yourReference: 'האסמכתא שלכם', period: 'תקופה',
    paymentTerms: code => (code === 'due_on_receipt' ? 'מיידי' : NET.test(code) ? `תוך ${code.match(NET)![1]} ימים` : undefined),
    subtotal: 'סכום ביניים', discount: 'הנחה', tax: 'מס', included: 'כלול', total: 'סה״כ', balance: 'יתרה', deposit: 'מקדמה שהתקבלה', amountDue: 'לתשלום',
    description: 'תיאור', quantity: 'כמות', amount: 'סכום', item: 'פריט', client: 'לקוח',
    scanToPay: 'סרקו לצפייה ולתשלום', termsHeading: 'תנאים',
    page: (n, of) => `עמוד ${n} מתוך ${of}`,
    watermark: { DRAFT: 'טיוטה', VOID: 'מבוטל', PAID: 'שולם' },
    copyMark: { original: 'מקור', copy: 'העתק נאמן למקור' },
    allocationNumber: 'מספר הקצאה',
    vatNumber: 'עוסק מורשה',
  },
};
