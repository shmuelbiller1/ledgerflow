import rateLimit from 'express-rate-limit';
import { sharedAuthRateLimiter, sharedBrainRateLimiter, sharedRateLimitMiddleware } from './sharedRateLimiter';

/**
 * Strict rate limiter for Authentication and Password Reset endpoints.
 * 5 attempts per 15 minutes per IP.
 */
export const authRateLimiter = sharedRateLimitMiddleware(
  sharedAuthRateLimiter,
  req => String(req.ip || req.socket.remoteAddress || 'unknown'),
);

/**
 * Rate limiter for public invoice views.
 * 30 views per minute per IP.
 */
export const publicInvoiceLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Too many public invoice requests. Please slow down.'
  }
});

/**
 * AU-1: Plaid's webhook is public; each request with an unknown key id costs a call to Plaid before it
 * can be refused. Plaid sends a handful of notices per connection, so 60 per minute per IP is ample.
 */
export const plaidWebhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', code: 'RATE_LIMIT_EXCEEDED', message: 'Too many webhook requests.' },
});

/**
 * Rate limiter for compute-heavy PDF generation endpoints.
 * 10 requests per minute per IP.
 */
export const pdfGenerationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    status: 'error',
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'PDF generation rate limit reached. Please wait a moment before generating more documents.'
  }
});

/**
 * Rate limiter for AI Brain & Financial LLM reasoning endpoints (/api/v1/brain/*).
 * 20 requests per minute per IP.
 */
export const brainRateLimiter = sharedRateLimitMiddleware(
  sharedBrainRateLimiter,
  req => String((req as typeof req & { user?: { uid?: string; id?: string } }).user?.uid ||
    (req as typeof req & { user?: { uid?: string; id?: string } }).user?.id ||
    req.ip || req.socket.remoteAddress || 'unknown'),
);

/** Z-02: an API key's own limit a minute (set when the key is made; 120 unless chosen). */
export const API_KEY_DEFAULT_PER_MINUTE = 120;
export function apiKeyLimit(raw: unknown): number {
  const n = Number(raw);
  return Number.isInteger(n) && n >= 10 && n <= 10_000 ? n : API_KEY_DEFAULT_PER_MINUTE;
}

/**
 * Z-02: requests made with an API key count against that key, not the caller's IP: each key has
 * its own limit a minute (`rateLimitPerMinute` on the key), so one busy integration does not slow
 * the others. Only API-key requests pass through it (apiAuthenticate).
 */
export const apiKeyRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: (req) => apiKeyLimit((req as unknown as { user?: { apiKeyRateLimit?: number } }).user?.apiKeyRateLimit),
  keyGenerator: (req) => `api-key:${String((req as unknown as { user?: { usedApiKeyId?: string } }).user?.usedApiKeyId || 'none')}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { status: 'error', code: 'RATE_LIMIT_EXCEEDED', message: 'This API key has made too many requests this minute. Please wait and try again.' },
});

/**
 * The app-wide limiters (F-01, moved from server.ts). A new set per app, so each app (and each
 * test) counts on its own.
 */
export function createAppRateLimiters() {
  // Rate Limiting - Increased for production SPA load
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 1000, // increased to 1000 to prevent false positives in high-density SPA usage
    message: { status: "error", message: "Maximum rate limit reached. Please hold for calibration." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Rate limiter specifically for transaction matching to prevent abuse / DOS (Strategic Key Protection)
  const matchLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 120, // 120 matching inquiries per minute
    message: { status: "error", message: "Transaction matching rate limit exceeded. Please throttle request intensity." },
    standardHeaders: true,
    legacyHeaders: false,
  });

  // Interceptor middleware for Developer API Logging
  const apiLimiter = rateLimit({
    windowMs: 60 * 1000, // 1 minute window
    max: 100, // Limit each IP to 100 requests per `window` (here, per minute)
    message: { status: "error", message: "Too many requests from this IP, please try again after a minute." },
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
  });
  return { limiter, matchLimiter, apiLimiter };
}
