import express from 'express';
import crypto from 'crypto';
import { getDb } from '../db/firestore';
import { safeFetch } from '../utils/safeFetch';
import { errorMessage } from '../auth/requestUser';

/**
 * Currency rates and tax-rate lookups from apilayer.com, cached in external_api_cache (moved out of
 * server.ts, F-01). Mounted with sign-in at /api/v1/currency and /api/v1/tax. Without the API key
 * they answer 503 "not set up yet".
 */
export const currencyRouter = express.Router();
export const taxDataRouter = express.Router();

function sendError(res: express.Response, message: string, status: number, details?: unknown) {
  res.status(status).json({ status: 'error', message, ...(details ? { details } : {}) });
}

/** GET through the cache: a stored answer younger than ttlMs, otherwise the API (errors aren't cached). */
async function fetchWithCache(url: string, headers: Record<string, string>, cacheKey: string, ttlMs: number): Promise<unknown> {
  const cacheRef = getDb().collection('external_api_cache').doc(cacheKey);
  const snap = await cacheRef.get();
  const cached = snap.exists ? snap.data() : undefined;
  if (cached && Date.now() - (cached.timestamp || 0) < ttlMs) return cached.payload;

  const response = await safeFetch(url, { method: 'GET', headers, allowedHostnames: ['api.apilayer.com'] });
  if (!response.ok) throw new Error(`API responded with ${response.status}: ${await response.text()}`);
  const payload = await response.json() as { success?: boolean };
  if (payload.success === false) return payload; // an application-level error: don't cache
  try {
    await cacheRef.set({ timestamp: Date.now(), payload });
  } catch (err) {
    console.error('Cache save error:', err);
  }
  return payload;
}

const urlKey = (url: string) => crypto.createHash('sha256').update(url).digest('hex');

currencyRouter.get('/:endpoint', async (req, res) => {
  try {
    const { endpoint } = req.params;
    if (!['list', 'live', 'convert', 'historical', 'timeframe', 'change'].includes(endpoint)) {
      return sendError(res, 'Invalid currency API endpoint', 400);
    }
    const apiKey = process.env.CURRENCY_API_KEY;
    if (!apiKey) return sendError(res, 'Currency rates are not set up yet (CURRENCY_API_KEY)', 503);
    const url = `https://api.apilayer.com/currency_data/${endpoint}?${new URLSearchParams(req.query as Record<string, string>).toString()}`;
    // live rates for 6 hours; history and the currency list don't change
    const ttlMs = ['historical', 'list', 'timeframe'].includes(endpoint) ? 1000 * 60 * 60 * 24 * 365 : 1000 * 60 * 60 * 6;
    res.json(await fetchWithCache(url, { apikey: apiKey }, `currency_${urlKey(url)}`, ttlMs));
  } catch (error) {
    console.error('[Currency] Proxy error:', error);
    sendError(res, 'Failed to fetch currency data', 500, errorMessage(error));
  }
});

taxDataRouter.get('/:endpoint', async (req, res) => {
  try {
    const { endpoint } = req.params;
    if (!['tax_rates', 'us_rate_list'].includes(endpoint)) return sendError(res, 'Invalid tax API endpoint', 400);
    const apiKey = process.env.TAX_API_KEY;
    if (!apiKey) return sendError(res, 'Tax rates are not set up yet (TAX_API_KEY)', 503);
    const url = `https://api.apilayer.com/tax_data/${endpoint}?${new URLSearchParams(req.query as Record<string, string>).toString()}`;
    // tax rates change rarely: 30 days
    res.json(await fetchWithCache(url, { apikey: apiKey }, `tax_${urlKey(url)}`, 1000 * 60 * 60 * 24 * 30));
  } catch (error) {
    console.error('[Tax] Proxy error:', error);
    sendError(res, 'Failed to fetch tax data', 500, errorMessage(error));
  }
});
