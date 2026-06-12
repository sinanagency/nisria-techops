// Pre send deterministic checker, v0.2. Pure function. No I/O.
//
// Order:
//   1. forbiddenBrands (precompiled at defineBotConfig) → ALWAYS drop mode.
//      A brand leak is a contamination event; the whole reply dies.
//   2. bannedPatterns → per entry mode:
//        drop  → whole body replaced with reaskPhrase, scan stops
//        strip → matched token removed, scan continues
//
// The caller logs `caught` (the alert is I/O and lives in the bot).
export function sanitizeReply(body, config) {
    if (!body)
        return { body, caught: [], dropped: false };
    const caught = [];
    // 1) Contamination wall. Precompiled, word boundary, case insensitive.
    for (const { brand, re } of config.__brandRegexes) {
        if (re.test(body)) {
            caught.push({ kind: "forbidden_brand", pattern: brand, mode: "drop", original: body.slice(0, 800) });
            return { body: config.reaskPhrase, caught, dropped: true };
        }
    }
    // 2) Per bot patterns.
    let out = body;
    for (const entry of config.bannedPatterns) {
        if (!entry.pattern.test(out))
            continue;
        if (entry.mode === "drop") {
            caught.push({ kind: "banned_pattern", pattern: entry.label, mode: "drop", original: body.slice(0, 800) });
            return { body: config.reaskPhrase, caught, dropped: true };
        }
        // strip: remove the token, tidy whitespace, keep the answer.
        const g = new RegExp(entry.pattern.source, entry.pattern.flags.includes("g") ? entry.pattern.flags : entry.pattern.flags + "g");
        out = out.replace(g, " ").replace(/ {2,}/g, " ").replace(/\s+([,.;:!?])/g, "$1").trim();
        caught.push({ kind: "banned_pattern", pattern: entry.label, mode: "strip", original: body.slice(0, 800) });
    }
    return { body: out, caught, dropped: false };
}
//# sourceMappingURL=pre-send.js.map