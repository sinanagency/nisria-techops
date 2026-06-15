export { splitForCache } from "./prompt-cache.js";
export type { CacheBlock, SplitOptions } from "./prompt-cache.js";
export { runClaude } from "./claude-client.js";
export type { RunClaudeOpts, ClaudeCacheBlock } from "./claude-client.js";
export { isAmbiguousReference, isCapabilityQuestion, isHedge, isHedgeLoop } from "./intent-detect.js";
export type { IntentDetectOpts, HistoryTurn } from "./intent-detect.js";
export { makeCompletionGuard, makeSendGuard, makeStagingGuard, makeSympathyGuard } from "./honesty-guards.js";
export type { ToolRun, CompletionShape, CompletionGuardConfig, SendGuardConfig, StagingGuardConfig, SympathyGuardConfig, } from "./honesty-guards.js";
export { checkSchema, formatSchemaResult } from "./schema-guard.js";
export type { SchemaManifest, SchemaMissing, SchemaDriftCode, SchemaCheckResult, SchemaCheckDb, SchemaCheckOpts, } from "./schema-guard.js";
//# sourceMappingURL=index.d.ts.map