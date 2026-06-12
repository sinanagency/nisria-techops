// createOutbound — THE structural fix for the bypass problem.
//
// v0.1 put the wall in a wrapper (sendTextAndLog) while the primitive
// (sendText / sendWhatsApp) stayed publicly callable. Result: ~15 live
// bypasses across the fleet, including Sasa's main reply and Jensen's
// morning brief. Convention does not hold under iteration speed.
//
// v0.2 inverts it. The bot constructs ONE outbound object from its config
// and a transport (the raw Graph fetch it already has). Every send method
// on that object sanitizes text, captions, and template params BEFORE the
// transport sees them. The raw transport is an argument, never an export,
// so there is no unsanitized door to call.
//
// Migration per bot is mechanical:
//   const outbound = createOutbound(SASA_BOT_GUARDS_CONFIG, { graphSend, onCatch, log });
//   export const sendText = outbound.sendText;   // same signature as before
// Every existing caller keeps compiling; every send is now walled.
import { sanitizeReply } from "./pre-send.js";
export function createOutbound(config, deps) {
    async function walled(to, body, build, kind) {
        const s = sanitizeReply(body, config);
        if (s.caught.length && deps.onCatch) {
            try {
                await deps.onCatch({ to, caught: s.caught, dropped: s.dropped, sent: s.body.slice(0, 400) });
            }
            catch { /* alert is best effort */ }
        }
        const result = await deps.graphSend(build(s.body));
        if (deps.log) {
            try {
                await deps.log({ to, body: s.body, kind, result });
            }
            catch { /* log is best effort */ }
        }
        return result;
    }
    return {
        sendText: (to, body) => walled(to, String(body).slice(0, 4096), (clean) => ({ to, type: "text", text: { body: clean, preview_url: false } }), "text"),
        sendImage: (to, link, caption) => caption
            ? walled(to, String(caption).slice(0, 1024), (clean) => ({ to, type: "image", image: { link, caption: clean } }), "image")
            : deps.graphSend({ to, type: "image", image: { link } }),
        sendDocument: (to, link, filename, caption) => caption
            ? walled(to, String(caption).slice(0, 1024), (clean) => ({ to, type: "document", document: { link, filename: String(filename || "file").slice(0, 240), caption: clean } }), "document")
            : deps.graphSend({ to, type: "document", document: { link, filename: String(filename || "file").slice(0, 240) } }),
        // Template params are interpolated into Meta approved copy, but a param can
        // still carry a leak ("task from Stephen"). Sanitize each param in strip
        // semantics: brands inside a param drop THAT param to the reask phrase,
        // never the whole template (the template frame is pre approved and safe).
        sendTemplate: async (to, name, params = [], lang = "en_US") => {
            const cleanParams = params.map((p) => sanitizeReply(String(p), config).body.replace(/\s+/g, " ").slice(0, 1000));
            const components = cleanParams.length
                ? [{ type: "body", parameters: cleanParams.map((t) => ({ type: "text", text: t })) }]
                : undefined;
            const result = await deps.graphSend({ to, type: "template", template: { name, language: { code: lang }, ...(components ? { components } : {}) } });
            if (deps.log) {
                try {
                    await deps.log({ to, body: cleanParams.join(" | "), kind: `template:${name}`, result });
                }
                catch { /* best effort */ }
            }
            return result;
        },
    };
}
//# sourceMappingURL=outbound.js.map