import { describe, it, expect } from "vitest";
import { handleAttach, handleView, handleAct, handleFillRecord, handleConfirm, type DaemonLike } from "./handlers.js";
import { AttachInput, ViewInput, ActInput, FillRecordInput, TOOL_NAMES } from "./schemas.js";
import { createMcpServer } from "./server.js";
import type { SemanticView, BatchResult } from "@browser-bridge/protocol";

const view: SemanticView = {
  sessionId: "s",
  pageId: "p",
  revision: 0,
  url: "https://x",
  origin: "https://x",
  title: "t",
  loading: "idle",
  scope: { kind: "all_forms" },
  elements: [],
  forms: [],
  alerts: [],
  trust: { pageContent: "untrusted" },
};

const okResult: BatchResult = { status: "completed", revision: 0, completed: 1, results: [{ target: "Email", status: "verified" }] };

const fake: DaemonLike = {
  attach: async (req) => ({ sessionId: "sess-1", capabilities: { schemaVersion: "v", vision: true, modes: ["semantic"], advancedCssSelectors: false }, _grant: req.grant }) as never,
  view: async () => view,
  act: async () => okResult,
  fillRecord: async () => ({ matched: [{ field: "email", target: "Email", confidence: 0.9 }], unmatched: [], ambiguities: [], batch: okResult }),
  screenshot: async () => ({ bytesBase64: "AAAA", contentType: "image/png" }),
};

const validGrant = {
  taskId: "t",
  allowedOrigins: ["https://x"],
  allowedRiskTiers: ["low"],
  sensitiveDataDestinations: [],
  budgets: {},
  expiresAt: "2999-01-01T00:00:00.000Z",
};

describe("tool input schemas", () => {
  it("accepts a well-formed attach input and rejects one missing the grant", () => {
    expect(AttachInput.safeParse({ grant: validGrant, url: "https://x" }).success).toBe(true);
    expect(AttachInput.safeParse({ url: "https://x" }).success).toBe(false);
  });

  it("validates view and act inputs against the protocol shapes", () => {
    expect(ViewInput.safeParse({ sessionId: "s", scope: { kind: "all_forms" } }).success).toBe(true);
    expect(ViewInput.safeParse({ sessionId: "s", scope: { kind: "nope" } }).success).toBe(false);
    expect(ActInput.safeParse({ sessionId: "s", batch: { actions: [{ op: "fill", target: { name: "Email" }, value: "a" }] } }).success).toBe(true);
    expect(ActInput.safeParse({ sessionId: "s", batch: { actions: [{ op: "teleport" }] } }).success).toBe(false);
  });
});

describe("handlers dispatch to the daemon", () => {
  it("attach → view → act", async () => {
    const attach = await handleAttach(fake, AttachInput.parse({ grant: validGrant }));
    expect(attach.sessionId).toBe("sess-1");
    const v = await handleView(fake, ViewInput.parse({ sessionId: "sess-1", scope: { kind: "all_forms" } }));
    expect(v.trust.pageContent).toBe("untrusted");
    const r = await handleAct(fake, ActInput.parse({ sessionId: "sess-1", batch: { actions: [{ op: "fill", target: { name: "Email" }, value: "a" }] } }));
    expect(r.status).toBe("completed");
  });

  it("fill_record dispatches and returns matches", async () => {
    const r = await handleFillRecord(fake, FillRecordInput.parse({ sessionId: "s", record: { email: "a@b.com" }, ambiguityPolicy: "ask" }));
    expect(r.matched[0]?.field).toBe("email");
    expect(r.batch.status).toBe("completed");
  });

  it("bridge_confirm only nudges the UI; it authors nothing", () => {
    expect(handleConfirm()).toEqual({ surfaced: true });
  });
});

describe("tool surface", () => {
  it("exposes exactly the 6 tools shipped through M2, all bridge_-prefixed", () => {
    expect(TOOL_NAMES).toHaveLength(6);
    expect(TOOL_NAMES.every((n) => n.startsWith("bridge_"))).toBe(true);
    expect(new Set(TOOL_NAMES).size).toBe(6);
    expect(TOOL_NAMES).toContain("bridge_fill_record");
  });

  it("constructs an MCP server over a daemon", () => {
    const server = createMcpServer(fake);
    expect(server).toBeDefined();
  });
});
