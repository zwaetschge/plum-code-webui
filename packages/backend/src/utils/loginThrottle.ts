/**
 * Per-account brake for password logins.
 *
 * The request rate limit is per IP (10 a minute), so a password could be
 * guessed indefinitely from changing addresses. This counts failures per
 * account name: after a few misses the account is locked for a short, doubling
 * time. A session that is already signed in is not affected, and a successful
 * login clears the count.
 */
export class LoginThrottle {
  private readonly entries = new Map<
    string,
    { failures: number; lockedUntil: number; last: number }
  >();

  constructor(
    private readonly freeAttempts = 5,
    private readonly baseLockMs = 60_000,
    private readonly maxLockMs = 15 * 60_000,
    private readonly forgetAfterMs = 60 * 60_000,
    private readonly now: () => number = Date.now,
    private readonly maxEntries = 10_000
  ) {}

  private static key(account: string): string {
    return account.trim().toLowerCase().slice(0, 200);
  }

  /** Milliseconds until the account may try again; 0 when it is not locked. */
  retryAfterMs(account: string): number {
    const entry = this.entries.get(LoginThrottle.key(account));
    if (!entry) return 0;
    return Math.max(0, entry.lockedUntil - this.now());
  }

  fail(account: string): void {
    const key = LoginThrottle.key(account);
    const now = this.now();
    const previous = this.entries.get(key);
    const failures =
      previous && now - previous.last < this.forgetAfterMs ? previous.failures + 1 : 1;
    const over = failures - this.freeAttempts;
    const lockMs = over >= 0 ? Math.min(this.maxLockMs, this.baseLockMs * 2 ** over) : 0;
    this.entries.delete(key);
    this.entries.set(key, { failures, lockedUntil: now + lockMs, last: now });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.entries.delete(oldest);
    }
  }

  succeed(account: string): void {
    this.entries.delete(LoginThrottle.key(account));
  }
}

export const basicLoginThrottle = new LoginThrottle();
