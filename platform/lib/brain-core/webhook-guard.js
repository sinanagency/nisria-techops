// @sinanagency/brain-core/webhook-guard
//
// Cross-bot webhook dedup + media-pending buffer. Shared logic that every
// WhatsApp bot in the fleet needs because Meta sends:
//   1. Duplicate webhooks with different wamids for the same message
//   2. Image+text as two separate webhooks (text arrives first, short)
//
// Each bot supplies adapters (seenByWamid, logToChat) that wire to its own
// Supabase tables. The primitive lives here, the adapters live in the bot.
//
// KT #302 (2026-06-16): ported from the hand-rolled concurrency guard in
// Jensen's route.ts that proved the pattern before the brain-core lift.
// Ported to brain-core v0.8 as the second cross-bot primitive (after
// discriminatorMismatch, v0.7).
const PROCESSING_LOCKS = new Map();
const MEDIA_PENDING = new Map();
const MEDIA_WAIT_MS = 2500;
function resolveMediaRef(text) {
    return /^(this|here|see|attached|image|photo|pic|screenshot|look|check|this is|here is|see attached|see this)$/i
        .test(String(text || "").trim());
}
export async function shouldProcess(adapterName, sender, wamid, text, adapters) {
    if (wamid) {
        const seen = await adapters.seenByWamid(wamid);
        if (seen)
            return { action: "skip", reason: "duplicate_wamid" };
    }
    const now = Date.now();
    const lockKey = `${adapterName}::${sender}`;
    const lastSeen = PROCESSING_LOCKS.get(lockKey);
    if (lastSeen !== undefined && now - lastSeen < 2000) {
        if (text)
            await adapters.logToChat(sender, text).catch(() => { });
        return { action: "skip", reason: "concurrent_duplicate" };
    }
    PROCESSING_LOCKS.set(lockKey, now);
    if (text && resolveMediaRef(text)) {
        MEDIA_PENDING.set(sender, { text, ts: now });
        let timedOut = false;
        await new Promise((resolve) => {
            const iv = setInterval(() => {
                if (!MEDIA_PENDING.has(sender)) {
                    clearInterval(iv);
                    resolve();
                }
            }, 100);
            setTimeout(() => {
                clearInterval(iv);
                timedOut = true;
                const buf = MEDIA_PENDING.get(sender);
                if (buf && buf.ts === now)
                    MEDIA_PENDING.delete(sender);
                resolve();
            }, MEDIA_WAIT_MS);
        });
        if (timedOut)
            return { action: "process" };
        return { action: "skip", reason: "merged_with_media" };
    }
    return { action: "process" };
}
export function mediaArrived(sender) {
    const buf = MEDIA_PENDING.get(sender);
    if (!buf)
        return null;
    MEDIA_PENDING.delete(sender);
    return buf.text;
}
export function _resetForTest() {
    PROCESSING_LOCKS.clear();
    MEDIA_PENDING.clear();
}
//# sourceMappingURL=webhook-guard.js.map