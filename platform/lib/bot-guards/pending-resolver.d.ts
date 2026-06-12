import type { BotGuardsConfig } from "./config.js";
export interface RecentMessage {
    id: string;
    direction: "in" | "out";
    body: string | null;
    created_at: string;
    handled_by?: string | null;
}
export interface PendingContext {
    /** Most recent messages for this contact, newest first, within the lookback window. */
    recent: RecentMessage[];
    /** The current inbound's text. */
    command: string;
    /** Bot config — used for forbiddenBrands check on the resolver's output. */
    config: BotGuardsConfig;
    /** Arbitrary bot-specific extras (sender identity, source ids, etc.). */
    extras?: Record<string, unknown>;
}
export interface ResolverHandler {
    /**
     * Does the most recent bot question match THIS kind? Bot supplies the
     * regex / heuristic. Example: Sasa's task_collecting detects "What's the task?".
     */
    matchesQuestion: (botQuestionBody: string) => boolean;
    /**
     * Should the current inbound be SKIPPED (e.g. it's a "yes" handled by a
     * different layer, or a bullet handled by parseTasks)?
     */
    shouldSkip?: (command: string) => boolean;
    /**
     * Execute the resolution. Bot does the DB write or whatever side-effect
     * is needed, returns the bot's confirmation reply string.
     */
    execute: (ctx: PendingContext) => Promise<{
        ok: boolean;
        reply?: string;
        ref?: string;
        reason?: string;
    } | null>;
}
export interface ResolveOptions {
    /** Lookback window in seconds (default 600 = 10 min). */
    lookbackSeconds?: number;
}
export interface ResolveResult {
    ok: boolean;
    /** The matched kind (one of resolvers keys), or null if nothing matched. */
    kind: string | null;
    reply?: string;
    ref?: string;
    reason?: string;
}
/**
 * Try each registered resolver against the current context. First match wins.
 * Returns null if no resolver matched (caller should fall through to next layer).
 */
export declare function resolvePendingAction(ctx: PendingContext, resolvers: Record<string, ResolverHandler>, opts?: ResolveOptions): Promise<ResolveResult | null>;
//# sourceMappingURL=pending-resolver.d.ts.map