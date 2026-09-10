import type { Request, Response, NextFunction } from 'express';

interface RateLimitConfig {
  name: string; // Stable limiter identifier used as the bucket key
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  message?: string; // Error message
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

// In-memory store for rate limits (can be replaced with Redis for multi-instance)
const rateLimitStore = new Map<string, RateLimitEntry>();

// Cleanup old entries periodically
const rateLimitCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitStore) {
    if (entry.resetTime < now) {
      rateLimitStore.delete(key);
    }
  }
}, 60000); // Cleanup every minute
rateLimitCleanupTimer.unref();

/**
 * Get client identifier for rate limiting. Relies on req.ip, which respects
 * Express's `trust proxy` setting. Trusting X-Forwarded-For directly lets an
 * attacker spoof any IP and defeat the limit, so that path is intentionally
 * removed — configure TRUST_PROXY to the correct hop count instead.
 */
function getClientId(req: Request): string {
  const userId = (req as unknown as { userId?: string }).userId;
  if (userId) {
    return `user:${userId}`;
  }

  const ip = req.ip || req.socket.remoteAddress || 'unknown';
  return `ip:${ip}`;
}

/**
 * Create a rate limiter middleware. `name` must be stable across all requests
 * that share the limit — keying on req.path means `/api/sessions/abc` and
 * `/api/sessions/def` get independent buckets, which is never what we want.
 */
export function createRateLimiter(config: RateLimitConfig) {
  const {
    name,
    windowMs,
    maxRequests,
    message = 'Too many requests, please try again later',
  } = config;

  return (req: Request, res: Response, next: NextFunction) => {
    const clientId = getClientId(req);
    const key = `${clientId}:${name}`;
    const now = Date.now();

    let entry = rateLimitStore.get(key);

    if (!entry || entry.resetTime < now) {
      entry = {
        count: 1,
        resetTime: now + windowMs,
      };
      rateLimitStore.set(key, entry);
      return next();
    }

    entry.count++;

    if (entry.count > maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      res.set('Retry-After', String(retryAfter));
      return res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message,
          retryAfter,
        },
      });
    }

    next();
  };
}

// Pre-configured rate limiters for common use cases
export const rateLimiters = {
  // Standard API rate limit: 100 requests per minute
  standard: createRateLimiter({
    name: 'standard',
    windowMs: 60 * 1000,
    maxRequests: 100,
  }),

  // Strict rate limit for sensitive operations: 10 per minute
  strict: createRateLimiter({
    name: 'strict',
    windowMs: 60 * 1000,
    maxRequests: 10,
    message: 'Too many attempts, please wait before trying again',
  }),

  // File upload limit: 20 uploads per minute
  upload: createRateLimiter({
    name: 'upload',
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: 'Too many file uploads, please wait before uploading more',
  }),

  // Chunk uploads use many small requests by design. This separate bucket
  // prevents abuse without making a valid 25 MB resumable upload impossible.
  uploadChunk: createRateLimiter({
    name: 'uploadChunk',
    windowMs: 60 * 1000,
    maxRequests: 240,
    message: 'Uploading chunks too quickly, please wait',
  }),

  // Session creation: 5 per minute
  sessionCreation: createRateLimiter({
    name: 'sessionCreation',
    windowMs: 60 * 1000,
    maxRequests: 5,
    message: 'Too many sessions created, please wait before creating more',
  }),

  // Message sending: 30 per minute (per session)
  messaging: createRateLimiter({
    name: 'messaging',
    windowMs: 60 * 1000,
    maxRequests: 30,
    message: 'Sending messages too quickly, please slow down',
  }),

  // Localhost port probing: 12 per minute. One request opens up to 48 outbound
  // connections to 127.0.0.1, so an unlimited endpoint is a scan amplifier
  // against whatever else runs in the container.
  portProbe: createRateLimiter({
    name: 'portProbe',
    windowMs: 60 * 1000,
    maxRequests: 12,
    message: 'Scanning preview ports too quickly, please wait',
  }),

  // Speech-to-text: 20 per minute. Each request forwards up to 25 MB to an
  // external Whisper service, so this is both an egress and a cost limit.
  transcribe: createRateLimiter({
    name: 'transcribe',
    windowMs: 60 * 1000,
    maxRequests: 20,
    message: 'Too many transcription requests, please wait',
  }),

  // Provider quota lookups: 60 per minute. Each one is an outbound call to
  // Anthropic, OpenAI or Z.AI with the user's own OAuth token, so an unlimited
  // endpoint lets a stuck frontend poll loop burn through the upstream's own
  // rate limit and get the account throttled.
  usageLimits: createRateLimiter({
    name: 'usageLimits',
    windowMs: 60 * 1000,
    maxRequests: 60,
    message: 'Too many quota lookups, please wait',
  }),

  // Image generation: 5 per minute
  imageGeneration: createRateLimiter({
    name: 'imageGeneration',
    windowMs: 60 * 1000,
    maxRequests: 5,
    message: 'Too many image generation requests, please wait',
  }),
};

export default rateLimiters;
