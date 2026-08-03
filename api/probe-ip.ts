/**
 * THROWAWAY (wave2d P3) — measures how Vercel's edge treats client-supplied trust headers.
 * Echoes the clientIp() the rate limiter WOULD key on, plus the raw headers the function
 * received, so we can settle (not assert) whether x-vercel-forwarded-for / x-real-ip are
 * platform-controlled. Removed before this branch merges. Echoes only the CALLER's own IP.
 */
function clientIp(req: any): string {
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

export default function handler(req: any, res: any): void {
  res.setHeader("content-type", "application/json");
  res.status(200).end(
    JSON.stringify({
      resolvedKey: clientIp(req),
      seen: {
        "x-vercel-forwarded-for": req?.headers?.["x-vercel-forwarded-for"] ?? null,
        "x-real-ip": req?.headers?.["x-real-ip"] ?? null,
        "x-forwarded-for": req?.headers?.["x-forwarded-for"] ?? null,
      },
    }),
  );
}
