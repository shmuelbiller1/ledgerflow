import { z } from 'zod';
import {
  BRANDED_DOCUMENTS,
  BRANDED_DOCUMENT_LABELS,
  DEFAULT_BRAND_COLOR,
  DOCUMENT_STYLES,
  LOGO_DATA_URL,
  MAX_LOGO_BYTES,
  brandColor,
  type BrandedDocument,
  type WorkspaceBranding,
} from './brandingConstants';

/**
 * How documents look (Y-11…Y-17, Y-33, Y-34): logo, brand colour, address under the company name,
 * a footer on every page, default terms per document type, and the "scan to pay" code on invoices.
 * Saved on the workspace (`branding`) by the server (PUT /api/v1/workspaces/:id/branding), read by
 * the PDF (src/server/services/pdfService.ts).
 */
export {
  BRANDED_DOCUMENTS,
  BRANDED_DOCUMENT_LABELS,
  DEFAULT_BRAND_COLOR,
  DOCUMENT_STYLES,
  LOGO_DATA_URL,
  MAX_LOGO_BYTES,
  brandColor,
  type BrandedDocument,
  type WorkspaceBranding,
};

export const BrandingSchema = z.object({
  logoDataUrl: z.string().max(Math.ceil(MAX_LOGO_BYTES * 4 / 3) + 40).regex(LOGO_DATA_URL, 'The logo must be a PNG or JPEG image').optional().or(z.literal('')),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a colour like #1F6FEB').optional().or(z.literal('')),
  address: z.string().max(300).optional(),
  footer: z.string().max(300).optional(),
  terms: z.object(Object.fromEntries(BRANDED_DOCUMENTS.map(d => [d, z.string().max(2000).optional()])) as Record<BrandedDocument, z.ZodOptional<z.ZodString>>).partial().strict().optional(),
  /** Print a QR code to the invoice's payment page (default on). */
  showPaymentQr: z.boolean().optional(),
  /** P-11: the language of the printed words on documents (a customer can have their own; src/lib/documentLanguage.ts) */
  language: z.enum(['en', 'he']).optional(),
  /** Y-11: the page's look: classic (the default), a bold coloured band across the top, or minimal (no coloured fills) */
  style: z.enum(['classic', 'bold', 'minimal']).optional(),
  /** Y-11: leave out the quantity column (a service business billing amounts) */
  hideQuantity: z.boolean().optional(),
}).strict();
