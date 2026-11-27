/**
 * Do two customers (or two vendors) look like the same business? Used before a merge, which moves every
 * document and balance and cannot be undone (27 Nov 2026 model test: both assistant models drafted merging
 * two unrelated companies, and nothing warned). They look alike when they share any of:
 * - the email address, or the email domain (other than a public mail provider);
 * - the tax number (`taxId` or `taxNumber`, compared without spaces, dots or dashes);
 * - a distinctive word of the name (legal forms such as "Ltd", "LLC" and "Corp" do not count).
 * Two records that share none of these are probably two different companies: the merge asks for an explicit
 * confirmation that they are the same business.
 */
export interface ContactIdentity { name?: unknown; email?: unknown; taxId?: unknown; taxNumber?: unknown }

const LEGAL_FORMS = new Set(['ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'ag', 'sa', 'srl', 'bv', 'nv', 'pty', 'llp', 'lp', 'the', 'and', 'of', 'group', 'holdings']);
const PUBLIC_MAIL = new Set(['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'icloud.com', 'me.com', 'aol.com', 'proton.me', 'protonmail.com', 'gmx.com', 'mail.com']);

const text = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const nameWords = (value: unknown) => new Set(text(value).split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1 && !LEGAL_FORMS.has(word)));
const taxNumber = (contact: ContactIdentity) => text(contact.taxId || contact.taxNumber).replace(/[\s.\-/]/g, '');

export function contactsLookAlike(a: ContactIdentity, b: ContactIdentity): boolean {
  const emailA = text(a.email), emailB = text(b.email);
  if (emailA && emailA === emailB) return true;
  const domainA = emailA.split('@')[1] ?? '', domainB = emailB.split('@')[1] ?? '';
  if (domainA && domainA === domainB && !PUBLIC_MAIL.has(domainA)) return true;
  const taxA = taxNumber(a), taxB = taxNumber(b);
  if (taxA && taxA === taxB) return true;
  const wordsB = nameWords(b.name);
  return [...nameWords(a.name)].some(word => wordsB.has(word));
}
