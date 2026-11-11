import { Request, Response, NextFunction } from 'express';

import { BRAND_NAME } from '../../config/brand';
export interface CsrfOptions {
  isAllowedOrigin: (origin: string) => boolean;
  ignoredPaths?: RegExp[];
}

/**
 * CSRF Protection Middleware for API endpoints.
 * Protects state-changing operations (POST, PUT, PATCH, DELETE) against Cross-Site Request Forgery.
 * Exempts external webhook endpoints that use cryptographic signatures (e.g. Stripe).
 */
export function csrfProtection(options: CsrfOptions) {
  const ignoredPrefixes = [
    '/api/webhook/',
    '/api/v1/workspaces/webhooks/',
    '/api/v1/public/',
    '/api/ai/',
    '/api/v1/ai/'
  ];

  return (req: Request, res: Response, next: NextFunction) => {
    // Safe idempotent methods do not mutate state
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      return next();
    }

    const path = req.path || req.originalUrl || '';

    // Bypass for external webhooks with their own signature verification
    if (ignoredPrefixes.some(prefix => path.startsWith(prefix))) {
      return next();
    }

    if (options.ignoredPaths && options.ignoredPaths.some(regex => regex.test(path))) {
      return next();
    }

    // 1. Check Origin or Referer header
    const origin = req.headers['origin'] as string | undefined;
    const referer = req.headers['referer'] as string | undefined;

    if (origin) {
      if (!options.isAllowedOrigin(origin)) {
        return res.status(403).json({
          status: 'error',
          code: 'CSRF_ORIGIN_FORBIDDEN',
          message: 'Origin header does not match permitted domain origins.'
        });
      }
    } else if (referer) {
      try {
        const refUrl = new URL(referer);
        if (!options.isAllowedOrigin(refUrl.origin)) {
          return res.status(403).json({
            status: 'error',
            code: 'CSRF_REFERER_FORBIDDEN',
            message: 'Referer header does not match permitted domain origins.'
          });
        }
      } catch {
        return res.status(403).json({
          status: 'error',
          code: 'CSRF_INVALID_REFERER',
          message: 'Malformed referer header.'
        });
      }
    }

    // 2. Defense-in-depth: Require custom header or bearer authorization for state-mutating requests
    // Browser form submissions cannot send custom headers or Bearer tokens without CORS preflight.
    const customHeader = req.headers['x-ledgerflow-request'] || req.headers['x-requested-with'];
    const authHeader = req.headers['authorization'];

    // In non-browser automated test environments or when Authorization/X-LedgerFlow-Request header is provided
    if (authHeader || customHeader || req.headers['x-internal-job'] || req.headers['stripe-signature']) {
      return next();
    }

    // If both origin/referer and custom headers are missing on state-changing requests, reject
    if (!origin && !referer) {
      // If request has Content-Type application/json from direct API call, check if user has custom header
      return res.status(403).json({
        status: 'error',
        code: 'CSRF_MISSING_CUSTOM_HEADER',
        message: `State-changing API requests require custom client header X-${BRAND_NAME}-Request or Authorization.`
      });
    }

    return next();
  };
}
