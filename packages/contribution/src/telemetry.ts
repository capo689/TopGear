/**
 * Product telemetry (§9.2, live at R1 with the same classification discipline).
 * Aggregated and structural: pattern hit/miss, per-widget success, and scorecard metrics.
 * No content, no URLs beyond origin, no values.
 */
export interface Telemetry {
  patternHits: number;
  patternMisses: number;
  perWidgetSuccess: Record<string, { attempts: number; verified: number }>;
  turns: number;
  interventions: number;
}

export function emptyTelemetry(): Telemetry {
  return { patternHits: 0, patternMisses: 0, perWidgetSuccess: {}, turns: 0, interventions: 0 };
}

export function recordWidgetOutcome(t: Telemetry, widgetKind: string, verified: boolean): void {
  const bucket = t.perWidgetSuccess[widgetKind] ?? { attempts: 0, verified: 0 };
  bucket.attempts += 1;
  if (verified) bucket.verified += 1;
  t.perWidgetSuccess[widgetKind] = bucket;
}
