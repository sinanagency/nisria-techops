// Honesty guard primitives — factory functions that build pure (reply,
// toolRuns) → boolean classifiers from per-Adapter config. The library holds
// the SHAPE; the Adapter brings the regex catalog and tool-category maps.
//
// Why factories: each guard is conceptually universal ("a claim of done
// without a backing tool" applies to every assistant), but the regex
// constants and tool-category maps are 100% tenant policy — Sasa's
// COMPLETION_TOOLS are different from CTH's, and Sasa's incident-tuned
// SHAPE_MONEY does not necessarily apply to Jensen's hospitality invoices.
//
// Per KT #238: don't pretend these are universal until N tenants have
// converged on the SAME guard shape. For now, the library provides
// machinery + a contract; each Adapter wires its own constants.
const ranSuccessfully = (toolRuns, names) => toolRuns.some((t) => {
    if (!names.has(t.name))
        return false;
    const r = t.result;
    if (r == null)
        return false;
    if (r.ok === false)
        return false;
    if (r.error)
        return false;
    return true;
});
const okIn = (toolRuns, names) => toolRuns.some((t) => names.has(t.name) && t.result?.ok === true);
/**
 * Build a (reply, toolRuns) → boolean guard from a per-tenant config.
 * Returns true when the reply asserts a completed action but no
 * category-matched completion-class tool returned ok=true this turn.
 */
export function makeCompletionGuard(config) {
    return function claimsCompletionWithoutSuccess(reply, toolRuns) {
        const claimsDone = config.agentCompletion.test(reply) || config.doneSimple.test(reply);
        if (!claimsDone)
            return false;
        if (config.futureClaim.test(reply))
            return false;
        const aboutUser = config.aboutUserComplete.test(reply);
        if (aboutUser && !config.agentSelfMark.test(reply))
            return false;
        const parseTasksDidIt = config.parseTasksSucceeded ? config.parseTasksSucceeded(toolRuns) : false;
        const globalReadExempt = config.globalReadExemptTools
            ? ranSuccessfully(toolRuns, config.globalReadExemptTools)
            : false;
        // Per-shape checks: if a shape matches, the backing tool must satisfy it.
        // NOTE: globalReadExempt is intentionally NOT checked per-shape — Sasa's
        // money-shape policy explicitly fires even when list_tasks ran (because a
        // money claim with no record_payment is wrong regardless of what else ran).
        // globalReadExempt only saves the generic catch-all from narration false
        // positives like "I've noted your open tasks: 1. Mark's case" where the
        // case-shape word came from list_tasks narration, not a real action claim.
        for (const shape of config.shapes) {
            if (!shape.regex.test(reply))
                continue;
            if (okIn(toolRuns, shape.requiredTools))
                continue;
            // Read-exemption: a read tool (e.g. list_tasks) normally excuses a shape
            // match, because the model may be QUOTING a title ("Complete the report")
            // from the read rather than claiming it acted. BUT a FIRST-PERSON self-mark
            // ("I marked it complete", "Done, marked the task") is a direct action claim,
            // not a quoted title — a read must NOT excuse it. Shapes opting in with
            // selfMarkNoExempt require a real action tool even when a read ran.
            // (2026-06-26: closes the gym-proven gap where "Done, marked the task
            // complete" + only list_tasks slipped through.)
            if (shape.readTools && ranSuccessfully(toolRuns, shape.readTools)
                && !(shape.selfMarkNoExempt && config.agentSelfMark.test(reply)))
                continue;
            if (shape.parseTasksExempt && parseTasksDidIt)
                continue;
            return true; // matched a shape but nothing backs it
        }
        // Generic catch-all: any completion-class tool's success backs a generic claim.
        if (okIn(toolRuns, config.completionTools))
            return false;
        if (globalReadExempt)
            return false;
        return true;
    };
}
/**
 * Build a (reply, toolRuns) → boolean guard for "claimed to have sent a
 * message but no send-class tool succeeded." Mirrors makeCompletionGuard's
 * shape but simpler: there's only one category (send).
 */
export function makeSendGuard(config) {
    return function claimsSendWithoutSend(reply, toolRuns) {
        if (!config.sendClaim.test(reply))
            return false;
        if (config.futureOrHonest.test(reply))
            return false;
        return !okIn(toolRuns, config.sendTools);
    };
}
/**
 * Build a (reply, toolRuns) → boolean guard for "claimed to have staged
 * something for later confirmation but never called the staging tool."
 */
export function makeStagingGuard(config) {
    return function claimsStagingWithoutTool(reply, toolRuns) {
        if (!config.stagingClaim.test(reply))
            return false;
        return !okIn(toolRuns, config.stagingTools);
    };
}
/**
 * Build a history → boolean check: was a sympathy opener already used in this
 * thread? Adapter calls strip if true to prevent "I'm so sorry, Nur" cascading.
 */
export function makeSympathyGuard(config) {
    return function alreadySympathized(history = []) {
        return history.some((m) => m.role === "assistant" && config.sympathyOpener.test(String(m.content || "")));
    };
}
//# sourceMappingURL=honesty-guards.js.map