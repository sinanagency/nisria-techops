// Generic pending-action resolver. Pattern-based, not bot-specific.
//
// The lib provides the SHAPE of the resolver. Each bot supplies its own
// resolver functions per kind via the resolvers map. The lib handles:
//   - Looking up recent bot question
//   - Matching the question against a per-bot "this was a clarifying question" detector
//   - Routing the current inbound to the matching kind's resolver
//
// This is the generalization of nisria-techops/lib/pending-task-resolver.ts.
/**
 * Try each registered resolver against the current context. First match wins.
 * Returns null if no resolver matched (caller should fall through to next layer).
 */
export async function resolvePendingAction(ctx, resolvers, opts = {}) {
    const { recent, command } = ctx;
    if (!command || !command.trim() || !recent.length)
        return null;
    const lookbackMs = (opts.lookbackSeconds ?? 600) * 1000;
    const now = Date.now();
    const lastBot = recent.find((m) => m.direction === "out" && (m.handled_by || "").toLowerCase() !== "");
    if (!lastBot)
        return null;
    if (now - new Date(lastBot.created_at).getTime() > lookbackMs)
        return null;
    const botBody = String(lastBot.body || "");
    for (const [kind, handler] of Object.entries(resolvers)) {
        if (handler.shouldSkip && handler.shouldSkip(command))
            continue;
        if (!handler.matchesQuestion(botBody))
            continue;
        const result = await handler.execute(ctx);
        if (!result)
            return null;
        return {
            ok: result.ok,
            kind,
            reply: result.reply,
            ref: result.ref,
            reason: result.reason,
        };
    }
    return null;
}
//# sourceMappingURL=pending-resolver.js.map