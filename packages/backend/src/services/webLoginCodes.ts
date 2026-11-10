import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * One-time codes for the browser login handoff.
 *
 * The login redirects used to carry the user's JWT itself
 * (`/auth/callback?token=…`): a seven-day credential in the browser history,
 * in proxy logs and in any Referer. The redirect now carries a code that is
 * good for one exchange within a minute and is worthless without the nonce
 * cookie set on the same response — so a link with someone else's code cannot
 * sign a victim into the attacker's account either (login CSRF).
 */
const DEFAULT_TTL_MS = 60 * 1000;
const DEFAULT_MAX_PENDING = 1_024;
const VALUE_PATTERN = /^[A-Za-z0-9_-]{43,128}$/;

interface PendingWebLogin {
  userId: string;
  nonceDigest: string;
  expiresAt: number;
}

const digest = (value: string): string => createHash('sha256').update(value, 'ascii').digest('hex');

function digestsMatch(actual: string, expected: string): boolean {
  const a = Buffer.from(actual, 'ascii');
  const b = Buffer.from(expected, 'ascii');
  return a.length === b.length && timingSafeEqual(a, b);
}

export class WebLoginCodeStore {
  private readonly pending = new Map<string, PendingWebLogin>();

  constructor(
    private readonly now: () => number = Date.now,
    private readonly createValue: () => string = () => randomBytes(32).toString('base64url'),
    private readonly ttlMs = DEFAULT_TTL_MS,
    private readonly maxPending = DEFAULT_MAX_PENDING
  ) {}

  /** A code for the redirect and the nonce for the cookie that goes with it. */
  issue(userId: string): { code: string; nonce: string } {
    if (!userId) throw new Error('Invalid web login request');
    this.pruneExpired();
    while (this.pending.size >= this.maxPending) {
      const oldest = this.pending.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.pending.delete(oldest);
    }
    const code = this.createValue();
    const nonce = this.createValue();
    this.pending.set(digest(code), {
      userId,
      nonceDigest: digest(nonce),
      expiresAt: this.now() + this.ttlMs,
    });
    return { code, nonce };
  }

  /** The user of a code presented with its nonce; a code works once. */
  exchange(code: string, nonce: string): string | null {
    if (!VALUE_PATTERN.test(code) || !VALUE_PATTERN.test(nonce)) return null;
    const key = digest(code);
    const entry = this.pending.get(key);
    if (!entry) return null;
    // Spent on the first attempt, right or wrong: no second guess at the nonce.
    this.pending.delete(key);
    if (entry.expiresAt <= this.now()) return null;
    return digestsMatch(digest(nonce), entry.nonceDigest) ? entry.userId : null;
  }

  private pruneExpired(): void {
    const now = this.now();
    for (const [key, entry] of this.pending) {
      if (entry.expiresAt <= now) this.pending.delete(key);
    }
  }
}

export const webLoginCodes = new WebLoginCodeStore();
export const WEB_LOGIN_NONCE_COOKIE = 'plum_login_nonce';
