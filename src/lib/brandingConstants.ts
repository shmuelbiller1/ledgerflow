/**
 * Pure document branding constants, types, and colour helper without Zod runtime overhead,
 * keeping client settings surfaces lightweight while server routes validate via BrandingSchema.
 */
export const BRANDED_DOCUMENTS = ['invoice', 'estimate', 'creditNote', 'statement', 'payment', 'purchaseOrder'] as const;
export type BrandedDocument = typeof BRANDED_DOCUMENTS[number];

export const BRANDED_DOCUMENT_LABELS: Record<BrandedDocument, string> = {
  invoice: 'Invoices', estimate: 'Estimates', creditNote: 'Credit notes', statement: 'Statements', payment: 'Payment receipts', purchaseOrder: 'Purchase orders',
};

/** Largest logo kept (as a data URL): logos are small, and the workspace row is read often. */
export const MAX_LOGO_BYTES = 200_000;
export const LOGO_DATA_URL = /^data:image\/(png|jpeg);base64,[A-Za-z0-9+/]+=*$/;

export const DOCUMENT_STYLES = [
  { value: 'classic', label: 'Classic' },
  { value: 'bold', label: 'Bold header band' },
  { value: 'minimal', label: 'Minimal (no coloured fills)' },
] as const;

export interface WorkspaceBranding {
  logoDataUrl?: string;
  color?: string;
  address?: string;
  footer?: string;
  terms?: Partial<Record<BrandedDocument, string>>;
  /** Print a QR code to the invoice's payment page (default on). */
  showPaymentQr?: boolean;
  /** P-11: the language of the printed words on documents (a customer can have their own; src/lib/documentLanguage.ts) */
  language?: 'en' | 'he';
  /** Y-11: the page's look: classic (the default), a bold coloured band across the top, or minimal (no coloured fills) */
  style?: 'classic' | 'bold' | 'minimal';
  /** Y-11: leave out the quantity column (a service business billing amounts) */
  hideQuantity?: boolean;
}

export const DEFAULT_BRAND_COLOR = '#1F2937';

/** The brand colour as #RRGGBB, or the default when missing or invalid. */
export function brandColor(color?: string): string {
  return /^#[0-9a-fA-F]{6}$/.test(color || '') ? color!.toUpperCase() : DEFAULT_BRAND_COLOR;
}
