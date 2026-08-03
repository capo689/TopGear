/**
 * COST-03 best-effort rate limiting. ONE limiter INSTANCE = ONE bucket namespace; you call
 * it with a SINGLE value as the key (an IP, or a VERIFIED installId) — NEVER a composite of
 * both. Two independent buckets means rotating one value cannot widen the other's bound, and
 * spoofing one cannot consume another's budget.
 *
 * In-memory sliding window with NO durable storage, so it is per warm serverless instance
 * only: a distributed flood across instances, or an attacker rotating IPs, still escapes it.
 * The Vercel functions inline a byte-identical copy (they must be dependency-free); the stub
 * imports this so stub and function share behavior, and parity.test.ts guards the pair.
 */
export function createRateLimiter(windowMs = 60_000, max = 60): (key: string, now?: number) => boolean {
  const hits = new Map<string, number[]>();
  return (key: string, now: number = Date.now()): boolean => {
    const arr = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    arr.push(now);
    hits.set(key, arr);
    if (hits.size > 5000) for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
    return arr.length > max;
  };
}

/** Best-effort client IP from proxy headers (Vercel sets x-forwarded-for). */
export function clientIp(req: { headers?: Record<string, unknown> }): string {
  const xff = req?.headers?.["x-forwarded-for"];
  const first = Array.isArray(xff) ? xff[0] : typeof xff === "string" ? xff.split(",")[0] : undefined;
  return (((first as string) || (req?.headers?.["x-real-ip"] as string) || "unknown") as string).toString().trim();
}
