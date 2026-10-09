import { describe, it, expect } from "vitest";
import vercelContributions from "../../../api/contributions.ts";
import vercelHealth from "../../../api/health.ts";
import { Consent } from "@browser-bridge/contribution";

function call(handler: any, req: unknown): { status: number; body: string } {
  const out = { status: 0, body: "" };
  const res = { setHeader() {}, status(s: number) { out.status = s; return this; }, end(b?: string) { out.body = b ?? ""; } };
  const r = handler(req as never, res as never);
  return Object.assign(out, { done: r });
}

describe("commons ingest is opt-in", () => {
  it("refuses every contribution when COMMONS_INGEST_ENABLED is unset, even with storage configured", async () => {
    delete process.env.COMMONS_INGEST_ENABLED;
    process.env.SUPABASE_DB_URL = "postgres://browser_bridge_app@test/db";
    const r = call(vercelContributions, { method: "POST", headers: {}, body: { origin: "https://x.test" } });
    await (r as any).done;
    expect(r.status).toBe(410);
    delete process.env.SUPABASE_DB_URL;
  });

  it("health reports disabled when the flag is unset", () => {
    delete process.env.COMMONS_INGEST_ENABLED;
    const r = call(vercelHealth, {});
    expect(JSON.parse(r.body).storage).toBe("disabled");
  });

  it("client consent defaults to off", () => {
    expect(new Consent().enabled).toBe(false);
  });
});
