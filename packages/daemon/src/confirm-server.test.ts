import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { CapabilityStore, systemClock } from "@browser-bridge/policy";
import { startConfirmServer, type ConfirmServerHandle } from "./confirm-server.js";

/**
 * INV-9's approval path had every piece except a channel: capabilities were minted
 * pending, `approveConfirmation` worked, the dialog was written and tested — and nothing
 * connected them, so no high-risk action could ever actually be approved by a human. The
 * invariant held only because the path was unreachable.
 *
 * This is an authorization surface, so its security properties are asserted here rather
 * than assumed: token required, wrong token rejected, loopback only, no CORS, POST-only
 * state changes, and stale capabilities refused instead of hollow-succeeding.
 */

let caps: CapabilityStore;
let server: ConfirmServerHandle;

const SESSION = "s1";
const mintPending = () =>
  caps.mintPending({
    action: { summary: "Submit the application form", formAction: "https://example.com/apply" },
    origin: "https://example.com",
    pageRevision: 1,
    sensitiveFields: ["Email"],
    ttlMs: 60_000,
  });

beforeAll(async () => {
  caps = new CapabilityStore(systemClock);
  server = await startConfirmServer({
    listPending: () => caps.listPending(),
    approve: (_s, id) => caps.approve(id),
    deny: (_s, id) => caps.deny(id),
  });
});

afterAll(async () => {
  await server?.close();
});

const url = (path: string, params: Record<string, string> = {}) => {
  const u = new URL(server.url + path);
  u.searchParams.set("sessionId", SESSION);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
};
const auth = { "x-bb-token": () => server.token };

describe("confirm channel — authorization", () => {
  it("refuses a request with no token", async () => {
    const r = await fetch(url("/pending"));
    expect(r.status).toBe(401);
  });

  it("refuses a request with a wrong token of the same length", async () => {
    const wrong = "f".repeat(server.token.length);
    const r = await fetch(url("/pending"), { headers: { "x-bb-token": wrong } });
    expect(r.status).toBe(401);
  });

  it("binds loopback only, never a routable interface", () => {
    // 0.0.0.0 would expose an approval endpoint to the local network.
    expect(server.url.startsWith("http://127.0.0.1:")).toBe(true);
  });

  it("sends no CORS header, so a web page cannot call it from the user's browser", async () => {
    const r = await fetch(url("/pending"), { headers: { "x-bb-token": server.token } });
    expect(r.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("confirm channel — the approval flow", () => {
  it("lists the daemon's own description of a pending capability", async () => {
    const cap = mintPending();
    const r = await fetch(url("/pending"), { headers: { "x-bb-token": auth["x-bb-token"]() } });
    const body = (await r.json()) as { pending: { capabilityId: string; summary: string; origin: string }[] };

    const found = body.pending.find((p) => p.capabilityId === cap.capabilityId);
    expect(found, JSON.stringify(body)).toBeDefined();
    // The summary is the DAEMON's, taken from the capability it minted.
    expect(found!.summary).toBe("Submit the application form");
    expect(found!.origin).toBe("https://example.com");
  });

  it("approves, and the capability becomes consumable exactly once", async () => {
    const cap = mintPending();
    const r = await fetch(url("/approve", { capabilityId: cap.capabilityId }), {
      method: "POST",
      headers: { "x-bb-token": server.token },
    });
    expect(r.status).toBe(200);

    const first = caps.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 1 });
    expect(first.ok).toBe(true);
    const replay = caps.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 1 });
    expect(replay.ok).toBe(false); // single-use survives approval over the wire
  });

  it("denies, and a denied capability can never later be approved", async () => {
    const cap = mintPending();
    const d = await fetch(url("/deny", { capabilityId: cap.capabilityId }), {
      method: "POST",
      headers: { "x-bb-token": server.token },
    });
    expect(d.status).toBe(200);

    // A UI that can only say yes is not a consent mechanism.
    expect(caps.approve(cap.capabilityId)).toBe(false);
    expect(caps.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 1 }).ok).toBe(false);
  });

  it("refuses to approve via GET, which a link or an <img> could trigger", async () => {
    const cap = mintPending();
    const r = await fetch(url("/approve", { capabilityId: cap.capabilityId }), {
      headers: { "x-bb-token": server.token },
    });
    expect(r.status).toBe(404);
    expect(caps.consume(cap.capabilityId, { origin: "https://example.com", pageRevision: 1 }).ok).toBe(false);
  });

  it("reports a stale capability as a conflict rather than a hollow success", async () => {
    const r = await fetch(url("/approve", { capabilityId: "no-such-capability" }), {
      method: "POST",
      headers: { "x-bb-token": server.token },
    });
    expect(r.status).toBe(409);
    expect((await r.json()) as { ok: boolean }).toMatchObject({ ok: false });
  });

  it("stops listing a capability once it has been approved or denied", async () => {
    const cap = mintPending();
    await fetch(url("/deny", { capabilityId: cap.capabilityId }), {
      method: "POST",
      headers: { "x-bb-token": server.token },
    });
    const r = await fetch(url("/pending"), { headers: { "x-bb-token": server.token } });
    const body = (await r.json()) as { pending: { capabilityId: string }[] };

    // Showing a human something they cannot act on is its own kind of lie.
    expect(body.pending.some((p) => p.capabilityId === cap.capabilityId)).toBe(false);
  });
});
