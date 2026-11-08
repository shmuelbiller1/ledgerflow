import { Request } from 'express';
import { trimEndChar } from '../../lib/textShape';

// On Vercel the production address is known (VERCEL_PROJECT_PRODUCTION_URL, set by Vercel itself,
// never by a request), so it can stand in for APP_URL until a custom domain is configured.
const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL
  ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
  : undefined;

if (process.env.NODE_ENV === 'production' && !process.env.APP_URL && !process.env.VITE_APP_URL && !vercelProductionUrl) {
  throw new Error('APP_URL environment variable is required in production mode');
}

/**
 * Safely determines the application base URL, strictly preventing Host-header poisoning (#85, #85-R, N6).
 */
export function getTrustedAppUrl(req?: Request): string {
  if (process.env.APP_URL) {
    return trimEndChar(process.env.APP_URL, '/');
  }
  if (process.env.VITE_APP_URL) {
    return trimEndChar(process.env.VITE_APP_URL, '/');
  }
  if (vercelProductionUrl) {
    return vercelProductionUrl;
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_URL environment variable is required in production mode');
  }

  if (req) {
    const rawHost = req.get('x-forwarded-host') || req.get('host') || '';
    const cleanHost = rawHost.split(',')[0].trim().toLowerCase();
    
    // In local development, permit localhost/127.0.0.1
    const isLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(cleanHost);
    if (isLocal) {
      const protocol = req.protocol === 'https' || req.get('x-forwarded-proto') === 'https' ? 'https' : 'http';
      return `${protocol}://${cleanHost}`;
    }

    // Explicit trusted first-party domain
    const isFirstParty = /^(?:[a-z0-9-]+\.)*ledgerflow\.app(?::\d+)?$/.test(cleanHost);
    if (isFirstParty) {
      return `https://${cleanHost}`;
    }
  }

  // Safe fallback default for development
  return 'http://localhost:3000';
}
