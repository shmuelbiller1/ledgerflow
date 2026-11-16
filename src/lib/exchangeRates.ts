/**
 * Exchange rate help on foreign-currency documents (BA-06, I-23): the rate is how many units of
 * the home currency one unit of the document's currency is worth (as on the invoice and bill
 * forms). Never a guessed number: the last rate this workspace used for that currency, or today's
 * rate from the server's rate service when it answers.
 */
import { runCommand } from './runCommand';

export function lastUsedRate(currency: string, docs: Array<{ currency?: string; exchangeRate?: number; date?: string }>): number | null {
  const used = docs
    .filter(d => d.currency === currency && typeof d.exchangeRate === 'number' && d.exchangeRate > 0 && d.exchangeRate !== 1)
    .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))[0];
  return used?.exchangeRate ?? null;
}

/** Today's rate for 1 `from` in `to`, or null when the rate service can't answer. */
export async function fetchLiveRate(from: string, to: string): Promise<number | null> {
  try {
    const data = await runCommand<{ rate?: unknown }>({
      path: `/api/v1/fx/rate?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`,
    });
    const rate = Number(data?.rate);
    return Number.isFinite(rate) && rate > 0 && rate < 1e6 ? Math.round(rate * 10000) / 10000 : null;
  } catch {
    return null;
  }
}

/** Common world currencies offered on documents (ISO 4217). */
export const WORLD_CURRENCIES = ['USD', 'EUR', 'GBP', 'ILS', 'CAD', 'AUD', 'NZD', 'JPY', 'CHF', 'CNY', 'HKD', 'SGD', 'INR', 'SEK',
  'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'ZAR', 'BRL', 'MXN', 'ARS', 'CLP', 'COP', 'AED', 'SAR', 'KRW', 'TWD', 'THB', 'PHP', 'IDR', 'MYR'] as const;

/**
 * Currencies to choose from on an invoice or bill (BA-06): the home currency, this document's, the
 * ones the workspace already uses, then the common world currencies.
 */
export function documentCurrencies(home: string, current: string | undefined, used: Array<{ currency?: string }>): string[] {
  const inUse = used.map(d => (d.currency || '').toUpperCase()).filter(c => /^[A-Z]{3}$/.test(c));
  return [...new Set([home, ...(current ? [current] : []), ...inUse, ...WORLD_CURRENCIES])];
}

/** A rate this workspace used: on which day, how many documents used it (K-29). */
export interface RateUse { date: string; rate: number; count: number }

interface RatedDoc { currency?: string; exchangeRate?: number; date?: string }

/**
 * Exchange-rate history at posting (K-29): the rates the workspace's documents were posted at for
 * one currency, by day (newest first). Built from the documents themselves, so it is exactly what
 * the books used.
 */
export function rateHistory(currency: string, docs: RatedDoc[]): RateUse[] {
  const byKey = new Map<string, RateUse>();
  for (const d of docs) {
    if (d.currency !== currency || typeof d.exchangeRate !== 'number' || !(d.exchangeRate > 0) || d.exchangeRate === 1 || !d.date) continue;
    const date = d.date.slice(0, 10);
    const key = `${date}|${d.exchangeRate}`;
    const use = byKey.get(key) || { date, rate: d.exchangeRate, count: 0 };
    use.count += 1;
    byKey.set(key, use);
  }
  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date) || a.rate - b.rate);
}

/** The rate used on `date`, or the closest day before it; null when none was used by then. */
export function rateOn(currency: string, date: string, docs: RatedDoc[]): RateUse | null {
  return rateHistory(currency, docs).find(u => u.date <= date.slice(0, 10)) ?? null;
}

/** BB-02: one currency the workspace's documents use besides its own. */
export interface CurrencyInUse {
  currency: string;
  /** invoices and bills in it */
  documents: number;
  /** of them, still open (owed to or by the business) */
  open: number;
  /** the newest rate a document was posted at, and its day */
  lastRate: number | null;
  lastDate: string | null;
}

/** The currencies the workspace's invoices and bills use other than its own, most used first. */
export function currenciesInUse(home: string, docs: Array<RatedDoc & { open?: boolean }>): CurrencyInUse[] {
  const byCurrency = new Map<string, CurrencyInUse>();
  for (const d of docs) {
    const currency = (d.currency || '').toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency) || currency === home) continue;
    const row = byCurrency.get(currency) || { currency, documents: 0, open: 0, lastRate: null, lastDate: null };
    row.documents += 1;
    if (d.open) row.open += 1;
    byCurrency.set(currency, row);
  }
  for (const row of byCurrency.values()) {
    const last = rateHistory(row.currency, docs)[0];
    if (last) { row.lastRate = last.rate; row.lastDate = last.date; }
  }
  return [...byCurrency.values()].sort((a, b) => b.documents - a.documents || a.currency.localeCompare(b.currency));
}
