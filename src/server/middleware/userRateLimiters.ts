/**
 * S-22: Rate limiting per user on sign-in, password reset and AI routes
 * 
 * Uses the shared Postgres-backed rate limiter to enforce limits per user/identifier
 * rather than per IP address. This prevents abuse while allowing legitimate users
 * to continue working.
 * 
 * Tests with two app instances sharing the same Postgres store.
 */

import { SharedRateLimiter } from './sharedRateLimiter';
import { getDb } from '../db/firestore';
import type { Request, Response, NextFunction } from 'express';

/**
 * Rate limiter configuration for user-based rate limiting
 */
export interface UserRateLimitConfig {
  /** Maximum requests per window */
  max: number;
  /** Window size in milliseconds */
  windowMs: number;
  /** Key prefix for identifying this rate limit type */
  keyPrefix: string;
  /** Message to return when rate limited */
  message: string;
  /** Whether to use user ID or IP as the identifier */
  useUserId: boolean;
}

/**
 * Default configurations for different rate limit types
 */
export const rateLimitConfigs: Record<string, UserRateLimitConfig> = {
  signIn: {
    max: 10,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'signin-user',
    message: 'Too many sign-in attempts. Please wait and try again.',
    useUserId: true
  },
  passwordReset: {
    max: 3,
    windowMs: 60 * 60 * 1000, // 1 hour
    keyPrefix: 'password-reset-user',
    message: 'Too many password reset requests. Please wait before trying again.',
    useUserId: true
  },
  aiRoutes: {
    max: 20,
    windowMs: 60 * 1000, // 1 minute
    keyPrefix: 'ai-user',
    message: 'AI route rate limit exceeded. Please throttle your requests.',
    useUserId: true
  },
  // IP-based fallback for unauthenticated requests
  signInIp: {
    max: 15,
    windowMs: 60 * 1000,
    keyPrefix: 'signin-ip',
    message: 'Too many sign-in attempts from this IP. Please wait and try again.',
    useUserId: false
  },
  passwordResetIp: {
    max: 5,
    windowMs: 60 * 60 * 1000,
    keyPrefix: 'password-reset-ip',
    message: 'Too many password reset requests from this IP. Please wait before trying again.',
    useUserId: false
  },
  aiRoutesIp: {
    max: 30,
    windowMs: 60 * 1000,
    keyPrefix: 'ai-ip',
    message: 'AI route rate limit exceeded for this IP. Please throttle your requests.',
    useUserId: false
  }
};

/**
 * Create a rate limiter middleware for a specific user-based rate limit
 */
export function createUserRateLimitMiddleware(config: UserRateLimitConfig) {
  const limiter = new SharedRateLimiter({
    windowMs: config.windowMs,
    max: config.max,
    keyPrefix: config.keyPrefix
  });

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Get identifier based on configuration
      const identifier = config.useUserId 
        ? getUserIdentifier(req)
        : getIpIdentifier(req);

      const result = await limiter.checkAndIncrement(identifier);

      if (!result.allowed) {
        const retryAfter = Math.ceil((result.resetTime - Date.now()) / 1000);
        
        res.set({
          'X-RateLimit-Limit': String(result.limit),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000)),
          'Retry-After': String(retryAfter)
        });

        return res.status(429).json({
          status: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message: config.message,
          retryAfter
        });
      }

      // Add rate limit headers for successful requests
      res.set({
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(Math.ceil(result.resetTime / 1000))
      });

      next();
    } catch (err) {
      console.error(`[UserRateLimiter] Error in ${config.keyPrefix}:`, err);
      // Fail open - allow the request but log the error
      next();
    }
  };
}

interface AuthedRequest extends Request {
  user?: { uid?: string; email?: string };
}

/**
 * Get user identifier from request (email or user ID)
 */
function getUserIdentifier(req: Request): string {
  // Try to get user from request (set by authenticate or apiAuthenticate middleware)
  const user = (req as AuthedRequest).user;
  
  if (user?.uid) {
    return `user:${user.uid}`;
  }
  
  if (user?.email) {
    return `email:${user.email.toLowerCase()}`;
  }
  
  // Fallback to IP if no user information
  return getIpIdentifier(req);
}

/**
 * Get IP identifier from request
 */
interface IpSource {
  headers: { [key: string]: string | string[] | undefined };
  ip?: string;
  connection?: { remoteAddress?: string };
}

function getIpIdentifier(req: IpSource): string {
  // Try various headers for the real client IP
  const forwardedFor = req.headers['x-forwarded-for'];
  const realIp = req.headers['x-real-ip'];
  
  if (typeof forwardedFor === 'string') {
    // x-forwarded-for can contain multiple IPs, take the first one
    const ips = forwardedFor.split(',').map(ip => ip.trim());
    if (ips.length > 0 && ips[0] !== '::1' && ips[0] !== '127.0.0.1') {
      return `ip:${ips[0]}`;
    }
  }
  
  if (typeof realIp === 'string' && realIp !== '::1' && realIp !== '127.0.0.1') {
    return `ip:${realIp}`;
  }
  
  // Fallback to connection remote address
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

/**
 * Pre-built middleware for sign-in rate limiting
 * 
 * S-22: Rate limiting per user on sign-in
 */
export const signInRateLimiter = createUserRateLimitMiddleware(rateLimitConfigs.signIn);

/**
 * Pre-built middleware for password reset rate limiting
 * 
 * S-22: Rate limiting per user on password reset
 */
export const passwordResetRateLimiter = createUserRateLimitMiddleware(rateLimitConfigs.passwordReset);

/**
 * Pre-built middleware for AI routes rate limiting
 * 
 * S-22: Rate limiting per user on AI routes
 */
export const aiUserRateLimiter = createUserRateLimitMiddleware(rateLimitConfigs.aiRoutes);

/**
 * Combined rate limiting that uses both user-based and IP-based limits
 * 
 * This provides defense in depth: even if an attacker can spoof user identifiers,
 * they're still limited by IP. And legitimate users behind the same IP (e.g., NAT)
 * can still make requests up to their individual limits.
 */
export function createCombinedRateLimitMiddleware(
  userConfig: UserRateLimitConfig,
  ipConfig: UserRateLimitConfig
) {
  const _userLimiter = createUserRateLimitMiddleware(userConfig);
  const _ipLimiter = createUserRateLimitMiddleware(ipConfig);

  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Check both user and IP limits
      const userIdentifier = getUserIdentifier(req);
      const ipIdentifier = getIpIdentifier(req);

      const userLimiterInstance = new SharedRateLimiter({
        windowMs: userConfig.windowMs,
        max: userConfig.max,
        keyPrefix: userConfig.keyPrefix
      });

      const ipLimiterInstance = new SharedRateLimiter({
        windowMs: ipConfig.windowMs,
        max: ipConfig.max,
        keyPrefix: ipConfig.keyPrefix
      });

      const [userResult, ipResult] = await Promise.all([
        userLimiterInstance.checkAndIncrement(userIdentifier),
        ipLimiterInstance.checkAndIncrement(ipIdentifier)
      ]);

      // Fail if either limit is exceeded
      if (!userResult.allowed || !ipResult.allowed) {
        const retryAfter = Math.max(
          Math.ceil((userResult.resetTime - Date.now()) / 1000),
          Math.ceil((ipResult.resetTime - Date.now()) / 1000)
        );

        res.set({
          'X-RateLimit-Limit': String(Math.min(userConfig.max, ipConfig.max)),
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': String(Math.ceil(Math.max(userResult.resetTime, ipResult.resetTime) / 1000)),
          'Retry-After': String(retryAfter)
        });

        const message = !userResult.allowed 
          ? userConfig.message 
          : ipConfig.message;

        return res.status(429).json({
          status: 'error',
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          retryAfter
        });
      }

      // Use the more restrictive limit for headers
      const remaining = Math.min(userResult.remaining, ipResult.remaining);
      const resetTime = Math.max(userResult.resetTime, ipResult.resetTime);

      res.set({
        'X-RateLimit-Limit': String(Math.min(userConfig.max, ipConfig.max)),
        'X-RateLimit-Remaining': String(remaining),
        'X-RateLimit-Reset': String(Math.ceil(resetTime / 1000))
      });

      next();
    } catch (err) {
      console.error('[CombinedRateLimiter] Error:', err);
      next();
    }
  };
}

/**
 * Combined sign-in rate limiter (user + IP)
 */
export const combinedSignInRateLimiter = createCombinedRateLimitMiddleware(
  rateLimitConfigs.signIn,
  rateLimitConfigs.signInIp
);

/**
 * Combined password reset rate limiter (user + IP)
 */
export const combinedPasswordResetRateLimiter = createCombinedRateLimitMiddleware(
  rateLimitConfigs.passwordReset,
  rateLimitConfigs.passwordResetIp
);

/**
 * Combined AI routes rate limiter (user + IP)
 */
export const combinedAiRateLimiter = createCombinedRateLimitMiddleware(
  rateLimitConfigs.aiRoutes,
  rateLimitConfigs.aiRoutesIp
);

/**
 * Rate limit tracking for monitoring and analytics
 */
export class RateLimitTracker {
  private readonly db: ReturnType<typeof getDb>;

  constructor() {
    this.db = getDb();
  }

  /**
   * Record a rate limit event for analytics
   */
  async trackRateLimitEvent(
    identifier: string,
    endpoint: string,
    limitType: string,
    wasBlocked: boolean
  ): Promise<void> {
    try {
      const docRef = this.db.collection('rateLimitEvents').doc();
      await docRef.set({
        identifier,
        endpoint,
        limitType,
        wasBlocked,
        timestamp: new Date().toISOString(),
        ip: getIpIdentifier({ headers: {}, connection: { remoteAddress: '' } })
      });
    } catch (err) {
      // Non-blocking - don't fail the request if tracking fails
      console.error('[RateLimitTracker] Error tracking event:', err);
    }
  }
}

/**
 * Create tracking middleware that records rate limit events
 */
export function createTrackingRateLimitMiddleware(
  config: UserRateLimitConfig,
  endpoint: string
) {
  const limiter = createUserRateLimitMiddleware(config);
  const tracker = new RateLimitTracker();

  return async (req: Request, res: Response, next: NextFunction) => {
    const identifier = config.useUserId 
      ? getUserIdentifier(req) 
      : getIpIdentifier(req);

    // Wrap the response to track if rate limited
    const originalSend = res.send;
    let wasRateLimited = false;

    res.send = function(this: Response, body: unknown) {
      if (res.statusCode === 429) {
        wasRateLimited = true;
      }
      return originalSend.call(this, body as Parameters<typeof originalSend>[0]);
    };

    // Call the limiter
    await limiter(req, res, () => {
      // Track the event
      tracker.trackRateLimitEvent(identifier, endpoint, config.keyPrefix, wasRateLimited);
      next();
    });
  };
}
