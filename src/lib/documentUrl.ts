/**
 * Which stored-file URL the browser is allowed to render, open or fetch.
 *
 * A file lives as one row of `documents` with its bytes (or a link) in `fileUrl`, and that row is
 * writable by the whole workspace (the database's own rule only asks for membership — see issue
 * #915). So the value is untrusted input by the time a screen paints it: a row can carry
 * `javascript:`, a `data:text/html` page, a remote http(s) tracker, or a `blob:` address that is
 * meaningless in the reader's session.
 *
 * Two narrow shapes are accepted, and nothing else:
 *   - a base64 `data:` address of one of the four formats the preview understands
 *     (PDF, PNG, JPEG, WebP) — what the upload paths write (`src/lib/attachments.ts`,
 *     `Vault.tsx`, the receipt dialog);
 *   - an `https:` link (a file stored elsewhere).
 *
 * `http:` (mixed content, no transport guarantee), `blob:` (session-scoped), `javascript:`,
 * `vbscript:`, `file:` and any non-base64 / non-previewable `data:` address are refused.
 */

/** The media types an in-app preview may embed (mirrors `attachmentPreviewKind`). */
export const EMBEDDABLE_DATA_TYPES = ['application/pdf', 'image/png', 'image/jpeg', 'image/webp'] as const;

/** `data:<one of EMBEDDABLE_DATA_TYPES>;base64,<payload>` — the shape the uploaders write. */
const EMBEDDABLE_DATA_URL = /^data:(application\/pdf|image\/(?:png|jpeg|webp));base64,[A-Za-z0-9+/=\s]+$/i;

/** A base64 `data:` address of a file that is downloaded rather than embedded. */
const DOWNLOADABLE_DATA_URL = /^data:[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*(?:;[a-z0-9=.+-]+)*;base64,[A-Za-z0-9+/=\s]+$/i;

/** Media types that stay refused even as a download: they are documents a browser can execute. */
const EXECUTABLE_DATA_TYPES = ['text/html', 'application/xhtml+xml', 'image/svg+xml', 'application/javascript', 'text/javascript'];

function mediaTypeOf(dataUrl: string): string {
  return dataUrl.slice('data:'.length).split(/[;,]/, 1)[0].toLowerCase();
}

function httpsUrl(value: string): string | null {
  try {
    return new URL(value).protocol === 'https:' ? value : null;
  } catch {
    return null;
  }
}

/**
 * The URL to put in an `img`, an `iframe`, a PDF preview or a `fetch` of a stored file — or null
 * when the value is not a base64 PDF/PNG/JPEG/WebP address or an `https:` link.
 */
export function safeEmbeddedDocumentUrl(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (EMBEDDABLE_DATA_URL.test(raw)) return raw;
  return httpsUrl(raw);
}

/**
 * The URL to put in a download / "open in a new tab" link — or null when it is not a base64
 * `data:` address of a non-executable file or an `https:` link. Text pages, SVG and scripts are
 * refused even here: a link that runs is not a download.
 */
export function safeDownloadDocumentUrl(value: unknown): string | null {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return null;
  if (DOWNLOADABLE_DATA_URL.test(raw) && !EXECUTABLE_DATA_TYPES.includes(mediaTypeOf(raw))) return raw;
  return httpsUrl(raw);
}
