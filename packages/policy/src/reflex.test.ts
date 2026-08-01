import { describe, it, expect } from "vitest";
import { decideReflex } from "./reflex.js";

describe("decideReflex", () => {
  it("rejects non-essential on a consent banner that offers a reject option — never accept all", () => {
    const d = decideReflex({
      kind: "cookie_consent",
      consentBearing: true,
      taskRelevant: false,
      hasRejectOption: true,
    });
    expect(d.action).toBe("reject_non_essential");
  });

  it("surfaces a consent banner with no clean reject/necessary-only option", () => {
    const d = decideReflex({ kind: "cookie_consent", consentBearing: true, taskRelevant: false });
    expect(d.action).toBe("surface");
  });

  it("dismisses a non-task-relevant, non-consent popup", () => {
    const d = decideReflex({ kind: "newsletter", consentBearing: false, taskRelevant: false });
    expect(d.action).toBe("dismiss");
  });

  it("surfaces a task-relevant modal instead of touching it", () => {
    const d = decideReflex({ kind: "modal", consentBearing: false, taskRelevant: true });
    expect(d.action).toBe("surface");
  });

  it("never auto-dismisses a consent banner even when dismissal is enabled", () => {
    const d = decideReflex(
      { kind: "cookie_consent", consentBearing: true, taskRelevant: false, hasRejectOption: false },
      { dismissNonEssentialPopups: true, consentDefault: "reject" },
    );
    expect(d.action).toBe("surface");
  });
});
