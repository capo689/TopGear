import { z } from "zod";
import { LocatorInput, FillValue } from "./primitives.js";

/**
 * Glob-style URL matching only — no arbitrary regex from models (plan §4.4). Kept as a
 * plain string here; the daemon compiles it with a safe glob matcher.
 */
const UrlGlob = z.string();

const ElementStateValue = z.enum([
  "visible",
  "hidden",
  "enabled",
  "disabled",
  "attached",
  "detached",
]);

/** Conditions the daemon can wait on locally, costing zero model turns (plan §4.4). */
export const WaitCondition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("element_state"), target: LocatorInput, state: ElementStateValue }),
  z.object({ type: z.literal("url_changed"), urlGlob: UrlGlob.optional() }),
  z.object({ type: z.literal("text_present"), text: z.string(), target: LocatorInput.optional() }),
  z.object({ type: z.literal("network_idle") }),
  z.object({ type: z.literal("form_valid"), target: LocatorInput.optional() }),
  z.object({ type: z.literal("dialog") }),
  z.object({ type: z.literal("download_complete") }),
]);
export type WaitCondition = z.infer<typeof WaitCondition>;

/** Predicates an `if` action branches on — evaluated by the daemon against the page. */
export const PageCondition = z.discriminatedUnion("type", [
  z.object({ type: z.literal("element_present"), target: LocatorInput }),
  z.object({ type: z.literal("element_state"), target: LocatorInput, state: ElementStateValue }),
  z.object({ type: z.literal("text_present"), text: z.string(), target: LocatorInput.optional() }),
  z.object({ type: z.literal("url_matches"), urlGlob: UrlGlob }),
  z.object({ type: z.literal("form_valid"), target: LocatorInput.optional() }),
]);
export type PageCondition = z.infer<typeof PageCondition>;

// --- Action members. Non-recursive members are plain objects; `if` is recursive. ---

const FillAction = z.object({ op: z.literal("fill"), target: LocatorInput, value: FillValue });
const CheckAction = z.object({ op: z.literal("check"), target: LocatorInput, value: z.boolean() });
const ClickAction = z.object({ op: z.literal("click"), target: LocatorInput, capability: z.string().optional() });
const PressAction = z.object({ op: z.literal("press"), target: LocatorInput.optional(), key: z.string() });
const ScrollAction = z.object({
  op: z.literal("scroll"),
  target: LocatorInput.optional(),
  direction: z.enum(["up", "down"]),
  amount: z.number().optional(),
});
const UploadAction = z.object({ op: z.literal("upload"), target: LocatorInput, fileToken: z.string() });
const SelectAction = z.object({
  op: z.literal("select"),
  target: LocatorInput,
  value: z.union([z.string(), z.array(z.string())]),
});
const SetDateAction = z.object({ op: z.literal("set_date"), target: LocatorInput, value: z.string() });
const SearchPickAction = z.object({
  op: z.literal("search_pick"),
  target: LocatorInput,
  query: z.string(),
  pick: z.union([z.string(), z.object({ index: z.number().int().nonnegative() })]),
});
const OpenMenuPathAction = z.object({ op: z.literal("open_menu_path"), path: z.array(z.string()) });
const ExpandAction = z.object({ op: z.literal("expand"), target: LocatorInput });
const GotoAction = z.object({ op: z.literal("goto"), url: z.string() });
const GotoIntentAction = z.object({ op: z.literal("goto_intent"), intent: z.string() });
const WaitAction = z.object({
  op: z.literal("wait"),
  condition: WaitCondition,
  timeoutMs: z.number().int().positive().optional(),
});

/** The `if` action — a tiny declarative conditional, NOT a scripting language. */
export interface IfAction {
  op: "if";
  condition: PageCondition;
  then: Action[];
  else?: Action[];
}

/**
 * A single action. `if` nests recursively; the daemon enforces the depth/expansion
 * caps (see `checkBatchCaps`). Every nested action, reflex, and replayed step passes
 * the SAME policy engine (INV-5) — a conditional cannot pre-authorize a gated action.
 */
export type Action =
  | z.infer<typeof FillAction>
  | z.infer<typeof CheckAction>
  | z.infer<typeof ClickAction>
  | z.infer<typeof PressAction>
  | z.infer<typeof ScrollAction>
  | z.infer<typeof UploadAction>
  | z.infer<typeof SelectAction>
  | z.infer<typeof SetDateAction>
  | z.infer<typeof SearchPickAction>
  | z.infer<typeof OpenMenuPathAction>
  | z.infer<typeof ExpandAction>
  | z.infer<typeof GotoAction>
  | z.infer<typeof GotoIntentAction>
  | z.infer<typeof WaitAction>
  | IfAction;

export const IfAction: z.ZodType<IfAction> = z.lazy(() =>
  z.object({
    op: z.literal("if"),
    condition: PageCondition,
    then: z.array(Action),
    else: z.array(Action).optional(),
  }),
);

export const Action: z.ZodType<Action> = z.lazy(() =>
  z.union([
    FillAction,
    CheckAction,
    ClickAction,
    PressAction,
    ScrollAction,
    UploadAction,
    SelectAction,
    SetDateAction,
    SearchPickAction,
    OpenMenuPathAction,
    ExpandAction,
    GotoAction,
    GotoIntentAction,
    WaitAction,
    IfAction,
  ]),
);

/** All valid action op discriminants. */
export type ActionOp = Action["op"];

/** A batch of actions submitted through `bridge_act` (plan §4.4, §7). */
export const ActionBatch = z.object({
  actions: z.array(Action),
  /** Stop the whole batch on the first failure rather than skipping dependents. */
  stopOnFailure: z.boolean().optional(),
  /** Reject if the targeted elements/forms changed since this revision (scoped). */
  expectedRevision: z.number().int().optional(),
});
export type ActionBatch = z.infer<typeof ActionBatch>;
