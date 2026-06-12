export type GuardMode = "drop" | "strip";
export interface BannedPattern {
    readonly pattern: RegExp;
    readonly mode: GuardMode;
    /** Short label for logs, e.g. "honest_no_action", "em_dash". */
    readonly label: string;
}
export interface BotGuardsConfigInput {
    readonly botName: string;
    readonly bannedPatterns: readonly BannedPattern[];
    readonly forbiddenBrands: readonly string[];
    readonly intentEnum: readonly string[];
    readonly pendingKinds: readonly string[];
    readonly reaskPhrase: string;
    readonly anthropicApiKey: string;
    readonly classifierModel?: string;
}
/** Compiled, frozen, type branded config. Only defineBotConfig() can make one. */
export interface BotGuardsConfig<Name extends string = string> extends BotGuardsConfigInput {
    readonly botName: Name;
    /** Precompiled brand regexes (word boundary, case insensitive). Internal. */
    readonly __brandRegexes: readonly {
        brand: string;
        re: RegExp;
    }[];
    /** Nominal brand so configs cannot cross by accident. */
    readonly __guard: Name;
}
/**
 * Build a bot's config. Compiles the brand regexes ONCE and freezes everything.
 * This is the only sanctioned constructor; do not hand build the object.
 */
export declare function defineBotConfig<Name extends string>(input: BotGuardsConfigInput & {
    botName: Name;
}): BotGuardsConfig<Name>;
export type Confidence = "high" | "medium" | "low";
export interface ClassifyResult<I extends string = string> {
    intent: I;
    confidence: Confidence;
    reason: string;
    error?: string;
}
export interface PreSendCatch {
    kind: "banned_pattern" | "forbidden_brand";
    pattern: string;
    mode: GuardMode;
    original: string;
}
export interface PreSendResult {
    /** The body that should actually be sent to the user. */
    body: string;
    /** All catches this pass (strip mode can catch several without dropping). */
    caught: PreSendCatch[];
    /** True when the body was fully replaced with reaskPhrase. */
    dropped: boolean;
}
//# sourceMappingURL=config.d.ts.map