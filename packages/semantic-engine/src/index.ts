/**
 * @browser-bridge/semantic-engine — DOM + a11y + layout → compact SemanticViews, with
 * hidden-content reading and scoped-staleness diffing (plan §5). The extractor runs in
 * the page; the host maps its output to the protocol view and keeps fingerprints
 * daemon-side.
 */
export * from "./types.js";
export * from "./extractor.js";
export * from "./revision.js";
export * from "./extract.js";
