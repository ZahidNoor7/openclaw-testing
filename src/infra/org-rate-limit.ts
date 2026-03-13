/**
 * Per-organization sliding-window rate limiter.
 *
 * Tracks request counts by orgId so that one organization cannot monopolise
 * gateway resources.  Uses the same sliding-window algorithm as
 * `gateway/auth-rate-limit.ts` but keyed by org ID rather than client IP.
 *
 * Usage:
 *   const limiter = createOrgRateLimiter();
 *   const result = limiter.check("org_acme");
 *   if (!result.allowed) throw new Error("Rate limit exceeded");
 *   limiter.record("org_acme");
 */

export interface OrgRateLimitConfig {
  /** Maximum requests allowed in the window.  @default 60 */
  maxRequests?: number;
  /** Sliding window duration in ms.  @default 60_000 (1 minute) */
  windowMs?: number;
  /** Prune stale entries interval in ms; <=0 disables auto-prune.  @default 60_000 */
  pruneIntervalMs?: number;
}

export interface OrgRateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export interface OrgRateLimiter {
  check(orgId: string): OrgRateLimitResult;
  record(orgId: string): void;
  reset(orgId: string): void;
  size(): number;
  prune(): void;
  dispose(): void;
}

const DEFAULT_MAX_REQUESTS = 60;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_PRUNE_INTERVAL_MS = 60_000;

interface Entry {
  /** Epoch-ms timestamps of requests within the current window. */
  attempts: number[];
}

export function createOrgRateLimiter(config?: OrgRateLimitConfig): OrgRateLimiter {
  const maxRequests = config?.maxRequests ?? DEFAULT_MAX_REQUESTS;
  const windowMs = config?.windowMs ?? DEFAULT_WINDOW_MS;
  const pruneIntervalMs = config?.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS;

  const entries = new Map<string, Entry>();

  const pruneTimer = pruneIntervalMs > 0 ? setInterval(() => prune(), pruneIntervalMs) : null;
  if (pruneTimer && "unref" in pruneTimer) {
    pruneTimer.unref();
  }

  function slide(entry: Entry, now: number): void {
    const cutoff = now - windowMs;
    entry.attempts = entry.attempts.filter((ts) => ts > cutoff);
  }

  function check(orgId: string): OrgRateLimitResult {
    const now = Date.now();
    const entry = entries.get(orgId);
    if (!entry) {
      return { allowed: true, remaining: maxRequests, retryAfterMs: 0 };
    }
    slide(entry, now);
    const remaining = Math.max(0, maxRequests - entry.attempts.length);
    return { allowed: remaining > 0, remaining, retryAfterMs: 0 };
  }

  function record(orgId: string): void {
    const now = Date.now();
    let entry = entries.get(orgId);
    if (!entry) {
      entry = { attempts: [] };
      entries.set(orgId, entry);
    }
    slide(entry, now);
    entry.attempts.push(now);
  }

  function reset(orgId: string): void {
    entries.delete(orgId);
  }

  function prune(): void {
    const now = Date.now();
    for (const [orgId, entry] of entries) {
      slide(entry, now);
      if (entry.attempts.length === 0) {
        entries.delete(orgId);
      }
    }
  }

  function size(): number {
    return entries.size;
  }

  function dispose(): void {
    if (pruneTimer) {
      clearInterval(pruneTimer);
    }
    entries.clear();
  }

  return { check, record, reset, size, prune, dispose };
}

/** Module-level singleton for use across org commands and gateway handlers. */
export const orgRateLimiter: OrgRateLimiter = createOrgRateLimiter();
