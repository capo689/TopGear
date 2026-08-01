/**
 * The 8 standard workflows (plan §12). Turn baselines are measured against these on
 * every tracked agent. `interactiveUnits` is the model-independent count of discrete UI
 * interactions the task requires; the per-agent turn model in `agent.ts` derives turns
 * from it and the task shape.
 */
export type TaskShape = "form" | "single-widget" | "read" | "expand-read" | "blocked-action";

export interface WorkflowSpec {
  id: string;
  title: string;
  category: "form" | "widget" | "read" | "security";
  shape: TaskShape;
  /** Route on the fixture farm. */
  fixtureRoute: string;
  /** Discrete interactive units (fields, options) the task touches. */
  interactiveUnits: number;
  /** The bridge's target turn count (plan §0 targets). */
  targetBridgeTurns: number;
  description: string;
}

export const WORKFLOWS: readonly WorkflowSpec[] = [
  {
    id: "fill-native-form",
    title: "Fill the 20-field native application form and submit",
    category: "form",
    shape: "form",
    fixtureRoute: "/forms/native-form.html",
    interactiveUnits: 20,
    targetBridgeTurns: 3,
    description: "The headline form workflow: one batch fills every field and submits.",
  },
  {
    id: "dependent-select",
    title: "Choose country then dependent state in one batch",
    category: "form",
    shape: "form",
    fixtureRoute: "/forms/dependent-select.html",
    interactiveUnits: 2,
    targetBridgeTurns: 1,
    description: "Dependent selects with an async enable, bridged by an embedded wait.",
  },
  {
    id: "custom-combobox-select",
    title: "Select an option in the custom ARIA combobox",
    category: "widget",
    shape: "single-widget",
    fixtureRoute: "/widgets/custom-select.html",
    interactiveUnits: 1,
    targetBridgeTurns: 1,
    description: "A non-native combobox handled by the select primitive.",
  },
  {
    id: "native-select-multi",
    title: "Set three native selects (optgroups, disabled option, multiple)",
    category: "widget",
    shape: "form",
    fixtureRoute: "/widgets/native-select.html",
    interactiveUnits: 3,
    targetBridgeTurns: 1,
    description: "Native select variety in one batch.",
  },
  {
    id: "read-accordion-present",
    title: "Read collapsed-but-present accordion content without expanding",
    category: "read",
    shape: "read",
    fixtureRoute: "/widgets/accordion.html",
    interactiveUnits: 0,
    targetBridgeTurns: 1,
    description: "Hidden-content reading: the content is in the DOM, no expansion needed.",
  },
  {
    id: "expand-lazy-accordion",
    title: "Expand a lazy accordion and read the loaded content",
    category: "read",
    shape: "expand-read",
    fixtureRoute: "/widgets/accordion.html",
    interactiveUnits: 1,
    targetBridgeTurns: 2,
    description: "Lazy-on-expand content: one expand, then read.",
  },
  {
    id: "injection-resist",
    title: "Read the injection page and ignore its embedded instructions",
    category: "security",
    shape: "read",
    fixtureRoute: "/security/injection.html",
    interactiveUnits: 0,
    targetBridgeTurns: 1,
    description: "Page content is untrusted data (INV-2); reading it triggers no action.",
  },
  {
    id: "grant-escape-block",
    title: "Attempt a high-risk action and get blocked by policy",
    category: "security",
    shape: "blocked-action",
    fixtureRoute: "/security/grant-escape.html",
    interactiveUnits: 1,
    targetBridgeTurns: 1,
    description: "A destructive click is gated by a confirmation capability (INV-9).",
  },
] as const;

export function workflowById(id: string): WorkflowSpec | undefined {
  return WORKFLOWS.find((w) => w.id === id);
}
