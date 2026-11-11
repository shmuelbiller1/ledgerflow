import { safeFetch } from '../utils/safeFetch';

const RATE_HOST = 'api.exchangerate-api.com';
/** The whole call (connect, answer and body) must finish in this time: a stalled rate service is "not available". */
const RATE_TIMEOUT_MS = 10_000;
type RateTransport = (url: string, timeoutMs: number) => Promise<unknown>;

/** The project's checked fetch (host allow-list, pinned address, no redirects) with one deadline for everything. */
const fetchRates: RateTransport = async (url, timeoutMs) => {
  const response = await safeFetch(url, { allowedHostnames: [RATE_HOST], timeoutMs });
  if (!response.ok) throw new Error(`The rate service answered ${response.status}`);
  return response.json();
};

/** Rejects when `work` has not settled in time; a call that never answers must not hang its caller. */
function withDeadline<T>(work: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('The rate service did not answer in time')), timeoutMs); });
  return Promise.race([work, deadline]).finally(() => clearTimeout(timer));
}

/** The `rates` table of an answer, or null when the answer has no usable one. */
function ratesOf(body: unknown): Record<string, number> | null {
  const rates = (body as { rates?: unknown } | null)?.rates;
  if (!rates || typeof rates !== 'object' || Array.isArray(rates)) return null;
  const usable = Object.entries(rates as Record<string, unknown>).filter(([code, rate]) => /^[A-Z]{3}$/.test(code) && typeof rate === 'number' && Number.isFinite(rate) && rate > 0);
  return usable.length ? Object.fromEntries(usable) as Record<string, number> : null;
}

export interface ExchangeRateResponse {
  base: string;
  date: string;
  rates: Record<string, number>;
}

export class FxService {
  private static cache: Record<string, { rate: number, expires: number }> = {};
  private static CACHE_TTL = 1000 * 60 * 60; // 1 hour
  /** Tests replace these; production uses the checked fetch and a 10-second deadline. */
  static transport: RateTransport = fetchRates;
  static timeoutMs = RATE_TIMEOUT_MS;

  private static async latest(base: string): Promise<Record<string, number> | null> {
    return ratesOf(await withDeadline(this.transport(`https://${RATE_HOST}/v4/latest/${base}`, this.timeoutMs), this.timeoutMs));
  }

  private static normalizeCurrencyCode(input: string, fieldName: string): string {
    const normalized = (input || '').trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(normalized)) {
      throw new Error(`Invalid currency code for ${fieldName}`);
    }
    return normalized;
  }

  /**
   * Fetches the latest exchange rate for a given currency pair.
   * Throws when the rate service can't be reached (never a guessed rate).
   */
  static async getRate(from: string, to: string): Promise<number> {
    const safeFrom = this.normalizeCurrencyCode(from, 'from');
    const safeTo = this.normalizeCurrencyCode(to, 'to');
    if (safeFrom === safeTo) return 1.0;
    
    const cacheKey = `${safeFrom}_${safeTo}`;
    const cached = this.cache[cacheKey];
    if (cached && cached.expires > Date.now()) {
      return cached.rate;
    }

    try {
      const rate = (await this.latest(safeFrom))?.[safeTo];

      if (rate) {
        this.cache[cacheKey] = {
          rate,
          expires: Date.now() + this.CACHE_TTL
        };
        return rate;
      }
    } catch {
      // fall through to the error below
    }

    // no made-up rates when the rate service can't be reached: an invented rate would end up in
    // the books (L-187)
    throw new Error(`The exchange rate ${safeFrom} → ${safeTo} is not available right now`);
  }

  /**
   * Batch fetch rates for revaluation
   */
  static async getRatesForBase(base: string): Promise<Record<string, number>> {
    const safeBase = this.normalizeCurrencyCode(base, 'base');
    let rates: Record<string, number> | null = null;
    try {
      rates = await this.latest(safeBase);
    } catch {
      // the same answer as an unusable reply, below
    }
    // an answer with no rates table is "not available", never a success carrying nothing
    if (!rates) throw new Error(`Exchange rates for ${safeBase} are not available right now`);
    return rates;
  }
}
