// @sinanagency/brain-core — public API.
//
// Empty machinery for sinanagency bots. Each Adapter brings its own
// persona text, tool implementations, DB connection, and audience rules.
// The package itself ships zero tenant-specific knowledge.
//
// v0.1 surface: prompt cache split primitive (the first piece extracted
// from Sasa's runSasa, arch2 c8e510f). Subsequent versions add the
// Anthropic client wrapper, tool dispatch loop, and honesty guards.
export { splitForCache } from "./prompt-cache.js";
export { runClaude } from "./claude-client.js";
export { isAmbiguousReference, isCapabilityQuestion, isHedge, isHedgeLoop } from "./intent-detect.js";
export { makeCompletionGuard, makeSendGuard, makeStagingGuard, makeSympathyGuard } from "./honesty-guards.js";
// v0.6 (2026-06-16): schema-drift detector. See schema-guard.ts header for
// the 2026-06-15 Sasa cascade that motivated this.
export { checkSchema, formatSchemaResult } from "./schema-guard.js";
//# sourceMappingURL=index.js.map