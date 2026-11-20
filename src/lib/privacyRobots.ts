/**
 * Agent #6 (security lane) — AF6-20261120-02: a link that is a credential must not be crawlable.
 *
 * Five pages are opened with a token in the path and no sign-in at all: `/i/<token>` (an invoice a
 * customer views and pays), `/c/<token>` (the customer portal), `/e/<token>` (an estimate a customer
 * signs), `/invite/<token>` (a workspace invitation) and, in the same family, nothing else. The token
 * *is* the credential: whoever has the URL can read the document — a customer's name, address, line
 * items, amounts — and, on `/i/` and `/e/`, act on it.
 *
 * Every one of those pages is served the same `index.html`, whose `<meta name="robots">` says
 * `index, follow, max-image-preview:large, …`, and the site's `public/robots.txt` allowed every path.
 * So a customer who forwards their invoice link into a public place (a forum, a support thread, a
 * public "my invoice" page) hands it to a search engine: the page is crawled, its text indexed, its
 * snippet cached, and the link stays findable — and the same for link-preview bots that fetch a URL
 * pasted into chat.
 *
 * The route is decided here, once, before React renders: the token paths get `noindex, nofollow,
 * noarchive, nosnippet, noimageindex` and the rest of the site keeps the marketing directives it has.
 * `public/robots.txt` also keeps the four token prefixes (and `/api/`) out of a crawl, so a crawler
 * that never fetches the page still does not fetch a customer's document. The two do not fight:
 * robots.txt stops the crawl, which is the protection that matters for a credential, and the meta
 * directive covers the crawler that arrived from a public link anyway.
 *
 * `X-Robots-Tag` on those responses is the server-side half and belongs to the API lane (it must be
 * sent before the SPA loads); it is reported with this finding, not patched here.
 */

/** Path prefixes whose first segment after the slash is a bearer token. */
export const TOKEN_PAGE_PREFIXES = ['/i/', '/c/', '/e/', '/invite/'] as const;

/** The site's own pages: indexable, as `index.html` says. */
export const PUBLIC_ROBOTS = 'index, follow, max-image-preview:large, max-snippet:-1, max-video-preview:-1';

/** A token page: not indexed, not followed, not cached as a snippet or a picture. */
export const TOKEN_PAGE_ROBOTS = 'noindex, nofollow, noarchive, nosnippet, noimageindex';

/** Is this pathname a token page (a document or an invitation that nobody signed in to see)? */
export function isTokenPagePath(pathname: string | null | undefined): boolean {
  const path = String(pathname || '/');
  return TOKEN_PAGE_PREFIXES.some(prefix => path.startsWith(prefix));
}

/** The `robots` directive the document should carry for this pathname. */
export function robotsForPath(pathname: string | null | undefined): string {
  return isTokenPagePath(pathname) ? TOKEN_PAGE_ROBOTS : PUBLIC_ROBOTS;
}

type RobotsDocument = {
  querySelector(selectors: string): { setAttribute(name: string, value: string): void } | null;
  createElement(tag: string): { setAttribute(name: string, value: string): void };
  head: { appendChild(node: unknown): unknown } | null;
};

/**
 * Writes the directive onto the page's `<meta name="robots">` — the one `index.html` already has, or
 * a new one — without depending on a browser (a test passes a document-like object).
 *
 * Failures are swallowed on purpose: a crawler reading this is not worth a blank screen, and a
 * blocked/frozen `document` must not stop the app from opening.
 */
export function applyRobotsDirective(
  pathname: string | null | undefined,
  doc: RobotsDocument | undefined = typeof document === 'undefined' ? undefined : (document as unknown as RobotsDocument),
): string {
  const directive = robotsForPath(pathname);
  if (!doc) return directive;
  try {
    const meta = doc.querySelector('meta[name="robots"]');
    if (meta) {
      meta.setAttribute('name', 'robots');
      meta.setAttribute('content', directive);
      return directive;
    }
    const created = doc.createElement('meta');
    created.setAttribute('name', 'robots');
    created.setAttribute('content', directive);
    doc.head?.appendChild(created);
  } catch {
    /* A document that refuses the write is not a reason to fail the page. */
  }
  return directive;
}
