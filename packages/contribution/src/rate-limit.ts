/**
 * COST-03 best-effort rate limiting. ONE limiter INSTANCE = ONE bucket namespace; you call
 * it with a SINGLE value as the key (a trusted client IP, or a VERIFIED installId) — NEVER a
 * composite of both. Two independent buckets means rotating one value cannot widen the
 * other's bound, and spoofing one cannot consume another's budget.
 *
 * In-memory sliding window with NO durable storage, so it is per warm serverless instance
 * only: a distributed flood across instances still escapes it. The Vercel functions carry a
 * behaviourally-identical copy of this logic (they must be dependency-free); parity.test.ts
 * guards the pair — there is no unenforced "byte-identical" claim.
 *
 * The returned function returns 0 when allowed, or a positive Retry-After (whole seconds)
 * when the key is over its limit, so callers can set the header.
 */
export type RateLimiter = ((key: string, now?: number) => number) & { size: () => number };

export function createRateLimiter(windowMs = 60_000, max = 60, maxKeys = 10_000): RateLimiter {
  const hits = new Map<string, number[]>();
  const limiter = (key: string, now: number = Date.now()): number => {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (arr.length >= max) {
      // Over the cap: do NOT push (bounds a single hot key's array — a saturated key can't grow
      // unboundedly), and rejected requests are NOT counted, so the window DRAINS windowMs after
      // the last ACCEPTED request rather than being a permanent penalty box.
      hits.set(key, arr);
      return Math.max(1, Math.ceil((windowMs - (now - (arr[0] ?? now))) / 1000));
    }
    arr.push(now);
    hits.set(key, arr);
    // Hard cap on distinct keys with UNCONDITIONAL eviction (Map preserves insertion order, so
    // this drops the oldest-inserted key). Correctness must NOT depend on anything being
    // expired — under key rotation nothing is ever expired, but memory + per-request cost stay
    // bounded because we evict regardless.
    while (hits.size > maxKeys) hits.delete(hits.keys().next().value as string);
    return 0;
  };
  (limiter as RateLimiter).size = () => hits.size;
  return limiter as RateLimiter;
}

/**
 * Best-effort client IP for rate limiting. Prefers x-vercel-forwarded-for, then x-real-ip;
 * x-forwarded-for is consulted LAST and only its RIGHTMOST entry (defense for non-Vercel
 * proxies, where the client controls the leftmost).
 *
 * MEASURED (2026-08-03, against the deployed Vercel preview via api/probe-ip, since removed):
 * client-supplied x-vercel-forwarded-for / x-real-ip / x-forwarded-for were ALL overwritten by
 * Vercel's edge with the real client IP — spoofed values (203.0.113.1 / 8.8.8.8 / 1.2.3.4)
 * were discarded and the function saw 97.115.x.x for all three, identical to baseline. So on
 * Vercel these headers are platform-controlled; a client cannot forge them. (Evidence, not an
 * assertion — the same failure mode the "byte-identical" claim had.)
 */
export function clientIp(req: { headers?: Record<string, unknown> }): string {
  const h = req?.headers ?? {};
  const val = (name: string): string | undefined => {
    const v = h[name];
    const s = Array.isArray(v) ? v[v.length - 1] : typeof v === "string" ? v : undefined;
    return s ? s.trim() : undefined;
  };
  const vercel = val("x-vercel-forwarded-for");
  if (vercel) return vercel.split(",").pop()!.trim();
  const real = val("x-real-ip");
  if (real) return real;
  const xff = val("x-forwarded-for");
  if (xff) return xff.split(",").pop()!.trim();
  return "unknown";
}
