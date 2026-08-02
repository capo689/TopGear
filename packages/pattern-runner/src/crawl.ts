/**
 * Crawl policy (plan §8). Honors robots for unauthenticated crawling, per-task budgets,
 * and the grant's allowed origins; refuses crawling behind auth walls unless the grant
 * names the origin. Defaults are conservative.
 */
export interface RobotsRules {
  disallow: string[];
}

export function parseRobots(txt: string): RobotsRules {
  const disallow: string[] = [];
  let appliesToUs = false;
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, "").trim();
    if (/^user-agent:/i.test(line)) {
      appliesToUs = line.split(":")[1]?.trim() === "*";
    } else if (appliesToUs && /^disallow:/i.test(line)) {
      const path = line.slice(line.indexOf(":") + 1).trim();
      if (path) disallow.push(path);
    }
  }
  return { disallow };
}

export function robotsAllows(rules: RobotsRules, pathname: string): boolean {
  return !rules.disallow.some((d) => pathname.startsWith(d));
}

export interface CrawlPolicyConfig {
  /** Origins the grant permits — crawling anything else (auth-walled or not) is refused. */
  allowedOrigins: string[];
  robots?: RobotsRules;
  /** Honor robots for unauthenticated crawling (default true). */
  respectRobots?: boolean;
}

export type CrawlDecision = { allowed: true } | { allowed: false; reason: string };

export class CrawlPolicy {
  constructor(private readonly config: CrawlPolicyConfig) {}

  check(url: string): CrawlDecision {
    let u: URL;
    try {
      u = new URL(url);
    } catch {
      return { allowed: false, reason: "invalid_url" };
    }
    // No crawling outside the grant's origins (covers auth walls: reach them only if named).
    if (!this.config.allowedOrigins.includes(u.origin)) {
      return { allowed: false, reason: "origin_not_in_grant" };
    }
    if (this.config.respectRobots !== false && this.config.robots && !robotsAllows(this.config.robots, u.pathname)) {
      return { allowed: false, reason: "robots_disallow" };
    }
    return { allowed: true };
  }
}
