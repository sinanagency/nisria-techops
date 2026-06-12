// BotGuardsConfig v0.2 — the contamination contract, hardened.
//
// Changes from v0.1:
//   1. bannedPatterns entries now carry a MODE:
//        "drop"  → replace the whole body with reaskPhrase (brand leaks, canned lines)
//        "strip" → remove the matched token, keep the rest of the reply
//      A stray em dash should not nuke a 400 word legitimate answer.
//   2. forbiddenBrands are PRECOMPILED once at config build time via
//      defineBotConfig(). No regex compilation on the send hot path.
//   3. Branded type: each config is tagged with its botName at the type level.
//      Passing CTH's config where Sasa's sender expects Sasa's is a compile error.
//   4. defineBotConfig() freezes the object. No runtime mutation of the wall.
function escapeRegex(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
/**
 * Build a bot's config. Compiles the brand regexes ONCE and freezes everything.
 * This is the only sanctioned constructor; do not hand build the object.
 */
export function defineBotConfig(input) {
    const forbiddenBrands = Object.freeze([...input.forbiddenBrands]);
    const __brandRegexes = forbiddenBrands
        .filter(Boolean)
        .map((brand) => Object.freeze({ brand, re: new RegExp("\\b" + escapeRegex(brand) + "\\b", "i") }));
    return Object.freeze({
        ...input,
        bannedPatterns: Object.freeze([...input.bannedPatterns].map((p) => Object.freeze({ ...p }))),
        forbiddenBrands,
        intentEnum: Object.freeze([...input.intentEnum]),
        pendingKinds: Object.freeze([...input.pendingKinds]),
        __brandRegexes: Object.freeze(__brandRegexes),
        __guard: input.botName,
    });
}
//# sourceMappingURL=config.js.map