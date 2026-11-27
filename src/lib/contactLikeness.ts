/**
 * Do two customers (or two vendors) look like the same business? Used before a merge, which moves every
 * document and balance and cannot be undone (27 Nov 2026 model test: both assistant models drafted merging
 * two unrelated companies, and nothing warned). They look alike when they share any of:
 * - the email address, or the email domain (other than a public mail provider);
 * - the tax number (`taxId` or `taxNumber`, compared without spaces, dots or dashes);
 * - a distinctive word of the name (legal forms such as "Ltd", "LLC", "Corp" and the Hebrew בע"מ do not count).
 * Two records that share none of these are probably two different companies: the merge asks for an explicit
 * confirmation that they are the same business.
 */
export interface ContactIdentity { name?: unknown; email?: unknown; taxId?: unknown; taxNumber?: unknown }

// Hebrew legal forms too: בע"מ (Ltd, with any quote mark), חברה (company), ושות' (& Co), שותפות (partnership), עמותה (non-profit)
const HEBREW_LTD = /בע ?["״'׳]? ?מ/g;
const LEGAL_FORMS = new Set(['בעמ', 'בע', 'חברה', 'חברת', 'ושות', 'ושותפים', 'שותפות', 'עמותה', 'ltd', 'limited', 'llc', 'inc', 'incorporated', 'corp', 'corporation', 'co', 'company', 'plc', 'gmbh', 'ag', 'sa', 'srl', 'bv', 'nv', 'pty', 'llp', 'lp', 'the', 'and', 'of', 'group', 'holdings']);
// public mail providers, matched by the provider's name so every country's domain counts (yahoo.co.uk, hotmail.fr,
// gmail.com, walla.co.il …): two people on the same provider are not one company
const PUBLIC_MAIL_PROVIDERS = new Set(['gmail', 'googlemail', 'outlook', 'hotmail', 'live', 'msn', 'yahoo', 'ymail', 'rocketmail', 'icloud', 'me', 'mac',
  'aol', 'proton', 'protonmail', 'pm', 'gmx', 'mail', 'email', 'yandex', 'zoho', 'fastmail', 'tutanota', 'hey', 'walla', 'bezeqint', 'zahav', 'netvision',
  'web', 't-online', 'orange', 'free', 'laposte', 'libero', 'virgilio', 'qq', '163', '126', 'naver', 'daum', 'rediffmail', 'btinternet', 'sky', 'comcast', 'verizon', 'att']);
/** The domain belongs to a public mail provider: its first label is one ("yahoo" in yahoo.co.uk, "mail" in mail.ru). */
const isPublicMail = (domain: string) => PUBLIC_MAIL_PROVIDERS.has(domain.split('.')[0] ?? '');

const text = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');
const nameWords = (value: unknown) => new Set(text(value).replace(HEBREW_LTD, ' ').split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1 && !LEGAL_FORMS.has(word)));
const taxNumber = (contact: ContactIdentity) => text(contact.taxId || contact.taxNumber).replace(/[\s.\-/]/g, '');

export function contactsLookAlike(a: ContactIdentity, b: ContactIdentity): boolean {
  const emailA = text(a.email), emailB = text(b.email);
  if (emailA && emailA === emailB) return true;
  const domainA = emailA.split('@')[1] ?? '', domainB = emailB.split('@')[1] ?? '';
  if (domainA && domainA === domainB && !isPublicMail(domainA)) return true;
  const taxA = taxNumber(a), taxB = taxNumber(b);
  if (taxA && taxA === taxB) return true;
  const wordsB = nameWords(b.name);
  return [...nameWords(a.name)].some(word => wordsB.has(word));
}
